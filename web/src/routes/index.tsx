import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'

const HOME_ID = '1'
const API = 'http://localhost:8787'

// --- Types ---

type Share = {
  id: string
  memberId: string
  amountCents: number
  paidAt: string | null
}

type Bill = {
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: Share[]
}

// --- Helpers ---

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

// --- Main Component ---

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  const [bills, setBills] = useState<Bill[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [payingShareId, setPayingShareId] = useState<string | null>(null)
  const [payErrors, setPayErrors] = useState<Record<string, string>>({})

  const loadBills = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API}/api/homes/${HOME_ID}/bills`)
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        setError(data.error ?? 'Failed to load bills')
        return
      }
      const data = (await res.json()) as { bills: Bill[] }
      setBills(data.bills)
    } catch {
      setError('Could not reach the server. Is the API running?')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadBills()
  }, [loadBills])

  async function payShare(billId: string, shareId: string) {
    setPayingShareId(shareId)
    setPayErrors((prev) => ({ ...prev, [shareId]: '' }))

    try {
      const res = await fetch(`${API}/api/bills/${billId}/shares/${shareId}/pay`, {
        method: 'POST',
        headers: {
          'Idempotency-Key': crypto.randomUUID(),
        },
      })

      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        setPayErrors((prev) => ({
          ...prev,
          [shareId]: data.error ?? 'Payment failed',
        }))
        return
      }

      // refresh bills after successful payment
      await loadBills()
    } catch {
      setPayErrors((prev) => ({
        ...prev,
        [shareId]: 'Could not reach the server',
      }))
    } finally {
      setPayingShareId(null)
    }
  }

  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif', maxWidth: 640 }}>
      <h1 style={{ marginBottom: 4 }}>🏠 Bill Splitter</h1>
      <p style={{ color: '#666', marginBottom: 24 }}>Home #{HOME_ID}</p>

      {/* Loading state */}
      {loading && <p style={{ color: '#888' }}>Loading bills...</p>}

      {/* Error state */}
      {error && (
        <div
          style={{
            background: '#fee',
            border: '1px solid #fcc',
            borderRadius: 8,
            padding: 16,
            marginBottom: 16,
          }}
        >
          <strong>Error:</strong> {error}
          <br />
          <button type="button" onClick={loadBills} style={{ marginTop: 8, cursor: 'pointer' }}>
            Retry
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && bills.length === 0 && (
        <p style={{ color: '#888' }}>No bills yet for this home.</p>
      )}

      {/* Bills list */}
      {!loading &&
        bills.map((bill) => (
          <div
            key={bill.id}
            style={{
              border: '1px solid #ddd',
              borderRadius: 8,
              padding: 16,
              marginBottom: 16,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <strong style={{ fontSize: 16 }}>{bill.title}</strong>
              <span style={{ color: '#555' }}>{formatCents(bill.totalCents)}</span>
            </div>

            {bill.shares.map((share) => (
              <div
                key={share.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 0',
                  borderTop: '1px solid #eee',
                }}
              >
                <div>
                  <span style={{ fontSize: 14, color: '#333' }}>Member #{share.memberId}</span>
                  <span style={{ marginLeft: 12, fontSize: 14 }}>
                    {formatCents(share.amountCents)}
                  </span>
                  {share.paidAt && (
                    <span style={{ marginLeft: 12, fontSize: 12, color: 'green' }}>✓ Paid</span>
                  )}
                  {payErrors[share.id] && (
                    <span style={{ marginLeft: 12, fontSize: 12, color: 'red' }}>
                      {payErrors[share.id]}
                    </span>
                  )}
                </div>

                {!share.paidAt && (
                  <button
                    type="button"
                    disabled={payingShareId === share.id}
                    onClick={() => payShare(bill.id, share.id)}
                    style={{
                      cursor: payingShareId === share.id ? 'not-allowed' : 'pointer',
                      padding: '4px 12px',
                      borderRadius: 4,
                      border: '1px solid #999',
                      background: payingShareId === share.id ? '#eee' : '#fff',
                    }}
                  >
                    {payingShareId === share.id ? 'Paying...' : 'Pay'}
                  </button>
                )}
              </div>
            ))}
          </div>
        ))}
    </main>
  )
}
