import { riskColor, riskLevel } from './tsdMath';

export interface ZoneNode {
  code: string;
  label: string;
  x: number;
  y: number;
  active: boolean;
  risk: number | null;
  divisionCount: number;
  color: string;
}

export interface NetworkRenderOptions {
  width: number;
  height: number;
  nodes: ZoneNode[];
  /** [zoneA, zoneB] corridor pairs. */
  corridors: [string, string][];
}

export interface NetworkRenderStats {
  nodes: number;
  corridors: number;
}

const DEFAULT_COLOR: Record<string, string> = {
  CR: '#38bdf8',
  WR: '#22d3ee',
  NWR: '#a3e635',
  SCR: '#f59e0b',
};

/**
 * Schematic 2D network map: zone nodes + corridors tinted by the active
 * section's asset risk (colored by the riskier endpoint). Pure draw function
 * so self-checks can drive it with a mock context.
 */
export function drawNetworkMap(ctx: CanvasRenderingContext2D, opts: NetworkRenderOptions): NetworkRenderStats {
  const { width, height } = opts;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0, 0, width, height);

  const nodeOf = (code: string) => opts.nodes.find((n) => n.code === code);

  for (const [aCode, bCode] of opts.corridors) {
    const a = nodeOf(aCode);
    const b = nodeOf(bCode);
    if (!a || !b) continue;
    const risk = Math.max(a.risk ?? 0, b.risk ?? 0);
    ctx.strokeStyle = risk > 0 ? hexA(riskColor(risk), 0.55) : 'rgba(148, 163, 184, 0.35)';
    ctx.lineWidth = risk > 0 ? 4 : 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  ctx.font = '12px ui-monospace, monospace';
  for (const node of opts.nodes) {
    const fill = node.risk != null ? riskColor(node.risk) : DEFAULT_COLOR[node.code] ?? '#64748b';
    // node halo for the active zone
    if (node.active) {
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(node.x, node.y, 22, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(node.x, node.y, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#e2e8f0';
    ctx.textAlign = 'center';
    ctx.fillText(node.code, node.x, node.y + 34);
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(`${node.divisionCount} division(s)`, node.x, node.y + 48);
    ctx.textAlign = 'left';
  }

  return { nodes: opts.nodes.length, corridors: opts.corridors.length };
}

function hexA(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}