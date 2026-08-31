interface ExecutionSummaryProps {
  data: any;
}

export default function ExecutionSummary({ data }: ExecutionSummaryProps) {
  const { metadata, results, summary } = data;
  const missions = metadata?.missions ?? [];
  const completeSet = new Set(summary?.missions_complete ?? []);

  const total = summary?.total ?? 0;
  const passed = summary?.passed ?? 0;
  const failed = total - passed;
  const allPass = failed === 0 && total > 0;
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

  const startTime = metadata?.start_time;
  const endTime = metadata?.last_updated;

  const fmtTime = (ts: string) => {
    if (!ts) return '—';
    const d = new Date(ts);
    return isNaN(d.getTime()) ? ts : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const fmtDuration = (start: string, end: string) => {
    if (!start || !end) return '—';
    const s = new Date(start);
    const e = new Date(end);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return '—';
    const secs = Math.round((e.getTime() - s.getTime()) / 1000);
    if (secs < 60) return secs + 's';
    return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  };

  const fmt = (n: number) => n.toLocaleString();
  const fmtCash = (n: number) => {
    if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    return n.toLocaleString();
  };

  const engages = results.filter((r: any) => r.type === 'engage');
  let totalXP = 0, totalSup = 0, totalCash = 0;
  if (engages.length > 0) {
    const firstSnap = engages.find((r: any) => r.before?.xp != null && r.before.xp > 0);
    const lastSnap = [...engages].reverse().find((r: any) => r.after?.xp != null && r.after.xp > 0);
    if (firstSnap && lastSnap) {
      totalXP   = (lastSnap.after.xp ?? 0) - (firstSnap.before.xp ?? 0);
      totalSup  = (firstSnap.before.supplies ?? 0) - (lastSnap.after.supplies ?? 0);
      totalCash = (lastSnap.after.cash ?? 0) - (firstSnap.before.cash ?? 0);
    }
  }

  const allFailures = results.flatMap((r: any) =>
    (r.checks ?? []).filter((c: any) => !c.pass).map((c: any) => ({
      mission: r.mission, type: r.type, click: r.click_number, ...c,
    }))
  );

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin bg-[var(--bg-base)]">
      <div className="max-w-5xl mx-auto px-6 py-5 flex flex-col gap-5 animate-fade-up">

        {/* Result banner */}
        <div className={`flex items-center gap-5 px-6 py-5 rounded-2xl border ${
          allPass
            ? 'bg-[var(--pass-light)] border-[rgba(30,142,62,0.2)]'
            : 'bg-[var(--fail-light)] border-[rgba(217,48,37,0.2)]'
        }`}>
          <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${
            allPass ? 'bg-[var(--pass-mid)]' : 'bg-[var(--fail-mid)]'
          }`}>
            <span className="text-white text-[20px]">{allPass ? '✓' : '✗'}</span>
          </div>
          <div className="flex-1">
            <div className={`text-[18px] font-semibold leading-tight ${allPass ? 'text-[var(--pass)]' : 'text-[var(--fail)]'}`}>
              {allPass ? 'All checks passed' : 'Execution complete'}
            </div>
            <div className="text-[12px] text-[var(--text-secondary)] mt-0.5">
              {allPass
                ? `${missions.length} missions verified successfully · Duration ${fmtDuration(startTime, endTime)}`
                : `${failed} check${failed !== 1 ? 's' : ''} failed · ${missions.length} missions · Duration ${fmtDuration(startTime, endTime)}`}
            </div>
          </div>
          <div className={`text-[13px] font-semibold px-4 py-2 rounded-full ${
            allPass
              ? 'bg-[var(--pass-mid)] text-white'
              : 'bg-[var(--fail-mid)] text-white'
          }`}>
            {allPass ? 'PASS' : `${failed} failed`}
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-4 gap-3">
          <StatCard label="Total checks" value={total} />
          <StatCard label="Passed" value={passed} color="pass" />
          <StatCard label="Failed" value={failed} color="fail" />
          <StatCard label="Pass rate" value={`${passRate}%`} color={passRate === 100 && total > 0 ? 'pass' : undefined} />
        </div>

        {/* Time row */}
        <div className="grid grid-cols-3 gap-3">
          <InfoCard label="Start time" value={fmtTime(startTime)} />
          <InfoCard label="End time" value={fmtTime(endTime)} />
          <InfoCard label="Duration" value={fmtDuration(startTime, endTime)} />
        </div>

        {/* Resources */}
        <section>
          <SectionLabel>Resources</SectionLabel>
          <div className="grid grid-cols-3 gap-3 mt-2">
            <ResourceCard label="Total XP earned" value={totalXP > 0 ? `+${fmt(totalXP)}` : '—'} color="pass" />
            <ResourceCard label="Total supplies used" value={totalSup > 0 ? `-${fmt(totalSup)}` : '—'} />
            <ResourceCard label="Total cash earned" value={totalCash > 0 ? fmtCash(totalCash) : '—'} />
          </div>
        </section>

        {/* Mission breakdown */}
        <section>
          <SectionLabel>Mission breakdown</SectionLabel>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3 mt-2">
            {missions.map((m: any) => {
              const mResults = results.filter((r: any) => r.mission_id === m.id);
              const mEngages = mResults.filter((r: any) => r.type === 'engage');
              const checks = mResults.flatMap((r: any) => r.checks ?? []);
              const mPassed = checks.filter((c: any) => c.pass).length;
              const mFailed = checks.length - mPassed;
              const isComplete = completeSet.has(m.name);
              const mAllPass = mFailed === 0 && checks.length > 0;
              const barPct = checks.length > 0 ? Math.round((mPassed / checks.length) * 100) : 0;

              return (
                <div
                  key={m.id}
                  className="flex flex-col gap-2.5 px-4 py-3.5 bg-[var(--bg-surface)] border border-[var(--border-light)] rounded-xl hover:border-[var(--border)] transition-colors"
                  style={{ boxShadow: '0 1px 3px rgba(60,64,67,0.06)' }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[12px] font-medium text-[var(--text-primary)] leading-snug flex-1">
                      {m.name}
                    </span>
                    <span className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                      !isComplete
                        ? 'bg-[var(--bg-surface-2)] text-[var(--text-tertiary)]'
                        : mAllPass
                        ? 'bg-[var(--pass-light)] text-[var(--pass)]'
                        : 'bg-[var(--fail-light)] text-[var(--fail)]'
                    }`}>
                      {!isComplete ? 'Incomplete' : mAllPass ? 'Pass' : 'Fail'}
                    </span>
                  </div>

                  <div className="flex gap-3 flex-wrap">
                    <MiniStat label="Clicks" value={mEngages.length} />
                    <MiniStat label="Checks" value={checks.length} />
                    <MiniStat label="Passed" value={mPassed} color="pass" />
                    {mFailed > 0 && <MiniStat label="Failed" value={mFailed} color="fail" />}
                  </div>

                  <div className="h-1.5 bg-[var(--bg-surface-2)] rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${mAllPass ? 'bg-[var(--pass-mid)]' : 'bg-[var(--fail-mid)]'}`}
                      style={{ width: `${barPct}%` }}
                    />
                  </div>

                  {m.loot_unit && (
                    <div className="flex items-center gap-2 px-2.5 py-1.5 bg-[var(--warn-light)] border border-[rgba(242,153,0,0.2)] rounded-lg">
                      <span className="text-[var(--warn)] text-[11px]">★</span>
                      <span className="text-[11px] font-medium text-[var(--text-primary)]">{m.loot_unit.name}</span>
                      <span className="text-[10px] text-[var(--text-tertiary)] ml-auto">
                        ATK {m.loot_unit.attack} · DEF {m.loot_unit.defence}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Failures */}
        {allFailures.length > 0 && (
          <section>
            <SectionLabel color="fail">Failed checks ({allFailures.length})</SectionLabel>
            <div className="flex flex-col gap-1.5 mt-2 max-h-[360px] overflow-y-auto scrollbar-thin">
              {allFailures.map((f: any, i: number) => {
                const typeLabel = f.type === 'engage' ? `Click #${f.click}` : (f.type ?? '').replace(/_/g, ' ');
                return (
                  <div
                    key={i}
                    className="flex items-center gap-3 px-4 py-2.5 bg-[var(--fail-light)] border border-[rgba(217,48,37,0.15)] rounded-lg font-[var(--font-mono)] text-[11px]"
                  >
                    <span className="text-[var(--fail)] font-semibold w-[20px] flex-shrink-0">✗</span>
                    <span className="text-[var(--text-secondary)] min-w-[160px] flex-shrink-0">{f.mission}</span>
                    <span className="text-[var(--text-primary)] font-medium min-w-[60px] flex-shrink-0">{f.field}</span>
                    <span className="text-[var(--text-tertiary)] min-w-[60px] flex-shrink-0">{typeLabel}</span>
                    <div className="flex-1 flex items-center gap-1.5">
                      <span className="text-[var(--text-tertiary)]">expected {f.expected}</span>
                      <span className="text-[var(--border)]">→</span>
                      <span className="text-[var(--fail)] font-semibold">got {f.actual}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Footer */}
        <div className="flex justify-between items-center pt-3 border-t border-[var(--border-light)] mt-1 pb-4">
          <span className="text-[11px] text-[var(--text-tertiary)]">
            Verification report · {missions.length} missions
          </span>
          <span className="text-[11px] text-[var(--text-tertiary)] font-[var(--font-mono)]">
            {fmtTime(startTime)} → {fmtTime(endTime)}
          </span>
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children, color }: { children: React.ReactNode; color?: 'fail' }) {
  return (
    <div className={`text-[11px] font-semibold uppercase tracking-wide ${color === 'fail' ? 'text-[var(--fail)]' : 'text-[var(--text-tertiary)]'}`}>
      {children}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number | string; color?: 'pass' | 'fail' }) {
  const valueColor =
    color === 'pass' ? 'text-[var(--pass)]' :
    color === 'fail' ? 'text-[var(--fail)]' :
    'text-[var(--text-primary)]';

  return (
    <div className="flex flex-col items-center gap-1 px-4 py-4 bg-[var(--bg-surface)] border border-[var(--border-light)] rounded-xl"
      style={{ boxShadow: '0 1px 3px rgba(60,64,67,0.06)' }}>
      <span className={`text-[28px] font-semibold font-[var(--font-mono)] leading-none ${valueColor}`}>{value}</span>
      <span className="text-[11px] text-[var(--text-tertiary)]">{label}</span>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3 bg-[var(--bg-surface)] border border-[var(--border-light)] rounded-xl"
      style={{ boxShadow: '0 1px 3px rgba(60,64,67,0.06)' }}>
      <span className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide">{label}</span>
      <span className="text-[13px] font-medium text-[var(--text-primary)] font-[var(--font-mono)]">{value}</span>
    </div>
  );
}

function ResourceCard({ label, value, color }: { label: string; value: string; color?: 'pass' }) {
  return (
    <div className="flex flex-col items-center gap-1 px-4 py-4 bg-[var(--bg-surface)] border border-[var(--border-light)] rounded-xl text-center"
      style={{ boxShadow: '0 1px 3px rgba(60,64,67,0.06)' }}>
      <span className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide">{label}</span>
      <span className={`text-[22px] font-semibold font-[var(--font-mono)] leading-none ${color === 'pass' ? 'text-[var(--pass)]' : 'text-[var(--text-primary)]'}`}>
        {value}
      </span>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: number; color?: 'pass' | 'fail' }) {
  return (
    <span className="text-[10px] text-[var(--text-tertiary)]">
      {label}{' '}
      <span className={`font-medium ${color === 'pass' ? 'text-[var(--pass)]' : color === 'fail' ? 'text-[var(--fail)]' : 'text-[var(--text-secondary)]'}`}>
        {value}
      </span>
    </span>
  );
}
