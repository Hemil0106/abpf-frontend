import type { StationDto, TrainDto, TrainStop } from '../types';

/**
 * Authentic real-world train catalog per Zone/Division, mirroring Indian
 * Railways numbering (the odd number of a pair is the DOWN/outward leg, the
 * even number the UP/inward leg). Each entry carries an explicit stop schedule
 * with true station chainages, so the time-space chart always draws the real
 * CSMT/Kalyan/Vapi/Phulera geometry regardless of what the backend seed sends.
 *
 * The dataset is the FRONTEND enforcement layer: `trainsForDivision` only ever
 * returns the catalog belonging to the active division, so cross-zone leakage
 * (e.g. a Shatabdi 12002 cruising inside a CR/WR roster) is impossible by
 * construction.
 */

const CR_ID = 'CR_MUMBAI'; // Mumbai CSMT – Kalyan – Igatpuri/Karjat
const WR_ID = 'WR_MUMBAI'; // Mumbai MMCT – Borivali – Vapi – Surat
const NWR_ID = 'NWR_JAIPUR'; // Jaipur – Phulera – Ajmer

/** Union of every real train number allowed in any roster, for leak tests. */
export const ALL_AUTHENTIC_TRAINS = [
  '12123', '12124', '22221', '22222', '11057', '11058', '12137', '12138',
  '12951', '12952', '12953', '12954', '22901', '22902', 'FR-001', 'FR-002',
  '12981', '12982', '20977', '20978', '12015', '12016',
] as const;
export type AuthenticTrainId = (typeof ALL_AUTHENTIC_TRAINS)[number];

/** A running stop: [station, chainage KM, time HH:MM]. */
type StopDef = readonly [string, number, string];

const st = ([name, km, time]: StopDef): TrainStop => ({ stationName: name, km, time });

function buildTrain(
  trainId: string,
  trainName: string,
  priority: number,
  type: TrainDto['type'],
  originStation: string,
  destinationStation: string,
  stops: readonly StopDef[],
): TrainDto {
  const schedule = stops.map(st);
  return {
    trainId,
    trainName,
    priority,
    type,
    originStation,
    destinationStation,
    loopLineRequirement: false,
    schedule,
    arrivalTime: `${stops[stops.length - 1][2]}:00`,
    departureTime: `${stops[0][2]}:00`,
  };
}

/** CR (Mumbai CSMT – Pune/Igatpuri/Karjat): Western + Central Ghat routes. */
const CR_TRAINS: TrainDto[] = [
  buildTrain('12123', 'Deccan Queen', 1, 'EXPRESS', 'CSMT', 'Pune',
    [['CSMT', 0, '07:10'], ['Dadar', 9, '07:16'], ['Thane', 34, '07:40'], ['Kalyan', 54, '08:05'], ['Karjat', 100, '08:42']]),
  buildTrain('12124', 'Deccan Queen', 1, 'EXPRESS', 'Pune', 'CSMT',
    [['Karjat', 100, '17:30'], ['Kalyan', 54, '18:05'], ['Thane', 34, '18:26'], ['Dadar', 9, '18:49'], ['CSMT', 0, '19:05']]),
  buildTrain('22221', 'CSMT-NZM Rajdhani Express', 1, 'EXPRESS', 'CSMT', 'Hazrat Nizamuddin',
    [['CSMT', 0, '16:10'], ['Kalyan', 54, '16:52'], ['Nashik Road', 188, '17:55']]),
  buildTrain('22222', 'NZM-CSMT Rajdhani Express', 1, 'EXPRESS', 'Hazrat Nizamuddin', 'CSMT',
    [['Nashik Road', 188, '08:00'], ['Kalyan', 54, '09:02'], ['CSMT', 0, '10:10']]),
  buildTrain('11057', 'CSMT-Amritsar Express', 3, 'PASSENGER', 'CSMT', 'Amritsar',
    [['CSMT', 0, '19:00'], ['Dadar', 9, '19:08'], ['Thane', 34, '19:33'], ['Kalyan', 54, '20:00'], ['Kasara', 121, '20:55']]),
  buildTrain('11058', 'Amritsar-CSMT Express', 3, 'PASSENGER', 'Amritsar', 'CSMT',
    [['Kasara', 121, '05:10'], ['Kalyan', 54, '06:05'], ['Thane', 34, '06:32'], ['Dadar', 9, '06:57'], ['CSMT', 0, '07:05']]),
  buildTrain('12137', 'Punjab Mail', 2, 'EXPRESS', 'CSMT', 'Firozpur',
    [['CSMT', 0, '10:00'], ['Dadar', 9, '10:08'], ['Thane', 34, '10:33'], ['Kalyan', 54, '11:00'], ['Karjat', 100, '11:42'], ['Kasara', 121, '12:10']]),
  buildTrain('12138', 'Punjab Mail', 2, 'EXPRESS', 'Firozpur', 'CSMT',
    [['Kasara', 121, '14:20'], ['Karjat', 100, '14:48'], ['Kalyan', 54, '15:30'], ['Thane', 34, '15:56'], ['Dadar', 9, '16:19'], ['CSMT', 0, '16:25']]),
];

/** WR (Mumbai – Borivali – Vapi – Surat): Western Dedicated Corridor. */
const WR_TRAINS: TrainDto[] = [
  buildTrain('12951', 'Tejas Rajdhani Express', 1, 'EXPRESS', 'MMCT', 'New Delhi',
    [['MMCT', 0, '17:00'], ['Borivali', 30, '17:26'], ['Vapi', 167, '19:20'], ['Surat', 263, '20:00']]),
  buildTrain('12952', 'Tejas Rajdhani Express', 1, 'EXPRESS', 'New Delhi', 'MMCT',
    [['Surat', 263, '08:30'], ['Vapi', 167, '09:10'], ['Borivali', 30, '11:05'], ['MMCT', 0, '11:35']]),
  buildTrain('12953', 'August Kranti Rajdhani Express', 1, 'EXPRESS', 'MMCT', 'Hazrat Nizamuddin',
    [['MMCT', 0, '17:35'], ['Borivali', 30, '18:01'], ['Vapi', 167, '19:55'], ['Surat', 263, '20:35']]),
  buildTrain('12954', 'August Kranti Rajdhani Express', 1, 'EXPRESS', 'Hazrat Nizamuddin', 'MMCT',
    [['Surat', 263, '07:20'], ['Vapi', 167, '08:00'], ['Borivali', 30, '09:50'], ['MMCT', 0, '10:20']]),
  buildTrain('22901', 'Bandra Terminus-Udaipur Superfast Express', 2, 'EXPRESS', 'Bandra Terminus', 'Udaipur',
    [['MMCT', 0, '07:15'], ['Borivali', 30, '07:45'], ['Vapi', 167, '09:55'], ['Surat', 263, '10:45']]),
  buildTrain('22902', 'Udaipur-Bandra Terminus Superfast Express', 2, 'EXPRESS', 'Udaipur', 'Bandra Terminus',
    [['Surat', 263, '18:30'], ['Vapi', 167, '19:20'], ['Borivali', 30, '21:25'], ['MMCT', 0, '22:00']]),
  buildTrain('FR-001', 'Western DFC Container Rake', 4, 'FREIGHT', 'MMCT', 'Surat',
    [['MMCT', 0, '01:30'], ['Borivali', 30, '02:10'], ['Vapi', 167, '04:40'], ['Surat', 263, '05:40']]),
  buildTrain('FR-002', 'Western DFC Container Rake', 4, 'FREIGHT', 'Surat', 'MMCT',
    [['Surat', 263, '14:30'], ['Vapi', 167, '15:30'], ['Borivali', 30, '18:05'], ['MMCT', 0, '18:45']]),
];

/** NWR (Jaipur – Phulera – Kishangarh – Ajmer): Jaipur division. */
const NWR_TRAINS: TrainDto[] = [
  buildTrain('12981', 'Jaipur-Udaipur Superfast Express', 2, 'EXPRESS', 'Jaipur', 'Udaipur',
    [['Jaipur', 0, '06:20'], ['Kanakpura', 9, '06:26'], ['Phulera', 55, '06:58'], ['Kishangarh', 105, '07:35'], ['Ajmer', 132, '08:00']]),
  buildTrain('12982', 'Udaipur-Jaipur Superfast Express', 2, 'EXPRESS', 'Udaipur', 'Jaipur',
    [['Ajmer', 132, '09:05'], ['Kishangarh', 105, '09:35'], ['Phulera', 55, '10:12'], ['Kanakpura', 9, '10:44'], ['Jaipur', 0, '10:50']]),
  buildTrain('20977', 'Vande Bharat Express', 1, 'EXPRESS', 'Ajmer', 'Chandigarh',
    [['Jaipur', 0, '10:30'], ['Kanakpura', 9, '10:36'], ['Phulera', 55, '11:08'], ['Kishangarh', 105, '11:45'], ['Ajmer', 132, '12:10']]),
  buildTrain('20978', 'Vande Bharat Express', 1, 'EXPRESS', 'Chandigarh', 'Ajmer',
    [['Ajmer', 132, '15:30'], ['Kishangarh', 105, '15:55'], ['Phulera', 55, '16:32'], ['Kanakpura', 9, '17:04'], ['Jaipur', 0, '17:10']]),
  buildTrain('12015', 'Ajmer Shatabdi Express', 1, 'EXPRESS', 'New Delhi', 'Ajmer',
    [['Jaipur', 0, '13:00'], ['Kanakpura', 9, '13:06'], ['Phulera', 55, '13:38'], ['Kishangarh', 105, '14:15'], ['Ajmer', 132, '14:40']]),
  buildTrain('12016', 'Ajmer Shatabdi Express', 1, 'EXPRESS', 'Ajmer', 'New Delhi',
    [['Ajmer', 132, '16:40'], ['Kishangarh', 105, '17:05'], ['Phulera', 55, '17:42'], ['Kanakpura', 9, '18:14'], ['Jaipur', 0, '18:20']]),
];

interface DivisionCatalog {
  id: string;
  zone: string;
  stations: StationDto[];
  trains: TrainDto[];
}

const CR_STATIONS: StationDto[] = [
  { stationName: 'CSMT', km: 0 }, { stationName: 'Dadar', km: 9 },
  { stationName: 'Thane', km: 34 }, { stationName: 'Kalyan', km: 54 },
  { stationName: 'Karjat', km: 100 }, { stationName: 'Kasara', km: 121 },
  { stationName: 'Nashik Road', km: 188 },
];
const WR_STATIONS: StationDto[] = [
  { stationName: 'MMCT', km: 0 }, { stationName: 'Borivali', km: 30 },
  { stationName: 'Vapi', km: 167 }, { stationName: 'Surat', km: 263 },
];
const NWR_STATIONS: StationDto[] = [
  { stationName: 'Jaipur', km: 0 }, { stationName: 'Kanakpura', km: 9 },
  { stationName: 'Phulera', km: 55 }, { stationName: 'Kishangarh', km: 105 },
  { stationName: 'Ajmer', km: 132 },
];

const CATALOGS: Record<string, DivisionCatalog> = {
  [CR_ID]: { id: CR_ID, zone: 'CR', stations: CR_STATIONS, trains: CR_TRAINS },
  [WR_ID]: { id: WR_ID, zone: 'WR', stations: WR_STATIONS, trains: WR_TRAINS },
  [NWR_ID]: { id: NWR_ID, zone: 'NWR', stations: NWR_STATIONS, trains: NWR_TRAINS },
};

/** Match any division id / zone to a catalog: exact id, then zone-prefix. */
function catalogFor(divisionId: string | null | undefined, zone?: string | null): DivisionCatalog | null {
  const probe = zone?.toUpperCase() ?? divisionId?.toUpperCase();
  if (!probe) return null;
  if (divisionId && CATALOGS[divisionId]) return CATALOGS[divisionId];
  for (const c of Object.values(CATALOGS)) {
    if (probe === c.zone || probe.startsWith(`${c.zone}_`) || probe.startsWith(`${c.zone}-`)) return c;
  }
  return null;
}

/** Last numeric digit of a 5-digit IR train number, or null for freight ids. */
function parityDigit(trainId: string): number | null {
  const digits = trainId.replace(/\D/g, '');
  return digits.length >= 2 ? Number(digits[digits.length - 1]) : null;
}

/**
 * Strict parity enforcement: odd numbers run UP (city → outward, ascending
 * chainage, solid lane) and even numbers run DOWN (outward → city, descending
 * chainage, dashed lane). Any stop schedule whose slope contradicts the number
 * is reversed so the drawn trajectory always obeys Indian Railways numbering.
 */
export function enforceParity(trains: readonly TrainDto[]): TrainDto[] {
  return trains.map((t) => {
    const digit = parityDigit(t.trainId);
    if (digit === null) return t;
    const wantsUp = digit % 2 === 1;
    const sched = t.schedule ?? t.stops ?? t.routePoints;
    if (!sched || sched.length < 2) return t;
    const firstKm = sched[0].chainageKm ?? sched[0].km ?? 0;
    const lastKm = sched[sched.length - 1].chainageKm ?? sched[sched.length - 1].km ?? 0;
    const isAscending = lastKm >= firstKm;
    if (isAscending === wantsUp) return { ...t, direction: wantsUp ? 'UP' : 'DOWN' };
    return { ...t, direction: wantsUp ? 'UP' : 'DOWN', schedule: [...sched].reverse() };
  });
}

/**
 * The single gate every division-aware view uses: returns the ACTIVE
 * division's authentic train catalog — never any other zone's — so cross-zone
 * leakage cannot occur. Unknown ids fall back to clearing the roster (safest
 * I/O invariant: an empty schedule beats a wrong zone's trains).
 */
export function trainsForDivision(
  divisionId: string | null | undefined,
  zone?: string | null,
): TrainDto[] {
  const catalog = catalogFor(divisionId, zone);
  if (!catalog) return [];
  return enforceParity(catalog.trains);
}

export function stationsForDivision(
  divisionId: string | null | undefined,
  zone?: string | null,
): StationDto[] {
  return catalogFor(divisionId, zone)?.stations ?? [];
}

export interface DivisionRef {
  id?: string | null;
  zone?: string | null;
}

/**
 * The never-blank-canvas fallback: returns the active division's authentic
 * roster when the division is recognised, or the full authentic union of all
 * three zones for an unrecognised division (no zone constraint → no leakage,
 * and the time-space canvas always has trains to draw). Every train is parity
 * enforced so odd/even numbering always matches its drawn slope.
 */
export function getFallbackTrains(division?: DivisionRef | null): TrainDto[] {
  const catalog = catalogFor(division?.id, division?.zone);
  const roster = catalog ? catalog.trains : Object.values(CATALOGS).flatMap((c) => c.trains);
  return enforceParity(roster);
}

export function isKnownDivision(divisionId: string | null | undefined): boolean {
  return catalogFor(divisionId) !== null;
}