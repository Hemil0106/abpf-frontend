import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AssetDto, BlockDto, CandidatePlan, StationDto, TrainDto } from '../src/types';
import {
  buildDayScale,
  clampPanX,
  dayWindow,
  getMinutesFromMidnight,
  kmOfStation,
  kmToY,
  liveKmAtTime,
  parseTimeInput,
  riskLevel,
  segmentIntersection,
  timeToX,
  timeToXCoordinate,
  trainDelayMins,
  trainSegment,
  trainStops,
  trajectoryLive,
  trajectoryOver,
  trajectoryPoint,
  zoomAtCursor,
} from '../src/tsd/tsdMath';
import { mockCtx } from './helpers';
import { drawTimeSpace } from '../src/tsd/renderTimeSpace';
import { drawNetworkMap, ZoneNode } from '../src/tsd/renderNetworkMap';
import { drawParetoScatter } from '../src/tsd/renderPareto';
import { addActivity, activitySnapshot, subscribeActivity } from '../src/services/activityLog';

/** Local 'YYYY-MM-DDTHH:mm:00' string — matches the backend's timezone-less format. */
const localIso = (hh: number, mm: number) => {
  const d = new Date(2026, 8, 20, hh, mm, 0);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(hh)}:${p(mm)}:00`;
};

test('tsdMath: parse time inputs, full-width X mapping, day window, segments, delays', () => {
  assert.equal(parseTimeInput('2026-09-20T00:00:00'), 0, 'ISO midnight');
  assert.equal(parseTimeInput(localIso(6, 30)), 390, 'ISO local morning');
  assert.equal(parseTimeInput(localIso(23, 45)), 1425, 'ISO local 23:45');
  assert.equal(parseTimeInput('06:30'), 390, 'bare HH:mm parses to minutes');
  assert.equal(parseTimeInput('22:15:30'), 22 * 60 + 15 + 0.5, 'bare HH:mm:ss with fractional minutes');

  assert.equal(dayWindow(1).startMin, 0, 'zoom 1 must show the full day');
  assert.equal(dayWindow(1).endMin, 1440);
  assert.equal(dayWindow(3).startMin, (1440 - 480) / 2, 'zoom >1 must day-centre the window');
  assert.ok(dayWindow(3).endMin < 1440);

  assert.equal(timeToXCoordinate(0, 800), 80, 'midnight maps to the padded left edge');
  assert.equal(timeToXCoordinate(1440, 800), 760, 'end-of-day maps to width - paddingRight');
  assert.equal(timeToXCoordinate(720, 800, 3), 420, 'padded mid-day maps identically at any zoom');
  assert.equal(timeToXCoordinate(720, 800), 420, 'mid-day maps to the padded mid-canvas');

  const stations: StationDto[] = [
    { stationName: 'MMCT', km: 0 },
    { stationName: 'BRC', km: 160 },
  ];
  assert.equal(kmOfStation('BRC', stations, 0, 320), 160);
  assert.equal(kmOfStation('UNKNOWN', stations, 0, 320), 0);

  const t1: TrainDto = {
    trainId: 'T1', trainName: 'U1', priority: 1,
    departureTime: localIso(6, 0),
    arrivalTime: localIso(10, 0),
    originStation: 'MMCT', destinationStation: 'BRC', loopLineRequirement: false,
  };
  const t2: TrainDto = {
    trainId: 'T2', trainName: 'U2', priority: 2,
    departureTime: localIso(6, 30),
    arrivalTime: localIso(10, 30),
    originStation: 'BRC', destinationStation: 'MMCT', loopLineRequirement: false,
  };
  const kmOf = (name: string | null) => kmOfStation(name, stations, 0, 320);
  const segmentStops = [
    { timeMins: 360, km: 0 },
    { timeMins: 480, km: 160 },
    { timeMins: 600, km: 320 },
  ];
  const s1 = trainSegment(t1, kmOf);
  const s2 = trainSegment(t2, kmOf);
  assert.equal(s1.x1, 360, 'departure maps to minutes-of-day');
  assert.equal(s1.x2, 600, 'arrival maps to minutes-of-day');
  assert.equal(s1.y1, 0);
  assert.equal(s1.y2, 160);
  assert.ok(segmentIntersection(s1, s2), 'opposite-slope trains must intersect');

  assert.equal(riskLevel(0.1), 'clear');
  assert.equal(riskLevel(0.5), 'caution');
  assert.equal(riskLevel(0.9), 'critical');

  const scale = buildDayScale({ height: 400, startKm: 0, endKm: 320, zoom: 1 });
  assert.equal(scale.y(0), 335, 'min km sits in the 65px bottom gutter');
  assert.equal(scale.y(320), 40, 'max km sits in the top gutter');
  assert.ok(scale.inView(720));

  assert.equal(trainDelayMins(t1, 0, 320, parseTimeInput('08:00'), 120), 30, '40 km behind at 0.75 min/km');
  assert.equal(trainDelayMins(t1, 0, 320, parseTimeInput('12:00'), 300), 15, 'late into the section on final chainage');
  assert.equal(trainDelayMins(t1, 0, 320, parseTimeInput('08:00')), 0, 'on-schedule with no live reading is 0');

  assert.equal(liveKmAtTime(segmentStops, 360), 0, 'locked to origin before departure');
  assert.equal(liveKmAtTime(segmentStops, 450), 120, 't = (450-360)/120 interpolates km between stops');
  assert.equal(liveKmAtTime(segmentStops, 480), 160, 'schedule mid-stop pins the exact chainage');
  assert.equal(liveKmAtTime(segmentStops, 700), 320, 'clamped to the destination after arrival');

  assert.deepEqual(trajectoryPoint(segmentStops, 450), { km: 120, timeMins: 450 }, 'km and clock both interpolate by the same progress');
  assert.deepEqual(trajectoryPoint(segmentStops, 360), { km: 0, timeMins: 360 }, 'origin pinned before departure');
  assert.deepEqual(trajectoryPoint(segmentStops, 700), { km: 320, timeMins: 600 }, 'destination pinned after arrival');
  assert.deepEqual(trajectoryPoint([], 500), { km: 0, timeMins: 500 }, 'empty schedule degrades to a null marker');

  assert.equal(trajectoryLive(segmentStops, 450)?.km, 120, 'trajectoryLock: mid-run point on the string');
  assert.equal(trajectoryLive(segmentStops, 359), null, 'trajectoryLock: before departure draws NO marker');
  assert.equal(trajectoryLive(segmentStops, 601), null, 'trajectoryLock: after arrival draws NO marker');
  assert.equal(trajectoryLive([], 500), null, 'trajectoryLock: degenerated schedule draws NO marker');

  assert.deepEqual(
    trajectoryOver(segmentStops, 450),
    { km: 120, timeMins: 450 },
    'strictLine: (simMins - depMins)/(arrMins - depMins) rides the single dep-ar Arr string',
  );
  assert.deepEqual(trajectoryOver(segmentStops, 600), { km: 320, timeMins: 600 }, 'strictLine: arrival pins the exact end chainage');
  assert.equal(trajectoryOver(segmentStops, 359), null, 'strictLine: t < dep renders no column marker');
  assert.equal(trajectoryOver(segmentStops, 601), null, 'strictLine: t > arr renders no column marker');
  assert.equal(trajectoryOver([{ timeMins: 360, km: 0 }], 500), null, 'strictLine: single stop has no lockable run');
});

test('tsdMath: robust stop parsing, X/Y converters, degenerate-section guards', () => {
  const stations: StationDto[] = [
    { stationName: 'MMCT', km: 0 },
    { stationName: 'BRC', km: 160 },
    { stationName: 'BVI', km: 320 },
  ];

  assert.equal(getMinutesFromMidnight('06:30'), 390, 'HH:mm');
  assert.equal(getMinutesFromMidnight(390), 390, 'raw minute number');
  assert.equal(getMinutesFromMidnight(1440 + 30), 30, 'raw minutes wrap past 1440');
  assert.equal(getMinutesFromMidnight(localIso(7, 45)), 465, 'ISO local');
  assert.equal(getMinutesFromMidnight(undefined), 0, 'missing time is harmless');

  assert.equal(timeToX(0, 800), 80, 'timeToX padded left edge');
  assert.equal(timeToX(1440, 800), 760, 'timeToX padded right edge');
  assert.equal(timeToX(720, 800, 3), 420, 'timeToX padded mid-day at any zoom');
  assert.equal(timeToX(360, 800), 250, 'timeToX quarter-day');
  assert.equal(Math.round(timeToX('06:30', 800) * 100) / 100, 264.17, 'timeToX parses bare HH:mm');

  assert.equal(kmToY(0, 0, 320, 400), 335, 'min km sits in the 65px bottom gutter');
  assert.equal(kmToY(320, 0, 320, 400), 40, 'max km sits in the top gutter');
  assert.equal(kmToY(160, 0, 320, 400), 187.5, 'mid-section sits mid-canvas');
  assert.equal(kmToY(100, 100, 100, 400), 335, 'degenerate 0-length section never NaNs');

  const t = (extra: Partial<TrainDto>): TrainDto => ({
    trainId: 'T9', trainName: 'T9', priority: 3,
    departureTime: localIso(6, 0),
    arrivalTime: localIso(10, 0),
    originStation: 'MMCT', destinationStation: 'BVI', loopLineRequirement: false,
    ...extra,
  });

  const fallback = trainStops(t({}), stations, 0, 320);
  assert.equal(fallback.length, 3, 'fallback builds 3 hash-staggered stops so a string ALWAYS draws');
  assert.equal(fallback[0].timeMins, 120, 'T9 hash base = (2661 % 10) * 120');
  assert.equal(fallback[1].timeMins, 210, 'second stop +90 min');
  assert.equal(fallback[1].km, 160, 'mid-stop spans the section midpoint');
  assert.equal(fallback[2].timeMins, 300, 'third stop +180 min');
  assert.equal(fallback[2].km, 320, 'final stop anchors at the section end');

  const scheduled = trainStops(
    t({
      schedule: [
        { stationName: 'MMCT', departureTime: localIso(6, 0), km: 0 },
        { stationName: 'BRC', km: 160, time: localIso(8, 0) },
        { stationName: 'BVI', chainageKm: 320, time: localIso(10, 0) },
      ],
    }),
    stations,
    0,
    320,
  );
  assert.equal(scheduled.length, 3, 'schedule payload overrides the fallback');
  assert.equal(scheduled[0].timeMins, 360, 'departureTime wins over time');
  assert.equal(scheduled[1].timeMins, 480, 'time with no arrival/departure');
  assert.equal(scheduled[1].km, 160, 'missing chainageKm falls back to km');
  assert.equal(scheduled[2].km, 320, 'chainageKm parsed');
});

test('tsdMath: view transform - cursor-locked wheel zoom and pan clamping', () => {
  assert.equal(clampPanX(50, 1000, 1), 0, 'no horizontal freedom at 1x');
  assert.equal(clampPanX(-5000, 1000, 3), -2000, 'pan stops where the scaled day still covers the viewport');
  assert.equal(clampPanX(200, 1000, 3), 0, 'pan never pushes the left edge off-screen');

  // The chart point under the cursor must not move while zooming.
  for (const [sx, panX, zoom, factor] of [
    [700, 0, 1, 1.1], [300, -400, 2, 1.1], [120, -1500, 4, 0.9], [640, -200, 2.5, 1.1],
  ] as const) {
    const before = (sx - panX) / zoom;
    const next = zoomAtCursor(sx, panX, zoom, factor, 1000);
    assert.equal((sx - next.panX) / next.zoom, before, `logical point pinned at sx=${sx} zoom=${zoom}`);
    assert.ok(next.zoom >= 1 && next.zoom <= 5, 'zoom stays clamped to 1x-5x');
  }
  assert.equal(zoomAtCursor(700, 0, 5, 1.1, 1000).zoom, 5, 'zoom-in stops at 5x');
  assert.equal(zoomAtCursor(700, 0, 1, 0.9, 1000).zoom, 1, 'zoom-out stops at 1x');
});

test('drawTimeSpace: stations, sloped trajectories, conflict halo, blocks, live marker', () => {
  const stations: StationDto[] = [
    { stationName: 'MMCT', km: 0 },
    { stationName: 'BRC', km: 160 },
    { stationName: 'BVI', km: 320 },
  ];
  const trains: TrainDto[] = [
    {
      trainId: 'T1', trainName: 'U1', priority: 1,
      departureTime: localIso(6, 0),
      arrivalTime: localIso(10, 0),
      originStation: 'MMCT', destinationStation: 'BRC', loopLineRequirement: false,
    },
    {
      trainId: 'T2', trainName: 'U2', priority: 3,
      departureTime: localIso(6, 30),
      arrivalTime: localIso(10, 30),
      originStation: 'BRC', destinationStation: 'MMCT', loopLineRequirement: false,
    },
  ];
  const blocks: BlockDto[] = [
    {
      blockId: 'B1', sectionId: 'WR-MMCT-01', startKm: 100, endKm: 200,
      startTime: localIso(7, 0),
      endTime: localIso(8, 0),
      requiredDurationMinutes: 60, blockPriority: 1,
    },
  ];
  const assets: AssetDto[] = [
    { assetId: 'A1', assetType: 'POINT', locationKm: 100, failureProbability: 0.7, consequenceScore: 5, rulDays: 30, failureRiskScore: 0.8 },
  ];

  const { ctx, calls } = mockCtx();
  // Recorder for text placement, so the bottom 24-hour tick labels can be
  // asserted as actually drawn (and above the scrollbar gutter).
  const texts: Array<[string, number, number]> = [];
  const spy = new Proxy({} as CanvasRenderingContext2D, {
    get: (_t, p: string) =>
      p === 'fillText'
        ? (s: string, x: number, y: number) => { texts.push([s, x, y]); }
        : (ctx as unknown as Record<string, unknown>)[p],
    set: (_t, p: string, v: unknown) => { (ctx as unknown as Record<string, unknown>)[p] = v; return true; },
  });
  // Live train sitting exactly on the BRC station line (km 160).
  const stats = drawTimeSpace(spy, {
    width: 800,
    height: 400,
    startKm: 0,
    endKm: 320,
    stations,
    trains,
    blocks,
    assets,
    live: { T1: { km: 160, mins: 480, speedKmh: 65 } },
    disruptions: [{ id: 'D1', km: 160, startMins: 360, endMins: 520 }],
    zoom: 1,
    showHeatmap: true,
    showBlocks: true,
    conflictsOnly: false,
  });

  assert.equal(stats.stations, 3);
  assert.equal(stats.trains, 2);
  assert.equal(stats.blocks, 1);
  assert.ok(stats.conflicts >= 1, 'a train through an active block window must draw a halo');
  assert.equal(stats.live, 1);
  assert.equal(stats.disruptionHits.length, 2, 'badges pinned where both trajectories intersect the window');
  assert.ok(
    stats.disruptionHits.every((h) => h.x >= timeToX(360, 800) && h.x <= timeToX(520, 800)),
    'intersection X must sit inside the window hours',
  );
  const yHi = kmToY(163, 0, 320, 400, 40, 70);
  const yLo = kmToY(157, 0, 320, 400, 40, 70);
  assert.ok(
    stats.disruptionHits.every((h) => h.y >= yHi && h.y <= yLo),
    'intersection Y must sit inside the km±3 corridor',
  );
  assert.ok(stats.heatSlices > 0, 'risk overlay bands must be drawn');
  assert.ok(calls.includes('arc'), 'conflict halos and disruption badges must draw ovals');
  assert.ok(calls.includes('setLineDash'), 'dashed station lines must be drawn');
  assert.ok(calls.includes('roundRect'), 'rounded block + train-label pills must be drawn');

  assert.equal(stats.blockHits.length, 1, 'block hit box must be reported for hover');
  assert.equal(stats.blockHits[0].blockId, 'B1');
  assert.ok(stats.blockHits[0].w > 0 && stats.blockHits[0].h > 0, 'block hit box must be non-empty');
  assert.equal(stats.liveHits.length, 1, 'live marker hit position must be reported for hover');
  assert.equal(stats.liveHits[0].trainId, 'T1');
  assert.equal(Math.round(stats.liveHits[0].x), Math.round(timeToX(480, 800)), 'live marker pins to its OWN schedule-time column');

  assert.equal(stats.zoneHits.length, 1, 'risk band must be reported for click inspection');
  assert.equal(stats.zoneHits[0].assetId, 'A1');
  assert.equal(stats.zoneHits[0].x, 80, 'band spans the full drawable width');
  assert.equal(stats.zoneHits[0].w, 800 - 80 - 40, 'band width covers the plot');
  assert.equal(stats.zoneHits[0].h, 16, 'band is 16px tall');
  assert.equal(Math.round(stats.zoneHits[0].y), Math.round(kmToY(100, 0, 320, 400, 40, 70) - 8), 'band centres on the asset chainage');

  // 24-hour day ticks stay visible in the bottom gutter, above the scrollbar.
  const hourTicks = texts.filter(([s, , y]) => /^\d{2}:00$/.test(s) && y === 400 - 25).map(([s]) => s);
  assert.deepEqual(hourTicks, ['00:00', '03:00', '06:00', '09:00', '12:00', '15:00', '18:00', '21:00', '24:00'], 'all nine hour ticks drawn at height-25');
  assert.ok(
    texts.every(([, , y]) => y <= 400 - 10),
    'no label is drawn into the scrollbar strip below the gutter',
  );
});

test('drawNetworkMap: nodes, risk-tinted corridors', () => {
  const nodes: ZoneNode[] = [
    { code: 'WR', label: 'Western', x: 60, y: 160, active: true, risk: 0.9, divisionCount: 1, color: '#64748b' },
    { code: 'CR', label: 'Central', x: 240, y: 240, active: false, risk: null, divisionCount: 2, color: '#64748b' },
    { code: 'SCR', label: 'South Central', x: 420, y: 300, active: false, risk: 0.1, divisionCount: 1, color: '#64748b' },
    { code: 'NWR', label: 'North Western', x: 200, y: 80, active: false, risk: null, divisionCount: 1, color: '#64748b' },
  ];
  const corridors: [string, string][] = [
    ['WR', 'NWR'],
    ['WR', 'CR'],
    ['WR', 'SCR'],
  ];

  const { ctx } = mockCtx();
  const stats = drawNetworkMap(ctx, {
    width: 480,
    height: 360,
    nodes,
    corridors,
  });

  assert.equal(stats.nodes, 4);
  assert.equal(stats.corridors, 3);
});

test('drawParetoScatter: frontier nodes, dominated candidates, selection ring', () => {
  const plans: CandidatePlan[] = [
    { planId: 'PLAN-01', name: 'steady-state', f1Delay: 15, f2Risk: 0.8, f3Availability: 1, score: 0.7, status: 'PARETO_OPTIMAL', delayMins: 15, blocks: [], trainIds: [] },
    { planId: 'PLAN-02', name: 'full-worksite', f1Delay: 120, f2Risk: 0.2, f3Availability: 0.5, score: 0.6, status: 'PARETO_OPTIMAL', delayMins: 120, blocks: [], trainIds: [] },
    { planId: 'PLAN-03', name: 'aggressive-clear', f1Delay: 90, f2Risk: 0.5, f3Availability: 0.4, score: 0.4, status: 'CANDIDATE', delayMins: 90, blocks: [], trainIds: [] },
  ];

  const { ctx } = mockCtx();
  const stats = drawParetoScatter(ctx, {
    width: 640,
    height: 360,
    plans,
    selectedPlanId: 'PLAN-02',
  });

  assert.equal(stats.plans, 3);
  assert.equal(stats.pareto, 2);
  assert.ok(stats.selected, 'selected plan must draw its amber ring');
});

test('activityLog: ordered, capped at 50 lines, subscribers notified', () => {
  const seen: string[] = [];
  const unsubscribe = subscribeActivity((line) => seen.push(line.message));
  for (let i = 0; i < 55; i++) addActivity('TELEMETRY', `tick ${i}`);
  unsubscribe();

  const snap = activitySnapshot();
  assert.equal(snap.length, 50, 'must keep exactly the newest 50 lines');
  assert.equal(snap[0].message, 'tick 5', 'oldest lines evicted');
  assert.equal(snap[snap.length - 1].message, 'tick 54', 'newest line last');
  assert.equal(seen.length, 55, 'subscriber sees every line');

  addActivity('SYSTEM', 'after unsubscribe');
  assert.equal(seen.length, 55, 'no notifications after unsubscribe');
});