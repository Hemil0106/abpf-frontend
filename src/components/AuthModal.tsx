import { useEffect, useState } from 'react';
import type { Role } from '../types';
import { ROLES, roleLabel, useAuth } from '../context/AuthContext';

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
}

const rolePill = (role: Role) =>
  role === 'ADMIN'
    ? 'bg-rose-500/15 text-rose-300'
    : role === 'DISPATCHER'
      ? 'bg-emerald-500/15 text-emerald-300'
      : 'bg-slate-700 text-slate-300';

export function AuthModal({ open, onClose }: AuthModalProps) {
  const { session, login, logout } = useAuth();
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<Role>('DISPATCHER');

  useEffect(() => {
    if (open) setUsername(session?.username ?? '');
  }, [open, session]);

  if (!open) return null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    login(username || 'operator', role);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-sm font-semibold text-slate-100">Access Control</h2>

        {session ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-slate-300">
              Signed in as <b className="text-slate-100">{session.username}</b>
            </p>
            <span className={`w-fit rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase ${rolePill(session.role)}`}>
              {session.role} · {roleLabel(session.role)}
            </span>
            <button
              onClick={() => {
                logout();
                onClose();
              }}
              className="mt-1 rounded-lg bg-slate-700 px-3 py-2 text-sm text-white transition-colors hover:bg-slate-600"
            >
              Sign Out
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <label className="text-xs text-slate-400">
              Operator
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. station-master"
                autoFocus
                className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-sky-500"
              />
            </label>
            <label className="text-xs text-slate-400">
              Role tier
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-sky-500"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r} — {roleLabel(r)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-500"
            >
              Sign In
            </button>
          </form>
        )}

        <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
          Commit Plan and Apply Strategy require the DISPATCHER or ADMIN role.
        </p>
      </div>
    </div>
  );
}