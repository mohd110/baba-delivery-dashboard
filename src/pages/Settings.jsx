import { Settings as SettingsIcon } from 'lucide-react'
import Topbar, { TopIcons } from '../layout/Topbar.jsx'
import ComingSoon from '../components/ComingSoon.jsx'

export default function Settings() {
  return (
    <>
      <Topbar>
        <h1 className="text-xl font-bold text-ink">Settings & Permissions</h1>
        <TopIcons />
      </Topbar>
      <ComingSoon
        icon={SettingsIcon}
        title="Settings & Permissions"
        description="Account details, team roles, and permission controls will appear here — coming soon."
      />
    </>
  )
}
