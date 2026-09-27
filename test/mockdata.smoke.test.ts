import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enforceParity, stationsForDivision, trainsForDivision } from '../src/data/mockData';
import type { TrainDto } from '../src/types';

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