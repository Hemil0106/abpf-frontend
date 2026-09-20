import { useCallback, useEffect, useState } from 'react';
import type { DisruptionAlert, TelemetryTick, ViewId, ZoneGroup } from './types';
import { fetchActiveSection, fetchSections, selectSection } from './services/api';
import { createTelemetrySocket } from './services/socket';
import { addActivity } from './services/activityLog';
import { Header } from './components/Header';
import { HomePage } from './components/HomePage';
import { Toasts } from './components/Toasts';
import { TimeSpaceChart } from './components/TimeSpaceChart';
import { NetworkMap } from './components/NetworkMap';
import { OptimizerPanel } from './components/OptimizerPanel';
import { DisruptionResolver } from './components/DisruptionResolver';
import { AuditLogs } from './components/AuditLogs';

export function App() {
  const [zones, setZones] = useState<ZoneGroup[]>([]);
  const [activeDivisionId, setActiveDivisionId] = useState<string | null>(null);
  const [payload, setPayload] = useState<Awaited<ReturnType<typeof fetchActiveSection>> | null>(null);
  const [activeView, setActiveView] = useState<ViewId>('home');
  const [socketConnected, setSocketConnected] = useState(false);
  const [alerts, setAlerts] = useState<DisruptionAlert[]>([]);
  const [live, setLive] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const z = await fetchSections();
        if (cancelled) return;
        setZones(z);
        const p = await fetchActiveSection();
        if (cancelled) return;
        setPayload(p);
        if (p.activeSection) setActiveDivisionId(p.activeSection.divisionId);
      } catch (err) {
        console.error('Failed to load initial data', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const socket = createTelemetrySocket();
    socket.on('connect', () => {
      setSocketConnected(true);
      addActivity('SYSTEM', 'Telemetry socket connected');
    });
    socket.on('disconnect', () => {
      setSocketConnected(false);
      addActivity('SYSTEM', 'Telemetry socket disconnected');
    });
    socket.on('telemetry_tick', (tick: TelemetryTick) => {
      const next: Record<string, number> = {};
      for (const train of tick.trains) next[train.trainId] = train.chainageKm;
      setLive(next);
      addActivity('TELEMETRY', `Live tick — ${tick.trains.length} train(s), ${tick.assets.length} asset(s)`);
    });
    socket.on('disruption_alert', (alert: DisruptionAlert) => {
      setAlerts((prev) => [alert, ...prev].slice(0, 8));
      addActivity('ALERT', `${alert.type}: ${alert.message}`);
    });
    const timer = window.setInterval(() => socket.emit('telemetry:now'), 30_000);
    return () => {
      window.clearInterval(timer);
      socket.disconnect();
    };
  }, []);

  const handleSelectDivision = useCallback((divisionId: string) => {
    setActiveDivisionId(divisionId);
    setLive({});
    addActivity('SECTION', `Switched active section to ${divisionId}`);
    (async () => {
      try {
        const p = await selectSection(divisionId);
        setPayload(p);
      } catch (err) {
        console.error('Failed to select section', err);
      }
    })();
  }, []);

  const handleDataChanged = useCallback(() => {
    (async () => {
      if (!activeDivisionId) return;
      try {
        const p = await selectSection(activeDivisionId);
        setPayload(p);
        setLive({});
      } catch (err) {
        console.error('Failed to refresh data', err);
      }
    })();
  }, [activeDivisionId]);

  const assets = payload?.assets ?? [];

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-100">
      <Header
        zones={zones}
        activeDivisionId={activeDivisionId}
        onSelectDivision={handleSelectDivision}
        socketConnected={socketConnected}
        activeView={activeView}
        onViewChange={setActiveView}
      />

      {alerts.length > 0 && (
        <div className="border-b border-slate-800 bg-slate-900 px-5 py-2">
          {alerts.map((a, i) => (
            <div key={`${a.timestamp}-${i}`} className="flex items-center gap-2 text-xs">
              <span className="h-2 w-2 shrink-0 rounded-full bg-rose-500" />
              <span className="text-rose-300">{a.type}</span>
              <span className="truncate text-slate-300">{a.message}</span>
            </div>
          ))}
        </div>
      )}

      <main className="flex min-h-0 flex-1 flex-col gap-4 p-5">
        {activeView === 'home' ? (
          <HomePage data={payload} live={live} />
        ) : activeView === 'optimizer' ? (
          <OptimizerPanel divisionId={activeDivisionId} onCommitted={handleDataChanged} />
        ) : activeView === 'disruption' ? (
          <DisruptionResolver latestAlert={alerts[0] ?? null} onApplied={handleDataChanged} />
        ) : activeView === 'audit' ? (
          <AuditLogs />
        ) : !payload ? (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
            Connecting to backend…
          </div>
        ) : activeView === 'timespace' ? (
          <TimeSpaceChart
            startKm={payload.activeSection?.startKm ?? 0}
            endKm={payload.activeSection?.endKm ?? 100}
            activeSection={payload.activeSection}
            stations={payload.stations}
            trains={payload.trains}
            blocks={payload.blocks}
            assets={assets}
            live={live}
          />
        ) : (
          <NetworkMap
            zones={zones}
            activeDivisionId={activeDivisionId}
            onSelectDivision={handleSelectDivision}
          />
        )}
      </main>

      <Toasts />
    </div>
  );
}