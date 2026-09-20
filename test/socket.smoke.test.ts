import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Server } from 'socket.io';
import http from 'node:http';
import { createTelemetrySocket } from '../src/services/socket';

test('client receives a live telemetry tick from the backend-style socket server', async () => {
  const httpServer = http.createServer();
  const io = new Server(httpServer);
  let interval: NodeJS.Timeout | undefined;
  const tick = {
    timestamp: new Date().toISOString(),
    tickMs: 3000,
    sectionId: 'WR-MMCT-01',
    trains: [
      { trainId: 'T1001', trainName: 'Express', chainageKm: 87.5, latitude: null, longitude: null, speedKmh: 96, status: 'RUNNING' },
    ],
    assets: [],
  };

  io.on('connection', (socket) => {
    interval = setInterval(() => socket.emit('telemetry_tick', tick), 50);
  });

  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const port = (httpServer.address() as { port: number }).port;
  process.env.VITE_API_URL = `http://127.0.0.1:${port}`;

  const client = createTelemetrySocket();
  try {
    const received = await new Promise<typeof tick>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for tick')), 5000);
      client.on('telemetry_tick', (t: typeof tick) => {
        clearTimeout(timer);
        resolve(t);
      });
    });
    assert.equal(received.sectionId, 'WR-MMCT-01');
    assert.equal(received.trains[0].trainId, 'T1001');
    assert.equal(received.trains[0].chainageKm, 87.5);
  } finally {
    client.disconnect();
    if (interval) clearInterval(interval);
    await new Promise<void>((resolve) => io.close(() => resolve()));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    delete process.env.VITE_API_URL;
  }
});