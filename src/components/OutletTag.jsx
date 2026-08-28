import { Store } from 'lucide-react'
import { useOutletTag } from '../lib/outletScope.js'

/**
 * The branch chip shown on an order. Renders nothing unless the signed-in
 * login can see more than one outlet (see `useOutletTag` for that rule), so it
 * can be dropped into any order row unconditionally.
 *
 * @param restaurantId  `orders.restaurant_id` for the row.
 * @param size          'xs' for dense list cards and table cells, 'sm' for
 *                      detail-panel headers.
 */
export default function OutletTag({ restaurantId, size = 'xs', className = '' }) {
  const { show, labelOf } = useOutletTag()
  if (!show) return null

  const sizing =
    size === 'sm'
      ? 'px-2.5 py-0.5 text-xs gap-1.5'
      : 'px-1.5 py-0.5 text-[9px] uppercase tracking-wide gap-1'
  const icon = size === 'sm' ? 'h-3 w-3' : 'h-2.5 w-2.5'

  return (
    <span
      title="Branch this order was placed at"
      className={`inline-flex max-w-[160px] shrink-0 items-center rounded-full bg-line-soft font-bold text-ink-soft ${sizing} ${className}`}
    >
      <Store className={`${icon} shrink-0`} />
      <span className="truncate">{labelOf(restaurantId)}</span>
    </span>
  )
}
