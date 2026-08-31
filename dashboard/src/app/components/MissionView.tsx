interface MissionViewProps {
  data: any;
  missionId: number;
}

export default function MissionView({ data, missionId }: MissionViewProps) {
  const missions = data?.metadata?.missions ?? [];
  const mission = missions.find((m: any) => m.id === missionId);
  if (!mission) return null;

  const results = data?.results ?? [];
  const complete = new Set(data?.summary?.missions_complete ?? []);
  const mResults = results.filter((r: any) => r.mission_id === missionId);
  const engages = mResults.filter((r: any) => r.type === 'engage');

  const fmtCash = (n: number) => {
    if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(0) + 'M';
    return n.toLocaleString();
  };

  const isDone = complete.has(mission.name);
  const allChecks = mResults.flatMap((r: any) => r.checks ?? []);
  const allPass = allChecks.every((c: any) => c.pass) && allChecks.length > 0;

  const statusLabel = isDone ? (allPass ? 'Complete' : 'Completed with failures') : engages.length > 0 ? 'In progress' : 'Pending';
  const statusVariant = isDone ? (allPass ? 'pass' : 'fail') : engages.length > 0 ? 'live' : 'pending';

  return (
    <>
      {/* Mission Header */}
      <div className="px-5 py-3.5 bg-[var(--bg-surface)] border-b border-[var(--border)] flex items-center gap-4 flex-shrink-0">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-3">
            <h1 className="text-[15px] font-semibold text-[var(--text-primary)] leading-none">
              {mission.name}
            </h1>
            <StatusChip variant={statusVariant} label={statusLabel} />
          </div>
          <div className="text-[11px] text-[var(--text-tertiary)]">
            Spec {mission.spec_steps} · Unlock level {mission.unlock_level} · ID {mission.id}
          </div>
        </div>

        <div className="ml-auto flex gap-2">
          <MetaChip label="Clicks verified" value={engages.length} />
          <MetaChip label="XP / engage" value={`+${mission.xp_gain}`} />
          <MetaChip label="Supplies / engage" value={`-${mission.supplies_cost}`} />
          <MetaChip label="Cash range" value={`${fmtCash(mission.cash_min)}–${fmtCash(mission.cash_max)}`} />
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto scrollbar-thin">
        {mResults.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="w-12 h-12 rounded-full bg-[var(--bg-surface-2)] flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <circle cx="10" cy="10" r="8" stroke="#9aa0a6" strokeWidth="1.5"/>
                <path d="M10 6v5M10 13.5v.5" stroke="#9aa0a6" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <p className="text-[13px] text-[var(--text-secondary)]">No results for this mission yet</p>
          </div>
        ) : (
          <table className="w-full border-collapse table-fixed">
            <thead className="sticky top-0 z-[5]">
              <tr>
                <th className="w-10 text-center">#</th>
                <th className="w-[80px]">Time</th>
                <th className="w-[90px]">Type</th>
                <th className="w-[80px] text-center">Phase</th>
                <th className="w-[160px]">XP before → after</th>
                <th className="w-[160px]">Supplies before → after</th>
                <th className="w-[120px]">XP check</th>
                <th className="w-[120px]">Supply check</th>
                <th className="w-[140px]">Cash reward</th>
                <th className="w-[80px] text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {mResults.map((r: any, i: number) => (
                <ResultRow key={i} result={r} isFirst={i === 0} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function StatusChip({ variant, label }: { variant: string; label: string }) {
  const cls =
    variant === 'pass'    ? 'bg-[var(--pass-light)] text-[var(--pass)]' :
    variant === 'fail'    ? 'bg-[var(--fail-light)] text-[var(--fail)]' :
    variant === 'live'    ? 'bg-[var(--blue-light)] text-[var(--blue)]' :
    'bg-[var(--bg-surface-2)] text-[var(--text-tertiary)]';

  return (
    <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium ${cls}`}>
      {label}
    </span>
  );
}

function MetaChip({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col items-center px-3 py-1.5 bg-[var(--bg-surface-2)] rounded-lg border border-[var(--border-light)] min-w-[80px]">
      <span className="text-[10px] text-[var(--text-tertiary)]">{label}</span>
      <span className="text-[12px] font-semibold text-[var(--text-primary)] font-[var(--font-mono)]">{value}</span>
    </div>
  );
}

function ResultRow({ result, isFirst }: { result: any; isFirst: boolean }) {
  const isEngage = result.type === 'engage';
  const isReward = result.type === 'mission_reward';
  const allPass = (result.checks ?? []).every((c: any) => c.pass);

  const typeLabel = isEngage ? 'Engage' : isReward ? 'Cash reward' : (result.type ?? '');
  const typeColor = isEngage ? 'text-[var(--blue)]' : isReward ? 'text-[var(--warn)]' : 'text-[var(--text-secondary)]';

  const xpCheck  = (result.checks ?? []).find((c: any) => c.field === 'xp');
  const supCheck = (result.checks ?? []).find((c: any) => c.field === 'supplies');
  const cashCheck = (result.checks ?? []).find((c: any) => c.field === 'cash');

  const fmt = (n: any) => (typeof n === 'number' ? n.toLocaleString() : '—');

  return (
    <tr className={`border-b border-[var(--border-light)] transition-colors hover:bg-[var(--bg-row-hover)] ${
      isFirst ? 'animate-row-in' : ''
    } odd:bg-[var(--bg-row)] even:bg-[var(--bg-row-alt)]`}>
      <td className="px-3 py-2 text-center font-[var(--font-mono)] text-[11px] font-medium text-[var(--text-secondary)] border-r border-[var(--border-light)]">
        {isEngage ? result.click_number : isReward ? '★' : '◆'}
      </td>
      <td className="px-3 py-2 font-[var(--font-mono)] text-[10px] text-[var(--text-tertiary)] border-r border-[var(--border-light)]">
        {result.timestamp ?? '—'}
      </td>
      <td className={`px-3 py-2 text-[11px] font-medium border-r border-[var(--border-light)] ${typeColor}`}>
        {typeLabel}
      </td>
      <td className="px-3 py-2 text-center border-r border-[var(--border-light)]">
        {isEngage ? <PhaseBar pct={result.phase_pct ?? 0} /> : <span className="text-[var(--text-tertiary)]">—</span>}
      </td>
      <td className="px-3 py-2 border-r border-[var(--border-light)]">
        {isEngage ? <ResourceCell before={result.before?.xp} after={result.after?.xp} check={xpCheck} /> : <span className="text-[var(--text-tertiary)]">—</span>}
      </td>
      <td className="px-3 py-2 border-r border-[var(--border-light)]">
        {isEngage ? <ResourceCell before={result.before?.supplies} after={result.after?.supplies} check={supCheck} /> : <span className="text-[var(--text-tertiary)]">—</span>}
      </td>
      <td className="px-3 py-2 border-r border-[var(--border-light)]">
        {xpCheck ? <CheckCell check={xpCheck} /> : <span className="text-[var(--text-tertiary)]">—</span>}
      </td>
      <td className="px-3 py-2 border-r border-[var(--border-light)]">
        {supCheck ? <CheckCell check={supCheck} /> : <span className="text-[var(--text-tertiary)]">—</span>}
      </td>
      <td className="px-3 py-2 border-r border-[var(--border-light)] font-[var(--font-mono)] text-[11px]">
        {cashCheck ? (
          <span className={cashCheck.pass ? 'text-[var(--pass)]' : 'text-[var(--fail)]'}>
            {cashCheck.pass ? '✓' : '✗'} {cashCheck.actual}
          </span>
        ) : isReward ? (
          <span className="text-[var(--text-primary)]">{fmt((result.after?.cash ?? 0) - (result.before?.cash ?? 0))}</span>
        ) : (
          <span className="text-[var(--text-tertiary)]">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-center">
        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${
          allPass
            ? 'bg-[var(--pass-light)] text-[var(--pass)]'
            : 'bg-[var(--fail-light)] text-[var(--fail)]'
        }`}>
          {allPass ? 'Pass' : 'Fail'}
        </span>
      </td>
    </tr>
  );
}

function PhaseBar({ pct }: { pct: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 h-1.5 bg-[var(--border-light)] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-[var(--pass-mid)]' : 'bg-[var(--blue-mid)]'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] font-medium text-[var(--text-secondary)] font-[var(--font-mono)] w-[28px] text-right">{pct}%</span>
    </div>
  );
}

function ResourceCell({ before, after, check }: { before: any; after: any; check: any }) {
  const fmt = (n: any) => (typeof n === 'number' ? n.toLocaleString() : '—');
  const delta = typeof before === 'number' && typeof after === 'number' ? after - before : null;

  return (
    <div className="flex items-center gap-1 font-[var(--font-mono)] text-[10px]">
      <span className="text-[var(--text-tertiary)]">{fmt(before)}</span>
      <span className="text-[var(--border)]">›</span>
      <span className="text-[var(--text-primary)]">{fmt(after)}</span>
      {delta !== null && (
        <span className={`text-[10px] font-semibold px-1 py-px rounded ${
          check?.pass
            ? 'bg-[var(--pass-light)] text-[var(--pass)]'
            : 'bg-[var(--fail-light)] text-[var(--fail)]'
        }`}>
          {delta >= 0 ? '+' : ''}{delta}
        </span>
      )}
    </div>
  );
}

function CheckCell({ check }: { check: any }) {
  return (
    <div className="flex flex-col gap-0.5 font-[var(--font-mono)] text-[10px]">
      <div className="flex items-center gap-1">
        <span className={`font-semibold ${check.pass ? 'text-[var(--pass)]' : 'text-[var(--fail)]'}`}>
          {check.pass ? '✓' : '✗'}
        </span>
        <span className="text-[var(--text-tertiary)]">exp {check.expected}</span>
      </div>
      <div className="text-[var(--text-secondary)]">got {check.actual}</div>
    </div>
  );
}
