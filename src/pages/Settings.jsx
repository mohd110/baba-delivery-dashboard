import { useEffect, useRef, useState } from 'react'
import { Clock, DoorOpen, Save, CheckCircle } from 'lucide-react'
import Topbar, { TopIcons } from '../layout/Topbar.jsx'
import {
  useRestaurant,
  isAutoScheduleOn,
  setAutoScheduleOn,
  isWithinOpenHours,
} from '../lib/restaurant.js'

// "HH:MM:SS" -> "HH:MM" for a time input; "HH:MM" -> "HH:MM:00" for the DB.
const toInput = (t) => (t ? String(t).slice(0, 5) : '')
const toDb = (t) => (t ? `${t}:00` : null)

// "08:00" -> "8:00 AM"
function fmt12(t) {
  if (!t) return '—'
  const [hStr, m] = t.split(':')
  let h = Number(hStr)
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${m} ${ampm}`
}

function Toggle({ on, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`flex h-6 w-11 items-center rounded-full p-0.5 transition-colors ${on ? 'bg-brand' : 'bg-line-2'}`}
    >
      <span
        className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0'}`}
      />
    </button>
  )
}

export default function Settings() {
  const { loading, openTime, closeTime, saveSchedule } = useRestaurant()
  const [openVal, setOpenVal] = useState('')
  const [closeVal, setCloseVal] = useState('')
  const [auto, setAuto] = useState(isAutoScheduleOn())
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const seeded = useRef(false)

  // Seed the inputs from the saved schedule once it has loaded.
  useEffect(() => {
    if (!loading && !seeded.current) {
      setOpenVal(toInput(openTime))
      setCloseVal(toInput(closeTime))
      seeded.current = true
    }
  }, [loading, openTime, closeTime])

  const save = async () => {
    setSaving(true)
    setSaved(false)
    setAutoScheduleOn(auto)
    const { error } = await saveSchedule(toDb(openVal), toDb(closeVal))
    setSaving(false)
    if (error) {
      alert(`Could not save schedule: ${error.message}`)
      return
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  // Live preview of whether these hours mean open or closed right now.
  const openNow = openVal && closeVal ? isWithinOpenHours(new Date(), openVal, closeVal) : true

  return (
    <>
      <Topbar>
        <h1 className="text-xl font-bold text-ink">Settings & Permissions</h1>
        <TopIcons />
      </Topbar>

      <div className="max-w-2xl space-y-6 p-8">
        {/* Business hours */}
        <div className="rounded-xl border border-line bg-white p-6">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-light text-brand">
              <Clock className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-bold text-ink">Business Hours</h2>
              <p className="text-xs text-ink-soft">Set when the restaurant accepts orders.</p>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">
                Opens at
              </label>
              <input
                type="time"
                value={openVal}
                onChange={(e) => setOpenVal(e.target.value)}
                className="w-full rounded-lg border border-line px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">
                Closes at
              </label>
              <input
                type="time"
                value={closeVal}
                onChange={(e) => setCloseVal(e.target.value)}
                className="w-full rounded-lg border border-line px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
              />
            </div>
          </div>

          {openVal && closeVal && (
            <p className="mt-3 text-xs text-ink-soft">
              Open <b className="text-ink">{fmt12(openVal)}</b> – <b className="text-ink">{fmt12(closeVal)}</b>
              {' · '}Closed <b className="text-ink">{fmt12(closeVal)}</b> – <b className="text-ink">{fmt12(openVal)}</b>
            </p>
          )}

          {/* Auto open/close */}
          <div className="mt-5 flex items-start justify-between gap-4 rounded-lg border border-line-soft bg-canvas/40 p-4">
            <div>
              <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                <DoorOpen className="h-4 w-4 text-ink-soft" /> Auto open &amp; close on schedule
              </p>
              <p className="mt-1 text-xs text-ink-soft">
                When on, the restaurant automatically closes outside the hours above and reopens
                when they start. You can still override it manually from the Active Orders page.
              </p>
              <p className="mt-2 text-xs font-semibold">
                Right now this schedule is:{' '}
                <span className={openNow ? 'text-pos-dark' : 'text-brand'}>
                  {openNow ? 'OPEN' : 'CLOSED'}
                </span>
              </p>
            </div>
            <Toggle on={auto} onChange={setAuto} />
          </div>

          <div className="mt-6 flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={saving || loading}
              className="flex items-center gap-2 rounded-lg bg-brand px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-dark disabled:opacity-50"
            >
              <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save Changes'}
            </button>
            {saved && (
              <span className="flex items-center gap-1.5 text-sm font-semibold text-pos-dark">
                <CheckCircle className="h-4 w-4 text-pos" /> Saved
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
