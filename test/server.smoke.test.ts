import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { createStaticServer } from '../server.mjs';

function listen(server: ReturnType<typeof createStaticServer>) {
  return new Promise<number>((resolve) => {
    server.listen(0, () => resolve((server.address() as { port: number }).port));
  });
}

function close(server: ReturnType<typeof createStaticServer>) {
  return new Promise<void>((resolve) => server.close(() => resolve()));
}

/**
 * Sends a raw HTTP/1.1 request over a socket. Node's http server passes the
 * request-target through verbatim (no WHATWG dot-segment normalization), which
 * is exactly the path that must hit the traversal guard.
 */
function rawGet(port: number, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1');
    let data = '';
    sock.on('connect', () =>
      sock.write(`GET ${path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`),
    );
    sock.on('data', (chunk) => (data += chunk.toString()));
    sock.on('end', () => resolve(data));
    sock.on('error', reject);
  });
}

test('static server: serves index, assets, SPA fallback, egress guard', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'abpf-static-'));
  await writeFile(join(dir, 'index.html'), '<html>abpf</html>');
  await writeFile(join(dir, 'app.js'), 'console.log(1)');

  const server = createStaticServer(dir);
  const port = await listen(server);
  try {
    const base = `http://127.0.0.1:${port}`;

    let res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    assert.match(await res.text(), /abpf/);

    res = await fetch(`${base}/app.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /javascript/);

    res = await fetch(`${base}/some/client/route`);
    assert.equal(res.status, 200, 'SPA routes must fall back to index.html');
    assert.match(await res.text(), /abpf/);

    const raw = await rawGet(port, '/%2e%2e/secret');
    assert.match(raw, /^HTTP\/1\.1 404/, 'path traversal must be rejected');
  } finally {
    await close(server);
  }
});