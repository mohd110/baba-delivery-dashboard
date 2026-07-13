import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase.js'

// Default trading hours: open 8:00 AM, close at midnight -> closed 12 AM–8 AM.
export const DEFAULT_OPEN = '08:00:00'
export const DEFAULT_CLOSE = '00:00:00'

// Whether the schedule auto open/close is enabled is a per-device preference
// (we don't want to add a DB column for it), stored in localStorage.
const AUTO_KEY = 'wbf.autoSchedule'
export const isAutoScheduleOn = () =>
  typeof window !== 'undefined' && window.localStorage.getItem(AUTO_KEY) === '1'
export const setAutoScheduleOn = (on) => {
  if (typeof window !== 'undefined') window.localStorage.setItem(AUTO_KEY, on ? '1' : '0')
}

// "HH:MM[:SS]" -> minutes since midnight (null if unparseable).
function toMinutes(t) {
  if (!t) return null
  const [h, m] = String(t).split(':')
  const mins = Number(h) * 60 + Number(m || 0)
  return Number.isFinite(mins) ? mins : null
}

// Should the store be open at `now` for the given schedule? Handles windows
// that wrap past midnight (e.g. open 08:00, close 00:00 => closed 12 AM–8 AM).
export function isWithinOpenHours(now, open, close) {
  const o = toMinutes(open)
  const c = toMinutes(close)
  if (o == null || c == null || o === c) return true // treat as 24 hours
  const cur = now.getHours() * 60 + now.getMinutes()
  if (o < c) return cur >= o && cur < c // same-day window
  return cur >= o || cur < c // wraps past midnight
}

// Shared restaurant open-state + schedule, kept in sync via realtime. Every
// consumer sees the same status because it all reads/writes the same rows.
let channelSeq = 0

export function useRestaurant() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  // Unique channel name per hook instance so multiple consumers don't clash.
  const [channelName] = useState(() => `restaurant-status-${++channelSeq}`)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('restaurants').select('*').order('name', { ascending: true })
    if (error) console.error('Failed to load restaurant status:', error.message)
    else setRows(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'restaurants' }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [load, channelName])

  const primary = rows[0] || null
  // The store counts as open only when every outlet is open.
  const isOpen = rows.length > 0 && rows.every((r) => r.is_open)
  const openTime = primary?.opening_time || DEFAULT_OPEN
  const closeTime = primary?.closing_time || DEFAULT_CLOSE

  // Flip every outlet's is_open flag (optimistic; reloads on failure).
  const setOpen = useCallback(
    async (next) => {
      const ids = rows.map((r) => r.id)
      if (ids.length === 0) return { error: { message: 'No outlet found to update.' } }
      setRows((prev) => prev.map((r) => ({ ...r, is_open: next })))
      const { error } = await supabase.from('restaurants').update({ is_open: next }).in('id', ids)
      if (error) load()
      return { error }
    },
    [rows, load]
  )

  // Persist trading hours to every outlet.
  const saveSchedule = useCallback(
    async (open, close) => {
      const ids = rows.map((r) => r.id)
      if (ids.length === 0) return { error: { message: 'No outlet found to update.' } }
      const { error } = await supabase
        .from('restaurants')
        .update({ opening_time: open, closing_time: close })
        .in('id', ids)
      if (!error) {
        setRows((prev) => prev.map((r) => ({ ...r, opening_time: open, closing_time: close })))
      }
      return { error }
    },
    [rows]
  )

  return { rows, loading, isOpen, openTime, closeTime, setOpen, saveSchedule, reload: load }
}
