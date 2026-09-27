import { useEffect, useRef, useState } from 'react';
import type { AssetDto, BlockDto, SectionDto, StationDto, TrainDto, TrainLive } from '../types';
import { drawTimeSpace, type BlockHit, type LiveHit, type ZoneHit } from '../tsd/renderTimeSpace';
import { parseTimeToMinutes, trainDelayMins, trajectoryPoint, trainStops, type TrajectoryPoint } from '../tsd/tsdMath';

interface TimeSpaceChartProps {
  startKm: number;
  endKm: number;
  activeSection: SectionDto | null;
  stations: readonly StationDto[];
  trains: readonly TrainDto[];
  blocks: readonly BlockDto[];
  assets: readonly AssetDto[];
  live: Readonly<Record<string, TrainLive>>;
}

type HoverItem = { type: 'block' | 'train'; id: string };
type InspectorItem = { type: 'block' | 'train' | 'zone'; id: string };

function hhmm(mins: number): string {
  const m = Math.round(Math.max(0, mins));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1 text-[10px] text-[#9E9E9E]">
      <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

/** Stable per-category cruise speed (km/h) for drift-free interpolation:
 * Express 80–110, Freight 40–60, mid-range chosen so motion never jitters. */
const categorySpeed = (train: TrainDto | undefined): number =>
  train?.type === 'FREIGHT' ? 50 : 95;

export function TimeSpaceChart({
  startKm,
  endKm,
  activeSection,
  stations,
  trains,
  blocks,
  assets,
  live,
}: TimeSpaceChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef(live);
  liveRef.current = live;
  const hitsRef = useRef<{ blocks: BlockHit[]; live: LiveHit[]; zones: ZoneHit[] }>({ blocks: [], live: [], zones: [] });
  const simRef = useRef({ timeMins: 420 });
  const targetsRef = useRef<Record<string, TrajectoryPoint>>({});
  const markersRef = useRef<Record<string, TrajectoryPoint>>({});

  const [zoom, setZoom] = useState(1);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showBlocks, setShowBlocks] = useState(true);
  const [conflictsOnly, setConflictsOnly] = useState(false);
  const [hover, setHover] = useState<HoverItem | null>(null);
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);
  const [inspector, setInspector] = useState<InspectorItem | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let dirty = true;
    let raf = 0;

    const speedOf = (trainId: string): number => {
      const train = trains.find((t) => t.trainId === trainId);
      const telemetry = liveRef.current[trainId];
      return telemetry && telemetry.speedKmh > 0 ? telemetry.speedKmh : categorySpeed(train);
    };

    // Markers are bound to each train's OWN sloped trajectory: every 2s the
    // operational timeline advances +2 sim minutes and each marker's target is
    // recomputed from its schedule segment (chainage AND clock both derive from
    // the same progress). A requestAnimationFrame loop lerps rendered X/Y
    // toward those targets so motion stays smooth between ticks.
    const recomputeTargets = () => {
      const t = simRef.current.timeMins;
      for (const [id, liveTarget] of Object.entries(liveRef.current)) {
        const train = trains.find((tr) => tr.trainId === id);
        targetsRef.current[id] = train
          ? trajectoryPoint(trainStops(train, stations, startKm, endKm), t)
          : { km: liveTarget.km, timeMins: liveTarget.mins ?? t };
      }
      for (const id of Object.keys(targetsRef.current)) {
        if (!liveRef.current[id]) delete targetsRef.current[id];
      }
    };

    const paint = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = wrap.getBoundingClientRect();
      if (rect.width === 0) return;
      // Horizontal zoom grows the canvas width so the day keeps a constant
      // pixel pitch and the window scrolls; 65px bottom gutter holds the
      // explicit time labels.
      const zoomWidth = Math.max(rect.width, rect.width * zoom);
      canvas.width = Math.round(zoomWidth * dpr);
      canvas.height = Math.round(650 * dpr);
      canvas.style.width = `${zoomWidth}px`;
      canvas.style.height = '650px';
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Pass the currently-lerped (km, mins) pair straight through: mins pins
      // the marker to its schedule time on the X axis, km to chainage on Y, so
      // the dot rides its own string instead of a wall-clock column.
      const slides: Record<string, TrainLive> = {};
      for (const [trainId, t] of Object.entries(targetsRef.current)) {
        const m = markersRef.current[trainId] ?? t;
        slides[trainId] = { km: m.km, mins: m.timeMins, speedKmh: speedOf(trainId) };
      }

      const stats = drawTimeSpace(ctx, {
        width: zoomWidth,
        height: 650,
        startKm,
        endKm,
        stations,
        trains,
        blocks,
        assets,
        live: slides,
        zoom,
        showHeatmap,
        showBlocks,
        conflictsOnly,
        cursorMin: parseTimeToMinutes(new Date()),
      });
      hitsRef.current = { blocks: stats.blockHits, live: stats.liveHits, zones: stats.zoneHits };
    };

    const frame = () => {
      raf = requestAnimationFrame(frame);
      let moved = false;
      for (const [id, t] of Object.entries(targetsRef.current)) {
        const prev = markersRef.current[id] ?? t;
        const km = prev.km + (t.km - prev.km) * 0.08;
        const timeMins = prev.timeMins + (t.timeMins - prev.timeMins) * 0.08;
        if (Math.abs(km - prev.km) > 0.02 || Math.abs(timeMins - prev.timeMins) > 0.02) moved = true;
        markersRef.current[id] = { km, timeMins };
      }
      if (moved || dirty) {
        dirty = false;
        paint();
      }
    };

    recomputeTargets();
    raf = requestAnimationFrame(frame);

    // 2-second tick: advance the operational timeline by +2 sim minutes and
    // recompute every marker target from its current schedule segment.
    const timer = window.setInterval(() => {
      simRef.current.timeMins = (simRef.current.timeMins + 2) % 1440;
      recomputeTargets();
      dirty = true;
    }, 2000);

    const observer = new ResizeObserver(paint);
    observer.observe(wrap);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(timer);
      observer.disconnect();
    };
  }, [startKm, endKm, stations, trains, blocks, assets, zoom, showHeatmap, showBlocks, conflictsOnly, activeSection]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.nativeEvent.offsetX ?? e.clientX - rect.left;
    const y = e.nativeEvent.offsetY ?? e.clientY - rect.top;
    const { blocks: blockHits, live: liveHits } = hitsRef.current;
    let next: HoverItem | null = null;
    for (const b of blockHits) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        next = { type: 'block', id: b.blockId };
        break;
      }
    }
    if (!next) {
      for (const l of liveHits) {
        if (Math.hypot(x - l.x, y - l.y) <= 8) {
          next = { type: 'train', id: l.trainId };
          break;
        }
      }
    }
    setHover(next);
    setMouse({ x, y });
  };

  const handleMouseLeave = () => {
    setHover(null);
    setMouse(null);
  };

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.nativeEvent.offsetX ?? e.clientX - rect.left;
    const y = e.nativeEvent.offsetY ?? e.clientY - rect.top;
    const { blocks, live: liveHits, zones } = hitsRef.current;
    for (const l of liveHits) {
      if (Math.hypot(x - l.x, y - l.y) <= 8) {
        setInspector({ type: 'train', id: l.trainId });
        return;
      }
    }
    for (const z of zones) {
      if (Math.hypot(x - z.x, y - z.y) <= 14) {
        setInspector({ type: 'zone', id: z.assetId });
        return;
      }
    }
    for (const b of blocks) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        setInspector({ type: 'block', id: b.blockId });
        return;
      }
    }
  };

  const stationOf = (km: number): { stationName: string; km: number } =>
    stations.reduce(
      (best, s) => (Math.abs(s.km - km) < Math.abs(best.km - km) ? s : best),
      stations[0] ?? { stationName: `KM ${km}`, km },
    );

  const tooltip = (() => {
    if (!hover || !mouse) return null;
    if (hover.type === 'block') {
      const block = blocks.find((b) => b.blockId === hover.id);
      if (!block) return null;
      const startMin = parseTimeToMinutes(block.startTime);
      const endMin = parseTimeToMinutes(block.endTime);
      const lo = Math.min(block.startKm, block.endKm);
      const hi = Math.max(block.startKm, block.endKm);
      const risk = assets.reduce(
        (acc, a) => (a.locationKm >= lo && a.locationKm <= hi ? Math.max(acc, a.failureRiskScore) : acc),
        0,
      );
      return (
        <div>
          <div className="text-xs font-semibold text-green-300">{block.blockId} · Maintenance Block</div>
          <div className="mt-1 text-[11px] text-slate-300">
            {stationOf(block.startKm).stationName} → {stationOf(block.endKm).stationName}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-400">
            {hhmm(startMin)} → {hhmm(endMin)} · {Math.round(endMin - startMin)} min
          </div>
          <div className="mt-1 flex items-center gap-3 text-[11px]">
            <span className="text-slate-400">
              Risk R<sub>i</sub> <b className="text-amber-300">{risk.toFixed(2)}</b>
            </span>
            <span className="text-emerald-400">Active</span>
          </div>
        </div>
      );
    }
    const train = trains.find((t) => t.trainId === hover.id);
    if (!train) return null;
    const pos = liveRef.current[hover.id];
    const delay = trainDelayMins(train, startKm, endKm, parseTimeToMinutes(new Date()), pos?.km);
    return (
      <div>
        <div className="text-xs font-semibold text-sky-300">
          {train.trainId} · {train.trainName}
        </div>
        <div className="mt-1 text-[11px] text-slate-300">
          {train.originStation} → {train.destinationStation}
        </div>
        <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-400">
          <span>
            Speed <b className="text-slate-200">{(pos?.speedKmh ?? 0).toFixed(0)} km/h</b>
          </span>
          <span className={delay > 0 ? 'text-amber-300' : 'text-emerald-400'}>
            {delay > 0 ? `+${delay} min` : 'On time'}
          </span>
        </div>
      </div>
    );
  })();

  const inspectorCard = (() => {
    if (!inspector) return null;
    const Row = ({ k, v, tone }: { k: string; v: React.ReactNode; tone?: string }) => (
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="shrink-0 text-slate-400">{k}</span>
        <span className={tone ?? 'font-medium text-slate-200'}>{v}</span>
      </div>
    );
    if (inspector.type === 'train') {
      const train = trains.find((t) => t.trainId === inspector.id);
      if (!train) return null;
      const pos = liveRef.current[train.trainId];
      const delay = trainDelayMins(train, startKm, endKm, parseTimeToMinutes(new Date()), pos?.km);
      return (
        <div className="space-y-1.5">
          <Row k="Type" v={`${train.type ?? 'PASSENGER'} Train`} />
          <Row k="ID" v={`${train.trainId} · ${train.trainName}`} />
          <Row k="Route" v={`${train.originStation} → ${train.destinationStation}`} />
          <Row k="Chainage" v={`${stationOf(pos?.km ?? 0).stationName} (${Math.round(pos?.km ?? 0)} KM)`} />
          <Row k="Speed" v={`${(pos?.speedKmh ?? 0).toFixed(0)} km/h`} />
          <Row k="Delay" v={delay > 0 ? `+${delay} min` : 'On time'} tone={delay > 0 ? 'text-amber-300' : 'text-emerald-400'} />
          <Row k="Priority" v={String(train.priority)} />
          <Row k="TSR" v="None reported" tone="text-slate-400" />
          <Row k="Action" v="Monitor headway" tone="text-sky-300" />
        </div>
      );
    }
    if (inspector.type === 'zone') {
      const asset = assets.find((a) => a.assetId === inspector.id);
      if (!asset) return null;
      const critical = asset.failureRiskScore >= 0.8;
      return (
        <div className="space-y-1.5">
          <Row k="Type" v="Asset Critical Zone" />
          <Row k="ID" v={`${asset.assetType} · ${asset.assetId}`} />
          <Row k="Location" v={`${activeSection?.sectionName ?? 'Section'} · ${stationOf(asset.locationKm).stationName}`} />
          <Row k="Chainage" v={`${Math.round(asset.locationKm)} KM`} />
          <Row k="Risk R_i" v={asset.failureRiskScore.toFixed(2)} tone={critical ? 'text-red-400' : 'text-amber-300'} />
          <Row k="P(F|t)" v={asset.failureProbability.toFixed(2)} tone={critical ? 'text-red-400' : 'text-amber-300'} />
          <Row k="RUL" v={`${asset.rulDays} days`} />
          <Row k="Cause" v={critical ? 'High failure likelihood, imminent' : 'Elevated failure likelihood'} />
          <Row k="TSR" v={critical ? 'TSR 30 km/h recommended' : 'No TSR'} tone={critical ? 'text-red-400' : 'text-slate-400'} />
          <Row k="Action" v="Dispatch maintenance inspection" tone="text-sky-300" />
        </div>
      );
    }
    const win = blocks.find((b) => b.blockId === inspector.id);
    if (!win) return null;
    const startMin = parseTimeToMinutes(win.startTime);
    const endMin = parseTimeToMinutes(win.endTime);
    return (
      <div className="space-y-1.5">
        <Row k="Type" v="Maintenance Block" tone="text-emerald-300" />
        <Row k="ID" v={win.blockId} />
        <Row k="Section" v={win.sectionId} />
        <Row k="Location" v={`${stationOf(win.startKm).stationName} → ${stationOf(win.endKm).stationName}`} />
        <Row k="Window" v={`${hhmm(startMin)} → ${hhmm(endMin)}`} />
        <Row k="Duration" v={`${win.requiredDurationMinutes} min`} />
        <Row k="Priority" v={String(win.blockPriority)} />
        <Row k="Cause" v="Planned maintenance possession" />
        <Row k="TSR" v="Speed restricted inside window" tone="text-amber-300" />
        <Row k="Action" v="Protect possession; reschedule trains" tone="text-emerald-300" />
      </div>
    );
  })();

  const scrollLeft = wrapRef.current?.scrollLeft ?? 0;
  const wrapWidth = wrapRef.current?.clientWidth ?? 0;
  const tipLeft = mouse ? Math.max(8, Math.min(mouse.x + 12 - scrollLeft, wrapWidth - 248)) : 0;

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4 text-xs text-[#E0E0E0]">
        <span className="text-[13px] font-semibold text-[#E0E0E0]">
          Interactive Time-Space String Diagram (COA / TMS View)
        </span>
        <label className="flex items-center gap-2 text-[#9E9E9E]">
          Zoom
          <input
            type="range"
            min={1}
            max={3}
            step={0.1}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="w-36 accent-[#2196F3]"
          />
          <span className="tabular-nums text-[#9E9E9E]">{zoom.toFixed(1)}×</span>
        </label>
        <span className="h-6 w-px bg-[#2A3550]" />
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={showHeatmap}
            onChange={(e) => setShowHeatmap(e.target.checked)}
            className="accent-[#2196F3]"
          />
          Risk Overlay
        </label>
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={showBlocks}
            onChange={(e) => setShowBlocks(e.target.checked)}
            className="accent-[#2196F3]"
          />
          Maintenance Blocks
        </label>
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={conflictsOnly}
            onChange={(e) => setConflictsOnly(e.target.checked)}
            className="accent-[#2196F3]"
          />
          Conflicts Only
        </label>
        <span className="h-6 w-px bg-[#2A3550]" />
        <div className="flex items-center gap-4">
          <LegendDot color="#2196F3" label="Express" />
          <LegendDot color="#FFC107" label="Freight" />
          <LegendDot color="#4CAF50" label="Block" />
          <LegendDot color="#E53935" label="Conflict" />
        </div>
        <span className="ml-auto text-[10px] text-slate-500">Click a train / block / zone to inspect</span>
      </div>
      <div
        ref={wrapRef}
        className="relative min-h-0 flex-1 overflow-x-auto overflow-y-hidden rounded-lg border border-slate-800 bg-slate-950 pb-4"
      >
        <canvas
          ref={canvasRef}
          className={`block ${hover ? 'cursor-pointer' : 'cursor-default'}`}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onClick={handleClick}
        />
        {mouse && hover && tooltip && (
          <div
            className="pointer-events-none absolute z-10 w-60 rounded-lg border border-slate-700 bg-slate-900/95 p-3 shadow-xl shadow-black/40"
            style={{ left: tipLeft, top: mouse.y + 12 }}
          >
            {tooltip}
          </div>
        )}
        {inspector && inspectorCard && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50" onClick={() => setInspector(null)}>
            <div
              className="w-80 rounded-xl border border-slate-700 bg-[#1E2638] p-4 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-[#E0E0E0]">
                  Inspector · {inspector.type}
                </span>
                <button
                  className="rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-white"
                  onClick={() => setInspector(null)}
                >
                  ✕
                </button>
              </div>
              {inspectorCard}
              <div className="mt-3 border-t border-[#2A3550] pt-2 text-[10px] text-slate-500">
                Click outside to close
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}