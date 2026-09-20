import { useCallback, useEffect, useState } from 'react';
import type { DisruptionAlert, DisruptionKind, RegisteredDisruption, StrategyType } from '../types';
import {
  errMessage,
  fetchDisruptions,
  injectDisruption,
  resolveDisruption,
} from '../services/api';

interface DisruptionResolverProps {
  latestAlert: DisruptionAlert | null;
  onApplied: () => void;
}

const TYPES: { value: DisruptionKind; label: string }[] = [
  { value: 'SIGNAL_FAILURE', label: 'Signal Failure' },
  { value: 'TRACK_INCIDENT', label: 'Track Incident' },
  { value: 'EQUIPMENT_FAILURE', label: 'Equipment Failure' },
];

const STRATEGY_COLOR: Record<StrategyType, string> = {
  UPSTREAM_HOLDING: 'bg-sky-500',
  TSR_30KMH: 'bg-amber-500',
  EMERGENCY_BLOCK: 'bg-rose-500',
};

export function DisruptionResolver({ latestAlert, onApplied }: DisruptionResolverProps) {
  const [disruptions, setDisruptions] = useState<RegisteredDisruption[]>([]);
  const [applying, setApplying] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({ type: 'TRACK_INCIDENT' as DisruptionKind, startKm: 80, endKm: 120, description: '' });

  const refresh = useCallback(async () => {
    try {
      const list = await fetchDisruptions();
      setDisruptions(list);
      setError(null);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, latestAlert]);

  const handleInject = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      try {
        const registered = await injectDisruption({
          type: form.type,
          startKm: form.startKm,
          endKm: form.endKm,
          description: form.description || undefined,
        });
        setDisruptions((prev) => [...prev, registered]);
        setForm((f) => ({ ...f, description: '' }));
      } catch (err) {
        setError(errMessage(err));
      }
    },
    [form],
  );

  const handleApply = useCallback(
    async (eventId: string, strategyType: StrategyType) => {
      setApplying((prev) => ({ ...prev, [eventId]: true }));
      setMessage((prev) => ({ ...prev, [eventId]: '' }));
      try {
        const res = await resolveDisruption(eventId, strategyType);
        setMessage((prev) => ({
          ...prev,
          [eventId]: `${res.message} · ${res.reTimedTrainIds.length} train(s) re-timed`,
        }));
        setDisruptions((prev) =>
          prev.map((d) => (d.event.eventId === eventId ? { ...d, resolved: true } : d)),
        );
        onApplied();
      } catch (err) {
        setMessage((prev) => ({ ...prev, [eventId]: errMessage(err) }));
      } finally {
        setApplying((prev) => ({ ...prev, [eventId]: false }));
      }
    },
    [onApplied],
  );

  const active = disruptions.filter((d) => !d.resolved);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto">
      {active.length > 0 && (
        <div
          role="alert"
          className="animate-pulse rounded-lg border border-rose-500/60 bg-rose-950/60 px-4 py-3 text-sm font-semibold text-rose-200"
        >
          ⚠ {active.length} active disruption(s) — recovery strategy required
        </div>
      )}

      <form
        onSubmit={handleInject}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4"
      >
        <label className="text-xs text-slate-400">
          Type
          <select
            value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as DisruptionKind }))}
            className="mt-1 block rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-sky-500"
          >
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-400">
          From KM
          <input
            type="number"
            min={0}
            value={form.startKm}
            onChange={(e) => setForm((f) => ({ ...f, startKm: Number(e.target.value) }))}
            className="mt-1 block w-24 rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-sky-500"
          />
        </label>
        <label className="text-xs text-slate-400">
          To KM
          <input
            type="number"
            min={0}
            value={form.endKm}
            onChange={(e) => setForm((f) => ({ ...f, endKm: Number(e.target.value) }))}
            className="mt-1 block w-24 rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-sky-500"
          />
        </label>
        <label className="min-w-40 flex-1 text-xs text-slate-400">
          Description
          <input
            type="text"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="Optional context"
            className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-sky-500"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-500"
        >
          Inject Disruption
        </button>
      </form>

      {error && <p className="text-xs text-rose-400">{error}</p>}

      {loading && <p className="text-sm text-slate-500">Loading active disruptions…</p>}

      {!loading && disruptions.length === 0 && (
        <p className="text-sm text-slate-500">
          No disruptions on record. Inject one above to evaluate recovery strategies.
        </p>
      )}

      {disruptions.map((d) => (
        <div
          key={d.event.eventId}
          className={`rounded-lg border p-4 ${
            d.resolved
              ? 'border-slate-700 bg-slate-900/60 opacity-70'
              : 'border-rose-500/40 bg-slate-900'
          }`}
        >
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-rose-300">
              {d.event.type.replace('_', ' ')}
            </span>
            <span className="text-xs text-slate-400">
              {d.event.eventId} · KM {d.event.startKm}–{d.event.endKm}
            </span>
            {d.resolved && (
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-400">
                Resolved
              </span>
            )}
          </div>
          <p className="mb-3 text-sm text-slate-300">{d.event.description}</p>

          <div className="grid gap-3 sm:grid-cols-3">
            {(d.strategies.length > 0 ? d.strategies : fallbackStrategies()).map((s) => (
              <div
                key={s.strategyId}
                className="flex flex-col gap-2 rounded-lg border border-slate-700 bg-slate-950 p-3"
              >
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                  <span className={`h-2.5 w-2.5 rounded-full ${STRATEGY_COLOR[s.type]}`} />
                  {s.name}
                </div>
                <p className="text-xs text-slate-400">
                  +{s.delayMins > 0 ? s.delayMins : '?'} min delay
                  {s.affectedTrainIds.length > 0 && (
                    <> · {s.affectedTrainIds.length} train(s)</>
                  )}
                </p>
                {s.reason && <p className="text-xs leading-relaxed text-slate-500">{s.reason}</p>}
                <button
                  onClick={() => handleApply(d.event.eventId, s.type)}
                  disabled={!!applying[d.event.eventId] || d.resolved}
                  className="mt-auto rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {applying[d.event.eventId] ? 'Applying…' : 'Apply Strategy'}
                </button>
                {message[d.event.eventId] && (
                  <p
                    className={`text-xs ${
                      message[d.event.eventId].startsWith('HTTP') || message[d.event.eventId].includes('error')
                        ? 'text-rose-400'
                        : 'text-emerald-400'
                    }`}
                  >
                    {message[d.event.eventId]}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Placeholder cards for disruptions hydrated from /active (which omits details). */
function fallbackStrategies(): RegisteredDisruption['strategies'] {
  const types: StrategyType[] = ['UPSTREAM_HOLDING', 'TSR_30KMH', 'EMERGENCY_BLOCK'];
  return types.map((type) => ({
    strategyId: type,
    type,
    name: type === 'UPSTREAM_HOLDING' ? 'Upstream Holding' : type === 'TSR_30KMH' ? 'TSR 30 km/h' : 'Emergency Block Allocation',
    delayMins: 0,
    earliestFeasibleDeparture: '',
    affectedTrainIds: [],
    reason: 'Details unavailable outside a live inject — apply to retime affected trains.',
  }));
}