import type { AssetDto, BlockDto, StationDto, TrainDto } from '../types';
import {
  buildDayScale,
  clockWindow,
  kmOfStation,
  minutesOfDay,
  riskColor,
  segmentIntersection,
  trainSegment,
} from './tsdMath';

export interface TimeSpaceRenderOptions {
  width: number;
  height: number;
  startKm: number;
  endKm: number;
  stations: readonly StationDto[];
  trains: readonly TrainDto[];
  blocks: readonly BlockDto[];
  assets: readonly AssetDto[];
  /** live trainId → current chainage Km, from the telemetry feed. */
  live: Readonly<Record<string, number>>;
  zoom: number;
  showHeatmap: boolean;
  showBlocks: boolean;
  /** cursor position on the day axis, minutes since midnight. */
  cursorMin: number;
}

export interface RenderStats {
  stations: number;
  trains: number;
  blocks: number;
  conflicts: number;
  live: number;
  heatSlices: number;
}

const HEAT_SLICES = 40;

/** Chainage gap below which a live marker sits on a station line and its label must flip below it. */
const LABEL_FLIP_KM = 12;

/**
 * Renders the time-space string diagram. X is minutes-of-day mapped across the
 * full canvas width, Y is chainage KM. Pure + side-effect-free apart from the
 * given 2D context, so self-checks can drive it with a mock context.
 */
export function drawTimeSpace(
  ctx: CanvasRenderingContext2D,
  opts: TimeSpaceRenderOptions,
): RenderStats {
  const { width, height } = opts;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0, 0, width, height);

  const kmOf = (name: string | null) =>
    kmOfStation(name, opts.stations, opts.startKm, opts.endKm);

  const { startMin, endMin } = clockWindow(opts.cursorMin, opts.zoom);
  const scale = buildDayScale({ width, height, startKm: opts.startKm, endKm: opts.endKm, startMin, endMin });

  const stats: RenderStats = {
    stations: 0,
    trains: 0,
    blocks: 0,
    conflicts: 0,
    live: 0,
    heatSlices: 0,
  };

  // Heatmap overlay: vertical risk bands by asset failure risk.
  if (opts.showHeatmap) {
    const band = (opts.endKm - opts.startKm) / HEAT_SLICES;
    for (let i = 0; i < HEAT_SLICES; i++) {
      const centerKm = opts.startKm + band * (i + 0.5);
      const risk = opts.assets.reduce(
        (acc, a) =>
          a.locationKm >= centerKm - band / 2 && a.locationKm <= centerKm + band / 2
            ? Math.max(acc, a.failureRiskScore)
            : acc,
        -Infinity,
      );
      if (!Number.isFinite(risk)) continue;
      ctx.fillStyle = hexA(riskColor(risk), 0.18);
      ctx.fillRect(0, scale.y(centerKm + band / 2), width, band * (height / Math.max(1e-6, opts.endKm - opts.startKm)));
      stats.heatSlices += 1;
    }
  }

  // Station lines along the Y (KM) axis.
  ctx.font = '11px ui-monospace, monospace';
  ctx.fillStyle = '#94a3b8';
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
  ctx.lineWidth = 1;
  for (const station of opts.stations) {
    const y = scale.y(station.km);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
    ctx.fillText(`${station.stationName}  ${station.km}KM`, 6, y - 3);
    stats.stations += 1;
  }

  // Maintenance blocks: shaded time × chainage rectangles.
  if (opts.showBlocks) {
    ctx.fillStyle = 'rgba(245, 158, 11, 0.22)';
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.8)';
    for (const block of opts.blocks) {
      const x1 = scale.x(minutesOfDay(block.startTime));
      const x2 = scale.x(minutesOfDay(block.endTime));
      const y1 = scale.y(block.startKm);
      const y2 = scale.y(block.endKm);
      ctx.fillRect(x1, Math.min(y1, y2), Math.max(2, x2 - x1), Math.abs(y2 - y1));
      ctx.strokeRect(x1, Math.min(y1, y2), Math.max(2, x2 - x1), Math.abs(y2 - y1));
      stats.blocks += 1;
    }
  }

  // Train trajectories: one sloped line per train from origin to destination
  // stop, drawn only when either endpoint is inside the visible window.
  const segments = opts.trains.map((t) => ({ train: t, seg: trainSegment(t, kmOf) }));
  const colorOf = (priority: number) =>
    priority <= 1 ? '#38bdf8' : priority <= 2 ? '#818cf8' : priority <= 3 ? '#a3e635' : '#22d3ee';

  for (const { train, seg } of segments) {
    if (!scale.inView(seg.x1) && !scale.inView(seg.x2)) continue;
    ctx.strokeStyle = colorOf(train.priority);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(scale.x(seg.x1), scale.y(seg.y1));
    ctx.lineTo(scale.x(seg.x2), scale.y(seg.y2));
    ctx.stroke();
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(train.trainId, scale.x(seg.x1) + 4, scale.y(seg.y1) - 4);
    stats.trains += 1;
  }

  // Conflict halos: red glow at crossing points.
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const hit = segmentIntersection(segments[i].seg, segments[j].seg);
      if (!hit || !scale.inView(hit.x)) continue;
      const cx = scale.x(hit.x);
      const cy = scale.y(hit.y);
      const gradient = ctx.createRadialGradient(cx, cy, 1, cx, cy, 26);
      gradient.addColorStop(0, 'rgba(239, 68, 68, 0.9)');
      gradient.addColorStop(1, 'rgba(239, 68, 68, 0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(cx, cy, 26, 0, Math.PI * 2);
      ctx.fill();
      stats.conflicts += 1;
    }
  }

  // Live train markers at the cursor time; flip the label below the marker
  // when it sits on/near a station line so it never collides with the station
  // label drawn just above the line.
  for (const [trainId, ch] of Object.entries(opts.live)) {
    if (ch < opts.startKm || ch > opts.endKm) continue;
    const x = scale.x(opts.cursorMin);
    const y = scale.y(ch);
    ctx.strokeStyle = '#f87171';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.stroke();
    const nearStation = opts.stations.some((s) => Math.abs(s.km - ch) < LABEL_FLIP_KM);
    const labelY = nearStation ? y + 16 : y - 8;
    ctx.fillStyle = '#fecaca';
    ctx.fillText(trainId, x + 8, labelY);
    stats.live += 1;
  }

  return stats;
}

function hexA(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}