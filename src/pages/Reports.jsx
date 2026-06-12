import { BarChart3 } from 'lucide-react'
import Topbar, { TopIcons } from '../layout/Topbar.jsx'
import ComingSoon from '../components/ComingSoon.jsx'

export default function Reports() {
  return (
    <>
      <Topbar>
        <h1 className="text-xl font-bold text-ink">Reports & Analytics</h1>
        <TopIcons />
      </Topbar>
      <ComingSoon
        icon={BarChart3}
        title="Reports & Analytics"
        description="Detailed sales analytics and exportable reports will appear here — coming soon."
      />
    </>
  )
}
