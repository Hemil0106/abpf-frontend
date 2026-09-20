import axios, { AxiosResponse } from 'axios';
import type {
  ActiveSectionPayload,
  AuditLogsResponse,
  CandidatePlan,
  DisruptionEvent,
  OptimizationSolveResponse,
  PlanCommitResult,
  RecoveryStrategy,
  RegisteredDisruption,
  SectionDto,
  StrategyType,
  ZoneGroup,
} from '../types';

/**
 * Resolves the backend origin: Node test override → Vite env → demo fallback.
 * Note the backend's default PORT is 5000, so the fallback aligns out of the box.
 */
export function baseUrl(): string {
  const fromNode =
    typeof process !== 'undefined' && process.env && process.env.VITE_API_URL;
  const fromVite = (import.meta as unknown as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL;
  return fromNode || fromVite || 'http://localhost:5000';
}

const withBase = () => ({ baseURL: baseUrl() });

const get = <T,>(path: string): Promise<AxiosResponse<T>> => axios.get<T>(path, withBase());
const post = <T,>(path: string, body: unknown): Promise<AxiosResponse<T>> =>
  axios.post<T>(path, body, withBase());

export async function fetchSections(): Promise<ZoneGroup[]> {
  const res = await get<{ zones: ZoneGroup[] }>('/api/v1/sections');
  return res.data.zones;
}

export async function fetchActiveSection(): Promise<ActiveSectionPayload> {
  const res = await get<ActiveSectionPayload>('/api/v1/data/active-section');
  return res.data;
}

export async function selectSection(sectionId: string): Promise<ActiveSectionPayload> {
  const res = await post<ActiveSectionPayload>('/api/v1/data/select-section', { sectionId });
  return res.data;
}

export async function fetchSection(sectionId: string): Promise<SectionDto> {
  const zones = await fetchSections();
  for (const zone of zones) {
    const hit = zone.divisions.find((d) => d.divisionId === sectionId);
    if (hit) return hit;
  }
  throw new Error(`Unknown sectionId: ${sectionId}`);
}

export { axios };

/** Flattens an axios/network error into a single human-readable line. */
export function errMessage(err: unknown): string {
  if (err instanceof Error) {
    const res = (err as { response?: { data?: { error?: string }; status?: number } }).response;
    if (res?.data?.error) return `HTTP ${res.status}: ${res.data.error}`;
    return err.message;
  }
  return 'Unknown error';
}

// --- Milestone 5 endpoints ------------------------------------------------

export async function solveOptimizer(
  divisionId: string,
  weights: { w1: number; w2: number; w3: number },
): Promise<OptimizationSolveResponse> {
  const res = await post<OptimizationSolveResponse>('/api/v1/optimizer/solve', {
    divisionId,
    weights,
  });
  return res.data;
}

export async function commitPlan(
  plan: CandidatePlan,
  weights: { w1: number; w2: number; w3: number },
): Promise<PlanCommitResult> {
  const res = await post<PlanCommitResult>('/api/v1/optimizer/commit', {
    planId: plan.planId,
    weights,
  });
  return res.data;
}

export async function fetchDisruptions(): Promise<RegisteredDisruption[]> {
  const res = await get<{
    count: number;
    disruptions: {
      eventId: string;
      type: DisruptionEvent['type'];
      description: string;
      status: 'ACTIVE';
      createdAt: string;
      strategies: StrategyType[];
    }[];
  }>('/api/v1/disruption/active');
  // The active endpoint only lists strategy names; hydrate what we can and let
  // the panel fill the rest from the inject response.
  return res.data.disruptions.map((d) => ({
    event: {
      eventId: d.eventId,
      type: d.type,
      description: d.description,
      startKm: 0,
      endKm: 0,
      reportedAt: d.createdAt,
    },
    strategies: d.strategies.map((type) => ({
      strategyId: type,
      type,
      name: strategyName(type),
      delayMins: 0,
      earliestFeasibleDeparture: '',
      affectedTrainIds: [],
      reason: '',
    })) as RecoveryStrategy[],
    createdAt: d.createdAt,
    resolved: false,
  }));
}

function strategyName(type: StrategyType): string {
  if (type === 'UPSTREAM_HOLDING') return 'Upstream Holding';
  if (type === 'TSR_30KMH') return 'TSR 30 km/h';
  return 'Emergency Block Allocation';
}

export async function injectDisruption(body: {
  type: DisruptionEvent['type'];
  startKm: number;
  endKm: number;
  description?: string;
}): Promise<RegisteredDisruption> {
  const res = await post<{ inserted: DisruptionEvent; strategies: RecoveryStrategy[] }>(
    '/api/v1/disruption/inject',
    body,
  );
  return {
    event: res.data.inserted,
    strategies: res.data.strategies,
    createdAt: res.data.inserted.reportedAt,
    resolved: false,
  };
}

export async function resolveDisruption(
  eventId: string,
  strategyType: StrategyType,
): Promise<{ message: string; reTimedTrainIds: string[] }> {
  const res = await post<{ message: string; reTimedTrainIds: string[] }>(
    '/api/v1/disruption/resolve',
    { eventId, strategyType },
  );
  return res.data;
}

export async function fetchAuditLogs(severity?: string): Promise<AuditLogsResponse> {
  const qs = severity && severity !== 'ALL' ? `?severity=${encodeURIComponent(severity)}` : '';
  const res = await get<AuditLogsResponse>(`/api/v1/audit/logs${qs}`);
  return res.data;
}

export async function downloadAuditExport(format: 'csv' | 'json'): Promise<Blob> {
  const res = await axios.get<Blob>(`/api/v1/audit/export?format=${format}`, {
    baseURL: baseUrl(),
    responseType: 'blob',
  });
  return res.data;
}