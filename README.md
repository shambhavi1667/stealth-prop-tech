## Decisions

### 1. Shares are created at bill creation time, not lazily
When a bill is created, shares for all current members are immediately inserted into the database. This means the split is fixed at the moment the bill is added. I chose this approach because it makes the balance query simple (just sum unpaid shares), avoids race conditions where a new member joins after a bill is created, and keeps the data consistent.

### 2. Concurrent payment protection via WHERE paid_at IS NULL
To prevent two people paying the same share at the same time, the UPDATE query uses `WHERE id = ? AND paid_at IS NULL`. Only one concurrent request can match this condition and update the row. I then check `meta.changes === 0` — if no rows were updated, another request got there first and I return 409. This uses SQLite's atomic UPDATE rather than application-level locking.

### 3. Idempotency key stored on the share row
The `idempotency_key` column on the shares table stores the key used for a successful payment. When the same key is sent again for the same share, I return 200 with the existing result instead of attempting a second payment. If a different key is sent for an already-paid share, I return 409. This makes the pay endpoint safe to retry without double-charging.