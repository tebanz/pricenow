export default function Badge({ status, children }) {
  const className = {
    pending: 'badge-pending',
    approved: 'badge-approved',
    rejected: 'badge-rejected',
    lowest: 'badge-lowest',
  }[status] ?? 'inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-500'

  return <span className={className}>{children}</span>
}
