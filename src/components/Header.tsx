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
    <header className="flex items-center gap-6 border-b border-[#2A3550] bg-[#1E2638] px-4 py-2.5">
      <div className="text-[13px] font-semibold text-[#E0E0E0]">{breadcrumb}</div>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-[11px] text-[#9E9E9E]">
          Zone
          <select
            value={selectedZone}
            onChange={(e) => {
              const zone = e.target.value;
              const first = zones.find((z) => z.code === zone)?.divisions[0];
              if (first) onSelectDivision(first.divisionId);
            }}
            className="rounded border border-[#2A3550] bg-[#121824] px-2 py-1 text-xs text-[#E0E0E0] outline-none focus:border-[#2196F3]"
          >
            {zones.map((z) => (
              <option key={z.code} value={z.code}>
                {z.name} ({z.code})
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-[#9E9E9E]">
          Division
          <select
            value={selectedDivision?.divisionId ?? ''}
            onChange={(e) => onSelectDivision(e.target.value)}
            className="rounded border border-[#2A3550] bg-[#121824] px-2 py-1 text-xs text-[#E0E0E0] outline-none focus:border-[#2196F3]"
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
          className={`flex items-center gap-1.5 text-[11px] font-semibold ${
            socketConnected ? 'text-[#4CAF50]' : 'text-[#9E9E9E]'
          }`}
        >
          <span className="inline-block h-2 w-2 rounded-full bg-current" />
          {socketConnected ? 'CONNECTED' : 'DISCONNECTED'}
        </span>
        <span className="font-mono text-xs text-[#E0E0E0]">{clock}</span>

        {session ? (
          <div className="flex items-center gap-2 rounded-full border border-[#2A3550] bg-[#121824] py-1 pl-2 pr-1">
            <span className="max-w-28 truncate text-xs text-[#E0E0E0]">{session.username}</span>
            <span className="rounded-full bg-[#2196F3]/20 px-2 py-0.5 text-[10px] font-semibold uppercase text-[#2196F3]">
              {session.role}
            </span>
            <button
              onClick={logout}
              title="Sign out"
              className="rounded-full px-1.5 text-[#9E9E9E] transition-colors hover:text-[#E53935]"
            >
              ×
            </button>
          </div>
        ) : (
          <button
            onClick={() => setAuthOpen(true)}
            className="rounded border border-[#2196F3]/50 px-3 py-1 text-xs font-medium text-[#2196F3] transition-colors hover:bg-[#2196F3] hover:text-white"
          >
            Log in
          </button>
        )}
        <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
      </div>
    </header>
  );
}