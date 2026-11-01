import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono<{ Bindings: Env }>()
app.use('*', cors())

app.get('/api/health', (c) => c.json({ status: 'ok' }))

// POST /api/homes
app.post('/api/homes', async (c) => {
  const body = await c.req.json<{ name?: unknown }>()

  if (typeof body.name !== 'string' || body.name.trim() === '') {
    return c.json({ error: 'name is required' }, 400)
  }

  const name = body.name.trim()

  const result = await c.env.DB.prepare('INSERT INTO homes (name) VALUES (?) RETURNING id, name')
    .bind(name)
    .first<{ id: number; name: string }>()

  if (!result) {
    return c.json({ error: 'failed to create home' }, 500)
  }

  return c.json({ id: String(result.id), name: result.name }, 201)
})

// POST /api/homes/:homeId/members
app.post('/api/homes/:homeId/members', async (c) => {
  const homeId = Number(c.req.param('homeId'))

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()

  if (!home) {
    return c.json({ error: 'home not found' }, 404)
  }

  const body = await c.req.json<{ name?: unknown }>()

  if (typeof body.name !== 'string' || body.name.trim() === '') {
    return c.json({ error: 'name is required' }, 400)
  }

  const name = body.name.trim()

  const result = await c.env.DB.prepare(
    'INSERT INTO members (home_id, name) VALUES (?, ?) RETURNING id, home_id AS homeId, name',
  )
    .bind(homeId, name)
    .first<{ id: number; homeId: number; name: string }>()

  if (!result) {
    return c.json({ error: 'failed to create member' }, 500)
  }

  return c.json(
    {
      id: String(result.id),
      homeId: String(result.homeId),
      name: result.name,
    },
    201,
  )
})

// helper: split cents across n members, remainder goes to first members
function splitCents(total: number, count: number): number[] {
  const base = Math.floor(total / count)
  const remainder = total % count
  return Array.from({ length: count }, (_, i) => (i < remainder ? base + 1 : base))
}

// POST /api/homes/:homeId/bills
app.post('/api/homes/:homeId/bills', async (c) => {
  const homeId = Number(c.req.param('homeId'))

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()

  if (!home) {
    return c.json({ error: 'home not found' }, 404)
  }

  const body = await c.req.json<{ title?: unknown; totalCents?: unknown }>()

  if (
    typeof body.totalCents !== 'number' ||
    !Number.isInteger(body.totalCents) ||
    body.totalCents <= 0
  ) {
    return c.json({ error: 'totalCents must be a positive whole number' }, 422)
  }

  if (typeof body.title !== 'string' || body.title.trim() === '') {
    return c.json({ error: 'title is required' }, 422)
  }

  const title = body.title.trim()
  const totalCents = body.totalCents

  const membersResult = await c.env.DB.prepare(
    'SELECT id FROM members WHERE home_id = ? ORDER BY id ASC',
  )
    .bind(homeId)
    .all<{ id: number }>()

  const members = membersResult.results

  if (members.length === 0) {
    return c.json({ error: 'home has no members' }, 422)
  }

  const bill = await c.env.DB.prepare(
    'INSERT INTO bills (home_id, title, total_cents) VALUES (?, ?, ?) RETURNING id',
  )
    .bind(homeId, title, totalCents)
    .first<{ id: number }>()

  if (!bill) {
    return c.json({ error: 'failed to create bill' }, 500)
  }

  const billId = bill.id
  const amounts = splitCents(totalCents, members.length)

  const shares: {
    id: string
    memberId: string
    amountCents: number
    paidAt: null
  }[] = []

  for (let i = 0; i < members.length; i++) {
    const member = members[i]

    if (!member) continue

    const share = await c.env.DB.prepare(
      'INSERT INTO shares (bill_id, member_id, amount_cents) VALUES (?, ?, ?) RETURNING id, member_id AS memberId, amount_cents AS amountCents',
    )
      .bind(billId, member.id, amounts[i])
      .first<{ id: number; memberId: number; amountCents: number }>()

    if (!share) continue

    shares.push({
      id: String(share.id),
      memberId: String(share.memberId),
      amountCents: share.amountCents,
      paidAt: null,
    })
  }

  return c.json(
    {
      id: String(billId),
      homeId: String(homeId),
      title,
      totalCents,
      shares,
    },
    201,
  )
})

// POST /api/bills/:billId/shares/:shareId/pay
app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const billId = Number(c.req.param('billId'))
  const shareId = Number(c.req.param('shareId'))
  const idempotencyKey = c.req.header('Idempotency-Key')

  if (!idempotencyKey) {
    return c.json({ error: 'Idempotency-Key header is required' }, 400)
  }

  const bill = await c.env.DB.prepare('SELECT id FROM bills WHERE id = ?').bind(billId).first()

  if (!bill) {
    return c.json({ error: 'bill not found' }, 404)
  }

  const share = await c.env.DB.prepare(
    'SELECT id, member_id AS memberId, amount_cents AS amountCents, paid_at AS paidAt, idempotency_key AS idempotencyKey FROM shares WHERE id = ? AND bill_id = ?',
  )
    .bind(shareId, billId)
    .first<{
      id: number
      memberId: number
      amountCents: number
      paidAt: string | null
      idempotencyKey: string | null
    }>()

  if (!share) {
    return c.json({ error: 'share not found' }, 404)
  }

  if (share.paidAt !== null) {
    if (share.idempotencyKey === idempotencyKey) {
      return c.json({
        id: String(share.id),
        memberId: String(share.memberId),
        amountCents: share.amountCents,
        paidAt: share.paidAt,
      })
    }
    return c.json({ error: 'share already paid with a different key' }, 409)
  }

  const paidAt = new Date().toISOString()
  const updateResult = await c.env.DB.prepare(
    'UPDATE shares SET paid_at = ?, idempotency_key = ? WHERE id = ? AND paid_at IS NULL',
  )
    .bind(paidAt, idempotencyKey, shareId)
    .run()

  if (updateResult.meta.changes === 0) {
    return c.json({ error: 'share already paid with a different key' }, 409)
  }

  return c.json({
    id: String(share.id),
    memberId: String(share.memberId),
    amountCents: share.amountCents,
    paidAt,
  })
})

// GET /api/homes/:homeId/balances
app.get('/api/homes/:homeId/balances', async (c) => {
  const homeId = Number(c.req.param('homeId'))

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()

  if (!home) {
    return c.json({ error: 'home not found' }, 404)
  }

  const result = await c.env.DB.prepare(
    `SELECT 
      m.id AS memberId,
      m.name,
      COALESCE(SUM(CASE WHEN s.paid_at IS NULL THEN s.amount_cents ELSE 0 END), 0) AS outstandingCents
    FROM members m
    LEFT JOIN shares s ON s.member_id = m.id
    LEFT JOIN bills b ON b.id = s.bill_id AND b.home_id = ?
    WHERE m.home_id = ?
    GROUP BY m.id, m.name
    ORDER BY m.id ASC`,
  )
    .bind(homeId, homeId)
    .all<{ memberId: number; name: string; outstandingCents: number }>()

  const balances = result.results.map((row) => ({
    memberId: String(row.memberId),
    name: row.name,
    outstandingCents: row.outstandingCents,
  }))

  return c.json({ balances })
})

// GET /api/homes/:homeId/bills
app.get('/api/homes/:homeId/bills', async (c) => {
  const homeId = Number(c.req.param('homeId'))

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()

  if (!home) {
    return c.json({ error: 'home not found' }, 404)
  }

  const billsResult = await c.env.DB.prepare(
    'SELECT id, home_id AS homeId, title, total_cents AS totalCents FROM bills WHERE home_id = ? ORDER BY id ASC',
  )
    .bind(homeId)
    .all<{ id: number; homeId: number; title: string; totalCents: number }>()

  const bills = await Promise.all(
    billsResult.results.map(async (bill) => {
      const sharesResult = await c.env.DB.prepare(
        'SELECT id, member_id AS memberId, amount_cents AS amountCents, paid_at AS paidAt FROM shares WHERE bill_id = ? ORDER BY id ASC',
      )
        .bind(bill.id)
        .all<{ id: number; memberId: number; amountCents: number; paidAt: string | null }>()

      return {
        id: String(bill.id),
        homeId: String(bill.homeId),
        title: bill.title,
        totalCents: bill.totalCents,
        shares: sharesResult.results.map((s) => ({
          id: String(s.id),
          memberId: String(s.memberId),
          amountCents: s.amountCents,
          paidAt: s.paidAt,
        })),
      }
    }),
  )

  return c.json({ bills })
})

export default app
