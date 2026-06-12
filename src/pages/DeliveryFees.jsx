import { IndianRupee } from 'lucide-react'
import Topbar, { TopIcons } from '../layout/Topbar.jsx'
import ComingSoon from '../components/ComingSoon.jsx'

export default function DeliveryFees() {
  return (
    <>
      <Topbar>
        <h1 className="text-xl font-bold text-ink">Delivery Fee Configuration</h1>
        <TopIcons />
      </Topbar>
      <ComingSoon
        icon={IndianRupee}
        title="Delivery Fee Configuration"
        description="Configure delivery zones, base fees, and distance pricing here — coming soon."
      />
    </>
  )
}
