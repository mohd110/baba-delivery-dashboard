import { setOptions, importLibrary } from '@googlemaps/js-api-loader'

/* Google Maps JS API — the same key/project the rider + customer app use
 * (there it's NEXT_PUBLIC_GOOGLE_MAPS_KEY; Vite needs its own VITE_ prefix to
 * expose it to the browser). Put it in `.env.local` for dev and in the Vercel
 * project env for prod:
 *
 *   VITE_GOOGLE_MAPS_KEY=AIza...
 *
 * The key's HTTP-referrer restrictions must include the dashboard's domain,
 * otherwise Google refuses the script and the map tiles never load.
 *
 * Everything that consumes this degrades gracefully when the key is missing —
 * the UI keeps the plain "open in Google Maps" links it had before. */
export const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY || ''
export const hasMapsKey = () => Boolean(MAPS_KEY)

// setOptions may only be called once, and only before the first importLibrary.
let optionsSet = false
let libsPromise = null

/** Loads the maps/marker/core libraries once per page, shared by every map. */
export function loadMapLibs() {
  if (!MAPS_KEY) return Promise.reject(new Error('VITE_GOOGLE_MAPS_KEY is not set'))
  if (!libsPromise) {
    if (!optionsSet) {
      setOptions({ key: MAPS_KEY, v: 'weekly' })
      optionsSet = true
    }
    libsPromise = Promise.all([
      importLibrary('maps'),
      importLibrary('marker'),
      importLibrary('core'),
    ]).catch((err) => {
      // Don't cache a failed load — a transient network error would otherwise
      // leave every map on the page permanently broken.
      libsPromise = null
      throw err
    })
  }
  return libsPromise
}

// Muted, low-clutter theme — matches the tracking map in the customer/rider app
// rather than raw Google Maps.
export const MAP_STYLE = [
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative', elementType: 'labels', stylers: [{ visibility: 'simplified' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#f4f4f4' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#cfe7f5' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#fde4dc' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#ffcfc0' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#e3e3e3' }] },
]

// Kanpur — only used when nothing on the map has coordinates.
export const FALLBACK_CENTER = { lat: 26.4499, lng: 80.3319 }

/** Postgres numerics arrive as numbers or strings depending on the driver. */
export function toCoords(lat, lng) {
  const la = Number(lat)
  const ln = Number(lng)
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null
  if (la === 0 && ln === 0) return null
  return { lat: la, lng: ln }
}

export const gmapsLink = (lat, lng) =>
  `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
