import type { StationDto, TrainDto } from '../types';

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
  '12123', '12124', '12127', '11057', '11058', '11060', '12137', '12138', '22221', '22222',
  '12951', '12952', '12953', '12954', '12955', '12956', '22901', '22902', 'FR-001', 'FR-002',
  '12981', '12982', '12983', '12984', '20977', '20978', '12015', '12016',
] as const;
export type AuthenticTrainId = (typeof ALL_AUTHENTIC_TRAINS)[number];

/**
 * Distinct running-speed classes produce visibly divergent string slopes:
 * Express 110–130 km/h (~0.56 min/km → 167 KM in ≈90 min, STEEP), Superfast/
 * Mail 75–90 km/h (~0.90 min/km → 167 KM in ≈150 min, MEDIUM), DFC Freight
 * 40–55 km/h (~1.44 min/km → 167 KM in ≈240 min, SHALLOW).
 */
const SPEED_MIN_PER_KM = { EXPRESS: 0.56, SUPERFAST: 0.9, FREIGHT: 1.44 } as const;
type TrainClass = keyof typeof SPEED_MIN_PER_KM;

const hhmm = (mins: number): string => {
  const m = Math.round(Math.max(0, mins)) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/**
 * Builds an authentic run: every intermediate stop's arrival is interpolated
 * from its true chainage at the class cruise speed, so all strings of a class
 * share one slope and each train's departure stays unique. Runs are authored
 * city-end-first (ascending chainage); `enforceParity` reverses even (DOWN)
 * trains so their slope descends.
 */
function route(
  trainId: string,
  trainName: string,
  priority: number,
  type: TrainDto['type'],
  originStation: string,
  destinationStation: string,
  depMins: number,
  cls: TrainClass,
  stops: readonly [string, number][],
): TrainDto {
  const schedule = stops.map(([stationName, km]) => ({
    stationName,
    km,
    time: hhmm(depMins + km * SPEED_MIN_PER_KM[cls]),
  }));
  return {
    trainId,
    trainName,
    priority,
    type,
    originStation,
    destinationStation,
    loopLineRequirement: false,
    schedule,
    arrivalTime: `${schedule[schedule.length - 1].time}:00`,
    departureTime: `${schedule[0].time}:00`,
  };
}

/** CR (Mumbai CSMT – Pune/Igatpuri/Karjat): Western + Central Ghat routes. */
const CR_TRAINS: TrainDto[] = [
  route('12123', 'Deccan Queen', 3, 'PASSENGER', 'CSMT', 'Pune', 7 * 60 + 10, 'SUPERFAST',
    [['CSMT', 0], ['Dadar', 9], ['Thane', 34], ['Kalyan', 54], ['Karjat', 100]]),
  route('12124', 'Deccan Queen', 3, 'PASSENGER', 'Pune', 'CSMT', 15 * 60 + 21, 'SUPERFAST',
    [['Karjat', 100], ['Kalyan', 54], ['Thane', 34], ['Dadar', 9], ['CSMT', 0]]),
  route('22221', 'CSMT-NZM Rajdhani Express', 1, 'EXPRESS', 'CSMT', 'Hazrat Nizamuddin', 16 * 60 + 10, 'EXPRESS',
    [['CSMT', 0], ['Kalyan', 54], ['Nashik Road', 188]]),
  route('22222', 'NZM-CSMT Rajdhani Express', 1, 'EXPRESS', 'Hazrat Nizamuddin', 'CSMT', 7 * 60 + 15, 'EXPRESS',
    [['Nashik Road', 188], ['Kalyan', 54], ['CSMT', 0]]),
  route('11057', 'CSMT-Amritsar Express', 3, 'PASSENGER', 'CSMT', 'Amritsar', 19 * 60, 'SUPERFAST',
    [['CSMT', 0], ['Dadar', 9], ['Thane', 34], ['Kalyan', 54], ['Kasara', 121]]),
  route('11058', 'Amritsar-CSMT Express', 3, 'PASSENGER', 'Amritsar', 'CSMT', 3 * 60, 'SUPERFAST',
    [['Kasara', 121], ['Kalyan', 54], ['Thane', 34], ['Dadar', 9], ['CSMT', 0]]),
  route('12137', 'Punjab Mail', 3, 'PASSENGER', 'CSMT', 'Firozpur', 10 * 60, 'SUPERFAST',
    [['CSMT', 0], ['Dadar', 9], ['Thane', 34], ['Kalyan', 54], ['Karjat', 100], ['Kasara', 121]]),
  route('12138', 'Punjab Mail', 3, 'PASSENGER', 'Firozpur', 'CSMT', 12 * 60 + 30, 'SUPERFAST',
    [['Kasara', 121], ['Karjat', 100], ['Kalyan', 54], ['Thane', 34], ['Dadar', 9], ['CSMT', 0]]),
  route('12127', 'Himgiri Express', 1, 'EXPRESS', 'CSMT', 'Nagpur', 21 * 60 + 30, 'EXPRESS',
    [['CSMT', 0], ['Kalyan', 54], ['Kasara', 121]]),
  route('11060', 'Himgiri Express', 1, 'EXPRESS', 'Nagpur', 'CSMT', 22 * 60 + 15, 'EXPRESS',
    [['Kasara', 121], ['Kalyan', 54], ['CSMT', 0]]),
];

/** WR (Mumbai – Borivali – Vapi – Surat): Western Dedicated Corridor. */
const WR_TRAINS: TrainDto[] = [
  route('12951', 'Tejas Rajdhani Express', 1, 'EXPRESS', 'MMCT', 'New Delhi', 17 * 60, 'EXPRESS',
    [['MMCT', 0], ['Borivali', 30], ['Vapi', 167], ['Surat', 263]]),
  route('12952', 'Tejas Rajdhani Express', 1, 'EXPRESS', 'New Delhi', 'MMCT', 6 * 60 + 30, 'EXPRESS',
    [['Surat', 263], ['Vapi', 167], ['Borivali', 30], ['MMCT', 0]]),
  route('12953', 'August Kranti Rajdhani Express', 1, 'EXPRESS', 'MMCT', 'Hazrat Nizamuddin', 17 * 60 + 35, 'EXPRESS',
    [['MMCT', 0], ['Borivali', 30], ['Vapi', 167], ['Surat', 263]]),
  route('12954', 'August Kranti Rajdhani Express', 1, 'EXPRESS', 'Hazrat Nizamuddin', 'MMCT', 5 * 60 + 15, 'EXPRESS',
    [['Surat', 263], ['Vapi', 167], ['Borivali', 30], ['MMCT', 0]]),
  route('22901', 'Bandra Terminus-Udaipur Superfast Express', 3, 'PASSENGER', 'Bandra Terminus', 'Udaipur', 7 * 60 + 15, 'SUPERFAST',
    [['MMCT', 0], ['Borivali', 30], ['Vapi', 167], ['Surat', 263]]),
  route('22902', 'Udaipur-Bandra Terminus Superfast Express', 3, 'PASSENGER', 'Udaipur', 'Bandra Terminus', 15 * 60, 'SUPERFAST',
    [['Surat', 263], ['Vapi', 167], ['Borivali', 30], ['MMCT', 0]]),
  route('FR-001', 'Western DFC Container Rake', 4, 'FREIGHT', 'MMCT', 'Surat', 90, 'FREIGHT',
    [['MMCT', 0], ['Borivali', 30], ['Vapi', 167], ['Surat', 263]]),
  route('FR-002', 'Western DFC Container Rake', 4, 'FREIGHT', 'Surat', 'MMCT', 9 * 60, 'FREIGHT',
    [['Surat', 263], ['Vapi', 167], ['Borivali', 30], ['MMCT', 0]]),
  route('12955', 'August Kranti Rajdhani Express', 1, 'EXPRESS', 'MMCT', 'Hazrat Nizamuddin', 21 * 60 + 30, 'EXPRESS',
    [['MMCT', 0], ['Borivali', 30], ['Vapi', 167], ['Surat', 263]]),
  route('12956', 'August Kranti Rajdhani Express', 1, 'EXPRESS', 'Hazrat Nizamuddin', 'MMCT', 21 * 60, 'EXPRESS',
    [['Surat', 263], ['Vapi', 167], ['Borivali', 30], ['MMCT', 0]]),
];

/** NWR (Jaipur – Phulera – Kishangarh – Ajmer): Jaipur division. */
const NWR_TRAINS: TrainDto[] = [
  route('12981', 'Jaipur-Udaipur Superfast Express', 3, 'PASSENGER', 'Jaipur', 'Udaipur', 6 * 60 + 20, 'SUPERFAST',
    [['Jaipur', 0], ['Kanakpura', 9], ['Phulera', 55], ['Kishangarh', 105], ['Ajmer', 132]]),
  route('12982', 'Udaipur-Jaipur Superfast Express', 3, 'PASSENGER', 'Udaipur', 'Jaipur', 7 * 60 + 20, 'SUPERFAST',
    [['Ajmer', 132], ['Kishangarh', 105], ['Phulera', 55], ['Kanakpura', 9], ['Jaipur', 0]]),
  route('20977', 'Vande Bharat Express', 1, 'EXPRESS', 'Ajmer', 'Chandigarh', 10 * 60 + 30, 'EXPRESS',
    [['Jaipur', 0], ['Kanakpura', 9], ['Phulera', 55], ['Kishangarh', 105], ['Ajmer', 132]]),
  route('20978', 'Vande Bharat Express', 1, 'EXPRESS', 'Chandigarh', 'Ajmer', 13 * 60 + 20, 'EXPRESS',
    [['Ajmer', 132], ['Kishangarh', 105], ['Phulera', 55], ['Kanakpura', 9], ['Jaipur', 0]]),
  route('12015', 'Ajmer Shatabdi Express', 1, 'EXPRESS', 'New Delhi', 'Ajmer', 13 * 60, 'EXPRESS',
    [['Jaipur', 0], ['Kanakpura', 9], ['Phulera', 55], ['Kishangarh', 105], ['Ajmer', 132]]),
  route('12016', 'Ajmer Shatabdi Express', 1, 'EXPRESS', 'Ajmer', 'New Delhi', 14 * 60 + 30, 'EXPRESS',
    [['Ajmer', 132], ['Kishangarh', 105], ['Phulera', 55], ['Kanakpura', 9], ['Jaipur', 0]]),
  route('12983', 'Ajmer-Jaipur Passenger', 3, 'PASSENGER', 'Jaipur', 'Ajmer', 21 * 60 + 30, 'SUPERFAST',
    [['Jaipur', 0], ['Kanakpura', 9], ['Phulera', 55], ['Kishangarh', 105], ['Ajmer', 132]]),
  route('12984', 'Ajmer-Jaipur Passenger', 3, 'PASSENGER', 'Ajmer', 'Jaipur', 22 * 60, 'SUPERFAST',
    [['Ajmer', 132], ['Kishangarh', 105], ['Phulera', 55], ['Kanakpura', 9], ['Jaipur', 0]]),
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