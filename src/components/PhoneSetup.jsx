import { useState, useSyncExternalStore } from 'react'
import { X, Bell, BellRing, Check, Download, Share, SquarePlus, MoreVertical, Smartphone } from 'lucide-react'
import {
  canPromptInstall,
  enableNotifications,
  isIos,
  isStandalone,
  markPhoneSetupDone,
  notificationsSupported,
  promptInstall,
  subscribeInstall,
} from '../lib/device.js'

/* First-run setup sheet for a phone: turn on new-order notifications, and add
 * the dashboard to the home screen as an app. Shown once per device (the flag
 * lives in this browser's storage) and reopenable from the phone header.
 *
 * iPhone is the awkward one: Safari only allows notifications for a site that
 * has been added to the home screen and opened from there. Home-screen apps on
 * iOS also get their own storage, so this sheet naturally shows again on that
 * first launch — which is exactly when the notification step can work. */

function StepRow({ n, title, sub, icon }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-light text-sm font-bold text-brand">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-ink">{title}</p>
        {sub && <p className="mt-0.5 text-[11px] text-ink-soft">{sub}</p>}
      </div>
      {icon && (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-line-soft text-ink">{icon}</span>
      )}
    </div>
  )
}

function Section({ title, done, children }) {
  return (
    <section className="rounded-2xl border border-line p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink">
        {done ? (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-pos text-white">
            <Check className="h-3.5 w-3.5 stroke-[3]" />
          </span>
        ) : null}
        {title}
      </h3>
      {children}
    </section>
  )
}

export default function PhoneSetup({ onClose }) {
  const ios = isIos()
  const installed = isStandalone()
  const canInstall = useSyncExternalStore(subscribeInstall, canPromptInstall, canPromptInstall)
  const [perm, setPerm] = useState(() => (notificationsSupported() ? Notification.permission : 'unsupported'))
  const [busy, setBusy] = useState(false)

  const allowNotifications = async () => {
    setBusy(true)
    try { setPerm(await enableNotifications()) } finally { setBusy(false) }
  }

  const finish = () => { markPhoneSetupDone(); onClose() }

  // On iPhone, notifications only exist inside the home-screen app, so the
  // install step comes first there.
  const iosNeedsInstall = ios && !installed

  const notifySection = (
    <Section title="Get new-order notifications" done={perm === 'granted'}>
      {perm === 'granted' ? (
        <p className="text-xs text-ink-soft">
          Notifications are on. New orders will pop up on this phone, even when the app is closed.
        </p>
      ) : iosNeedsInstall ? (
        <p className="text-xs text-ink-soft">
          On iPhone, notifications only work from the home-screen app. Add it using the steps
          below, open <b>WB Admin</b> from your home screen, and allow notifications there.
        </p>
      ) : perm === 'denied' ? (
        <p className="text-xs text-ink-soft">
          Notifications are blocked for this site. To turn them back on, open the browser menu →{' '}
          <b>Settings → Site settings → Notifications</b>, allow this site, then reopen the app.
        </p>
      ) : perm === 'unsupported' ? (
        <p className="text-xs text-ink-soft">
          This browser can’t show notifications. Open the dashboard in <b>Chrome</b>
          {ios ? ' or Safari' : ''} to get new-order alerts.
        </p>
      ) : (
        <>
          <p className="mb-3 text-xs text-ink-soft">
            Get an alert on this phone the moment an order comes in, so none are missed.
          </p>
          <button
            type="button"
            onClick={allowNotifications}
            disabled={busy}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand text-sm font-bold text-white hover:bg-brand-dark disabled:opacity-60"
          >
            <BellRing className="h-4 w-4" /> {busy ? 'Turning on…' : 'Allow notifications'}
          </button>
        </>
      )}
    </Section>
  )

  const installSection = (
    <Section title="Add the app to your home screen" done={installed}>
      {installed ? (
        <p className="text-xs text-ink-soft">You’re using the home-screen app. You’re all set.</p>
      ) : ios ? (
        <div className="space-y-3">
          <StepRow n={1} title="Tap the Share button" sub="The square with an arrow, at the bottom of Safari" icon={<Share className="h-5 w-5 text-info" />} />
          <StepRow n={2} title="Tap “Add to Home Screen”" sub="Scroll down the share sheet to find it" icon={<SquarePlus className="h-5 w-5" />} />
          <StepRow n={3} title="Tap “Add”" sub="The WB Admin icon appears on your home screen" icon={<Check className="h-5 w-5 text-pos" />} />
        </div>
      ) : canInstall ? (
        <>
          <p className="mb-3 text-xs text-ink-soft">
            Opens full screen like a normal app, with the Wali Baba logo on your home screen.
          </p>
          <button
            type="button"
            onClick={promptInstall}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-ink text-sm font-bold text-white"
          >
            <Download className="h-4 w-4" /> Install app
          </button>
        </>
      ) : (
        <div className="space-y-3">
          <StepRow n={1} title="Tap the ⋮ menu" sub="Top-right corner of Chrome" icon={<MoreVertical className="h-5 w-5" />} />
          <StepRow n={2} title="Tap “Add to Home screen”" sub="Or “Install app”, if you see that instead" icon={<SquarePlus className="h-5 w-5" />} />
          <StepRow n={3} title="Tap “Install” or “Add”" sub="The WB Admin icon appears on your home screen" icon={<Check className="h-5 w-5 text-pos" />} />
        </div>
      )}
    </Section>
  )

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 px-3 pb-3 backdrop-blur-sm sm:items-center">
      <div className="flex max-h-full w-full max-w-sm flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="relative bg-brand px-5 pb-4 pt-5">
          <button
            type="button"
            onClick={onClose}
            title="Close"
            className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-full bg-white/20"
          >
            <X className="h-4 w-4 text-white" />
          </button>
          <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-white p-1.5">
            <img src="/assets/wali-baba-logo.png" alt="" className="h-full w-full object-contain" />
          </span>
          <h2 className="flex items-center gap-1.5 text-base font-extrabold leading-tight text-white">
            <Smartphone className="h-4 w-4" /> Set up this phone
          </h2>
          <p className="mt-1 text-xs text-white/80">
            Two quick steps so new orders reach you, and the dashboard opens like an app.
          </p>
        </div>

        <div className="space-y-3 overflow-y-auto px-4 py-4">
          {iosNeedsInstall ? (
            <>
              {installSection}
              {notifySection}
            </>
          ) : (
            <>
              {notifySection}
              {installSection}
            </>
          )}
        </div>

        <div className="flex flex-col gap-1 px-4 pb-4">
          <button
            type="button"
            onClick={finish}
            className="h-11 w-full rounded-xl bg-brand text-sm font-bold text-white hover:bg-brand-dark"
          >
            Done
          </button>
          <button type="button" onClick={onClose} className="flex h-9 items-center justify-center gap-1 text-xs font-medium text-ink-soft">
            <Bell className="h-3 w-3" /> Remind me later
          </button>
        </div>
      </div>
    </div>
  )
}
