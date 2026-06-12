import { Sparkles } from 'lucide-react'

/* On-brand placeholder for pages that don't have a Supabase data source yet. */
export default function ComingSoon({ title, description, icon: Icon = Sparkles }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 py-24 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#ffdad3] text-brand">
        <Icon className="h-7 w-7" />
      </span>
      <h1 className="mt-6 text-[28px] font-bold text-ink">{title}</h1>
      <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-line-soft px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-ink-soft">
        <span className="h-1.5 w-1.5 rounded-full bg-brand" /> Feature coming soon
      </span>
      <p className="mt-4 max-w-md text-sm leading-relaxed text-ink-soft">{description}</p>
    </div>
  )
}
