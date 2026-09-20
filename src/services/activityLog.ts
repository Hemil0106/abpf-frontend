import type { ActivityLine, ActivitySource } from '../types';

const MAX_LINES = 50;

const lines: ActivityLine[] = [];
const subscribers = new Set<(line: ActivityLine) => void>();
let nextId = 0;

function emit(line: ActivityLine) {
  for (const fn of subscribers) fn(line);
}

/** Append a timestamped operational event; the newest 50 lines are kept. */
export function addActivity(source: ActivitySource, message: string): ActivityLine {
  lines.push({ id: ++nextId, ts: new Date().toLocaleTimeString(), source, message });
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
  const line = lines[lines.length - 1];
  emit(line);
  return line;
}

export function activitySnapshot(): ActivityLine[] {
  return [...lines];
}

export function subscribeActivity(fn: (line: ActivityLine) => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}