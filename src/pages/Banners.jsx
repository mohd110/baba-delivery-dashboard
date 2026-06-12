import { Image as ImageIcon } from 'lucide-react'
import Topbar, { TopIcons } from '../layout/Topbar.jsx'
import ComingSoon from '../components/ComingSoon.jsx'

export default function Banners() {
  return (
    <>
      <Topbar>
        <h1 className="text-xl font-bold text-ink">Promo Banner Management</h1>
        <TopIcons />
      </Topbar>
      <ComingSoon
        icon={ImageIcon}
        title="Promo Banner Management"
        description="Create and schedule promotional banners for the customer app here — coming soon."
      />
    </>
  )
}
