interface TopBarProps {
  data: any;
  status: 'waiting' | 'live' | 'complete' | 'error';
  viewMode: 'auto' | 'summary' | 'live';
  onViewModeChange: (mode: 'auto' | 'summary' | 'live') => void;
  showViewToggle: boolean;
}

export default function TopBar({ data, status, viewMode, onViewModeChange, showViewToggle }: TopBarProps) {
  const total = data?.summary?.total ?? 0;
  const passed = data?.summary?.passed ?? 0;
  const failed = total - passed;
  const rate = total > 0 ? Math.round((passed / total) * 100) : 0;

  const lastUpdated = data?.metadata?.last_updated;
  const formattedTime = lastUpdated ? new Date(lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : null;

  const statusConfig = {
    live:     { label: 'Live',     color: 'bg-[var(--pass-mid)]', textColor: 'text-[var(--pass)]',  bg: 'bg-[var(--pass-light)]' },
    complete: { label: 'Complete', color: 'bg-[var(--pass-mid)]', textColor: 'text-[var(--pass)]',  bg: 'bg-[var(--pass-light)]' },
    waiting:  { label: 'Waiting',  color: 'bg-[var(--text-tertiary)]', textColor: 'text-[var(--text-secondary)]', bg: 'bg-[var(--bg-surface-2)]' },
    error:    { label: 'Error',    color: 'bg-[var(--fail-mid)]',  textColor: 'text-[var(--fail)]',  bg: 'bg-[var(--fail-light)]' },
  };
  const sc = statusConfig[status];

  return (
    <header className="h-[56px] flex items-center gap-6 px-5 bg-[var(--bg-surface)] border-b border-[var(--border)] flex-shrink-0 relative z-10"
      style={{ boxShadow: '0 1px 3px rgba(60,64,67,0.08)' }}>

      {/* Logo */}
      <div className="flex items-center gap-2.5 flex-shrink-0">
        <div className="w-8 h-8 rounded-lg bg-[var(--blue)] flex items-center justify-center flex-shrink-0">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 2L14 13H2L8 2Z" fill="white" fillOpacity="0.9"/>
          </svg>
        </div>
        <div className="flex flex-col leading-none">
          <span className="text-[13px] font-semibold text-[var(--text-primary)] tracking-tight">
            QA Dashboard
          </span>
          <span className="text-[10px] text-[var(--text-tertiary)] font-normal">
            Verification Monitor
          </span>
        </div>
      </div>

      {/* Divider */}
      <div className="w-px h-6 bg-[var(--border)] flex-shrink-0" />

      {/* Stats */}
      <div className="flex gap-2 flex-1">
        <StatPill label="Total" value={total || '—'} />
        <StatPill label="Passed" value={passed || '—'} variant="pass" />
        <StatPill label="Failed" value={failed || '—'} variant="fail" />
        <StatPill label="Pass rate" value={total > 0 ? `${rate}%` : '—'} variant={rate === 100 && total > 0 ? 'pass' : undefined} />
      </div>

      {/* Right */}
      <div className="flex items-center gap-3 flex-shrink-0">
        {showViewToggle && (
          <div className="flex bg-[var(--bg-surface-2)] rounded-lg p-0.5 border border-[var(--border-light)]">
            <button
              onClick={() => onViewModeChange('summary')}
              className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-all ${
                viewMode === 'summary'
                  ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm border border-[var(--border-light)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              Summary
            </button>
            <button
              onClick={() => onViewModeChange('live')}
              className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-all ${
                viewMode === 'live'
                  ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm border border-[var(--border-light)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              Live table
            </button>
          </div>
        )}

        {/* Status badge */}
        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full ${sc.bg}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${sc.color} ${status === 'live' ? 'animate-pulse-dot' : ''}`} />
          <span className={`text-[11px] font-medium ${sc.textColor}`}>{sc.label}</span>
          {formattedTime && (
            <span className="text-[10px] text-[var(--text-tertiary)] ml-1 font-[var(--font-mono)]">
              {formattedTime}
            </span>
          )}
        </div>
      </div>
    </header>
  );
}

function StatPill({ label, value, variant }: { label: string; value: string | number; variant?: 'pass' | 'fail' }) {
  const color =
    variant === 'pass' ? 'text-[var(--pass)]' :
    variant === 'fail' ? 'text-[var(--fail)]' :
    'text-[var(--text-primary)]';

  return (
    <div className="flex items-center gap-1.5 px-3 py-1 bg-[var(--bg-surface-2)] rounded-lg border border-[var(--border-light)]">
      <span className="text-[11px] text-[var(--text-tertiary)] font-normal">{label}</span>
      <span className={`text-[13px] font-semibold font-[var(--font-mono)] ${color}`}>{value}</span>
    </div>
  );
}
