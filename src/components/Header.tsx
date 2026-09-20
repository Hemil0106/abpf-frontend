import { useState } from 'react';
import type { SectionDto, ViewId, ZoneGroup } from '../types';
import { useAuth } from '../context/AuthContext';
import { AuthModal } from './AuthModal';

interface HeaderProps {
  zones: ZoneGroup[];
  activeDivisionId: string | null;
  onSelectDivision: (divisionId: string) => void;
  socketConnected: boolean;
  activeView: ViewId;
  onViewChange: (view: ViewId) => void;
}

const VIEWS: { id: ViewId; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'timespace', label: 'Time-Space' },
  { id: 'network', label: 'Zonal Network' },
  { id: 'optimizer', label: 'Optimizer' },
  { id: 'disruption', label: 'Disruptions' },
  { id: 'audit', label: 'Audit Trail' },
];

export function Header({
  zones,
  activeDivisionId,
  onSelectDivision,
  socketConnected,
  activeView,
  onViewChange,
}: HeaderProps) {
  const { session, logout } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  const active = zones
    .flatMap((z) => z.divisions)
    .find((d) => d.divisionId === activeDivisionId);
  const selectedZone = active?.zone ?? zones[0]?.code ?? 'CR';
  const divisions = zones.find((z) => z.code === selectedZone)?.divisions ?? [];
  const selectedDivision = active ?? divisions[0];

  return (
    <header className="flex flex-wrap items-center gap-4 border-b border-slate-800 bg-slate-900 px-5 py-3">
      <div className="flex items-center gap-2 pr-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-600 text-sm font-bold text-white">
          ABPF
        </span>
        <div className="leading-tight">
          <div className="text-sm font-semibold text-slate-100">AI-ABPF Control Desk</div>
          <div className="text-[11px] text-slate-400">Railway Operations Optimizer</div>
        </div>
      </div>

      <nav className="flex gap-1 rounded-lg bg-slate-800 p-1">
        {VIEWS.map((view) => (
          <button
            key={view.id}
            onClick={() => onViewChange(view.id)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              activeView === view.id
                ? 'bg-sky-600 text-white'
                : 'text-slate-300 hover:bg-slate-700 hover:text-white'
            }`}
          >
            {view.label}
          </button>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-slate-400">
          Zone
          <select
            value={selectedZone}
            onChange={(e) => {
              const zone = e.target.value;
              const first = zones.find((z) => z.code === zone)?.divisions[0];
              if (first) onSelectDivision(first.divisionId);
            }}
            className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-sky-500"
          >
            {zones.map((z) => (
              <option key={z.code} value={z.code}>
                {z.code}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-xs text-slate-400">
          Division
          <select
            value={selectedDivision?.divisionId ?? ''}
            onChange={(e) => onSelectDivision(e.target.value)}
            className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-sky-500"
          >
            {divisions.map((d: SectionDto) => (
              <option key={d.divisionId} value={d.divisionId}>
                {d.sectionName}
              </option>
            ))}
          </select>
        </label>

        <span
          className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide ${
            socketConnected ? 'text-emerald-400' : 'text-rose-400'
          }`}
        >
          <span className="inline-block h-2 w-2 rounded-full bg-current" />
          {socketConnected ? 'Live Stream Active' : 'Offline — Reconnecting'}
        </span>

        {session ? (
          <div className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-800 py-1 pl-2 pr-1">
            <span className="max-w-28 truncate text-xs text-slate-200">{session.username}</span>
            <span className="rounded-full bg-sky-600/20 px-2 py-0.5 text-[10px] font-semibold uppercase text-sky-300">
              {session.role}
            </span>
            <button
              onClick={logout}
              title="Sign out"
              className="rounded-full px-1.5 text-slate-400 transition-colors hover:text-rose-400"
            >
              ×
            </button>
          </div>
        ) : (
          <button
            onClick={() => setAuthOpen(true)}
            className="rounded-lg border border-sky-600/50 px-3 py-1.5 text-xs font-medium text-sky-300 transition-colors hover:bg-sky-600 hover:text-white"
          >
            Log in
          </button>
        )}
        <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
      </div>
    </header>
  );
}