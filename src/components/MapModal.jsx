import { ExternalLink, MapPin, X } from 'lucide-react'
import LiveMap from './LiveMap.jsx'
import { gmapsLink, hasMapsKey } from '../lib/googleMaps.js'

function sinceLabel(iso) {
  if (!iso) return null
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (!Number.isFinite(sec)) return null
  if (sec < 60) return 'updated just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `updated ${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `updated ${hr}h ago`
  return `updated ${Math.floor(hr / 24)}d ago`
}

function Legend({ colour, glyph, label }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-ink-soft">
      <span
        className="flex h-4 w-4 items-center justify-center rounded-full bg-white text-[9px]"
        style={{ border: `2px solid ${colour}` }}
      >
        {glyph}
      </span>
      {label}
    </span>
  )
}

/* Full-screen map dialog used by "View Map" (order) and "Live pin" (rider).
 * Rendered conditionally by the parent — mounting it opens it. */
export default function MapModal({
  title,
  subtitle,
  onClose,
  rider = null,
  restaurant = null,
  customer = null,
  riderUpdatedAt = null,
  riderName = 'Rider',
}) {
  const since = sinceLabel(riderUpdatedAt)

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h3 className="text-sm font-bold text-ink">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-ink-soft">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1.5 text-ink-soft hover:bg-line-soft hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <LiveMap
          rider={rider}
          restaurant={restaurant}
          customer={customer}
          className="h-[60vh] max-h-[520px] w-full"
        />

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
          <div className="flex flex-wrap items-center gap-3">
            {restaurant && <Legend colour="#b51c00" glyph="🍴" label="Outlet" />}
            {customer && <Legend colour="#191c1d" glyph="🏠" label="Customer" />}
            {rider ? (
              <Legend colour="#2563eb" glyph="🛵" label={since ? `${riderName} · ${since}` : riderName} />
            ) : (
              <span className="text-[11px] font-semibold text-ink-soft">
                {hasMapsKey() ? 'Waiting for rider GPS…' : ''}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {rider && (
              <a
                href={gmapsLink(rider.lat, rider.lng)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-semibold text-info hover:underline"
              >
                <MapPin className="h-3.5 w-3.5" /> Rider in Google Maps <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {customer && (
              <a
                href={gmapsLink(customer.lat, customer.lng)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-semibold text-info hover:underline"
              >
                <MapPin className="h-3.5 w-3.5" /> Address in Google Maps <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
