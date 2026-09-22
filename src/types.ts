export interface StationDto {
  stationName: string;
  km: number;
}

export interface SectionDto {
  divisionId: string;
  divisionName: string;
  zone: string;
  zoneName: string;
  sectionName: string;
  displayLabel: string;
  startKm: number;
  endKm: number;
  stations: StationDto[];
}

export interface ZoneGroup {
  code: string;
  name: string;
  divisions: SectionDto[];
}

export interface TrainStop {
  stationName?: string;
  station?: string;
  chainageKm?: number;
  km?: number;
  arrivalTime?: string;
  departureTime?: string;
  time?: string | number;
}

export interface TrainDto {
  trainId: string;
  trainName: string;
  priority: number;
  arrivalTime: string;
  departureTime: string;
  originStation: string;
  destinationStation: string;
  loopLineRequirement: boolean;
  // Milestone 6: a richer payload may carry a typed train and a stop schedule.
  type?: 'FREIGHT' | 'EXPRESS' | 'PASSENGER';
  schedule?: TrainStop[];
  stops?: TrainStop[];
  routePoints?: TrainStop[];
}

export interface AssetDto {
  assetId: string;
  assetType: string;
  locationKm: number;
  failureProbability: number;
  consequenceScore: number;
  rulDays: number;
  failureRiskScore: number;
}

export interface BlockDto {
  blockId: string;
  sectionId: string;
  startKm: number;
  endKm: number;
  startTime: string;
  endTime: string;
  requiredDurationMinutes: number;
  blockPriority: number;
}

export interface ActiveSectionPayload {
  activeSection: SectionDto | null;
  stations: StationDto[];
  trains: TrainDto[];
  assets: AssetDto[];
  blocks: BlockDto[];
}

export interface TelemetryTrain {
  trainId: string;
  trainName: string;
  chainageKm: number;
  latitude: number | null;
  longitude: number | null;
  speedKmh: number;
  status: string;
  /** When present, the wall-clock time the position was reported. */
  currentPosition?: {
    time?: string | number;
    timestamp?: string | number;
  };
}

export interface TelemetryAsset {
  assetId: string;
  assetType: string;
  locationKm: number;
  latitude: number | null;
  longitude: number | null;
  riskScore: number;
  status: string;
}

export interface TelemetryTick {
  timestamp: string;
  tickMs: number;
  sectionId: string | null;
  trains: TelemetryTrain[];
  assets: TelemetryAsset[];
}

export interface DisruptionAlert {
  type: 'DISRUPTION_INJECTED' | 'STRATEGY_APPLIED' | 'CRITICAL_RISK';
  message: string;
  timestamp: string;
  eventId?: string;
  assetId?: string;
  riskScore?: number;
}

export type ViewId = 'home' | 'assets' | 'timespace' | 'network' | 'optimizer' | 'disruption' | 'audit';

// --- Milestone 6: RBAC + activity ticker -----------------------------------

export type Role = 'CONTROLLER' | 'DISPATCHER' | 'ADMIN';

export interface UserSession {
  username: string;
  role: Role;
}

export type ActivitySource =
  | 'SYSTEM'
  | 'SECTION'
  | 'OPTIMIZER'
  | 'DISRUPTION'
  | 'TELEMETRY'
  | 'ALERT'
  | 'AUTH';

export interface ActivityLine {
  id: number;
  ts: string;
  source: ActivitySource;
  message: string;
}

/** Live telemetry snapshot of a train, as kept by the control desk. */
export interface TrainLive {
  km: number;
  /** minutes since midnight the position was reported. */
  mins: number;
  speedKmh: number;
}

// --- Milestone 5: optimizer / disruption / audit contracts -----------------

export interface CandidatePlan {
  planId: string;
  name: string;
  f1Delay: number;
  f2Risk: number;
  f3Availability: number;
  score: number;
  status: 'PARETO_OPTIMAL' | 'CANDIDATE';
  delayMins: number;
  blocks: { blockId: string; startKm: number; endKm: number }[];
  trainIds: string[];
}

export interface OptimizationSolveResponse {
  generator: string;
  divisionId: string | null;
  weights: { w1: number; w2: number; w3: number };
  paretoCount: number;
  plans: CandidatePlan[];
}

export interface PlanCommitResult {
  message: string;
  planId: string;
  delayMins: number;
  reTimedTrainIds: string[];
  appliedAt: string;
}

export type DisruptionKind = 'SIGNAL_FAILURE' | 'TRACK_INCIDENT' | 'EQUIPMENT_FAILURE';
export type StrategyType = 'UPSTREAM_HOLDING' | 'TSR_30KMH' | 'EMERGENCY_BLOCK';

export interface RecoveryStrategy {
  strategyId: string;
  type: StrategyType;
  name: string;
  delayMins: number;
  earliestFeasibleDeparture: string;
  affectedTrainIds: string[];
  reason: string;
}

export interface DisruptionEvent {
  eventId: string;
  type: DisruptionKind;
  description: string;
  startKm: number;
  endKm: number;
  reportedAt: string;
}

export interface RegisteredDisruption {
  event: DisruptionEvent;
  strategies: RecoveryStrategy[];
  createdAt: string;
  resolved: boolean;
}

export type AuditSeverity = 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL' | 'SYSTEM_OVERRIDE';

export interface AuditEntry {
  id: number;
  timestamp: string;
  category: string;
  severity: AuditSeverity;
  message: string;
  details?: unknown;
}

export interface AuditLogsResponse {
  count: number;
  logs: AuditEntry[];
}