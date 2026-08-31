import { useState, useEffect } from 'react';
import TopBar from './components/TopBar';
import Sidebar from './components/Sidebar';
import MissionView from './components/MissionView';
import ExecutionSummary from './components/ExecutionSummary';
import EmptyState from './components/EmptyState';

interface DashboardData {
  metadata?: {
    missions?: any[];
    start_time?: string;
    last_updated?: string;
  };
  results?: any[];
  summary?: {
    total?: number;
    passed?: number;
    missions_complete?: string[];
  };
}

const POLL_MS = 1000;

export default function App() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [selectedMission, setSelectedMission] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<'auto' | 'summary' | 'live'>('auto');
  const [status, setStatus] = useState<'waiting' | 'live' | 'complete' | 'error'>('waiting');

  const isExecutionComplete = (d: DashboardData | null): boolean => {
    if (!d?.metadata?.missions?.length) return false;
    const complete = new Set(d.summary?.missions_complete ?? []);
    return d.metadata.missions.every((m) => complete.has(m.name));
  };

  const shouldShowSummary = (): boolean => {
    if (viewMode === 'summary') return true;
    if (viewMode === 'live') return false;
    return isExecutionComplete(data);
  };

  const poll = async () => {
    try {
      const urls = [
        '/verification_results.json',
        '/@fs/../verification_results.json',
      ];

      for (const url of urls) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5000);
          const resp = await fetch(url + '?t=' + Date.now(), {
            cache: 'no-store',
            signal: controller.signal,
          });
          clearTimeout(timeout);

          if (resp.ok) {
            const newData = await resp.json();
            setData(newData);

            const execComplete = isExecutionComplete(newData);
            setStatus(execComplete ? 'complete' : (newData.results?.length > 0 ? 'live' : 'waiting'));
            return;
          }
        } catch {}
      }
      setStatus('error');
    } catch (err) {
      console.warn('Poll error:', err);
      setStatus('error');
    }
  };

  useEffect(() => {
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (data && !selectedMission && data.metadata?.missions?.length) {
      const firstWithData = data.metadata.missions.find((m) =>
        data.results?.some((r) => r.mission_id === m.id)
      );
      const first = firstWithData ?? data.metadata.missions[0];
      if (first) setSelectedMission(first.id);
    }
  }, [data, selectedMission]);

  const showSummary = shouldShowSummary();
  const execComplete = isExecutionComplete(data);

  return (
    <div className="flex flex-col h-screen bg-[var(--bg-base)]">
      <TopBar
        data={data}
        status={status}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        showViewToggle={execComplete}
      />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          data={data}
          selectedMission={selectedMission}
          onSelectMission={(id) => {
            setSelectedMission(id);
            setViewMode('live');
          }}
          showSummary={showSummary}
        />

        <main className="flex-1 flex flex-col overflow-hidden">
          {!data?.results?.length && <EmptyState />}

          {data?.results?.length > 0 && showSummary && (
            <ExecutionSummary data={data} />
          )}

          {data?.results?.length > 0 && !showSummary && selectedMission !== null && (
            <MissionView
              data={data}
              missionId={selectedMission}
            />
          )}
        </main>
      </div>
    </div>
  );
}
