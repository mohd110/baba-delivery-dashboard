import { Search, Bell, LayoutGrid } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

/* Header shell — pages compose their own left/right content */
export default function Topbar({ children }) {
  return (
    <header className="sticky top-0 z-20 flex h-16 w-full shrink-0 items-center justify-between gap-4 border-b border-line bg-white px-8">
      {children}
    </header>
  )
}

// Controlled search input. Pass `value` + `onChange` to actually filter a list;
// omit them and it stays a plain (uncontrolled) box.
export function SearchBox({ placeholder, className = '', value, onChange }) {
  return (
    <div className={`relative ${className}`}>
      <Search className="absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-ink-soft" />
      <input
        type="text"
        placeholder={placeholder}
        value={value ?? undefined}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        className="w-full rounded-full bg-line-soft py-[9px] pl-10 pr-4 text-sm text-ink placeholder:text-ink-soft focus:outline-none"
      />
    </div>
  )
}

export function IconButton({ icon: Icon, dot = false, onClick, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="relative flex h-9 w-9 items-center justify-center rounded-lg text-ink-soft hover:bg-line-soft hover:text-ink"
    >
      <Icon className="h-5 w-5" />
      {dot && (
        <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-brand ring-2 ring-white" />
      )}
    </button>
  )
}

export function TopIcons() {
  const navigate = useNavigate()
  return (
    <>
      <IconButton icon={Bell} onClick={() => navigate('/orders')} title="Active orders" />
      <IconButton icon={LayoutGrid} onClick={() => navigate('/dashboard')} title="Dashboard overview" />
    </>
  )
}

export function Divider() {
  return <div className="mx-1 h-6 w-px bg-line" />
}

export function ProfileChip({ name = 'Wali Baba Foods', sub = 'Restaurant Admin', img, initials, initialsBg = 'bg-brand' }) {
  const logoSrc = img || '/assets/walibaba logo.jpeg'
  return (
    <div className="flex items-center gap-3">
      <img
        src={logoSrc}
        onError={(e) => {
          if (!e.currentTarget.dataset.triedFallback) {
            e.currentTarget.dataset.triedFallback = 'true'
            e.currentTarget.src = '/assets/logo.png'
          }
        }}
        alt={name}
        className="h-9 w-9 shrink-0 rounded-full bg-line-2 object-cover ring-2 ring-brand/15 shadow-sm"
      />
      <div className="flex flex-col leading-tight">
        <span className="text-sm font-semibold text-ink">{name}</span>
        {sub && <span className="text-[10px] uppercase tracking-wide text-ink-soft">{sub}</span>}
      </div>
    </div>
  )
}

export function StatusDot({ text, color = 'bg-pos', textColor = 'text-ink' }) {
  return (
    <span className={`flex items-center gap-1.5 text-sm font-medium ${textColor}`}>
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {text}
    </span>
  )
}
