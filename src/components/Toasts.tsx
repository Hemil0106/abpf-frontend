import { useAuth, type ToastTone } from '../context/AuthContext';

const TONE_STYLES: Record<ToastTone, string> = {
  info: 'border-sky-500/40 text-sky-200',
  warn: 'border-amber-500/50 text-amber-200',
  error: 'border-rose-500/60 text-rose-200',
  success: 'border-emerald-500/50 text-emerald-200',
};

export function Toasts() {
  const { toasts, dismissToast } = useAuth();
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-4 top-16 z-50 flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismissToast(t.id)}
          className={`pointer-events-auto rounded-lg border bg-slate-900/95 px-3 py-2 text-left text-xs shadow-lg backdrop-blur ${TONE_STYLES[t.tone]}`}
        >
          {t.message}
        </button>
      ))}
    </div>
  );
}