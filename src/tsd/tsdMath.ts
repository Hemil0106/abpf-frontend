import type { StationDto, TrainDto } from '../types';

export type RiskLevel = 'clear' | 'caution' | 'critical';

export function riskLevel(risk: number): RiskLevel {
  if (risk > 0.6) return 'critical';
  if (risk > 0.3) return 'caution';
  return 'clear';
}

export function riskColor(risk: number): string {
  const level = riskLevel(risk);
  return level === 'critical' ? '#dc2626' : level === 'caution' ? '#f59e0b' : '#16a34a';
}

/**
 * Wall-clock minutes since midnight (0..1440) for a local ISO time string,
 * Date, or epoch number. The backend timestamps (e.g. "2026-09-20T06:00:00")
 * are timezone-less local times, so Date#getHours/getMinutes give the true
 * wall-clock of the day diagram.
 */
export function minutesOfDay(value: string | Date | number): number {
  const d = typeof value === 'string' ? new Date(value) : value instanceof Date ? value : new Date(value);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

/** Station → chainage KM; unknown stations snap to the section lower bound. */
export function kmOfStation(
  station: string | null | undefined,
  stations: readonly StationDto[],
  fallbackLo: number,
  fallbackHi: number,
): number {
  if (!station) return fallbackLo;
  const hit = stations.find((s) => s.stationName === station);
  if (hit) return hit.km;
  // ponytail: no station-geodesy on the client; unknown origins anchor at section start.
  void fallbackHi;
  return fallbackLo;
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Line intersection in the (x,y) plane, or null when parallel/disjoint. */
export function segmentIntersection(a: Segment, b: Segment): { x: number; y: number } | null {
  const dx1 = a.x2 - a.x1;
  const dy1 = a.y2 - a.y1;
  const dx2 = b.x2 - b.x1;
  const dy2 = b.y2 - b.y1;
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-12) return null;
  const qx = b.x1 - a.x1;
  const qy = b.y1 - a.y1;
  const s = (qx * dy2 - qy * dx2) / denom;
  const t = (qx * dy1 - qy * dx1) / denom;
  if (s < 0 || s > 1 || t < 0 || t > 1) return null;
  return { x: a.x1 + s * dx1, y: a.y1 + s * dy1 };
}

/** Sloped trajectory segment: x = departure/arrival as minutes-of-day, y = origin/destination KM. */
export function trainSegment(train: TrainDto, kmOf: (name: string | null) => number): Segment {
  return {
    x1: minutesOfDay(train.departureTime),
    y1: kmOf(train.originStation),
    x2: minutesOfDay(train.arrivalTime),
    y2: kmOf(train.destinationStation),
  };
}

/**
 * Visible window on the day axis, centered on the cursor and clamped to
 * [0, 1440]. zoom = 1 shows the full day; higher zooms crop around the cursor.
 */
export function clockWindow(
  cursorMin: number,
  zoom: number,
  dayMinutes = 1440,
): { startMin: number; endMin: number } {
  const clamped = Math.max(0, Math.min(dayMinutes, cursorMin));
  const span = Math.max(60, Math.min(dayMinutes, dayMinutes / Math.max(zoom, 0.25)));
  const start = Math.max(0, Math.min(dayMinutes - span, clamped - span / 2));
  return { startMin: start, endMin: start + span };
}

export interface DayScale {
  x(minOfDay: number): number;
  y(km: number): number;
  inView(minOfDay: number): boolean;
}

export function buildDayScale(opts: {
  width: number;
  height: number;
  startKm: number;
  endKm: number;
  startMin: number;
  endMin: number;
}): DayScale {
  const kmSpan = Math.max(1e-6, opts.endKm - opts.startKm);
  const minSpan = Math.max(1e-6, opts.endMin - opts.startMin);
  return {
    x: (min) => ((min - opts.startMin) / minSpan) * opts.width,
    y: (km) => opts.height - ((km - opts.startKm) / kmSpan) * opts.height,
    inView: (min) => min >= opts.startMin && min <= opts.endMin,
  };
}