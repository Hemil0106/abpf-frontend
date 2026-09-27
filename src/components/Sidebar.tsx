import { useState } from 'react';
import { Activity, FileText, Home, Network, ShieldAlert, TrendingUp, Zap } from 'lucide-react';
import type { ViewId } from '../types';

interface SidebarProps {
  activeView: ViewId;
  onViewChange: (view: ViewId) => void;
}

const NAV_ITEMS: { id: ViewId; icon: typeof Home; label: string }[] = [
  { id: 'home', icon: Home, label: 'Home / Landing' },
  { id: 'assets', icon: Activity, label: 'Asset Health & Diagnostics' },
  { id: 'timespace', icon: TrendingUp, label: 'Time-Space String Chart' },
  { id: 'network', icon: Network, label: 'Zonal Network Map' },
  { id: 'optimizer', icon: Zap, label: 'Optimization Engine' },
  { id: 'disruption', icon: ShieldAlert, label: 'Disruption Resolver' },
  { id: 'audit', icon: FileText, label: 'Audit Logs' },
];

export function Sidebar({ activeView, onViewChange }: SidebarProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <aside
      className={`flex shrink-0 flex-col border-r border-slate-800/60 bg-slate-950/90 backdrop-blur-2xl transition-[width] duration-150 ${
        expanded ? 'w-60' : 'w-[60px]'
      }`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-800/60 px-2.5 py-2.5">
        <span className="flex h-7 items-center rounded-lg bg-gradient-to-r from-cyan-400 to-blue-500 px-2 text-sm font-bold text-slate-950">
          AB
        </span>
        <button
          onClick={() => setExpanded(!expanded)}
          title={expanded ? 'Collapse' : 'Expand'}
          className="px-1 text-slate-500 transition-colors hover:text-white"
        >
          {expanded ? '«' : '»'}
        </button>
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto py-2">
        {NAV_ITEMS.map((item) => {
          const active = item.id === activeView;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id)}
              title={expanded ? undefined : item.label}
              className={`flex items-center gap-2 rounded-xl px-3 py-2 transition-all ${
                active
                  ? 'border-l-4 border-cyan-400 bg-gradient-to-r from-cyan-500/15 to-transparent font-semibold text-cyan-300 shadow-[0_0_15px_rgba(6,182,212,0.15)]'
                  : 'border-l-4 border-transparent text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
              } ${expanded ? 'mx-2' : 'justify-center px-0'}`}
            >
              <span className="shrink-0">
                <Icon size={15} strokeWidth={2} />
              </span>
              {expanded && <span className="truncate text-xs">{item.label}</span>}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}