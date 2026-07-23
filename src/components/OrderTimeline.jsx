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
      <ol className="rounded-lg border border-line p-3">
        {steps.map((s, i) => {
          const isLast = i === steps.length - 1
          const nextDone = !isLast && steps[i + 1].done
          const time = fmtStepTime(s.at)
          return (
            <li key={i} className="flex gap-3">
              <div className="flex flex-col items-center self-stretch">
                <span
                  className={`z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                    s.cancelled
                      ? 'bg-red-500 text-white'
                      : s.done
                        ? 'bg-pos text-white'
                        : 'border-2 border-line-2 bg-white'
                  }`}
                >
                  {s.cancelled ? (
                    <X className="h-3.5 w-3.5" />
                  ) : s.done ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-line-2" />
                  )}
                </span>
                {!isLast && <span className={`w-0.5 flex-1 ${nextDone ? 'bg-pos' : 'bg-line-2'}`} />}
              </div>
              <div className={`-mt-0.5 ${isLast ? 'pb-0' : 'pb-4'}`}>
                <p className={`text-xs font-semibold ${s.done ? 'text-ink' : 'text-ink-soft'}`}>{s.label}</p>
                {(time || !s.done) && (
                  <p className="text-[11px] text-ink-soft">{time || 'Pending'}</p>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
