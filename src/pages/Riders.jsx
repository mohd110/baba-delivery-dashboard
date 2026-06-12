import { Bike } from 'lucide-react'
import Topbar, { TopIcons } from '../layout/Topbar.jsx'
import ComingSoon from '../components/ComingSoon.jsx'

export default function Riders() {
  return (
    <>
      <Topbar>
        <h1 className="text-xl font-bold text-ink">Rider Management</h1>
        <TopIcons />
      </Topbar>
      <ComingSoon
        icon={Bike}
        title="Rider Management"
        description="Rider onboarding, live location tracking, and delivery performance will appear here once rider data is connected."
      />
    </>
  )
}
