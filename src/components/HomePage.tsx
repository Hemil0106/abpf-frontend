import { useEffect, useState } from 'react';
import type { ActiveSectionPayload, ActivityLine, TrainLive } from '../types';
import { activitySnapshot, subscribeActivity } from '../services/activityLog';
import { getMinutesFromMidnight } from '../tsd/tsdMath';

interface HomePageProps {
  data: ActiveSectionPayload | null;
  live: Readonly<Record<string, TrainLive>>;
  onLaunch: () => void;
}

const BULLETS = [
  '  •  Live sensor telemetry ingestion (RAIL / OHE / SIGNAL / SWITCH)',
  '  •  Dynamic maintenance block allocation scoring (F1 obj)',
  '  •  Realtime train delay injection & delay minimisation engine (F2 obj)',
  '  •  Network line capacity availability index (F3 obj)',
  '  •  Equipment & gang workload utilisation tracking (F4 obj)',
];

const two = (n: number) => String(n).padStart(2, '0');
const hhmmss = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
};

export function HomePage({ data, live, onLaunch }: HomePageProps) {
  const [clock, setClock] = useState(() => {
    const d = new Date();
    return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
  });
  const [events, setEvents] = useState<ActivityLine[]>(() => activitySnapshot());

  useEffect(() => {
    const t = window.setInterval(() => {
      const d = new Date();
      setClock(`${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`);
    }, 1000);
    const unsubscribe = subscribeActivity((line) => setEvents((prev) => [...prev.slice(-49), line]));
    return () => {
      window.clearInterval(t);
      unsubscribe();
    };
  }, []);

  const trains = data?.trains ?? [];
  const assets = data?.assets ?? [];
  const blocks = data?.blocks ?? [];
  const streamActive = Object.keys(live).length > 0;

  const highPriority = trains.filter((t) => t.priority <= 2).length;
  const critical = assets.filter((a) => a.failureRiskScore > 0.6).length;

  const blockMinutes = blocks.reduce(
    (acc, b) => acc + Math.max(0, getMinutesFromMidnight(b.endTime) - getMinutesFromMidnight(b.startTime)),
    0,
  );
  const utilization = Math.min(100, (blockMinutes / 1440) * 100);
  const availability = assets.length === 0 ? 100 : (assets.filter((a) => a.failureRiskScore <= 0.6).length / assets.length) * 100;

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto px-1 pb-1">
      <div>
        <div className="text-xl font-bold text-[#2196F3]">
          AI-POWERED AUTOMATIC BLOCK PLANNING SYSTEM (AI-ABPF)
        </div>
        <div className="mt-0.5 text-[13px] text-[#9E9E9E]">
          SIH26027: Dynamic Maintenance Allocation &amp; Delay Minimization Engine
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs">
        <span className={`flex items-center gap-1.5 font-semibold ${streamActive ? 'text-[#4CAF50]' : 'text-[#9E9E9E]'}`}>
          <span className="inline-block h-2 w-2 rounded-full bg-current" />
          {streamActive ? 'CONNECTED' : 'DISCONNECTED'}
        </span>
        <span className="font-mono text-[#E0E0E0]">{clock}</span>
        <span className="ml-auto rounded bg-[#FFC107] px-2.5 py-0.5 text-[11px] font-semibold text-[#1A1A1A]">
          RENDER API
        </span>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <div className="rounded border border-[#2A3550] bg-[#1E2638] px-4 py-3.5">
          <div className="text-xs text-[#9E9E9E]">Monitored Trains</div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-[#2196F3]">{trains.length}</div>
          <div className="mt-1 text-xs text-[#9E9E9E]">{highPriority} High-Priority Mail/Express</div>
        </div>
        <div className="rounded border border-[#2A3550] bg-[#1E2638] px-4 py-3.5">
          <div className="text-xs text-[#9E9E9E]">Track Asset Health</div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-[#E53935]">{assets.length}</div>
          <div className="mt-1 text-xs text-[#9E9E9E]">{critical} Critical Risk (Ri &gt; 0.6)</div>
        </div>
        <div className="rounded border border-[#2A3550] bg-[#1E2638] px-4 py-3.5">
          <div className="text-xs text-[#9E9E9E]">Maintenance Resources</div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-[#4CAF50]">{utilization.toFixed(1)}%</div>
          <div className="mt-1 text-xs text-[#9E9E9E]">{blocks.length} active block window(s)</div>
        </div>
        <div className="rounded border border-[#2A3550] bg-[#1E2638] px-4 py-3.5">
          <div className="text-xs text-[#9E9E9E]">Network Line Capacity</div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-[#FFC107]">{availability.toFixed(1)}%</div>
          <div className="mt-1 text-xs text-[#9E9E9E]">F3 Objective Metric</div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col rounded border border-[#2A3550] bg-[#1E2638] px-4 py-4">
        <div className="text-[13px] font-semibold text-[#2196F3]">System Capabilities</div>
        <ul className="mt-2 flex-1 space-y-1 text-[13px] text-[#E0E0E0]">
          {BULLETS.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
        <div className="mt-3 flex justify-end">
          <button
            onClick={onLaunch}
            className="rounded bg-[#2196F3] px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#1E88E5]"
          >
            Launch Operational Dashboard
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-col">
        <div className="text-xs text-[#2196F3]">Live Telemetry Log</div>
        <ul className="mt-1 h-40 shrink-0 overflow-y-auto rounded border border-[#2A3550] bg-[#1E2638] px-3 py-2 font-mono text-xs text-[#E0E0E0]">
          {events.length === 0 ? (
            <li className="text-[#9E9E9E]">Home page ready. Telemetry stream begins when the backend wakes.</li>
          ) : (
            events.map((line) => (
              <li key={line.id} className="whitespace-pre-wrap">
                <span className="text-[#9E9E9E]">[{hhmmss(line.ts)}]</span> {line.message}
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}