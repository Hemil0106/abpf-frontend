import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AssetDto, BlockDto, CandidatePlan, StationDto, TrainDto } from '../src/types';
import {
  buildTimeScale,
  isoToEpochMs,
  kmOfStation,
  riskLevel,
  segmentIntersection,
  timeWindow,
  trainSegment,
} from '../src/tsd/tsdMath';
import { mockCtx } from './helpers';
import { drawTimeSpace } from '../src/tsd/renderTimeSpace';
import { drawNetworkMap, ZoneNode } from '../src/tsd/renderNetworkMap';
import { drawParetoScatter } from '../src/tsd/renderPareto';

const iso = (h: string, m: number) => {
  const d = new Date('2026-09-20T00:00:00Z');
  d.setMinutes(m);
  return d;
};

test('tsdMath: station→km resolution, train segments, conflicts', () => {
  const stations: StationDto[] = [
    { stationName: 'MMCT', km: 0 },
    { stationName: 'BRC', km: 160 },
  ];
  assert.equal(kmOfStation('BRC', stations, 0, 320), 160);
  assert.equal(kmOfStation('UNKNOWN', stations, 0, 320), 0);

  const t1: TrainDto = {
    trainId: 'T1', trainName: 'U1', priority: 1,
    departureTime: iso('06:00', 0).toISOString(),
    arrivalTime: iso('10:00', 240).toISOString(),
    originStation: 'MMCT', destinationStation: 'BRC', loopLineRequirement: false,
  };
  const t2: TrainDto = {
    trainId: 'T2', trainName: 'U2', priority: 2,
    departureTime: iso('06:30', 30).toISOString(),
    arrivalTime: iso('10:30', 270).toISOString(),
    originStation: 'BRC', destinationStation: 'MMCT', loopLineRequirement: false,
  };
  const kmOf = (name: string | null) => kmOfStation(name, stations, 0, 320);
  const s1 = trainSegment(t1, kmOf);
  const s2 = trainSegment(t2, kmOf);
  assert.ok(segmentIntersection(s1, s2), 'crossing trains must intersect');

  assert.equal(riskLevel(0.1), 'clear');
  assert.equal(riskLevel(0.5), 'caution');
  assert.equal(riskLevel(0.9), 'critical');

  const tw = timeWindow(
    [isoToEpochMs(t1.departureTime), isoToEpochMs(t1.arrivalTime)],
    [],
    iso('08:00', 120).getTime(),
    1,
  );
  assert.ok(tw.visibleMs > 0);
  const scale = buildTimeScale({ width: 800, height: 400, startKm: 0, endKm: 320, minMs: tw.minMs, visibleMs: tw.visibleMs });
  assert.equal(scale.y(0), 400);
  assert.equal(scale.y(320), 0);
});

test('drawTimeSpace: stations, crossing conflict halo, blocks, live marker', () => {
  const stations: StationDto[] = [
    { stationName: 'MMCT', km: 0 },
    { stationName: 'BRC', km: 160 },
    { stationName: 'BVI', km: 320 },
  ];
  const trains: TrainDto[] = [
    {
      trainId: 'T1', trainName: 'U1', priority: 1,
      departureTime: iso('06:00', 0).toISOString(),
      arrivalTime: iso('10:00', 240).toISOString(),
      originStation: 'MMCT', destinationStation: 'BRC', loopLineRequirement: false,
    },
    {
      trainId: 'T2', trainName: 'U2', priority: 2,
      departureTime: iso('06:30', 30).toISOString(),
      arrivalTime: iso('10:30', 270).toISOString(),
      originStation: 'BRC', destinationStation: 'MMCT', loopLineRequirement: false,
    },
  ];
  const blocks: BlockDto[] = [
    {
      blockId: 'B1', sectionId: 'WR-MMCT-01', startKm: 100, endKm: 200,
      startTime: iso('07:00', 60).toISOString(),
      endTime: iso('08:00', 120).toISOString(),
      requiredDurationMinutes: 60, blockPriority: 1,
    },
  ];
  const assets: AssetDto[] = [
    { assetId: 'A1', assetType: 'POINT', locationKm: 100, failureProbability: 0.7, consequenceScore: 5, rulDays: 30, failureRiskScore: 0.8 },
  ];

  const { ctx, calls } = mockCtx();
  const stats = drawTimeSpace(ctx, {
    width: 800,
    height: 400,
    startKm: 0,
    endKm: 320,
    stations,
    trains,
    blocks,
    assets,
    live: { T1: 120 },
    zoom: 1,
    showHeatmap: true,
    showBlocks: true,
    cursorMs: iso('08:00', 120).getTime(),
  });

  assert.equal(stats.stations, 3);
  assert.equal(stats.trains, 2);
  assert.equal(stats.blocks, 1);
  assert.equal(stats.conflicts, 1, 'crossing trains must draw a conflict halo');
  assert.equal(stats.live, 1);
  assert.ok(stats.heatSlices > 0, 'heatmap slices must be drawn');
  assert.ok(calls.includes('addColorStop'), 'conflict halo gradient must be built');
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