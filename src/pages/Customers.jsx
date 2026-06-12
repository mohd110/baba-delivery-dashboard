import { Users } from 'lucide-react'
import Topbar, { TopIcons } from '../layout/Topbar.jsx'
import ComingSoon from '../components/ComingSoon.jsx'

export default function Customers() {
  return (
    <>
      <Topbar>
        <h1 className="text-xl font-bold text-ink">Customer Management</h1>
        <TopIcons />
      </Topbar>
      <ComingSoon
        icon={Users}
        title="Customer Management"
        description="Customer profiles, order history, and lifetime value insights will appear here — coming soon."
      />
    </>
  )
}
