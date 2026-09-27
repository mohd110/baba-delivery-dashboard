import { MessageSquareText } from 'lucide-react'
import { orderNote } from '../lib/format.js'

/* The customer's note for the kitchen, called out so it isn't missed while
 * cooking. Renders nothing for an order without one. */
export default function OrderNote({ order, className = '' }) {
  const note = orderNote(order)
  if (!note) return null
  return (
    <div className={`rounded-xl border border-amber-300 bg-amber-50 p-4 ${className}`}>
      <p className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#92400e]">
        <MessageSquareText className="h-3.5 w-3.5" /> Order note from customer
      </p>
      <p className="whitespace-pre-wrap break-words text-sm font-semibold text-ink">{note}</p>
    </div>
  )
}
