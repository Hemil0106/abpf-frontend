import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enforceParity, getFallbackTrains, stationsForDivision, trainsForDivision } from '../src/data/mockData';
import type { TrainDto } from '../src/types';
import {
  ALL_AUTHENTIC_TRAINS,
} from '../src/data/mockData';

const CR = ['11057', '11058', '12123', '12124', '12137', '12138', '22221', '22222'];
const WR = ['12951', '12952', '12953', '12954', '22901', '22902', 'FR-001', 'FR-002'].sort();
const NWR = ['12015', '12016', '12981', '12982', '20977', '20978'];

const ids = (trains: readonly TrainDto[]): string[] => trains.map((t) => t.trainId).sort();

/** Last digit of a 5-digit IR number; odd=UP, even=DOWN (freight ids keep their direction). */
const expectedDirection = (train: TrainDto): 'UP' | 'DOWN' | null => {
  const digits = train.trainId.replace(/\D/g, '');
  return digits.length >= 2 ? (Number(digits[digits.length - 1]) % 2 === 1 ? 'UP' : 'DOWN') : null;
};

test('mockData: authentic per-zone rosters with strict parity and zero cross-zone leakage', () => {
  const cr = trainsForDivision('CR_MUMBAI');
  const wr = trainsForDivision('WR_MUMBAI');
  const nwr = trainsForDivision('NWR_JAIPUR');

  assert.deepEqual(ids(cr), CR, 'CR roster is exactly the 8 authentic CSMT-section trains');
  assert.deepEqual(ids(wr), WR, 'WR roster is exactly the 8 authentic MMCT-section trains');
  assert.deepEqual(ids(nwr), NWR, 'NWR roster is exactly the 6 authentic Jaipur-section trains');

  // Cross-zone leakage: no roster may contain any other zone's train number.
  for (const t of ids(cr)) assert.ok(!WR.includes(t) && !NWR.includes(t), `${t} must not leak`);
  for (const t of ids(wr)) assert.ok(!CR.includes(t) && !NWR.includes(t), `${t} must not leak`);
  for (const t of ids(nwr)) assert.ok(!CR.includes(t) && !WR.includes(t), `${t} must not leak`);
  assert.ok(!ids(wr).includes('12002'), 'Shatabdi 12002 must never appear in a WR/CR timetable');

  // Parity: even numbers run DOWN (descending chainage, dashed lane), odd UP.
  for (const train of [...cr, ...wr, ...nwr]) {
    const want = expectedDirection(train);
    if (want === null) continue;
    assert.equal(train.direction, want, `${train.trainId} direction must follow parity`);
    const stops = train.schedule!;
    const firstKm = stops[0].km ?? 0;
    const lastKm = stops[stops.length - 1].km ?? 0;
    assert.equal(
      lastKm >= firstKm,
      want === 'UP',
      `${train.trainId} stop slope must agree with its lane direction`,
    );
  }

  // Authentic chainages: Deccan Queen hits CSMT 0 / Kalyan 54 / Karjat 100,
  // Tejas Rajdhani runs MMCT 0 / Borivali 30 / Vapi 167 / Surat 263, and the
  // Jaipur express stops Phulera 55 / Kishangarh 105.
  const dq = cr.find((t) => t.trainId === '12123')!;
  assert.deepEqual(dq.schedule!.map((s) => [s.stationName, s.km]), [
    ['CSMT', 0], ['Dadar', 9], ['Thane', 34], ['Kalyan', 54], ['Karjat', 100],
  ]);
  const tejas = wr.find((t) => t.trainId === '12951')!;
  assert.deepEqual(tejas.schedule!.map((s) => [s.stationName, s.km]), [
    ['MMCT', 0], ['Borivali', 30], ['Vapi', 167], ['Surat', 263],
  ]);
  const jp = nwr.find((t) => t.trainId === '12981')!;
  assert.deepEqual(jp.schedule!.map((s) => [s.stationName, s.km]), [
    ['Jaipur', 0], ['Kanakpura', 9], ['Phulera', 55], ['Kishangarh', 105], ['Ajmer', 132],
  ]);
});

const toMins = (time: string): number => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

test('mockData: class-speed slopes diverge and departures never collide', () => {
  // Steepness: the 0→263 KM corridor takes ~147 / ~237 / ~379 sim minutes for
  // EXPRESS / SUPERFAST / FREIGHT — visibly divergent string slopes. A 167 KM
  // leg is ~94 / ~150 / ~240 minutes exactly as the roster spec demands.
  const wr = trainsForDivision('WR_MUMBAI');
  const depOf = (t: TrainDto) => toMins(String(t.schedule![0].time));
  const runMins = (t: TrainDto, toKm: number): number => {
    const s = t.schedule!;
    const dep = toMins(String(s[0].time));
    const arr = toMins(String(s[s.length - 1].time));
    const spanKm = Math.abs(s[s.length - 1].km! - s[0].km!);
    return Math.round(((arr - dep) * toKm) / spanKm);
  };

  const tejas = wr.find((t) => t.trainId === '12951')!; // EXPRESS
  const sf = wr.find((t) => t.trainId === '22901')!; // SUPERFAST
  const rake = wr.find((t) => t.trainId === 'FR-001')!; // FREIGHT
  assert.equal(runMins(tejas, 263), Math.round(263 * 0.56), 'express 167 KM ≈ 94 min (STEEP slope)');
  assert.equal(runMins(sf, 263), Math.round(263 * 0.9), 'superfast 167 KM ≈ 150 min (MEDIUM slope)');
  assert.equal(runMins(rake, 263), Math.round(263 * 1.44), 'DFC freight 167 KM ≈ 240 min (SHALLOW slope)');

  // Every rail pair must have a unique departure timestamp within its division
  // — no trains share a departure unless it is a planned parallel move (none here).
  for (const [div, roster] of [
    ['CR_MUMBAI', 'CR'],
    ['WR_MUMBAI', 'WR'],
    ['NWR_JAIPUR', 'NWR'],
  ] as const) {
    const list = trainsForDivision(div);
    const deps = list.map(depOf);
    assert.equal(new Set(deps).size, deps.length, `${roster} departures must all be distinct`);
    assert.equal(list.length, new Set(list.map((t) => t.trainId)).size, `${roster} train ids unique`);
  }
});

test('mockData: division id matching and schedule reversal under enforced parity', () => {
  assert.ok(trainsForDivision('WR-MMCT-01').length > 0, 'zone-prefix ids (legacy backend) still resolve to WR');
  assert.ok(trainsForDivision('cr_mumbai').length > 0, 'derives cleanly and matches on upserted zones');
  assert.deepEqual(trainsForDivision('SCR_HYDERABAD'), [], 'unknown division must not render a roster');

  const stations = stationsForDivision('CR_MUMBAI');
  const csmt = stations.find((s) => s.stationName === 'CSMT');
  const nashik = stations.find((s) => s.stationName === 'Nashik Road');
  assert.equal(csmt?.km, 0);
  assert.equal(nashik?.km, 188, 'CR section spans to Nashik Road at KM 188');

  // A deliberately mis-ordered even train must be flipped to run DOWN.
  const wrong: TrainDto[] = [{
    trainId: '99998',
    trainName: 'test',
    priority: 1,
    departureTime: '06:00:00',
    arrivalTime: '09:00:00',
    originStation: 'A',
    destinationStation: 'B',
    loopLineRequirement: false,
    schedule: [
      { stationName: 'A', km: 0, time: '06:00' },
      { stationName: 'B', km: 100, time: '09:00' },
    ],
  }];
  const fixed = enforceParity(wrong)[0];
  assert.equal(fixed.direction, 'DOWN', 'even number forces the DOWN lane');
  const fixedStops = fixed.schedule!;
  assert.equal(fixedStops[0].stationName, 'B', 'schedule reversed so descent ends at the origin');
  assert.equal(fixedStops[fixedStops.length - 1].stationName, 'A');
});

test('mockData: getFallbackTrains guarantees the canvas is never blank', () => {
  const cr = getFallbackTrains({ id: 'CR_MUMBAI', zone: 'CR' });
  assert.ok(cr.length > 0, 'known division returns its authentic roster');
  assert.deepEqual(new Set(cr.map((t) => t.trainId)), new Set(CR), 'CR fallback = CR catalog');
  assert.ok(cr.every((t) => t.direction === 'UP' || t.direction === 'DOWN'), 'every fallback train carries a lane');

  const wr = getFallbackTrains({ zone: 'WR' });
  assert.ok(wr.length > 0, 'zone-only reference resolves to WR');
  assert.ok(wr.every((t) => WR.includes(t.trainId)), 'WR fallback never leaks another zone');

  const unknown = getFallbackTrains({ id: 'SCR_HYDERABAD', zone: 'SCR' });
  assert.ok(unknown.length > 0, 'unknown division still yields authentic trains (no blank canvas)');
  assert.ok(
    unknown.every((t) => (ALL_AUTHENTIC_TRAINS as readonly string[]).includes(t.trainId)),
    'union fallback only uses real train numbers',
  );
});