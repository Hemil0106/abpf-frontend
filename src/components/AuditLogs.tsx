import { useCallback, useEffect, useState } from 'react';
import type { AuditEntry, AuditSeverity } from '../types';
import { downloadAuditExport, errMessage, fetchAuditLogs } from '../services/api';

const SEVERITIES: (AuditSeverity | 'ALL')[] = ['ALL', 'INFO', 'WARNING', 'ERROR', 'CRITICAL', 'SYSTEM_OVERRIDE'];

const SEVERITY_STYLE: Record<AuditSeverity, string> = {
  INFO: 'bg-sky-500/15 text-sky-400',
  WARNING: 'bg-amber-500/15 text-amber-400',
  ERROR: 'bg-rose-500/15 text-rose-400',
  CRITICAL: 'bg-rose-600/20 text-rose-300',
  SYSTEM_OVERRIDE: 'bg-purple-500/15 text-purple-400',
};

export function AuditLogs() {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [search, setSearch] = useState('');
  const [severity, setSeverity] = useState<AuditSeverity | 'ALL'>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<'csv' | 'json' | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAuditLogs(severity);
      setLogs(res.logs);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setLoading(false);
    }
  }, [severity]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const exportFile = useCallback(async (format: 'csv' | 'json') => {
    setDownloading(format);
    setError(null);
    try {
      const blob = await downloadAuditExport(format);
      const name = format === 'csv' ? 'audit-shift-report.csv' : 'audit-shift-report.json';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setDownloading(null);
    }
  }, []);

  const q = search.trim().toLowerCase();
  const filtered = logs.filter((l) => {
    if (q === '') return true;
    return [l.message, l.category, String(l.id)]
      .concat(l.details == null ? [] : [JSON.stringify(l.details)])
      .some((field) => field.toLowerCase().includes(q));
  });

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search message, category or id…"
          className="min-w-64 flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500"
        />
        <label className="flex items-center gap-2 text-xs text-slate-400">
          Severity
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as AuditSeverity | 'ALL')}
            className="rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-slate-100 outline-none focus:border-sky-500"
          >
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => void refresh()}
          disabled={loading}
          className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300 transition-colors hover:border-sky-500 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        <button
          onClick={() => void exportFile('csv')}
          disabled={downloading !== null}
          className="rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-500 disabled:opacity-50"
        >
          {downloading === 'csv' ? 'Exporting…' : 'Export CSV'}
        </button>
        <button
          onClick={() => void exportFile('json')}
          disabled={downloading !== null}
          className="rounded-md bg-purple-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-500 disabled:opacity-50"
        >
          {downloading === 'json' ? 'Exporting…' : 'Export JSON Shift Report'}
        </button>
      </div>

      {error && <p className="text-xs text-rose-400">{error}</p>}

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-800 bg-slate-900">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 bg-slate-800 text-[10px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-3 py-2">Timestamp</th>
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Module</th>
              <th className="px-3 py-2">Severity</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {filtered.map((l) => (
              <tr key={l.id} className="hover:bg-slate-800/50">
                <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-400">
                  {new Date(l.timestamp).toLocaleString()}
                </td>
                <td className="px-3 py-2 text-slate-300">system</td>
                <td className="px-3 py-2 text-slate-300">SYSTEM</td>
                <td className="px-3 py-2 text-slate-300">{l.category}</td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${SEVERITY_STYLE[l.severity] ?? SEVERITY_STYLE.INFO}`}
                  >
                    {l.severity}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-200">{l.message}</td>
                <td className="max-w-72 truncate px-3 py-2 font-mono text-slate-500">
                  {l.details == null ? '—' : JSON.stringify(l.details)}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-slate-500">
                  {loading ? 'Loading audit trail…' : 'No entries match the current filter.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}