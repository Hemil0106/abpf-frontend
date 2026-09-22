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
      className={`flex shrink-0 flex-col border-r border-[#2A3550] bg-[#1E2638] transition-[width] duration-150 ${
        expanded ? 'w-60' : 'w-[60px]'
      }`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-[#2A3550] px-2.5 py-2.5">
        <span className="flex h-7 items-center rounded bg-[#2196F3] px-2 text-sm font-bold text-white">AB</span>
        <button
          onClick={() => setExpanded(!expanded)}
          title={expanded ? 'Collapse' : 'Expand'}
          className="px-1 text-[#9E9E9E] transition-colors hover:text-white"
        >
          {expanded ? '«' : '»'}
        </button>
      </div>

      <nav className="flex flex-1 flex-col gap-0 overflow-y-auto py-2">
        {NAV_ITEMS.map((item) => {
          const active = item.id === activeView;
          return (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id)}
              title={expanded ? undefined : item.label}
              className={`flex h-10 items-center gap-2 transition-colors ${
                active ? 'border-l-[3px] border-[#2196F3] bg-[#23335C] text-white' : 'border-l-[3px] border-transparent bg-[#121824] text-[#E0E0E0] hover:bg-[#212B40]'
              } ${expanded ? 'px-3' : 'justify-center px-0'}`}
            >
              <span className={`shrink-0 px-1 text-[11px] font-medium ${active ? 'text-[#2196F3]' : 'text-[#9E9E9E]'}`}>
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