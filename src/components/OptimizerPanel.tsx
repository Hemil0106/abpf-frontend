import { useCallback, useEffect, useRef, useState } from 'react';
import type { CandidatePlan } from '../types';
import { commitPlan, errMessage, solveOptimizer } from '../services/api';
import { drawParetoScatter } from '../tsd/renderPareto';

interface OptimizerPanelProps {
  divisionId: string | null;
  onCommitted: () => void;
}

type Weights = { w1: number; w2: number; w3: number };

const PRESETS: { label: string; weights: Weights }[] = [
  { label: 'Delay Priority', weights: { w1: 0.7, w2: 0.15, w3: 0.15 } },
  { label: 'Safety First', weights: { w1: 0.15, w2: 0.7, w3: 0.15 } },
  { label: 'Balanced', weights: { w1: 0.4, w2: 0.35, w3: 0.25 } },
];

const WEIGHT_META = [
  { key: 'w1' as const, label: 'w1 · minimize delay' },
  { key: 'w2' as const, label: 'w2 · minimize risk' },
  { key: 'w3' as const, label: 'w3 · maximize availability' },
];

export function OptimizerPanel({ divisionId, onCommitted }: OptimizerPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const plansRef = useRef<CandidatePlan[]>([]);
  const selectedRef = useRef<string | null>(null);

  const [weights, setWeights] = useState<Weights>({ w1: 0.4, w2: 0.35, w3: 0.25 });
  const [plans, setPlans] = useState<CandidatePlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [solving, setSolving] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  plansRef.current = plans;
  selectedRef.current = selectedPlanId;

  const runSolve = useCallback(async () => {
    if (!divisionId) return;
    setSolving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await solveOptimizer(divisionId, weights);
      setPlans(res.plans);
      setSelectedPlanId(null);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSolving(false);
    }
  }, [divisionId, weights]);

  const handleCommit = useCallback(async () => {
    if (!selectedPlanId) return;
    const plan = plansRef.current.find((p) => p.planId === selectedPlanId);
    if (!plan) return;
    setCommitting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await commitPlan(plan, weights);
      setSuccess(`${res.message} — ${res.reTimedTrainIds.length} train(s) re-timed`);
      onCommitted();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setCommitting(false);
    }
  }, [selectedPlanId, weights, onCommitted]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const render = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0) return;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawParetoScatter(ctx, {
        width: rect.width,
        height: rect.height,
        plans: plansRef.current,
        selectedPlanId: selectedRef.current,
      });
    };
    render();
    const observer = new ResizeObserver(render);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const selectedPlan = plans.find((p) => p.planId === selectedPlanId) ?? null;

  return (
    <div className="flex h-full gap-4">
      <div className="flex w-72 shrink-0 flex-col gap-5 overflow-y-auto rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div>
          <h2 className="mb-3 text-sm font-semibold text-slate-200">MOMINP Weights</h2>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                onClick={() => setWeights(preset.weights)}
                className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                  weights.w1 === preset.weights.w1 &&
                  weights.w2 === preset.weights.w2 &&
                  weights.w3 === preset.weights.w3
                    ? 'border-sky-500 bg-sky-600 text-white'
                    : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-sky-500'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {WEIGHT_META.map(({ key, label }) => (
          <label key={key} className="block text-xs text-slate-400">
            {label}
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={weights[key]}
              onChange={(e) =>
                setWeights((prev) => ({ ...prev, [key]: Number(e.target.value) }))
              }
              className="mt-1 w-full accent-sky-500"
            />
            <span className="tabular-nums text-slate-300">{weights[key].toFixed(2)}</span>
          </label>
        ))}

        <button
          onClick={runSolve}
          disabled={solving || !divisionId}
          className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {solving ? 'Solving…' : 'Run MOMINP Solve'}
        </button>

        {error && <p className="text-xs text-rose-400">{error}</p>}
        {success && <p className="text-xs text-emerald-400">{success}</p>}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-800 bg-slate-950">
          <canvas ref={canvasRef} className="block h-full w-full" />
        </div>

        {selectedPlan && (
          <div className="rounded-lg border border-amber-500/40 bg-slate-900 p-4">
            <div className="mb-2 flex items-center gap-3">
              <h3 className="text-sm font-semibold text-slate-200">
                {selectedPlan.name} <span className="text-slate-500">· {selectedPlan.planId}</span>
              </h3>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                  selectedPlan.status === 'PARETO_OPTIMAL'
                    ? 'bg-emerald-500/15 text-emerald-400'
                    : 'bg-slate-700 text-slate-300'
                }`}
              >
                {selectedPlan.status.replace('_', ' ')}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-400 sm:grid-cols-4">
              <span>score: <b className="text-slate-200">{selectedPlan.score.toFixed(4)}</b></span>
              <span>delay: <b className="text-slate-200">+{selectedPlan.delayMins} min</b></span>
              <span>risk: <b className="text-slate-200">{selectedPlan.f2Risk.toFixed(2)}</b></span>
              <span>trains: <b className="text-slate-200">{selectedPlan.trainIds.length}</b></span>
            </div>
            <button
              onClick={handleCommit}
              disabled={committing}
              className="mt-3 rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {committing ? 'Committing…' : 'Commit Plan'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}