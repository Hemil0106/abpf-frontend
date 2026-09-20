import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { baseUrl, fetchSections, selectSection } from '../src/services/api';

const ZONES = {
  zones: [
    {
      code: 'WR',
      name: 'Western Railway',
      divisions: [
        {
          divisionId: 'WR-MMCT-01',
          divisionName: 'WR',
          zone: 'WR',
          zoneName: 'Western Railway',
          sectionName: 'Mumbai Central–Vadodara',
          displayLabel: 'MMCT–BRC',
          startKm: 0,
          endKm: 320,
          stations: [],
        },
      ],
    },
  ],
};

const ACTIVE = {
  activeSection: {
    divisionId: 'WR-MMCT-01',
    divisionName: 'WR',
    zone: 'WR',
    zoneName: 'Western Railway',
    sectionName: 'Mumbai Central–Vadodara',
    displayLabel: 'MMCT–BRC',
    startKm: 0,
    endKm: 320,
    stations: [],
  },
  stations: [],
  trains: [],
  assets: [{ assetId: 'A1', assetType: 'POINT', locationKm: 100, failureRiskScore: 0.5 }],
  blocks: [],
};

test('baseUrl falls back to localhost:5000 when no env is set', () => {
  delete process.env.VITE_API_URL;
  assert.equal(baseUrl(), 'http://localhost:5000');
});

test('api client talks to the live-style backend over HTTP', async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.method === 'POST' && req.url === '/api/v1/data/select-section') {
      res.end(JSON.stringify(ACTIVE));
    } else if (req.url === '/api/v1/sections') {
      res.end(JSON.stringify(ZONES));
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  process.env.VITE_API_URL = `http://127.0.0.1:${port}`;

  try {
    const zones = await fetchSections();
    assert.equal(zones.length, 1);
    assert.equal(zones[0].divisions[0].divisionId, 'WR-MMCT-01');
    const payload = await selectSection('WR-MMCT-01');
    assert.equal(payload.activeSection?.sectionName, 'Mumbai Central–Vadodara');
    assert.equal(payload.assets.length, 1);
  } finally {
    delete process.env.VITE_API_URL;
    server.close();
  }
});