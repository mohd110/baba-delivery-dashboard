import { orderCode } from '../lib/format.js'

// Bold the last 4 characters of an order code — that's the part staff read out
// to identify an order, so it stands out from the rest of the id.
export function boldLast4(s) {
  if (!s) return s
  if (s.length <= 4) return <b className="font-bold">{s}</b>
  return <>{s.slice(0, -4)}<b className="font-bold">{s.slice(-4)}</b></>
}

// Render an order code with its "BB" prefix in brand red (uppercased) and the
// remainder in ink black, with the last 4 characters bold.
export function OrderIdLabel({ order, className = '' }) {
  const code = orderCode(order)
  const m = /^bb(.*)$/i.exec(code)
  if (!m) return <span className={className}>{boldLast4(code)}</span>
  return (
    <span className={className}>
      <span className="text-brand">BB</span>
      <span className="text-ink">{boldLast4(m[1])}</span>
    </span>
  )
}
