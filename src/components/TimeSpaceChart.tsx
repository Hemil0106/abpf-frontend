import { useEffect, useRef, useState } from 'react';
import type { AssetDto, BlockDto, SectionDto, StationDto, TrainDto, TrainLive } from '../types';
import { drawTimeSpace, type BlockHit, type LiveHit } from '../tsd/renderTimeSpace';
import { getMinutesFromMidnight, trainDelayMins } from '../tsd/tsdMath';

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

function hhmm(mins: number): string {
  const m = Math.round(Math.max(0, mins));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

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
  const hitsRef = useRef<{ blocks: BlockHit[]; live: LiveHit[] }>({ blocks: [], live: [] });

  const [zoom, setZoom] = useState(1);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showBlocks, setShowBlocks] = useState(true);
  const [hover, setHover] = useState<HoverItem | null>(null);
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const render = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = wrap.getBoundingClientRect();
      if (rect.width === 0) return;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(650 * dpr);
      canvas.style.height = '650px';
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      console.log('Canvas rendering', { trains: trains.length, section: activeSection });
      const stats = drawTimeSpace(ctx, {
        width: rect.width,
        height: 650,
        startKm,
        endKm,
        stations,
        trains,
        blocks,
        assets,
        live: liveRef.current,
        zoom,
        showHeatmap,
        showBlocks,
        cursorMin: getMinutesFromMidnight(new Date()),
      });
      hitsRef.current = { blocks: stats.blockHits, live: stats.liveHits };
    };

    render();
    const timer = window.setInterval(render, 1000);
    const observer = new ResizeObserver(render);
    observer.observe(wrap);
    return () => {
      window.clearInterval(timer);
      observer.disconnect();
    };
  }, [startKm, endKm, stations, trains, blocks, assets, zoom, showHeatmap, showBlocks, activeSection]);

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
      const startMin = getMinutesFromMidnight(block.startTime);
      const endMin = getMinutesFromMidnight(block.endTime);
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
    const delay = trainDelayMins(train, startKm, endKm, getMinutesFromMidnight(new Date()), pos?.km);
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

  const wrapWidth = wrapRef.current?.clientWidth ?? 0;
  const tipLeft = mouse ? Math.max(8, Math.min(mouse.x + 12, wrapWidth - 248)) : 0;

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300">
        <label className="flex items-center gap-2">
          Zoom
          <input
            type="range"
            min={1}
            max={3}
            step={0.1}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="w-36 accent-sky-500"
          />
          <span className="tabular-nums text-slate-400">{zoom.toFixed(1)}×</span>
        </label>
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={showHeatmap}
            onChange={(e) => setShowHeatmap(e.target.checked)}
            className="accent-sky-500"
          />
          Show Heatmap
        </label>
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={showBlocks}
            onChange={(e) => setShowBlocks(e.target.checked)}
            className="accent-sky-500"
          />
          Show Maintenance Blocks
        </label>
      </div>
      <div ref={wrapRef} className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-800 bg-slate-950">
        <canvas
          ref={canvasRef}
          className={`block h-full w-full ${hover ? 'cursor-pointer' : 'cursor-default'}`}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        />
        {mouse && hover && tooltip && (
          <div
            className="pointer-events-none absolute z-10 w-60 rounded-lg border border-slate-700 bg-slate-900/95 p-3 shadow-xl shadow-black/40"
            style={{ left: tipLeft, top: mouse.y + 12 }}
          >
            {tooltip}
          </div>
        )}
      </div>
    </div>
  );
}