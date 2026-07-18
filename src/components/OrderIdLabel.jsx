import { orderCode } from '../lib/format.js'

// Last 4 chars are bold+extrabold; the prefix is explicitly font-normal so it
// stays regular weight even when the parent element is font-bold.
export function boldLast4(s) {
  if (!s) return s
  if (s.length <= 4) return <b className="font-extrabold">{s}</b>
  return (
    <>
      <span className="font-normal">{s.slice(0, -4)}</span>
      <b className="font-extrabold">{s.slice(-4)}</b>
    </>
  )
}

// Render an order code with its "BB" prefix in brand red (uppercased) and the
// remainder in ink black, with only the last 4 characters bold.
export function OrderIdLabel({ order, className = '' }) {
  const code = orderCode(order)
  const m = /^bb(.*)$/i.exec(code)
  if (!m) return <span className={className}>{boldLast4(code)}</span>
  return (
    <span className={className}>
      <span className="font-normal text-brand">BB</span>
      <span className="text-ink">{boldLast4(m[1])}</span>
    </span>
  )
}
