import type { AssetDto, BlockDto, StationDto, TrainDto, TrainLive } from '../types';
import {
  buildDayScale,
  getMinutesFromMidnight,
  kmOfStation,
  kmToY,
  riskColor,
  segmentIntersection,
  timeToX,
  trainStops,
  type Segment,
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
  /** live trainId → current position snapshot from the telemetry feed. */
  live: Readonly<Record<string, TrainLive>>;
  zoom: number;
  showHeatmap: boolean;
  showBlocks: boolean;
  /** Draw only conflict halos, hiding trajectory strings. */
  conflictsOnly: boolean;
  /** cursor position on the day axis, minutes since midnight. */
  cursorMin: number;
}

/** Maintenance block window bounding box, in CSS pixels (for hit testing). */
export interface BlockHit {
  blockId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Live train marker position, in CSS pixels (for hit testing). */
export interface LiveHit {
  trainId: string;
  x: number;
  y: number;
}

export interface RenderStats {
  stations: number;
  trains: number;
  blocks: number;
  conflicts: number;
  live: number;
  heatSlices: number;
  blockHits: BlockHit[];
  liveHits: LiveHit[];
}

const HEAT_SLICES = 40;

/** Chainage gap below which a live marker sits on a station line and its label must flip below it. */
const LABEL_FLIP_KM = 12;

/** Sloped line palette: freight amber, everything else sky blue (desktop legend). */
const colorOf = (train: TrainDto) =>
  train.type === 'FREIGHT' ? '#eab308' : '#38bdf8';

/** A maintenance block window in (time, km) axes, km normalized low→high. */
interface BlockWindow {
  startMin: number;
  endMin: number;
  startKm: number;
  endKm: number;
}

/** Split a stop polyline into its adjacent segments for intersection checks. */
function segmentsOf(points: { x1: number; y1: number }[]): Segment[] {
  return points.slice(0, -1).map((p, i) => ({
    x1: p.x1,
    y1: p.y1,
    x2: points[i + 1].x1,
    y2: points[i + 1].y1,
  }));
}

/** Point where a trajectory segment enters a block window, or null when it misses. */
function segmentRectHit(seg: Segment, win: BlockWindow): { x: number; y: number } | null {
  const yLo = Math.min(win.startKm, win.endKm);
  const yHi = Math.max(win.startKm, win.endKm);
  const inside = (px: number, py: number) =>
    px >= win.startMin && px <= win.endMin && py >= yLo && py <= yHi;
  if (inside(seg.x1, seg.y1) || inside(seg.x2, seg.y2)) {
    return inside(seg.x1, seg.y1) ? { x: seg.x1, y: seg.y1 } : { x: seg.x2, y: seg.y2 };
  }
  const edges: Segment[] = [
    { x1: win.startMin, y1: yLo, x2: win.endMin, y2: yLo },
    { x1: win.startMin, y1: yHi, x2: win.endMin, y2: yHi },
    { x1: win.startMin, y1: yLo, x2: win.startMin, y2: yHi },
    { x1: win.endMin, y1: yLo, x2: win.endMin, y2: yHi },
  ];
  for (const edge of edges) {
    const hit = segmentIntersection(seg, edge);
    if (hit) return hit;
  }
  return null;
}

/** Live marker sits on the train's string: interpolate the time at which the
 * schedule crosses the live chainage, so trains never stack on one X. */
function timeAtKmOnSchedule(points: { timeMins: number; km: number }[], km: number): number | null {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const lo = Math.min(a.km, b.km);
    const hi = Math.max(a.km, b.km);
    if (km >= lo && km <= hi) {
      const ratio = (km - lo) / Math.max(1e-9, hi - lo);
      return a.timeMins + ratio * (b.timeMins - a.timeMins);
    }
  }
  return null;
}

/**
 * Renders the time-space string diagram (Java Swing engine replicant).
 * X is minutes-of-day mapped across the padded horizontal axis (80px left gutter
 * for the KM/Y labels, 40px right), Y is chainage KM with a 40px gutter. Pure +
 * side-effect-free apart from the given 2D context, so self-checks can drive it
 * with a mock context.
 */
export function drawTimeSpace(
  ctx: CanvasRenderingContext2D,
  opts: TimeSpaceRenderOptions,
): RenderStats {
  const { width, height } = opts;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0, 0, width, height);

  // Guarded section bounds: a degenerate 0-length section can never NaN the Y axis.
  const minKm = opts.startKm ?? 0;
  const maxKm = opts.endKm ?? 100;

  const kmOf = (name: string | null) => kmOfStation(name, opts.stations, minKm, maxKm);
  const scale = buildDayScale({ height, startKm: minKm, endKm: maxKm, zoom: opts.zoom });
  const xOf = (min: number) => timeToX(min, width, opts.zoom);
  const yOf = (km: number) => kmToY(km, minKm, maxKm, height);

  const stats: RenderStats = {
    stations: 0,
    trains: 0,
    blocks: 0,
    conflicts: 0,
    live: 0,
    heatSlices: 0,
    blockHits: [],
    liveHits: [],
  };

  ctx.font = '11px ui-monospace, monospace';

  // Background grid: dashed horizontal lines at every station KM (section bounds
  // included) and dashed vertical lines at hourly ticks 00:00 → 23:00.
  ctx.save();
  ctx.setLineDash([5, 5]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
  const gridKms = new Set<number>([minKm, maxKm, ...opts.stations.map((s) => s.km)]);
  for (const km of gridKms) {
    const y = yOf(km);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  for (let hour = 0; hour < 24; hour++) {
    const gx = xOf(hour * 60);
    ctx.beginPath();
    ctx.moveTo(gx, 20);
    ctx.lineTo(gx, height - 20);
    ctx.stroke();
  }
  ctx.restore();

  // Station labels along the Y (KM) axis.
  ctx.fillStyle = '#94a3b8';
  for (const station of opts.stations) {
    ctx.fillText(`${station.stationName}  ${station.km}KM`, 6, yOf(station.km) - 3);
    stats.stations += 1;
  }

  // Active maintenance block windows (green), used later for conflict detection.
  const blockWindows: BlockWindow[] = opts.blocks.map((b) => ({
    startMin: getMinutesFromMidnight(b.startTime),
    endMin: getMinutesFromMidnight(b.endTime),
    startKm: Math.min(b.startKm, b.endKm),
    endKm: Math.max(b.startKm, b.endKm),
  }));

  if (opts.showBlocks) {
    ctx.fillStyle = 'rgba(34, 197, 94, 0.25)';
    ctx.strokeStyle = '#22c55e';
    for (const block of opts.blocks) {
      const x1 = xOf(getMinutesFromMidnight(block.startTime));
      const x2 = xOf(getMinutesFromMidnight(block.endTime));
      const y1 = yOf(block.startKm);
      const y2 = yOf(block.endKm);
      const bx = x1;
      const by = Math.min(y1, y2);
      const bw = Math.max(2, x2 - x1);
      const bh = Math.abs(y2 - y1);
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeRect(bx, by, bw, bh);
      stats.blocks += 1;
      stats.blockHits.push({ blockId: block.blockId, x: bx, y: by, w: bw, h: bh });
    }
  }

  // Heatmap overlay: vertical risk bands by asset failure risk.
  if (opts.showHeatmap) {
    const band = (maxKm - minKm) / HEAT_SLICES;
    for (let i = 0; i < HEAT_SLICES; i++) {
      const centerKm = minKm + band * (i + 0.5);
      const risk = opts.assets.reduce(
        (acc, a) =>
          a.locationKm >= centerKm - band / 2 && a.locationKm <= centerKm + band / 2
            ? Math.max(acc, a.failureRiskScore)
            : acc,
        -Infinity,
      );
      if (!Number.isFinite(risk)) continue;
      ctx.fillStyle = hexA(riskColor(risk), 0.18);
      const yTop = yOf(centerKm - band / 2);
      const yBottom = yOf(centerKm + band / 2);
      ctx.fillRect(0, yBottom, width, Math.max(1, yTop - yBottom));
      stats.heatSlices += 1;
    }
  }

  // Train trajectories: one sloped polyline per train over its schedule stops.
  // Fallback stops (origin→destination times) are generated when no schedule
  // payload is present. Labels sit beside the first point (+10 X, +4 Y).
  const polylines = opts.trains.map((train) => ({ train, points: trainStops(train, opts.stations, minKm, maxKm) }));

  for (const { train, points } of polylines) {
    if (points.length < 2) continue;
    if (!points.some((p) => scale.inView(p.timeMins))) continue;
    if (opts.conflictsOnly) continue;
    ctx.strokeStyle = colorOf(train);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    points.forEach((p, idx) => {
      const px = xOf(p.timeMins);
      const py = yOf(p.km);
      if (idx === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(train.trainId, xOf(points[0].timeMins) + 10, yOf(points[0].km) + 4);
    stats.trains += 1;
  }

  // Conflict halos: pulsing red rings where a trajectory cuts an active
  // maintenance block window.
  if (opts.showBlocks && blockWindows.length > 0) {
    const wave = Math.abs(Math.sin(Date.now() / 350));
    const ringRadius = 14 + 10 * wave;
    for (const { points } of polylines) {
      const segs = segmentsOf(points.map((p) => ({ x1: p.timeMins, y1: p.km })));
      for (const win of blockWindows) {
        for (const seg of segs) {
          const hit = segmentRectHit(seg, win);
          if (!hit || !scale.inView(hit.x)) continue;
          const cx = xOf(hit.x);
          const cy = yOf(hit.y);
          const gradient = ctx.createRadialGradient(cx, cy, 1, cx, cy, ringRadius + 12);
          gradient.addColorStop(0, 'rgba(229, 57, 53, 0.9)');
          gradient.addColorStop(1, 'rgba(229, 57, 53, 0)');
          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.arc(cx, cy, ringRadius + 12, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#E53935';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
          ctx.stroke();
          stats.conflicts += 1;
        }
      }
    }
  }

  // Live train markers: a pulsing red ring at each train's current position
// sitting ON its own trajectory string (live chainage interpolated against the
// schedule). Trains without a schedule crossover fall back to their reported
// position time, then the cursor time — never a shared mid-canvas X. The label
// flips below the marker when it sits on/near a station line.
  const liveWave = Math.abs(Math.sin(Date.now() / 350));
  for (const [trainId, pos] of Object.entries(opts.live)) {
    if (pos.km < minKm || pos.km > maxKm) continue;
    const trainPoly = polylines.find((p) => p.train.trainId === trainId);
    const onTrajectory = trainPoly ? timeAtKmOnSchedule(trainPoly.points, pos.km) : null;
    const mx = xOf(onTrajectory ?? pos.mins ?? opts.cursorMin);
    const my = yOf(pos.km);
    const liveRadius = 10 + 4 * liveWave;
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(mx, my, liveRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(mx, my, Math.max(2, liveRadius - 5), 0, Math.PI * 2);
    ctx.stroke();
    const nearStation = opts.stations.some((s) => Math.abs(s.km - pos.km) < LABEL_FLIP_KM);
    const labelY = nearStation ? my + 16 : my - 8;
    ctx.fillStyle = '#fecaca';
    ctx.fillText(trainId, mx + 8, labelY);
    stats.live += 1;
    stats.liveHits.push({ trainId, x: mx, y: my });
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