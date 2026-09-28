import type { AssetDto, BlockDto, StationDto, TrainDto, TrainLive } from '../types';
import {
  buildDayScale,
  getMinutesFromMidnight,
  kmOfStation,
  kmToY,
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
  /** disruption / problem locations: badge drawn at asset km + operating window. */
  disruptions?: readonly DisruptionDot[];
  zoom: number;
  showHeatmap: boolean;
  showBlocks: boolean;
  /** Draw only conflict halos, hiding trajectory strings. */
  conflictsOnly: boolean;
  /** cursor position on the day axis, minutes since midnight. */
  cursorMin: number;
}

/** A disruption / problem location: fixed chainage and active time window. */
export interface DisruptionDot {
  id: string;
  km: number;
  startMins: number;
  endMins: number;
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

/** Critical asset-zone warning band rect, in CSS pixels (for hit testing). */
export interface ZoneHit {
  assetId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Disruption warning badge position, in CSS pixels (for click hit testing). */
export interface DisruptionHit {
  disruptionId: string;
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
  zoneHits: ZoneHit[];
  disruptionHits: DisruptionHit[];
}

// Risk-band + conflict palette (desktop mirror): amber freight/local strings
// and emerald/red accents from ThemeConstants.
const ACCENT_AMBER = '#FFC107';
const ACCENT_RED = '#E53935';
const GRID_MAJOR = '#2A3550';
const GRID_MINOR = '#1E2638';
const STATION_LINE = '#3A4560';
const BLOCK_GREEN = '#22c55e';
const BLOCK_AMBER = '#f59e0b';
const DISRUPTION_RED = '#ef4444';

// Dual-line lane palette: UP lane (ascending chainage) drawn solid in bright
// sky blue for high-priority trains and yellow for the rest; DOWN lane
// (descending chainage) drawn dashed for instant operational recognition.
const UP_BLUE = '#38bdf8';
const DOWN_YELLOW = '#eab308';

const LEFT_PAD = 80;
const TOP_PAD = 40;
const BOTTOM_PAD = 70;
const RIGHT_PAD = 40;

/** Train string color: DFC freight stays amber, high-priority express bright sky blue, else yellow. */
const colorOf = (train: TrainDto) =>
  train.type === 'FREIGHT' || train.priority > 2 ? DOWN_YELLOW : UP_BLUE;

/**
 * Dash pattern: DFC freight rakes are ALWAYS dashed ([8,4]) regardless of lane
 * so a shallow amber rake reads instantly; DOWN lane strings dash tighter
 * ([6,4]) per the legend.
 */
const dashOf = (train: TrainDto, down: boolean): [number, number] | null =>
  train.type === 'FREIGHT' ? [8, 4] : down ? [6, 4] : null;

/**
 * Lane direction: an explicit `train.direction` wins when the payload carries
 * one; otherwise the stop polyline decides — UP (Dadar→Thane→Kalyan) runs
 * 0 KM → 60 KM ascending, DOWN (Kalyan→Thane→Dadar) runs top → 0 KM.
 */
const laneOf = (train: TrainDto, points: { km: number }[]): number => {
  if (train.direction === 'DOWN') return -1;
  if (train.direction === 'UP') return 1;
  return points.length < 2 || points[points.length - 1].km >= points[0].km ? 1 : -1;
};

/** Maintenance-block window tint: high-priority possession → amber, else green. */
const blockColor = (block: BlockDto) => (block.blockPriority >= 3 ? BLOCK_AMBER : BLOCK_GREEN);

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

/**
 * Renders the time-space string diagram (Java Swing engine replicant).
 * X is minutes-of-day mapped across the padded horizontal axis (80px left gutter
 * for the KM/Y labels, 40px right), Y is chainage KM with 65px bottom gutter. Pure +
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
  const yOf = (km: number) => kmToY(km, minKm, maxKm, height, TOP_PAD, BOTTOM_PAD);

  const stats: RenderStats = {
    stations: 0,
    trains: 0,
    blocks: 0,
    conflicts: 0,
    live: 0,
    heatSlices: 0,
    blockHits: [],
    liveHits: [],
    zoneHits: [],
    disruptionHits: [],
  };

  ctx.font = '11px ui-monospace, monospace';

  const plotW = width - LEFT_PAD - RIGHT_PAD;
  const plotH = height - TOP_PAD - BOTTOM_PAD;

  // Desktop grid mirror: solid 10-KM horizontals (major at multiples of 50)
  // with numeric "N KM" labels right-aligned to the left gutter, 30-minute
  // verticals (hour lines heavier) with hour labels below the plot, dashed
  // station lines with names in the right gutter, and a plot border box.
  ctx.save();
  ctx.font = '10px monospace';
  for (let km = Math.ceil(minKm / 10) * 10; km <= Math.floor(maxKm / 10) * 10; km += 10) {
    const y = yOf(km);
    ctx.strokeStyle = km % 50 === 0 ? GRID_MAJOR : GRID_MINOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(LEFT_PAD, y);
    ctx.lineTo(LEFT_PAD + plotW, y);
    ctx.stroke();
    const label = `${km} KM`;
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(label, LEFT_PAD - ctx.measureText(label).width - 6, y + 4);
  }
  for (let min = 0; min <= 1440; min += 30) {
    const gx = xOf(min);
    const isHour = min % 60 === 0;
    ctx.strokeStyle = isHour ? GRID_MAJOR : GRID_MINOR;
    ctx.lineWidth = isHour ? 1 : 0.5;
    ctx.beginPath();
    ctx.moveTo(gx, TOP_PAD);
    ctx.lineTo(gx, TOP_PAD + plotH);
    ctx.stroke();
  }
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = STATION_LINE;
  for (const station of opts.stations) {
    const y = yOf(station.km);
    ctx.beginPath();
    ctx.moveTo(LEFT_PAD, y);
    ctx.lineTo(LEFT_PAD + plotW, y);
    ctx.stroke();
    ctx.fillStyle = '#E0E0E0';
    ctx.fillText(station.stationName, LEFT_PAD + plotW + 6, y + 4);
    stats.stations += 1;
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = GRID_MAJOR;
  ctx.lineWidth = 1;
  ctx.strokeRect(LEFT_PAD, TOP_PAD, plotW, plotH);
  // Explicit 24-hour day ticks (00:00 → 24:00) sitting in the bottom gutter
  // just above the horizontal scrollbar — the canvas bottoms out at BOTTOM_PAD
  // so the labels are never clipped by the scrolling container.
  ctx.fillStyle = '#94a3b8';
  for (let min = 0; min <= 1440; min += 180) {
    ctx.fillText(`${String(min / 60).padStart(2, '0')}:00`, xOf(min) - 12, height - 25);
  }
  ctx.restore();

  // Active maintenance block windows (green), used later for conflict detection.
  const blockWindows: BlockWindow[] = opts.blocks.map((b) => ({
    startMin: getMinutesFromMidnight(b.startTime),
    endMin: getMinutesFromMidnight(b.endTime),
    startKm: Math.min(b.startKm, b.endKm),
    endKm: Math.max(b.startKm, b.endKm),
  }));

  if (opts.showBlocks) {
    for (const block of opts.blocks) {
      const x1 = xOf(getMinutesFromMidnight(block.startTime));
      const x2 = xOf(getMinutesFromMidnight(block.endTime));
      const y1 = yOf(block.startKm);
      const y2 = yOf(block.endKm);
      const bx = x1;
      const by = Math.min(y1, y2);
      const bw = Math.max(2, x2 - x1);
      const bh = Math.abs(y2 - y1);
      const base = blockColor(block);
      ctx.save();
      ctx.shadowColor = base;
      ctx.shadowBlur = 10;
      ctx.fillStyle = hexA(base, 0.14);
      ctx.strokeStyle = hexA(base, 0.7);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, bh, 10);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 10px monospace';
      ctx.fillText(block.blockId, bx + 8, by + 16);
      stats.blocks += 1;
      stats.blockHits.push({ blockId: block.blockId, x: bx, y: by, w: bw, h: bh });
    }
  }

  // Risk Overlay (desktop mirror): a subtle translucent horizontal warning band
  // at each critical asset's chainage spanning the full drawable width — no
  // floating gutter dots, so the band reads as a risk corridor the trains run
  // through. Each band is a click target for the inspector.
  if (opts.showHeatmap) {
    for (const asset of opts.assets) {
      if (asset.locationKm < minKm || asset.locationKm > maxKm) continue;
      const y = yOf(asset.locationKm);
      ctx.fillStyle = 'rgba(239, 68, 68, 0.15)';
      ctx.fillRect(LEFT_PAD, y - 8, plotW, 16);
      stats.heatSlices += 1;
      stats.zoneHits.push({ assetId: asset.assetId, x: LEFT_PAD, y: y - 8, w: plotW, h: 16 });
    }
  }

  // Train trajectories (desktop mirror): soft glow underlay + 2.5px core,
  // coloured by priority (≤2 blue, else amber); with "Conflicts Only" enabled
  // non-conflicting strings are dimmed instead of hidden. The id label sits in
  // a dark pill at the string's chord midpoint.
  const polylines = opts.trains.map((train) => ({ train, points: trainStops(train, opts.stations, minKm, maxKm) }));

  const conflicted = new Map<string, boolean>();
  for (const { train, points } of polylines) {
    const segs = segmentsOf(points.map((p) => ({ x1: p.timeMins, y1: p.km })));
    conflicted.set(train.trainId, segs.some((seg) => blockWindows.some((win) => segmentRectHit(seg, win))));
  }

  for (const { train, points } of polylines) {
    if (points.length < 2) continue;
    if (!points.some((p) => scale.inView(p.timeMins))) continue;
    const color = colorOf(train);
    const down = laneOf(train, points) < 0;
    const dash = dashOf(train, down);
    const dim = opts.conflictsOnly && !(conflicted.get(train.trainId) ?? false);
    if (dim) {
      ctx.save();
      if (dash) ctx.setLineDash(dash);
      ctx.strokeStyle = hexA(color, 30 / 255);
      ctx.lineWidth = 1;
      ctx.beginPath();
      points.forEach((p, idx) => {
        const px = xOf(p.timeMins);
        const py = yOf(p.km);
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.restore();
      stats.trains += 1;
      continue;
    }
    ctx.save();
    if (dash) ctx.setLineDash(dash);
    ctx.strokeStyle = hexA(color, 35 / 255);
    ctx.lineWidth = 7;
    ctx.beginPath();
    points.forEach((p, idx) => {
      const px = xOf(p.timeMins);
      const py = yOf(p.km);
      if (idx === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();
    const first = points[0];
    const last = points[points.length - 1];
    const midX = (xOf(first.timeMins) + xOf(last.timeMins)) / 2;
    const midY = (yOf(first.km) + yOf(last.km)) / 2;
    const label = down ? `${train.trainId} ▾` : `${train.trainId} ▴`;
    ctx.font = '9px monospace';
    const textW = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(25, 33, 48, 0.86)';
    ctx.beginPath();
    ctx.roundRect(midX - 2, midY - 13, textW + 8, 14, 8);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(label, midX + 2, midY - 3);
    stats.trains += 1;
  }

  // Conflict halos (desktop mirror): three concentric red ovals where a
  // trajectory cuts an active maintenance block window.
  if (blockWindows.length > 0) {
    for (const { points } of polylines) {
      const segs = segmentsOf(points.map((p) => ({ x1: p.timeMins, y1: p.km })));
      for (const win of blockWindows) {
        for (const seg of segs) {
          const hit = segmentRectHit(seg, win);
          if (!hit || !scale.inView(hit.x)) continue;
          const cx = xOf(hit.x);
          const cy = yOf(hit.y);
          ctx.fillStyle = hexA(ACCENT_RED, 25 / 255);
          ctx.beginPath();
          ctx.arc(cx, cy, 14, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = hexA(ACCENT_RED, 55 / 255);
          ctx.beginPath();
          ctx.arc(cx, cy, 10, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = hexA(ACCENT_RED, 180 / 255);
          ctx.beginPath();
          ctx.arc(cx, cy, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = ACCENT_RED;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(cx, cy, 6, 0, Math.PI * 2);
          ctx.stroke();
          stats.conflicts += 1;
        }
      }
    }
  }

  // Disruption / problem locations (spec): the badge is pinned EXACTLY where a
  // train trajectory intersects the disruption's operating window (startMins..
  // endMins × km±3), so it rides on the line instead of floating unanchored.
  // No dashed underline — the glowing red exclamation badge is the marker.
  for (const d of opts.disruptions ?? []) {
    const win: BlockWindow = {
      startMin: d.startMins,
      endMin: d.endMins,
      startKm: d.km - 3,
      endKm: d.km + 3,
    };
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 240 + d.id.length * 0.7);
    for (const { points } of polylines) {
      for (const seg of segmentsOf(points.map((p) => ({ x1: p.timeMins, y1: p.km })))) {
        const hit = segmentRectHit(seg, win);
        if (!hit || !scale.inView(hit.x)) continue;
        const cx = xOf(hit.x);
        const cy = yOf(hit.y);
        ctx.save();
        ctx.shadowColor = DISRUPTION_RED;
        ctx.shadowBlur = 14;
        ctx.strokeStyle = DISRUPTION_RED;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, 8 + pulse * 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = hexA(DISRUPTION_RED, 55 / 255);
        ctx.beginPath();
        ctx.arc(cx, cy, 7 + pulse * 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = DISRUPTION_RED;
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('!', cx, cy + 0.5);
        ctx.restore();
        stats.disruptionHits.push({ disruptionId: d.id, x: cx, y: cy });
      }
    }
  }

  // Live train markers: glowing amber dot pinned to each train's own sloped
  // trajectory — X follows the interpolated schedule time (pos.mins), Y the
  // matching chainage — never the wall-clock column. The id label rides in a
  // small dark pill offset (+8, -4); markers near the bottom origin flip the
  // pill ABOVE the marker so the label never covers the X-axis tick labels.
  for (const [trainId, pos] of Object.entries(opts.live)) {
    if (pos.km < minKm || pos.km > maxKm) continue;
    const mx = xOf(pos.mins ?? opts.cursorMin);
    const my = yOf(pos.km);
    ctx.fillStyle = hexA(ACCENT_AMBER, 60 / 255);
    ctx.beginPath();
    ctx.arc(mx, my, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = ACCENT_AMBER;
    ctx.beginPath();
    ctx.arc(mx, my, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0b1220';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(mx, my, 5, 0, Math.PI * 2);
    ctx.stroke();
    const nearBottom = my > yOf(minKm) - 14;
    const liveDir = opts.trains.find((t) => t.trainId === trainId)?.direction;
    const label = liveDir === 'DOWN' ? `${trainId} ▾` : liveDir === 'UP' ? `${trainId} ▴` : trainId;
    ctx.font = '9px monospace';
    const textW = ctx.measureText(label).width;
    // Badge offset (+10, -12) from the marker centre so passing trains' labels
    // never stack over each other or cover their own glowing dot.
    ctx.fillStyle = 'rgba(25, 33, 48, 0.86)';
    ctx.beginPath();
    ctx.roundRect(mx + 10, nearBottom ? my - 12 - 12 : my - 12, textW + 6, 12, 6);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(label, mx + 13, nearBottom ? my - 16 : my - 4);
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