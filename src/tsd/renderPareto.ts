import type { CandidatePlan } from '../types';

export interface ParetoRenderOptions {
  width: number;
  height: number;
  plans: readonly CandidatePlan[];
  selectedPlanId: string | null;
}

export interface ParetoRenderStats {
  plans: number;
  pareto: number;
  selected: boolean;
}

/**
 * 2D scatter of the CandidatePlan frontier: x = f1Delay (lost minutes, lower
 * better), y = f2Risk (residual risk, lower better). Pareto-optimal plans are
 * filled green; dominated candidates hollow grey; the selected plan gets an
 * amber ring. f3Availability scales the marker radius. Pure draw function so
 * self-checks can drive it with a mock context.
 */
export function drawParetoScatter(
  ctx: CanvasRenderingContext2D,
  opts: ParetoRenderOptions,
): ParetoRenderStats {
  const { width, height, plans } = opts;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0, 0, width, height);

  const stats: ParetoRenderStats = { plans: 0, pareto: 0, selected: false };
  if (plans.length === 0) {
    ctx.fillStyle = '#64748b';
    ctx.font = '13px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Run a solve to populate the frontier', width / 2, height / 2);
    ctx.textAlign = 'left';
    return stats;
  }

  const pad = 34;
  const xs = plans.map((p) => p.f1Delay);
  const ys = plans.map((p) => p.f2Risk);
  const xMin = Math.min(...xs, 0);
  const xMax = Math.max(...xs, 10);
  const yMin = Math.min(...ys, 0);
  const yMax = Math.max(...ys, 1);
  const sx = (v: number) => pad + ((v - xMin) / (xMax - xMin)) * (width - pad * 2);
  const sy = (v: number) => height - pad - ((v - yMin) / (yMax - yMin)) * (height - pad * 2);

  // axes
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, pad);
  ctx.lineTo(pad, height - pad);
  ctx.lineTo(width - pad, height - pad);
  ctx.stroke();
  ctx.fillStyle = '#94a3b8';
  ctx.font = '11px ui-monospace, monospace';
  ctx.fillText(`f1: lost minutes (${xMin}–${xMax})`, pad, height - pad + 16);
  ctx.fillText(`f2: residual risk (${yMin.toFixed(2)}–${yMax.toFixed(2)})`, 6, pad + 10);

  const best = plans[0];
  const rMax = 9;
  const rMin = 4;
  const rOf = (p: CandidatePlan) =>
    best ? rMin + (p.f3Availability / Math.max(1e-6, best.f3Availability)) * (rMax - rMin) : rMin;

  for (const plan of plans) {
    const x = sx(plan.f1Delay);
    const y = sy(plan.f2Risk);
    const radius = Math.max(3, Math.min(rMax, rOf(plan)));
    const isPareto = plan.status === 'PARETO_OPTIMAL';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    if (isPareto) {
      ctx.fillStyle = '#16a34a';
      ctx.fill();
      stats.pareto += 1;
    } else {
      ctx.fillStyle = '#1e293b';
      ctx.fill();
    }
    ctx.strokeStyle = isPareto ? '#4ade80' : '#64748b';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    if (opts.selectedPlanId === plan.planId) {
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(x, y, radius + 5, 0, Math.PI * 2);
      ctx.stroke();
      stats.selected = true;
    }

    ctx.fillStyle = '#cbd5e1';
    ctx.fillText(`${plan.name.slice(0, 6)} ${plan.score.toFixed(2)}`, x + radius + 4, y - 4);
    stats.plans += 1;
  }

  return stats;
}