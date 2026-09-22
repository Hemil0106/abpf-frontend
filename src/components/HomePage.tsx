import { useEffect, useState } from 'react';
import type { ActiveSectionPayload, ActivityLine, TrainLive } from '../types';
import { activitySnapshot, subscribeActivity } from '../services/activityLog';
import { parseTimeInput, trainDelayMins } from '../tsd/tsdMath';

interface HomePageProps {
  data: ActiveSectionPayload | null;
  live: Readonly<Record<string, TrainLive>>;
}

const SOURCE_STYLE: Record<ActivityLine['source'], string> = {
  SYSTEM: 'bg-slate-600',
  SECTION: 'bg-sky-600',
  OPTIMIZER: 'bg-violet-600',
  DISRUPTION: 'bg-rose-600',
  TELEMETRY: 'bg-emerald-600',
  ALERT: 'bg-amber-600',
  AUTH: 'bg-indigo-600',
};

function KpiCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub: string;
  accent: string;
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className={`mb-2 text-[10px] font-semibold uppercase tracking-wide ${accent}`}>{label}</div>
      <div className="text-3xl font-bold tabular-nums text-slate-100">{value}</div>
      <div className="mt-1 text-[11px] text-slate-500">{sub}</div>
    </div>
  );
}

export function HomePage({ data, live }: HomePageProps) {
  const [events, setEvents] = useState<ActivityLine[]>(() => activitySnapshot());

  useEffect(() => {
    const unsubscribe = subscribeActivity((line) =>
      setEvents((prev) => [...prev.slice(-49), line]),
    );
    return unsubscribe;
  }, []);

  const trains = data?.trains ?? [];
  const assets = data?.assets ?? [];
  const blocks = data?.blocks ?? [];
  const section = data?.activeSection;

  const nowMin = parseTimeInput(new Date());
  const delays = section
    ? trains.map((t) => trainDelayMins(t, section.startKm, section.endKm, nowMin, live[t.trainId]?.km))
    : [];
  const avgDelay = delays.length ? Math.round(delays.reduce((a, b) => a + b, 0) / delays.length) : 0;
  const criticalAssets = assets.filter((a) => a.failureRiskScore > 0.6).length;
  const activeTrains = Object.keys(live).length || trains.length;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto">
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Active Trains"
          value={activeTrains}
          sub={section ? `on ${section.displayLabel}` : 'awaiting section data'}
          accent="text-sky-400"
        />
        <KpiCard
          label="Avg Section Delay"
          value={`${avgDelay} min`}
          sub="estimate vs planned schedule"
          accent="text-amber-400"
        />
        <KpiCard
          label="Critical Assets"
          value={criticalAssets}
          sub="failure risk R > 0.60"
          accent="text-rose-400"
        />
        <KpiCard
          label="Maintenance Blocks"
          value={blocks.length}
          sub="active track possessions"
          accent="text-violet-400"
        />
      </section>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
          <span className="text-xs font-semibold text-slate-400">Live Operational Activity</span>
          <span className="text-[10px] text-slate-500">last {events.length} events</span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto px-4 py-2 font-mono text-[11px]">
          {events.length === 0 && <p className="text-slate-500">Waiting for system events…</p>}
          {events.map((e) => (
            <div key={e.id} className="flex items-center gap-2 py-0.5">
              <span className="shrink-0 tabular-nums text-slate-500">{e.ts}</span>
              <span
                className={`w-20 shrink-0 rounded px-1 text-center text-[9px] font-semibold uppercase text-white ${SOURCE_STYLE[e.source]}`}
              >
                {e.source}
              </span>
              <span className="truncate text-slate-300">{e.message}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}