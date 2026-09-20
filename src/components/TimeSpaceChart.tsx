import { useEffect, useRef, useState } from 'react';
import type { AssetDto, BlockDto, SectionDto, StationDto, TrainDto } from '../types';
import { drawTimeSpace } from '../tsd/renderTimeSpace';
import { parseTimeInput } from '../tsd/tsdMath';

interface TimeSpaceChartProps {
  startKm: number;
  endKm: number;
  activeSection: SectionDto | null;
  stations: readonly StationDto[];
  trains: readonly TrainDto[];
  blocks: readonly BlockDto[];
  assets: readonly AssetDto[];
  live: Readonly<Record<string, number>>;
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

  const [zoom, setZoom] = useState(1);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showBlocks, setShowBlocks] = useState(true);

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
      drawTimeSpace(ctx, {
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
        cursorMin: parseTimeInput(new Date()),
      });
    };

    render();
    const timer = window.setInterval(render, 1000);
    const observer = new ResizeObserver(render);
    observer.observe(wrap);
    return () => {
      window.clearInterval(timer);
      observer.disconnect();
    };
  }, [startKm, endKm, stations, trains, blocks, assets, zoom, showHeatmap, showBlocks]);

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
      <div ref={wrapRef} className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-800 bg-slate-950">
        <canvas ref={canvasRef} className="block h-full w-full" />
      </div>
    </div>
  );
}