import type { AssetDto, BlockDto, StationDto, TrainDto } from '../types';
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

const colorOf = (train: TrainDto) =>
  train.type === 'FREIGHT' || train.priority >= 3
    ? '#38bdf8'
    : train.type === 'EXPRESS' || train.priority === 1
      ? '#f87171'
      : '#22d3ee';

/** Split a stop polyline into its adjacent segments for intersection checks. */
function segmentsOf(points: { x1: number; y1: number }[]): Segment[] {
  return points.slice(0, -1).map((p, i) => ({
    x1: p.x1,
    y1: p.y1,
    x2: points[i + 1].x1,
    y2: points[i + 1].y1,
  }));
}

/**
 * Renders the time-space string diagram. X is minutes-of-day mapped across the
 * full canvas width (day-centred crop at zoom > 1), Y is chainage KM with a
 * 40px gutter. Pure + side-effect-free apart from the given 2D context, so
 * self-checks can drive it with a mock context.
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
  };

  // Background grid: thin hour column guides.
  for (let hour = 0; hour <= 24; hour++) {
    const gx = xOf(hour * 60);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(gx, 20);
    ctx.lineTo(gx, height - 20);
    ctx.stroke();
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
      const x1 = xOf(getMinutesFromMidnight(block.startTime));
      const x2 = xOf(getMinutesFromMidnight(block.endTime));
      const y1 = yOf(block.startKm);
      const y2 = yOf(block.endKm);
      ctx.fillRect(x1, Math.min(y1, y2), Math.max(2, x2 - x1), Math.abs(y2 - y1));
      ctx.strokeRect(x1, Math.min(y1, y2), Math.max(2, x2 - x1), Math.abs(y2 - y1));
      stats.blocks += 1;
    }
  }

  // Train trajectories: one sloped polyline per train over its schedule stops.
  // Express in red/orange, freight in blue. Fallback stops (origin→destination
  // times) are generated when no schedule payload is present.
  const polylines = opts.trains.map((train) => ({ train, points: trainStops(train, opts.stations, minKm, maxKm) }));

  for (const { train, points } of polylines) {
    if (points.length < 2) continue;
    if (!points.some((p) => scale.inView(p.timeMins))) continue;
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
    ctx.fillText(train.trainId, xOf(points[0].timeMins) + 4, yOf(points[0].km) - 4);
    stats.trains += 1;
  }

  // Conflict halos: red glow at crossing points between train polylines.
  for (let i = 0; i < polylines.length; i++) {
    for (let j = i + 1; j < polylines.length; j++) {
      const a = segmentsOf(polylines[i].points.map((p) => ({ x1: p.timeMins, y1: p.km })));
      const b = segmentsOf(polylines[j].points.map((p) => ({ x1: p.timeMins, y1: p.km })));
      for (const sa of a) {
        for (const sb of b) {
          const hit = segmentIntersection(sa, sb);
          if (!hit || !scale.inView(hit.x)) continue;
          const cx = xOf(hit.x);
          const cy = yOf(hit.y);
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
    }
  }

  // Live train markers at the cursor time; flip the label below the marker
  // when it sits on/near a station line so it never collides with the station
  // label drawn just above the line.
  for (const [trainId, ch] of Object.entries(opts.live)) {
    if (ch < minKm || ch > maxKm) continue;
    const mx = xOf(opts.cursorMin);
    const my = yOf(ch);
    ctx.strokeStyle = '#f87171';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(mx, my, 6, 0, Math.PI * 2);
    ctx.stroke();
    const nearStation = opts.stations.some((s) => Math.abs(s.km - ch) < LABEL_FLIP_KM);
    const labelY = nearStation ? my + 16 : my - 8;
    ctx.fillStyle = '#fecaca';
    ctx.fillText(trainId, mx + 8, labelY);
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