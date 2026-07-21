import { orderCode } from '../lib/format.js'

// Only the last 4 chars are bold; the prefix is explicitly font-normal so it
// stays regular weight even when the parent element is font-bold. The bold is
// font-bold (not extrabold) so the digits read as one continuous run.
//
// Everything is wrapped in a single inline span so this always renders as ONE
// element. Returning a bare fragment made the two halves separate children — if
// the parent was a flex row with `gap`, that gap got inserted *between* the
// digits and the last-4, looking like a gap in the number.
export function boldLast4(s) {
  if (!s) return s
  if (s.length <= 4) return <b className="font-bold">{s}</b>
  return (
    <span className="whitespace-nowrap">
      <span className="font-normal">{s.slice(0, -4)}</span>
      <b className="font-bold">{s.slice(-4)}</b>
    </span>
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
