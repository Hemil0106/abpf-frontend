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
 * Wall-clock minutes since midnight (0..1440) for any time input: backend local
 * ISO strings ("2026-09-20T06:00:00"), bare clock times ("06:30", "22:15:30"),
 * Date instances, or epoch-millisecond numbers. The backend timestamps are
 * timezone-less local times, so the local Date accessors give the true
 * wall-clock of the day diagram.
 */
export function parseTimeInput(value: string | Date | number): number {
  if (typeof value === 'string') {
    const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
    if (match) {
      const h = Number(match[1]);
      const m = Number(match[2]);
      const s = match[3] ? Number(match[3]) : 0;
      if (h < 24 && m < 60 && s < 60) return h * 60 + m + s / 60;
    }
  }
  const d = typeof value === 'number' ? new Date(value) : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return 0;
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
    x1: parseTimeInput(train.departureTime),
    y1: kmOf(train.originStation),
    x2: parseTimeInput(train.arrivalTime),
    y2: kmOf(train.destinationStation),
  };
}

/**
 * Visible window on the day axis, day-centred. zoom = 1 shows the full 0–1440
 * day; higher zooms crop symmetrically so trajectories still span the visible
 * horizontal axis.
 */
export function dayWindow(zoom: number, dayMinutes = 1440): { startMin: number; endMin: number } {
  const span = Math.max(60, Math.min(dayMinutes, dayMinutes / Math.max(zoom, 0.25)));
  const start = (dayMinutes - span) / 2;
  return { startMin: start, endMin: start + span };
}

/**
 * Maps a time (minutes since midnight) to a canvas X coordinate across the
 * padded horizontal axis (80px left for the KM/Y labels, 40px right). The day
 * always spans the full width; horizontal zoom is applied upstream by growing
 * the canvas width (scroll container), so each minute keeps a constant pixel
 * pitch per zoom level and the shifted window just scrolls into view.
 */
export function timeToXCoordinate(
  timeMinutes: number,
  canvasWidth: number,
  _zoom = 1,
  paddingLeft = 80,
  paddingRight = 40,
): number {
  const clamped = Math.max(0, Math.min(1440, timeMinutes));
  const inner = Math.max(0, canvasWidth - paddingLeft - paddingRight);
  return paddingLeft + (clamped / 1440) * inner;
}

/**
 * Chainage km → canvas Y. `paddingTop` leaves room for the axis label above the
 * highest KM; `paddingBottom` (65px) is a deep bottom gutter so the X-axis
 * baseline, tick marks and time labels never collide with the station name at
 * the section's lower bound. `maxKm - minKm` is floored at 1 so a degenerate
 * section can never produce NaN/Infinity Y.
 */
export function kmToY(
  km: number,
  minKm: number,
  maxKm: number,
  height: number,
  paddingTop = 40,
  paddingBottom = 65,
): number {
  const ratio = (km - minKm) / Math.max(1, maxKm - minKm);
  return height - paddingBottom - ratio * (height - paddingTop - paddingBottom);
}

export interface DayScale {
  y(km: number): number;
  inView(minOfDay: number): boolean;
}

export function buildDayScale(opts: {
  height: number;
  startKm: number;
  endKm: number;
  zoom?: number;
}): DayScale {
  return {
    y: (km) => kmToY(km, opts.startKm, opts.endKm, opts.height),
    // Scrollable whole-day canvas: every minute is always reachable by
    // horizontal scrolling, so nothing is culled.
    inView: () => true,
  };
}

/**
 * Estimated delay (minutes) of a train vs its plan: expected chainage at
 * `nowMin` (time-linear in the departure→arrival segment) minus the live
 * chainage, converted to minutes via the plan's own km-per-minute rate.
 * No live reading → expected position assumed → 0.
 */
export function trainDelayMins(
  train: TrainDto,
  startKm: number,
  endKm: number,
  nowMin: number,
  liveKm?: number,
): number {
  const dep = parseTimeInput(train.departureTime);
  const arr = parseTimeInput(train.arrivalTime);
  const span = Math.max(1e-6, arr - dep);
  const sectionKm = Math.max(1e-6, endKm - startKm);
  const expected =
    nowMin >= arr ? endKm : nowMin <= dep ? startKm : startKm + ((nowMin - dep) / span) * sectionKm;
  return Math.max(0, Math.round(((expected - (liveKm ?? expected)) * span) / sectionKm));
}

/**
 * Minute-of-day from any stop/clock value: numeric raw minutes since midnight,
 * HH:mm[:ss], ISO/local strings, or Dates. Bare numbers are treated as minutes
 * (stop payloads), NOT epoch milliseconds.
 */
export function getMinutesFromMidnight(
  timeVal: string | number | Date | null | undefined,
): number {
  if (timeVal === null || timeVal === undefined) return 0;
  if (typeof timeVal === 'number') return ((timeVal % 1440) + 1440) % 1440;
  return parseTimeInput(timeVal);
}

/** Minutes-of-day input → padded canvas X; day-centred crop at zoom > 1. */
export function timeToX(timeInput: string | number | Date, width: number, zoom = 1): number {
  const mins = typeof timeInput === 'number' ? timeInput : getMinutesFromMidnight(timeInput);
  return timeToXCoordinate(mins, width, zoom);
}

/** Spec alias: ISO/HH:mm/bare-minutes input → minutes since midnight (0–1440). */
export function parseTimeToMinutes(timeStr: string | number | Date): number {
  return getMinutesFromMidnight(timeStr);
}

export interface StopPoint {
  timeMins: number;
  km: number;
}

export interface TrajectoryPoint {
  km: number;
  timeMins: number;
}

/**
 * Point strictly locked onto a train's schedule polyline at `timeMins`: find
 * the active segment [stopA, stopB], progress = (timeMins − stopA.timeMins) /
 * (stopB.timeMins − stopA.timeMins) clamped to [0,1], then interpolate BOTH
 * chainage and clock time by the same progress so (km, timeMins) always lies
 * exactly on the sloped string. Purely a function of the inputs — no noise,
 * no memory — so markers can never slip off their line or oscillate.
 */
export function trajectoryPoint(stops: readonly StopPoint[], timeMins: number): TrajectoryPoint {
  if (stops.length === 0) return { km: 0, timeMins };
  if (stops.length === 1) return { km: stops[0].km, timeMins: stops[0].timeMins };
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (timeMins <= first.timeMins) return { km: first.km, timeMins: first.timeMins };
  if (timeMins >= last.timeMins) return { km: last.km, timeMins: last.timeMins };
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (timeMins >= a.timeMins && timeMins <= b.timeMins) {
      const span = Math.max(1e-9, b.timeMins - a.timeMins);
      const progress = Math.max(0, Math.min(1, (timeMins - a.timeMins) / span));
      return {
        km: a.km + progress * (b.km - a.km),
        timeMins: a.timeMins + progress * (b.timeMins - a.timeMins),
      };
    }
  }
  return { km: last.km, timeMins: last.timeMins };
}

/**
 * Deterministic live chainage locked onto the trajectory: the km half of
 * `trajectoryPoint`. Purely a function of the clock and the schedule — no
 * noise, no memory — so the marker glides along the string and can never
 * oscillate.
 */
export function liveKmAtTime(stops: readonly StopPoint[], nowMin: number): number {
  return trajectoryPoint(stops, nowMin).km;
}

function stopsFromPayload(train: TrainDto): Array<{
  time?: string | number;
  km?: number;
  station?: string;
}> | null {
  const source = train.schedule ?? train.stops ?? train.routePoints;
  if (!Array.isArray(source) || source.length < 2) return null;
  return source.map((s) => ({
    time: s.arrivalTime ?? s.departureTime ?? s.time,
    km: s.chainageKm ?? s.km,
    station: s.stationName ?? s.station,
  }));
}

/** Simple stable numeric hash of a train id, used to stagger generated schedules. */
export function trainIdHash(trainId: string): number {
  let h = 0;
  for (let i = 0; i < trainId.length; i++) h = (h * 31 + trainId.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * Bulletproof extraction of a train's schedule stops. Consumes
 * `train.schedule` / `train.stops` / `train.routePoints` (length ≥ 2) when
 * present; otherwise generates 3 hash-staggered stops spanning the section
 * (start → mid → end), so a sloped string ALWAYS renders even when the
 * payload carries no schedule.
 */
export function trainStops(
  train: TrainDto,
  stations: readonly StationDto[],
  minKm: number,
  maxKm: number,
): StopPoint[] {
  const payload = stopsFromPayload(train);
  if (payload) {
    return payload.map((s) => ({
      timeMins: getMinutesFromMidnight(s.time),
      km: s.km ?? kmOfStation(s.station, stations, minKm, maxKm),
    }));
  }
  const base = (trainIdHash(train.trainId) % 10) * 120;
  const midKm = minKm + (maxKm - minKm) / 2;
  return [
    { timeMins: base, km: minKm },
    { timeMins: base + 90, km: midKm },
    { timeMins: base + 180, km: maxKm },
  ];
}