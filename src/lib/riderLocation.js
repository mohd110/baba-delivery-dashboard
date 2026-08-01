import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'

/* Live GPS position of one rider.
 *
 * `rider_locations` is unique per order_id (see 002_rider_flow.sql), so a rider
 * who has been on several orders has several rows — the newest `updated_at` is
 * the one that matters. The rider app upserts every few seconds, which is why
 * this only ever runs for ONE rider at a time (the one whose panel/modal is
 * open) instead of subscribing to the whole table: an unfiltered subscription
 * here would pull every ping from every rider into the dashboard.
 *
 * Returns null while loading, when there's no rider, or when the rider has
 * never reported a position. */
export function useRiderLocation(riderId) {
  // The rider each position belongs to is stored alongside it, so switching
  // riders reads as "nothing yet" on the very first render instead of needing a
  // clearing setState inside the effect (which would cascade a render).
  const [state, setState] = useState({ riderId: null, loc: null })

  useEffect(() => {
    if (!riderId) return
    let alive = true

    supabase
      .from('rider_locations')
      .select('rider_id, order_id, latitude, longitude, updated_at')
      .eq('rider_id', riderId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .then(({ data, error }) => {
        if (!alive) return
        if (error) {
          console.error('Failed to load rider location:', error.message)
          return
        }
        setState({ riderId, loc: data?.[0] ?? null })
      })

    const channel = supabase
      .channel(`rider-location-${riderId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rider_locations', filter: `rider_id=eq.${riderId}` },
        (payload) => {
          const row = payload.new
          if (payload.eventType === 'DELETE' || row?.latitude == null || row?.longitude == null) return
          setState((prev) => {
            // Rows for the rider's older orders can still be touched — keep the
            // freshest ping, and never mix in another rider's row.
            const cur = prev.riderId === riderId ? prev.loc : null
            if (cur && new Date(row.updated_at) < new Date(cur.updated_at)) return prev
            return { riderId, loc: row }
          })
        }
      )
      .subscribe()

    return () => {
      alive = false
      supabase.removeChannel(channel)
    }
  }, [riderId])

  return state.riderId === riderId ? state.loc : null
}
