import { useCallback, useEffect, useRef, useState } from 'react'
import { loadMapLibs, MAP_STYLE, FALLBACK_CENTER, hasMapsKey } from '../lib/googleMaps.js'

/* A Google map with up to three pins — outlet 🍴, delivery address 🏠 and the
 * live rider 🛵 — styled like the tracking map in the customer/rider app.
 *
 * The map is built once; only the rider marker moves as new GPS pings arrive,
 * so a rider reporting every few seconds doesn't tear the map down and rebuild
 * it. The view auto-fits on creation and on the first rider fix, then leaves
 * the camera alone so panning/zooming isn't yanked back.
 *
 * Every coordinate prop is optional — pass what you have. */
export default function LiveMap({
  rider = null,
  restaurant = null,
  customer = null,
  className = 'h-52 w-full',
  showRoute = true,
}) {
  const hostRef = useRef(null)
  const instRef = useRef(null)
  const riderRef = useRef(rider)
  const [failed, setFailed] = useState(false)

  // Serialised so the map isn't rebuilt every time the parent re-renders and
  // hands us fresh object literals with identical numbers.
  const key = (c) => (c ? `${c.lat},${c.lng}` : '')
  const restaurantKey = key(restaurant)
  const customerKey = key(customer)
  const riderKey = key(rider)

  // Push the latest rider position onto the marker, fitting the view the first
  // time we hear from them.
  const applyRider = useCallback(() => {
    const inst = instRef.current
    const coords = riderRef.current
    if (!inst) return
    if (!coords) {
      inst.riderMarker.setVisible(false)
      return
    }
    inst.riderMarker.setPosition(coords)
    inst.riderMarker.setVisible(true)
    if (!inst.riderFitted) {
      inst.riderFitted = true
      inst.bounds.extend(coords)
      if (inst.pointCount > 0) inst.map.fitBounds(inst.bounds, 60)
      else inst.map.setCenter(coords)
    }
  }, [])

  useEffect(() => {
    riderRef.current = riderKey
      ? { lat: Number(riderKey.split(',')[0]), lng: Number(riderKey.split(',')[1]) }
      : null
    applyRider()
  }, [riderKey, applyRider])

  useEffect(() => {
    if (!hasMapsKey()) return
    let alive = true

    const parse = (k) => (k ? { lat: Number(k.split(',')[0]), lng: Number(k.split(',')[1]) } : null)
    const rCoords = parse(restaurantKey)
    const cCoords = parse(customerKey)

    loadMapLibs()
      .then(([{ Map, Polyline }, { Marker }, { LatLngBounds, SymbolPath }]) => {
        if (!alive || !hostRef.current) return

        // White circular badge with an emoji glyph — the delivery-app style pin.
        const badge = (borderColor) => ({
          path: SymbolPath.CIRCLE,
          scale: 15,
          fillColor: '#ffffff',
          fillOpacity: 1,
          strokeColor: borderColor,
          strokeWeight: 3,
        })

        const map = new Map(hostRef.current, {
          center: rCoords ?? cCoords ?? riderRef.current ?? FALLBACK_CENTER,
          zoom: 14,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: 'greedy',
          styles: MAP_STYLE,
        })

        const bounds = new LatLngBounds()
        let pointCount = 0

        if (showRoute && rCoords && cCoords) {
          new Polyline({
            path: [rCoords, cCoords],
            map,
            strokeOpacity: 0,
            icons: [
              {
                icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, strokeColor: '#b51c00', scale: 3 },
                offset: '0',
                repeat: '14px',
              },
            ],
          })
        }

        if (rCoords) {
          new Marker({
            position: rCoords,
            map,
            icon: badge('#b51c00'),
            label: { text: '🍴', fontSize: '13px' },
            title: 'Outlet',
            zIndex: 10,
          })
          bounds.extend(rCoords)
          pointCount += 1
        }

        if (cCoords) {
          new Marker({
            position: cCoords,
            map,
            icon: badge('#191c1d'),
            label: { text: '🏠', fontSize: '13px' },
            title: 'Delivery address',
            zIndex: 10,
          })
          bounds.extend(cCoords)
          pointCount += 1
        }

        if (pointCount > 1) map.fitBounds(bounds, 60)

        const riderMarker = new Marker({
          map,
          visible: false,
          icon: badge('#2563eb'),
          label: { text: '🛵', fontSize: '13px' },
          title: 'Rider',
          zIndex: 999,
        })

        instRef.current = { map, riderMarker, bounds, pointCount, riderFitted: false }
        applyRider()
      })
      .catch((err) => {
        console.error('Google Maps failed to load:', err.message)
        if (alive) setFailed(true)
      })

    return () => {
      alive = false
      const inst = instRef.current
      if (inst) {
        inst.riderMarker.setMap(null)
        instRef.current = null
      }
    }
  }, [restaurantKey, customerKey, showRoute, applyRider])

  if (!hasMapsKey() || failed) {
    return (
      <div className={`${className} flex items-center justify-center rounded-lg border border-line bg-canvas`}>
        <p className="px-4 text-center text-[11px] font-semibold text-ink-soft">
          {failed ? 'Map could not load' : 'Map unavailable — VITE_GOOGLE_MAPS_KEY is not set'}
        </p>
      </div>
    )
  }

  return <div ref={hostRef} className={className} />
}
