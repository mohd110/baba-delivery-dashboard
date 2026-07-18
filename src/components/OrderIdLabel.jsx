import { orderCode } from '../lib/format.js'

// Bold the last 4 characters of an order code — that's the part staff read out
// to identify an order, so it stands out from the rest of the id.
// Uses font-extrabold + a slightly larger size so the last 4 pop even when the
// surrounding text is already font-bold.
export function boldLast4(s) {
  if (!s) return s
  if (s.length <= 4) return <b className="font-extrabold text-[1.05em]">{s}</b>
  return (
    <>
      {s.slice(0, -4)}
      <b className="font-extrabold text-[1.05em]">{s.slice(-4)}</b>
    </>
  )
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
