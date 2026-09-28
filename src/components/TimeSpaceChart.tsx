import { useEffect, useMemo, useRef, useState } from 'react';
import type { AssetDto, BlockDto, DisruptionKind, PendingDisruptionRef, SectionDto, StationDto, TrainDto, TrainLive } from '../types';
import {
  drawTimeSpace,
  type BlockHit,
  type DisruptionDot,
  type DisruptionHit,
  type LiveHit,
  type ZoneHit,
} from '../tsd/renderTimeSpace';
import { clampPanX, kmToY, MAX_ZOOM, MIN_ZOOM, parseTimeToMinutes, timeToX, trainDelayMins, trajectoryOver, zoomAtCursor, trainStops, type TrajectoryPoint } from '../tsd/tsdMath';
import { enforceParity, getFallbackTrains } from '../data/mockData';

interface TimeSpaceChartProps {
  startKm: number;
  endKm: number;
  activeSection: SectionDto | null;
  stations: readonly StationDto[];
  trains: readonly TrainDto[];
  blocks: readonly BlockDto[];
  assets: readonly AssetDto[];
  live: Readonly<Record<string, TrainLive>>;
  /** Active division id is the dynamic train-rostering key (per-zone catalog). */
  activeDivisionId?: string | null;
  /** Fired by the inspector's "Deploy Resolution Strategy" button. */
  onDeployDisruption?: (ref: PendingDisruptionRef) => void;
}

type InspectorItem = { type: 'block' | 'train' | 'zone' | 'disruption'; id: string };

/** A chart disruption mapped from a high-risk asset (R_i > 0.6). */
interface ChartDisruption {
  id: string;
  assetId: string;
  kind: DisruptionKind;
  km: number;
  startMins: number;
  endMins: number;
  severity: 'MEDIUM' | 'HIGH' | 'CRITICAL';
  riskScore: number;
  affectedTrainIds: string[];
  strategy: string;
  mastLabel: string;
}

function hhmm(mins: number): string {
  const m = Math.round(Math.max(0, mins));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[10px] text-slate-400">
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }}
      />
      {label}
    </span>
  );
}

interface TogglePillProps {
  label: string;
  on: boolean;
  onClick: () => void;
}

function TogglePill({ label, on, onClick }: TogglePillProps) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-[11px] font-medium transition-all ${
        on
          ? 'border-cyan-500/50 bg-cyan-500/20 text-cyan-300 shadow-[0_0_10px_rgba(6,182,212,0.2)]'
          : 'border-slate-700/60 bg-slate-800/40 text-slate-400 hover:text-slate-200'
      }`}
    >
      {label}
    </button>
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
  trains: rawTrains,
  blocks,
  assets,
  live,
  activeDivisionId,
  onDeployDisruption,
}: TimeSpaceChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef(live);
  liveRef.current = live;

  // The active division descriptor the roster gate filters against: the id the
  // header selected, the section's zone, and the backend's station list.
  const activeDivision = useMemo(
    () => ({ id: activeDivisionId, zone: activeSection?.zone ?? null, stations }),
    [activeDivisionId, activeSection?.zone, stations],
  );

  // Safe-train gate (NEVER a blank canvas): prefer the routed trains that
  // belong to the active division (matched by division/zone id or an origin
  // station on the section), else fall back to the authentic per-zone roster.
  // A division known but with zero surviving trains still gets generation
  // instead of an empty chart. Every survivor is parity enforced so odd/even
  // numbering always matches the drawn slope.
  const trains = useMemo(() => {
    if (!rawTrains || rawTrains.length === 0) return getFallbackTrains(activeDivision);
    const filtered = rawTrains.filter(
      (t) =>
        t.divisionId === activeDivision.id ||
        t.zone === activeDivision.zone ||
        activeDivision.stations.some(
          (s) => s.stationName.toLowerCase() === (t.originStation ?? '').toLowerCase(),
        ),
    );
    return filtered.length > 0 ? enforceParity(filtered) : getFallbackTrains(activeDivision);
  }, [rawTrains, activeDivision]);
  const hitsRef = useRef<{
    blocks: BlockHit[];
    live: LiveHit[];
    zones: ZoneHit[];
    disruptions: DisruptionHit[];
  }>({ blocks: [], live: [], zones: [], disruptions: [] });
  const simRef = useRef({ timeMins: 420 });
  const targetsRef = useRef<Record<string, TrajectoryPoint>>({});
  const markersRef = useRef<Record<string, TrajectoryPoint>>({});

  const [zoomLevel, setZoomLevel] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  // Refs mirror the view state so the rAF paint loop reads the live transform
  // without re-subscribing (a 60 fps drag must never restart the loop).
  const panRef = useRef(panOffset);
  panRef.current = panOffset;
  const zoomRef = useRef(zoomLevel);
  zoomRef.current = zoomLevel;
  const dragRef = useRef({ x: 0, y: 0 });
  const draggedRef = useRef(false);
  const dirtyRef = useRef(true);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showBlocks, setShowBlocks] = useState(true);
  const [conflictsOnly, setConflictsOnly] = useState(false);
  const [pointing, setPointing] = useState(false);
  const [inspector, setInspector] = useState<InspectorItem | null>(null);

  // Disruption / problem locations derived from high-risk assets (R_i > 0.6):
  // a deterministic, visible operating window (hashed 02:00–22:00 start, 2–6h
  // duration), problem kind from the asset family, strategy by severity band.
  const disruptions = useMemo<ChartDisruption[]>(() => {
    const list: ChartDisruption[] = [];
    for (const asset of assets) {
      if (asset.locationKm < startKm || asset.locationKm > endKm) continue;
      const risk = asset.failureRiskScore;
      if (risk <= 0.6) continue;
      const seed = [...asset.assetId].reduce((acc, c) => acc + c.charCodeAt(0), 0);
      const startMins = 120 + (seed % 1200);
      const endMins = Math.min(1440, startMins + 120 + ((seed >> 3) % 240));
      const kind: DisruptionKind =
        asset.assetType === 'SIGNAL'
          ? 'SIGNAL_FAILURE'
          : asset.assetType === 'SWITCH' || asset.assetType === 'OHE'
            ? 'EQUIPMENT_FAILURE'
            : 'TRACK_INCIDENT';
      const severity = risk >= 0.8 ? 'CRITICAL' : risk >= 0.7 ? 'HIGH' : 'MEDIUM';
      const affectedTrainIds = trains
        .filter((t) =>
          trainStops(t, stations, startKm, endKm).some((p) => Math.abs(p.km - asset.locationKm) <= 5),
        )
        .map((t) => t.trainId);
      // Indian Railways OHE structure reference: mast at the whole-KM of the
      // asset with a deterministic 10–39 digit branch suffix.
      const mastLabel = `OHE Mast ${Math.floor(asset.locationKm)}/${10 + ((seed >> 4) % 30)} at KM ${asset.locationKm.toFixed(3)}`;
      list.push({
        id: `D-${asset.assetId}`,
        assetId: asset.assetId,
        kind,
        km: asset.locationKm,
        startMins,
        endMins,
        severity,
        riskScore: risk,
        affectedTrainIds: affectedTrainIds.slice(0, 6),
        mastLabel,
        strategy:
          severity === 'CRITICAL'
            ? 'Emergency block + TSR 30 km/h; hold upstream, reschedule affected trains'
            : 'Upstream holding + TSR 30 km/h; dispatch inspection gang',
      });
    }
    return list;
  }, [assets, trains, stations, startKm, endKm]);

  // Mirror for the render effect so repaints always see the latest disruptions.
  const disruptionsRef = useRef<readonly DisruptionDot[]>([]);
  disruptionsRef.current = disruptions.map((d) => ({ id: d.id, km: d.km, startMins: d.startMins, endMins: d.endMins }));

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let raf = 0;

    const speedOf = (trainId: string): number => {
      const train = trains.find((t) => t.trainId === trainId);
      const telemetry = liveRef.current[trainId];
      return telemetry && telemetry.speedKmh > 0 ? telemetry.speedKmh : categorySpeed(train);
    };

    // LOOP 2 — live pointers, ROSTER-driven (not telemetry-driven): every train
    // in the displayed roster gets a target, and trajectoryOver only returns one
    // while the sim clock is inside that train's own dep→arr window, so only
    // currently-running trains show a pointer. An rAF loop lerps rendered X/Y
    // toward the targets so motion stays smooth between the 2s ticks.
    const recomputeTargets = () => {
      const t = simRef.current.timeMins;
      const next: Record<string, TrajectoryPoint> = {};
      for (const train of trains) {
        const live = trajectoryOver(trainStops(train, stations, startKm, endKm), t);
        if (live) next[train.trainId] = live;
      }
      // Drop markers of trains that left their run window, so a re-entering
      // train (after the 1440-minute clock wrap) starts on its own string
      // instead of lerping across the canvas from a stale position.
      for (const id of Object.keys(markersRef.current)) {
        if (!next[id]) delete markersRef.current[id];
      }
      targetsRef.current = next;
    };

    const paint = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = wrap.getBoundingClientRect();
      if (rect.width === 0) return;
      // The canvas stays viewport-sized; the Google-Maps transform does the
      // zooming, so hit regions are always recorded in logical chart space.
      const width = rect.width;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(650 * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = '650px';
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Pan + X-only zoom: drag scrolls the day sideways, wheel zooms about the
      // cursor. Text is drawn unscaled by the renderer's own counter-scale.
      ctx.save();
      ctx.translate(panRef.current.x, panRef.current.y);
      ctx.scale(zoomRef.current, 1);

      // Pass the currently-lerped (km, mins) pair straight through: mins pins
      // the marker to its schedule time on the X axis, km to chainage on Y, so
      // the dot rides its own string instead of a wall-clock column.
      const slides: Record<string, TrainLive> = {};
      for (const [trainId, t] of Object.entries(targetsRef.current)) {
        const m = markersRef.current[trainId] ?? t;
        slides[trainId] = { km: m.km, mins: m.timeMins, speedKmh: speedOf(trainId) };
      }

      const stats = drawTimeSpace(ctx, {
        width,
        height: 650,
        startKm,
        endKm,
        stations,
        trains,
        blocks,
        assets,
        live: slides,
        disruptions: disruptionsRef.current,
        zoom: 1,
        showHeatmap,
        showBlocks,
        conflictsOnly,
      });
      ctx.restore();
      hitsRef.current = {
        blocks: stats.blockHits,
        live: stats.liveHits,
        zones: stats.zoneHits,
        disruptions: stats.disruptionHits,
      };
    };

    const frame = () => {
      raf = requestAnimationFrame(frame);
      let moved = false;
      for (const [id, t] of Object.entries(targetsRef.current)) {
        const prev = markersRef.current[id] ?? t;
        const km = prev.km + (t.km - prev.km) * 0.05;
        const timeMins = prev.timeMins + (t.timeMins - prev.timeMins) * 0.05;
        if (Math.abs(km - prev.km) > 0.02 || Math.abs(timeMins - prev.timeMins) > 0.02) moved = true;
        markersRef.current[id] = { km, timeMins };
      }
      // Pulsing disruption badges need a repaint every frame while present.
      if (disruptionsRef.current.length > 0) moved = true;
      if (moved || dirtyRef.current) {
        dirtyRef.current = false;
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
      dirtyRef.current = true;
    }, 2000);

    const observer = new ResizeObserver(paint);
    observer.observe(wrap);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(timer);
      observer.disconnect();
    };
  }, [startKm, endKm, stations, trains, blocks, assets, showHeatmap, showBlocks, conflictsOnly, activeSection]);

  // Wheel zoom (Google Maps style): a NATIVE non-passive listener, because
  // React's root-level onWheel is registered passive and preventDefault() would
  // be ignored (the page would scroll instead of the day zooming).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const view = zoomAtCursor(
        ev.offsetX,
        panRef.current.x,
        zoomRef.current,
        ev.deltaY < 0 ? 1.1 : 0.9,
        canvas.clientWidth || 1,
      );
      setZoomLevel(view.zoom);
      setPanOffset({ x: view.panX, y: 0 });
      dirtyRef.current = true;
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  // Keep the pan inside the viewport whenever the zoom level changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setPanOffset((prev) => ({ x: clampPanX(prev.x, canvas.clientWidth || 1, zoomLevel), y: 0 }));
  }, [zoomLevel]);

  const stationOf = (km: number): { stationName: string; km: number } =>
    stations.reduce(
      (best, s) => (Math.abs(s.km - km) < Math.abs(best.km - km) ? s : best),
      stations[0] ?? { stationName: `KM ${km}`, km },
    );

  const pointSegDist = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  };

  // Click-only hit testing, strict order: train marker/line → block rect →
  // disruption badge → risk-overlay dot. Same code drives the pointer cursor
  // on hover and the inspector on click; no tooltip popups appear. The input is
  // in LOGICAL chart space (see toLogical) and the reported hits are logical
  // too, so the pan/zoom transform never affects what gets picked.
  const pickAt = (x: number, y: number): InspectorItem | null => {
    const width = canvasRef.current?.clientWidth ?? 0;
    const { blocks, live: liveHits, zones, disruptions } = hitsRef.current;
    for (const l of liveHits) {
      if (Math.hypot(x - l.x, y - l.y) <= 10) return { type: 'train', id: l.trainId };
    }
    for (const train of trains) {
      const trainId = train.trainId;
      const points = trainStops(train, stations, startKm, endKm);
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i];
        const b = points[i + 1];
        const dist = pointSegDist(
          x,
          y,
          timeToX(a.timeMins, width),
          kmToY(a.km, startKm, endKm, 650, 40, 70),
          timeToX(b.timeMins, width),
          kmToY(b.km, startKm, endKm, 650, 40, 70),
        );
        if (dist <= 10) return { type: 'train', id: trainId };
      }
    }
    for (const b of blocks) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return { type: 'block', id: b.blockId };
    }
    for (const d of disruptions) {
      if (Math.hypot(x - d.x, y - d.y) <= 12) return { type: 'disruption', id: d.disruptionId };
    }
    for (const z of zones) {
      if (x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h) return { type: 'zone', id: z.assetId };
    }
    return null;
  };

  // Convert a mouse event's screen-space point into the transform's logical
  // chart space, the same space every drawn hit region lives in.
  const toLogical = (e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const sx = e.nativeEvent.offsetX ?? e.clientX - (rect?.left ?? 0);
    const sy = e.nativeEvent.offsetY ?? e.clientY - (rect?.top ?? 0);
    return { x: (sx - panRef.current.x) / zoomRef.current, y: sy - panRef.current.y };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    dragRef.current = { x: e.clientX, y: e.clientY };
    draggedRef.current = false;
    setIsDragging(true);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDragging) {
      const dx = e.clientX - dragRef.current.x;
      const dy = e.clientY - dragRef.current.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) draggedRef.current = true;
      const width = canvasRef.current?.clientWidth ?? 0;
      setPanOffset((prev) => ({ x: clampPanX(prev.x + dx, width, zoomRef.current), y: 0 }));
      dragRef.current = { x: e.clientX, y: e.clientY };
      dirtyRef.current = true;
      return;
    }
    const { x, y } = toLogical(e);
    setPointing(pickAt(x, y) !== null);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleMouseLeave = () => {
    setIsDragging(false);
    setPointing(false);
  };

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // A drag that ends over the canvas must not open the inspector.
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    const { x, y } = toLogical(e);
    setInspector(pickAt(x, y));
  };

  const resetView = () => {
    setZoomLevel(MIN_ZOOM);
    setPanOffset({ x: 0, y: 0 });
    dirtyRef.current = true;
  };

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
      // Position comes from telemetry when present, else the marker's own
      // locked point on the chart (markers are roster-driven, telemetry sparse).
      const marker = markersRef.current[train.trainId];
      const km = pos?.km ?? marker?.km ?? 0;
      const speed = pos?.speedKmh ?? (marker ? categorySpeed(train) : 0);
      const delay = trainDelayMins(train, startKm, endKm, parseTimeToMinutes(new Date()), km);
      return (
        <div className="space-y-1.5">
          <Row k="Type" v={`${train.type ?? 'PASSENGER'} Train`} />
          <Row k="ID" v={`${train.trainId} · ${train.trainName}`} />
          <Row k="Route" v={`${train.originStation} → ${train.destinationStation}`} />
          <Row
            k="Schedule"
            v={`Dep ${hhmm(parseTimeToMinutes(train.departureTime))} · Arr ${hhmm(parseTimeToMinutes(train.arrivalTime))}`}
          />
          <Row k="Current Position" v={`${stationOf(km).stationName} (${Math.round(km)} KM)`} />
          <Row k="Speed" v={`${speed.toFixed(0)} km/h`} />
          <Row k="Delay" v={delay > 0 ? `+${delay} min` : 'On time'} tone={delay > 0 ? 'text-amber-300' : 'text-emerald-400'} />
          <Row k="Priority" v={String(train.priority)} />
          <Row k="TSR" v="None reported" tone="text-slate-400" />
          <Row k="Action" v="Monitor headway" tone="text-sky-300" />
        </div>
      );
    }
    if (inspector.type === 'disruption') {
      const d = disruptions.find((x) => x.id === inspector.id);
      if (!d) return null;
      const KIND_LABEL: Record<DisruptionKind, string> = {
        TRACK_INCIDENT: 'Track Fracture',
        SIGNAL_FAILURE: 'Signal Failure',
        EQUIPMENT_FAILURE: 'Equipment Failure',
      };
      const severityTone =
        d.severity === 'CRITICAL' ? 'text-red-400' : d.severity === 'HIGH' ? 'text-amber-300' : 'text-yellow-200';
      return (
        <div className="space-y-1.5">
          <Row k="Problem" v={KIND_LABEL[d.kind]} tone="text-red-400" />
          <Row k="Asset" v={`${d.assetId}`} />
          <Row k="Location" v={`${activeSection?.sectionName ?? 'Section'} · ${stationOf(d.km).stationName}`} />
          <Row k="OHE Location" v={d.mastLabel} tone="text-sky-300" />
          <Row k="Chainage" v={`${Math.round(d.km)} KM`} />
          <Row k="Time Window" v={`${hhmm(d.startMins)} → ${hhmm(d.endMins)}`} />
          <Row k="Severity" v={d.severity} tone={severityTone} />
          <Row k="Risk R_i" v={d.riskScore.toFixed(2)} tone={severityTone} />
          <Row k="Affected Trains" v={d.affectedTrainIds.length > 0 ? d.affectedTrainIds.join(', ') : 'None yet'} />
          <Row k="Strategy" v={d.strategy} tone="text-emerald-300" />
          <button
            onClick={() => onDeployDisruption?.({ assetId: d.assetId, sectionName: activeSection?.sectionName ?? 'Section', kind: d.kind, km: d.km, riskScore: d.riskScore, mastLabel: d.mastLabel })}
            className="mt-2 w-full rounded-lg bg-gradient-to-r from-cyan-500 to-emerald-500 px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-950 shadow-[0_0_14px_rgba(6,182,212,0.4)] transition-all hover:brightness-110"
          >
            Deploy Resolution Strategy →
          </button>
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
        <Row k="Work Scope" v={win.blockPriority >= 3 ? 'Urgent track renewal / OHE repair' : 'Routine maintenance possession'} />
        <Row k="Target KM" v={`${win.startKm} → ${win.endKm} KM`} />
        <Row k="Location" v={`${stationOf(win.startKm).stationName} → ${stationOf(win.endKm).stationName}`} />
        <Row k="Plan Window" v={`${hhmm(startMin)} → ${hhmm(endMin)}`} />
        <Row k="Duration" v={`${win.requiredDurationMinutes} min`} />
        <Row k="Priority" v={String(win.blockPriority)} />
        <Row k="Cause" v="Planned maintenance possession" />
        <Row k="TSR" v="Speed restricted inside window" tone="text-amber-300" />
        <Row k="Action" v="Protect possession; reschedule trains" tone="text-emerald-300" />
      </div>
    );
  })();

  return (
    <div className="flex max-h-[calc(100vh-180px)] min-h-0 flex-col gap-3 overflow-auto">
      <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-slate-800/80 bg-slate-900/60 p-3 text-xs text-slate-200 shadow-2xl shadow-cyan-950/20 backdrop-blur-md">
        <span className="text-[13px] font-semibold text-slate-200">
          Interactive Time-Space String Diagram (COA / TMS View)
        </span>
        <label className="flex items-center gap-2 text-[11px] text-slate-400">
          Zoom
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.1}
            value={zoomLevel}
            onChange={(e) => setZoomLevel(Number(e.target.value))}
            className="h-1.5 w-36 cursor-pointer rounded-lg bg-slate-800 accent-cyan-400"
          />
          <span className="tabular-nums text-cyan-300">{zoomLevel.toFixed(1)}×</span>
        </label>
        <button
          onClick={resetView}
          className="rounded-full border border-slate-700/60 bg-slate-800/40 px-3 py-1 text-[11px] font-medium text-slate-400 transition-all hover:text-slate-200"
        >
          Reset view
        </button>
        <span className="text-[10px] text-slate-500">Scroll to zoom · drag to pan</span>
        <span className="h-5 w-px bg-slate-700/60" />
        <TogglePill label="Risk Overlay" on={showHeatmap} onClick={() => setShowHeatmap(!showHeatmap)} />
        <TogglePill label="Maintenance Blocks" on={showBlocks} onClick={() => setShowBlocks(!showBlocks)} />
        <TogglePill label="Conflicts Only" on={conflictsOnly} onClick={() => setConflictsOnly(!conflictsOnly)} />
        <span className="h-5 w-px bg-slate-700/60" />
        <div className="flex items-center gap-4">
          <LegendDot color="#38bdf8" label="Express (UP)" />
          <LegendDot color="#eab308" label="Freight (DOWN)" />
          <span className="text-[10px] text-slate-500">DOWN lane / DFC rake = dashed</span>
          <LegendDot color="#22c55e" label="Block" />
          <LegendDot color="#E53935" label="Conflict" />
          <LegendDot color="#ef4444" label="Disruption" />
        </div>
        <span className="ml-auto text-[10px] text-slate-500">Click a train / block / disruption / zone to inspect</span>
      </div>
      <div
        ref={wrapRef}
        className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-800 bg-slate-950"
      >
        <canvas
          ref={canvasRef}
          className={`block ${isDragging ? 'cursor-grabbing' : pointing ? 'cursor-pointer' : 'cursor-grab'}`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onClick={handleClick}
        />
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