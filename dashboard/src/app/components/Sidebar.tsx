interface SidebarProps {
  data: any;
  selectedMission: number | null;
  onSelectMission: (id: number) => void;
  showSummary: boolean;
}

export default function Sidebar({ data, selectedMission, onSelectMission, showSummary }: SidebarProps) {
  const missions = data?.metadata?.missions ?? [];
  const results = data?.results ?? [];
  const complete = new Set(data?.summary?.missions_complete ?? []);

  if (!missions.length) return null;

  const engageResults = results.filter((r: any) => r.type === 'engage');
  const lastMissionId = engageResults.at(-1)?.mission_id ?? null;

  return (
    <aside className="w-[256px] flex-shrink-0 bg-[var(--bg-sidebar)] border-r border-[var(--border)] flex flex-col overflow-hidden">
      <div className="px-4 pt-4 pb-3">
        <span className="text-[11px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wide">
          Missions
        </span>
      </div>

      <nav className="flex-1 overflow-y-auto scrollbar-thin px-2 pb-2 flex flex-col gap-0.5">
        {missions.map((mission: any) => {
          const mResults = results.filter((r: any) => r.mission_id === mission.id && r.type === 'engage');
          const checks = mResults.flatMap((r: any) => r.checks ?? []);
          const hasData = mResults.length > 0;
          const isDone = complete.has(mission.name);
          const isRunning = !isDone && mission.id === lastMissionId;

          let status: 'pending' | 'pass' | 'fail' | 'live';
          if (!hasData) {
            status = 'pending';
          } else if (isDone) {
            status = checks.every((c: any) => c.pass) ? 'pass' : 'fail';
          } else if (isRunning) {
            status = 'live';
          } else {
            status = checks.every((c: any) => c.pass) ? 'pass' : 'fail';
          }

          const specMatch = mission.spec_steps?.match(/(\d+)-(\d+)/);
          const specRange = specMatch ? parseInt(specMatch[2], 10) - parseInt(specMatch[1], 10) + 1 : 10;
          const progressPct = isDone ? 100 : Math.min(100, Math.round((mResults.length / specRange) * 100));

          const isActive = selectedMission === mission.id && !showSummary;

          return (
            <div
              key={mission.id}
              onClick={() => onSelectMission(mission.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectMission(mission.id);
                }
              }}
              tabIndex={0}
              className={`flex flex-col px-3 py-2.5 rounded-lg cursor-pointer transition-all outline-none focus-visible:ring-2 focus-visible:ring-[var(--blue)] gap-2 ${
                isActive
                  ? 'bg-[var(--blue-light)] ring-1 ring-[rgba(26,115,232,0.2)]'
                  : 'hover:bg-[var(--bg-surface-2)]'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                  <span className={`text-[12px] font-medium leading-snug truncate ${
                    isActive ? 'text-[var(--blue)]' : 'text-[var(--text-primary)]'
                  }`}>
                    {mission.name}
                  </span>
                  <div className="flex gap-2.5">
                    <MissionStat label="Clicks" value={mResults.length} />
                    <MissionStat label="XP" value={`+${mission.xp_gain}`} />
                  </div>
                </div>
                <StatusBadge status={status} />
              </div>

              <div className="h-1 bg-[var(--border-light)] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    status === 'pass' ? 'bg-[var(--pass-mid)]' :
                    status === 'fail' ? 'bg-[var(--fail-mid)]' :
                    status === 'live' ? 'bg-[var(--blue-mid)]' :
                    'bg-[var(--border)]'
                  }`}
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          );
        })}
      </nav>

      <div className="px-4 py-3 border-t border-[var(--border)] bg-[var(--bg-surface)]">
        <div className="text-[11px] font-medium text-[var(--text-primary)]">
          {data?.metadata?.missions?.length ?? 0} missions
        </div>
        <div className="text-[10px] text-[var(--text-tertiary)]">
          Verification suite
        </div>
      </div>
    </aside>
  );
}

function StatusBadge({ status }: { status: 'pending' | 'pass' | 'fail' | 'live' }) {
  const config = {
    pending: { label: 'Pending',  cls: 'bg-[var(--bg-surface-2)] text-[var(--text-tertiary)]' },
    pass:    { label: 'Pass',     cls: 'bg-[var(--pass-light)] text-[var(--pass)]' },
    fail:    { label: 'Fail',     cls: 'bg-[var(--fail-light)] text-[var(--fail)]' },
    live:    { label: 'Live',     cls: 'bg-[var(--blue-light)] text-[var(--blue)] animate-badge-pulse' },
  };
  const { label, cls } = config[status];

  return (
    <span className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold ${cls}`}>
      {label}
    </span>
  );
}

function MissionStat({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="text-[10px] text-[var(--text-tertiary)]">
      {label} <span className="text-[var(--text-secondary)] font-medium">{value}</span>
    </span>
  );
}
