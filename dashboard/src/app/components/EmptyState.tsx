export default function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 px-10">
      <div className="w-16 h-16 rounded-2xl bg-[var(--bg-surface-2)] border border-[var(--border-light)] flex items-center justify-center"
        style={{ boxShadow: '0 1px 3px rgba(60,64,67,0.06)' }}>
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none" className="animate-spin-slow" style={{ animationDuration: '12s' }}>
          <circle cx="14" cy="14" r="11" stroke="#dadce0" strokeWidth="1.5" strokeDasharray="4 3"/>
          <circle cx="14" cy="14" r="5" stroke="#dadce0" strokeWidth="1.5"/>
          <circle cx="14" cy="14" r="1.5" fill="#bdc1c6"/>
        </svg>
      </div>

      <div className="flex flex-col items-center gap-1.5">
        <p className="text-[15px] font-semibold text-[var(--text-primary)]">
          Waiting for test data
        </p>
        <p className="text-[12px] text-[var(--text-secondary)] text-center max-w-[280px] leading-relaxed">
          Start your test runner to begin live verification. Results will appear automatically.
        </p>
      </div>

      <div className="flex items-center gap-2 px-4 py-2.5 bg-[var(--bg-surface-2)] rounded-lg border border-[var(--border-light)]">
        <code className="font-[var(--font-mono)] text-[11px] text-[var(--blue)]">
          py test_volcanic_clean.py
        </code>
      </div>

      <div className="flex items-center gap-1.5 mt-1">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-tertiary)] animate-pulse-dot" />
        <span className="text-[11px] text-[var(--text-tertiary)]">Polling every second</span>
      </div>
    </div>
  );
}
