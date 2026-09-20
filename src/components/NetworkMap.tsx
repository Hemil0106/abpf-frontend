import { useCallback, useEffect, useRef, useState } from 'react';
import type { ZoneGroup } from '../types';
import { drawNetworkMap, ZoneNode } from '../tsd/renderNetworkMap';
import { fetchActiveSection, selectSection } from '../services/api';

interface NetworkMapProps {
  zones: ZoneGroup[];
  activeDivisionId: string | null;
  onSelectDivision: (divisionId: string) => void;
}

const CORRIDORS: [string, string][] = [
  ['WR', 'NWR'],
  ['WR', 'CR'],
  ['CR', 'SCR'],
  ['NWR', 'SCR'],
];

const NODE_POS = (w: number, h: number): Record<string, { x: number; y: number }> => ({
  WR: { x: w * 0.22, y: h * 0.5 },
  NWR: { x: w * 0.45, y: h * 0.2 },
  CR: { x: w * 0.58, y: h * 0.62 },
  SCR: { x: w * 0.8, y: h * 0.78 },
});

/**
 * Zonal schematic map. On mount it sweeps one division per zone to snapshot
 * each zone's active-section risk, then restores the original selection.
 */
export function NetworkMap({ zones, activeDivisionId, onSelectDivision }: NetworkMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoneRisks, setZoneRisks] = useState<Record<string, number | null>>({});
  const [activeRisk, setActiveRisk] = useState<number | null>(null);

  const loadZoneRisks = useCallback(async () => {
    const sectionId = activeDivisionId;
    const risks: Record<string, number | null> = {};
    for (const zone of zones) {
      const first = zone.divisions[0];
      if (!first) continue;
      try {
        const payload = await selectSection(first.divisionId);
        const maxRisk = payload.assets.reduce((acc, a) => Math.max(acc, a.failureRiskScore), 0);
        risks[zone.code] = maxRisk > 0 ? maxRisk : null;
      } catch {
        risks[zone.code] = null;
      }
    }
    if (sectionId) {
      try {
        await selectSection(sectionId);
      } catch {
        // best-effort restore
      }
    }
    setZoneRisks(risks);
  }, [zones, activeDivisionId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const payload = await fetchActiveSection();
        if (!cancelled) {
          const maxRisk = payload.assets.reduce((acc, a) => Math.max(acc, a.failureRiskScore), 0);
          setActiveRisk(maxRisk > 0 ? maxRisk : null);
        }
      } catch {
        // leave null
      }
    })();
    void loadZoneRisks();
    return () => {
      cancelled = true;
    };
  }, [loadZoneRisks]);

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mx = event.clientX - rect.left;
      const my = event.clientY - rect.top;
      const pos = NODE_POS(rect.width, rect.height);
      for (const zone of zones) {
        const p = pos[zone.code];
        if (!p) continue;
        const dist = Math.hypot(mx - p.x, my - p.y);
        if (dist <= 22) {
          const first = zone.divisions[0];
          if (first) onSelectDivision(first.divisionId);
          return;
        }
      }
    },
    [zones, onSelectDivision],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const render = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0) return;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const pos = NODE_POS(rect.width, rect.height);
      const activeZoneCode = zones.find((z) => z.divisions.some((d) => d.divisionId === activeDivisionId))?.code;
      const nodes: ZoneNode[] = zones.map((zone) => ({
        code: zone.code,
        label: zone.name,
        x: pos[zone.code]?.x ?? 0,
        y: pos[zone.code]?.y ?? 0,
        active: zone.code === activeZoneCode,
        risk: zone.code === activeZoneCode && activeRisk != null ? activeRisk : zoneRisks[zone.code] ?? null,
        divisionCount: zone.divisions.length,
        color: '#64748b',
      }));
      drawNetworkMap(ctx, { width: rect.width, height: rect.height, nodes, corridors: CORRIDORS });
    };
    render();
    const observer = new ResizeObserver(render);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [zones, activeDivisionId, activeRisk, zoneRisks]);

return (
    <div className="relative h-full">
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        className="block h-full w-full cursor-pointer rounded-lg border border-slate-800 bg-slate-950"
      />
      <div className="pointer-events-none absolute bottom-2 left-3 flex items-center gap-3 text-[11px] text-slate-400">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Low</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> Caution</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-600" /> Critical</span>
        <span className="ml-2 text-slate-500">Click a node to activate its division</span>
      </div>
    </div>
  );
}