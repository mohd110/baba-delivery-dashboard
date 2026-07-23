import { Check, X } from 'lucide-react'

// Zomato-style order timeline. Each step is backed by a timestamp column on the
// orders row (see ORDER_TIMELINE_HANDOFF.md); a step shows "done" when its
// timestamp is set, or when the order's status has already moved past it (so a
// delivered order still checks every step even if a rider-app timestamp is
// missing). Times render where known.
const TIMELINE_STEPS = [
  { key: 'created_at',       label: 'Placed' },
  { key: 'accepted_at',      label: 'Accepted' },
  { key: 'rider_arrived_at', label: 'Delivery partner arrived' },
  { key: 'ready_at',         label: 'Ready' },
  { key: 'picked_up_at',     label: 'Picked up' },
  { key: 'delivered_at',     label: 'Delivered' },
]

// Furthest step index a non-cancelled status has reached.
const STATUS_REACHED = {
  pending: 0, accepted: 1, preparing: 1, ready: 3, out_for_delivery: 4, delivered: 5,
}

function fmtStepTime(iso) {
  if (!iso) return null
  const d = new Date(iso)
  return isNaN(d.getTime()) ? null : d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
}

// "14 minutes" between two timestamps, for the "Delivered in …" caption.
function durationText(fromIso, toIso) {
  if (!fromIso || !toIso) return null
  const mins = Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60000)
  return Number.isFinite(mins) && mins >= 0 ? `${mins} minute${mins === 1 ? '' : 's'}` : null
}

export default function OrderTimeline({ order }) {
  if (!order) return null
  const cancelled = order.status === 'cancelled'
  let steps
  if (cancelled) {
    // Show Placed plus any milestone actually reached, then a Cancelled endpoint.
    steps = TIMELINE_STEPS
      .map((s) => ({ label: s.label, at: order[s.key] || null, done: order[s.key] != null }))
      .filter((s, i) => i === 0 || s.at != null)
    steps.push({ label: 'Cancelled', at: order.cancelled_at || null, done: true, cancelled: true })
  } else {
    const reached = STATUS_REACHED[order.status] ?? 0
    steps = TIMELINE_STEPS.map((s, i) => ({
      label: s.label,
      at: order[s.key] || null,
      done: order[s.key] != null || i <= reached,
    }))
  }

  const delivered = durationText(order.created_at, order.delivered_at)

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-[10px] font-bold uppercase tracking-wider text-ink-soft">Order Timeline</h4>
        {cancelled ? (
          <span className="text-[11px] font-semibold text-red-600">Order cancelled</span>
        ) : delivered ? (
          <span className="text-[11px] font-semibold text-pos-dark">Delivered in {delivered}</span>
        ) : null}
      </div>
      {/* Horizontal stepper — scrolls sideways when the container is narrow. */}
      <div className="overflow-x-auto rounded-lg border border-line px-2 py-4">
        <ol className="flex min-w-max">
          {steps.map((s, i) => {
            const isFirst = i === 0
            const isLast = i === steps.length - 1
            const time = fmtStepTime(s.at)
            // The segment feeding into a node is "done" (green) when that node
            // is reached; the segment leaving it is green when the next is.
            const leftOn = s.done
            const rightOn = !isLast && steps[i + 1].done
            return (
              <li key={i} className="flex w-[104px] shrink-0 flex-col items-center">
                <div className="flex w-full items-center">
                  <span className={`h-0.5 flex-1 ${isFirst ? 'invisible' : leftOn ? 'bg-pos' : 'bg-line-2'}`} />
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                      s.cancelled
                        ? 'bg-red-500 text-white'
                        : s.done
                          ? 'bg-pos text-white'
                          : 'border-2 border-line-2 bg-white'
                    }`}
                  >
                    {s.cancelled ? (
                      <X className="h-4 w-4" />
                    ) : s.done ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-line-2" />
                    )}
                  </span>
                  <span className={`h-0.5 flex-1 ${isLast ? 'invisible' : rightOn ? 'bg-pos' : 'bg-line-2'}`} />
                </div>
                <p className={`mt-1.5 px-1 text-center text-[11px] font-semibold leading-tight ${s.done ? 'text-ink' : 'text-ink-soft'}`}>
                  {s.label}
                </p>
                {(time || !s.done) && (
                  <p className="mt-0.5 text-center text-[10px] text-ink-soft">{time || 'Pending'}</p>
                )}
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}
