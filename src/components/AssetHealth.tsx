import { useMemo, useState } from 'react';
import type { AssetDto } from '../types';

interface AssetHealthProps {
  assets: readonly AssetDto[];
}

const HIGH_RISK = 0.6;
const HOTSPOT = 0.8;

function levelOf(risk: number): { label: string; color: string } {
  if (risk > 0.6) return { label: 'CRITICAL', color: 'text-[#E53935]' };
  if (risk >= 0.35) return { label: 'CAUTION', color: 'text-[#FFC107]' };
  return { label: 'CLEAR', color: 'text-[#4CAF50]' };
}

function MetricCard({ title, value, accent }: { title: string; value: string; accent: string }) {
  return (
    <div className="rounded border border-[#2A3550] bg-[#1E2638] px-3.5 py-3">
      <div className="text-[11px] text-[#9E9E9E]">{title}</div>
      <div className={`mt-1 text-[22px] font-bold tabular-nums ${accent}`}>{value}</div>
    </div>
  );
}

export function AssetHealth({ assets }: AssetHealthProps) {
  const types = useMemo(() => ['ALL', ...Array.from(new Set(assets.map((a) => a.assetType)))], [assets]);
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [riskOrder, setRiskOrder] = useState<'desc' | 'asc'>('desc');

  const rows = useMemo(() => {
    const filtered = typeFilter === 'ALL' ? assets : assets.filter((a) => a.assetType === typeFilter);
    return [...filtered].sort((a, b) =>
      riskOrder === 'desc' ? b.failureRiskScore - a.failureRiskScore : a.failureRiskScore - b.failureRiskScore,
    );
  }, [assets, typeFilter, riskOrder]);

  const total = assets.length;
  const highRisk = assets.filter((a) => a.failureRiskScore > HIGH_RISK).length;
  const hotspots = assets.filter((a) => a.failureRiskScore > HOTSPOT).length;
  const avgRul = total === 0 ? 0 : Math.round(assets.reduce((s, a) => s + a.rulDays, 0) / total);

  const selected = selectedId ? assets.find((a) => a.assetId === selectedId) ?? null : null;

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-base font-bold text-[#E0E0E0]">Asset Health Monitoring & RUL Prognostics</div>
          <div className="mt-0.5 text-[11px] text-[#9E9E9E]">
            Live risk scoring and remaining useful life across the division&apos;s track assets
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] text-[#9E9E9E]">Asset Type Filter</div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="mt-1 rounded border border-[#2A3550] bg-[#0F172A] px-2 py-1 text-xs text-[#E0E0E0] outline-none focus:border-[#2196F3]"
          >
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <MetricCard title="Total Assets" value={String(total)} accent="text-[#2196F3]" />
        <MetricCard title="High Risk Count (R_i > 0.60)" value={String(highRisk)} accent="text-[#E53935]" />
        <MetricCard title="Critical Hotspots (R_i > 0.80)" value={String(hotspots)} accent="text-[#FFC107]" />
        <MetricCard title="Avg System RUL" value={`${avgRul} d`} accent="text-[#4CAF50]" />
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="min-w-0 flex-1 overflow-hidden rounded border border-[#2A3550] bg-[#1E2638]">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[#2A3550] text-[11px] text-[#9E9E9E]">
                <th className="px-3 py-2 font-medium">Asset ID</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 text-right font-medium">Location KM</th>
                <th className="px-3 py-2 text-right font-medium">P(Fail)</th>
                <th className="px-3 py-2 text-right font-medium">RUL (d)</th>
                <th className="px-3 py-2 text-right font-medium">
                  <button
                    onClick={() => setRiskOrder(riskOrder === 'desc' ? 'asc' : 'desc')}
                    className="inline-flex items-center gap-1 hover:text-white"
                  >
                    Risk {riskOrder === 'desc' ? '↓' : '↑'}
                  </button>
                </th>
                <th className="px-3 py-2 font-medium">Level</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const lvl = levelOf(a.failureRiskScore);
                return (
                  <tr
                    key={a.assetId}
                    onClick={() => setSelectedId(a.assetId)}
                    className={`border-b border-[#2A3550]/50 transition-colors ${
                      selectedId === a.assetId ? 'bg-[#23335C]' : 'hover:bg-[#212B40]'
                    }`}
                  >
                    <td className="px-3 py-2 text-[#E0E0E0]">{a.assetId}</td>
                    <td className="px-3 py-2">{a.assetType}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{a.locationKm}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{a.failureProbability.toFixed(3)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{a.rulDays}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{a.failureRiskScore.toFixed(3)}</td>
                    <td className={`px-3 py-2 font-semibold ${lvl.color}`}>{lvl.label}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="w-60 shrink-0 rounded border border-[#2A3550] bg-[#1E2638] p-4">
          {selected ? (
            <>
              <div className="text-sm font-bold text-[#E0E0E0]">{selected.assetId}</div>
              <div className="mt-0.5 text-[11px] text-[#9E9E9E]">{selected.assetType}</div>
              <div className="mt-3 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-[#9E9E9E]">Location</span>
                  <span className="tabular-nums text-[#E0E0E0]">KM {selected.locationKm}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#9E9E9E]">Failure P</span>
                  <span className="tabular-nums text-[#E0E0E0]">{selected.failureProbability.toFixed(3)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#9E9E9E]">Consequence</span>
                  <span className="tabular-nums text-[#E0E0E0]">{selected.consequenceScore}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#9E9E9E]">RUL</span>
                  <span className="tabular-nums text-[#E0E0E0]">{selected.rulDays} d</span>
                </div>
              </div>
              <div className="mt-4">
                <div className="pb-1 text-[11px] text-[#9E9E9E]">
                  Risk Score <span className="font-bold text-[#E0E0E0]">{selected.failureRiskScore.toFixed(3)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded bg-[#121824]">
                  <div
                    className="h-full rounded"
                    style={{
                      width: `${Math.min(100, selected.failureRiskScore * 100)}%`,
                      backgroundColor: levelOf(selected.failureRiskScore).label === 'CRITICAL' ? '#E53935' : levelOf(selected.failureRiskScore).label === 'CAUTION' ? '#FFC107' : '#4CAF50',
                    }}
                  />
                </div>
                <div className={`mt-2 text-[11px] font-semibold ${levelOf(selected.failureRiskScore).color}`}>
                  {levelOf(selected.failureRiskScore).label}
                </div>
              </div>
            </>
          ) : (
            <div className="text-xs text-[#9E9E9E]">Select an asset row to inspect its RUL prognosis.</div>
          )}
        </div>
      </div>
    </div>
  );
}