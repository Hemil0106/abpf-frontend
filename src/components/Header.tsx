import { useEffect, useState } from 'react';
import type { SectionDto, ViewId, ZoneGroup } from '../types';
import { useAuth } from '../context/AuthContext';
import { AuthModal } from './AuthModal';

interface HeaderProps {
  zones: ZoneGroup[];
  activeDivisionId: string | null;
  onSelectDivision: (divisionId: string) => void;
  socketConnected: boolean;
  activeView: ViewId;
}

const SECTION_LABELS: Partial<Record<ViewId, string>> = {
  assets: 'Asset Health & Diagnostics',
  timespace: 'Time-Space String Chart',
  network: 'Zonal Network Map',
  optimizer: 'Optimization Engine',
  disruption: 'Disruption Resolver',
  audit: 'Audit Logs',
};

const two = (n: number) => String(n).padStart(2, '0');

export function Header({ zones, activeDivisionId, onSelectDivision, socketConnected, activeView }: HeaderProps) {
  const { session, logout } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  const [clock, setClock] = useState(() => {
    const d = new Date();
    return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
  });

  useEffect(() => {
    const t = window.setInterval(() => {
      const d = new Date();
      setClock(`${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`);
    }, 1000);
    return () => window.clearInterval(t);
  }, []);

  const active = zones
    .flatMap((z) => z.divisions)
    .find((d) => d.divisionId === activeDivisionId);
  const selectedZone = active?.zone ?? zones[0]?.code ?? 'CR';
  const divisions = zones.find((z) => z.code === selectedZone)?.divisions ?? [];
  const selectedDivision = active ?? divisions[0];

  const breadcrumb =
    'Dashboard' + (SECTION_LABELS[activeView] ? ` > ${SECTION_LABELS[activeView]}` : '');

  return (
    <header className="flex items-center gap-6 border-b border-slate-800/80 bg-slate-950/80 px-4 py-2.5 shadow-lg backdrop-blur-xl">
      <div className="flex items-center gap-3">
        <span className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-2 shadow-[0_0_15px_rgba(6,182,212,0.25)]">
          <span className="bg-gradient-to-r from-cyan-400 via-sky-400 to-blue-500 bg-clip-text font-extrabold text-sm text-transparent">
            AB
          </span>
        </span>
        <div className="leading-tight">
          <div className="bg-gradient-to-r from-cyan-400 via-sky-400 to-blue-500 bg-clip-text font-extrabold text-sm text-transparent">
            AUTO BLOCK PLANNING
          </div>
          <div className="text-[10px] text-slate-500">COA / TMS Control Desk</div>
        </div>
      </div>

      <div className="hidden text-[13px] font-semibold text-slate-300 lg:block">{breadcrumb}</div>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
          Zone
          <select
            value={selectedZone}
            onChange={(e) => {
              const zone = e.target.value;
              const first = zones.find((z) => z.code === zone)?.divisions[0];
              if (first) onSelectDivision(first.divisionId);
            }}
            className="rounded-xl border border-slate-700/60 bg-slate-900/80 px-3 py-1.5 text-xs text-slate-200 shadow-inner outline-none focus:ring-2 focus:ring-cyan-500/50"
          >
            {zones.map((z) => (
              <option key={z.code} value={z.code}>
                {z.name} ({z.code})
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
          Division
          <select
            value={selectedDivision?.divisionId ?? ''}
            onChange={(e) => onSelectDivision(e.target.value)}
            className="rounded-xl border border-slate-700/60 bg-slate-900/80 px-3 py-1.5 text-xs text-slate-200 shadow-inner outline-none focus:ring-2 focus:ring-cyan-500/50"
          >
            {divisions.map((d: SectionDto) => (
              <option key={d.divisionId} value={d.divisionId}>
                {d.displayLabel}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="ml-auto flex items-center gap-4">
        <span
          className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${
            socketConnected
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.2)]'
              : 'border-rose-500/30 bg-rose-500/10 text-rose-400 shadow-[0_0_12px_rgba(244,63,94,0.2)]'
          }`}
        >
          <span className="relative flex h-2 w-2">
            <span className={`absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60`} />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
          </span>
          {socketConnected ? 'CONNECTED' : 'DISCONNECTED'}
        </span>
        <span className="font-mono text-xs tabular-nums text-slate-400">{clock}</span>

        {session ? (
          <div className="flex items-center gap-2 rounded-xl border border-slate-700/80 bg-slate-900/90 px-3 py-1 shadow-md">
            <span className="max-w-28 truncate text-xs text-slate-200">{session.username}</span>
            <span className="rounded-full bg-cyan-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase text-cyan-300">
              {session.role}
            </span>
            <button
              onClick={logout}
              title="Sign out"
              className="rounded-full px-1.5 text-slate-500 transition-colors hover:text-rose-400"
            >
              ×
            </button>
          </div>
        ) : (
          <button
            onClick={() => setAuthOpen(true)}
            className="rounded-xl border border-cyan-500/50 px-3 py-1 text-xs font-medium text-cyan-300 transition-colors hover:bg-cyan-500 hover:text-slate-950"
          >
            Log in
          </button>
        )}
        <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
      </div>
    </header>
  );
}