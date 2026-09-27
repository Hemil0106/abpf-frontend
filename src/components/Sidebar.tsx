import { useState } from 'react';
import type { ViewId } from '../types';

interface SidebarProps {
  activeView: ViewId;
  onViewChange: (view: ViewId) => void;
}

const NAV_ITEMS: { id: ViewId; glyph: string; label: string }[] = [
  { id: 'home', glyph: 'HM', label: 'Home / Landing' },
  { id: 'assets', glyph: 'HL', label: 'Asset Health & Diagnostics' },
  { id: 'timespace', glyph: 'TS', label: 'Time-Space String Chart' },
  { id: 'network', glyph: 'NW', label: 'Zonal Network Map' },
  { id: 'optimizer', glyph: 'OP', label: 'Optimization Engine' },
  { id: 'disruption', glyph: 'DR', label: 'Disruption Resolver' },
  { id: 'audit', glyph: 'AU', label: 'Audit Logs' },
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
          return (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id)}
              title={expanded ? undefined : item.label}
              className={`flex items-center gap-2 rounded-xl px-3 py-2 transition-all ${
                active
                  ? 'border-l-4 border-cyan-400 bg-gradient-to-r from-cyan-500/15 to-transparent font-semibold text-cyan-300 shadow-[0_0_15px_rgba(6,182,212,0.15)]'
                  : 'ml-0 border-l-4 border-transparent text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
              } ${expanded ? 'mx-2' : 'justify-center px-0'}`}
            >
              <span className={`shrink-0 px-0.5 text-[11px] font-medium ${active ? 'text-cyan-300' : 'text-slate-500'}`}>
                {item.glyph}
              </span>
              {expanded && <span className="truncate text-xs">{item.label}</span>}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}