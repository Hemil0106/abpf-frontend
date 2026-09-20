import type { StationDto, TrainDto } from '../types';

/** Local ISO-8601 (no timezone) to epoch milliseconds — matches the backend timestamps. */
export function isoToEpochMs(iso: string): number {
  return new Date(iso).getTime();
}

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

export function trainSegment(train: TrainDto, kmOf: (name: string | null) => number): Segment {
  return {
    x1: isoToEpochMs(train.departureTime),
    y1: kmOf(train.originStation),
    x2: isoToEpochMs(train.arrivalTime),
    y2: kmOf(train.destinationStation),
  };
}

/** Visible time window (epoch mins) given trains, blocks, the cursor and zoom. */
export function timeWindow(
  trainsEv: readonly number[],
  blockEv: readonly number[],
  cursorMs: number,
  zoom: number,
): { minMs: number; visibleMs: number } {
  const cursorMin = cursorMs / 60_000;
  const events = [
    ...trainsEv,
    ...blockEv,
    cursorMin,
    cursorMin + 60,
    cursorMin - 60,
  ];
  const min = Math.min(...events);
  const max = Math.max(...events);
  const span = Math.max(90, max - min);
  const visibleMs = (span / Math.max(zoom, 0.25)) * 60_000;
  const minMs = Math.min(min * 60_000, cursorMs - visibleMs * 0.25, max * 60_000 - visibleMs);
  return { minMs, visibleMs };
}

export interface TimeScale {
  x(min: number): number;
  y(km: number): number;
  inView(min: number): boolean;
}

export function buildTimeScale(opts: {
  width: number;
  height: number;
  startKm: number;
  endKm: number;
  minMs: number;
  visibleMs: number;
}): TimeScale {
  const kmSpan = Math.max(1e-6, opts.endKm - opts.startKm);
  return {
    x: (ms) => ((ms - opts.minMs) / opts.visibleMs) * opts.width,
    y: (km) => opts.height - ((km - opts.startKm) / kmSpan) * opts.height,
    inView: (ms) => ms >= opts.minMs && ms <= opts.minMs + opts.visibleMs,
  };
}