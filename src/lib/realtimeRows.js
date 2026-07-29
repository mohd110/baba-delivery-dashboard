import { useEffect, useRef } from 'react'

/* Apply a realtime row event to local state without refetching the table.
 *
 * Every page here used to subscribe with `event: '*'` and respond `() => load()`,
 * which re-downloads every row — joins included — to learn about one changed
 * field. Order rows change roughly five times each on their way from pending to
 * delivered, and the dashboard writes to `orders` itself (late_since,
 * eta_minutes, auto-cancel), so pages were also paying full table egress for
 * their own writes.
 *
 * An UPDATE payload carries the complete new row, so for a row we already hold
 * we can merge it in and skip the round trip entirely.
 *
 * What still needs a real reload — because Postgres changefeeds carry only the
 * row itself, never its joined relations (`order_items`, `rider`, …):
 *   - INSERT: a brand-new order has no joined rows in the payload
 *   - DELETE: nothing to merge
 *   - UPDATE of a row we don't hold: it has just entered this page's filter, so
 *     we need its joins fetched
 */
export function patchRowFromEvent(payload, { rowsRef, setRows, reload }) {
  if (payload.eventType !== 'UPDATE') { reload(); return }
  const row = payload.new
  if (!row?.id || !rowsRef.current.some((r) => r.id === row.id)) { reload(); return }
  setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...row } : r)))
}

/* A ref that always mirrors `rows`, so a realtime callback can read the current
 * list without being re-created (and thus without tearing down and re-opening
 * the channel) every time the data changes. */
export function useRowMirror(rows) {
  const ref = useRef(rows)
  useEffect(() => { ref.current = rows }, [rows])
  return ref
}
