import { Store } from 'lucide-react'
import Topbar, { TopIcons } from '../layout/Topbar.jsx'
import ComingSoon from '../components/ComingSoon.jsx'

export default function Outlets() {
  return (
    <>
      <Topbar>
        <h1 className="text-xl font-bold text-ink">Outlet Management</h1>
        <TopIcons />
      </Topbar>
      <ComingSoon
        icon={Store}
        title="Outlet Management"
        description="Multi-outlet status, staffing, and revenue tracking will appear here once outlet data is connected."
      />
    </>
  )
}
