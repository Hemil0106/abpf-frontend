import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
};

/**
 * Minimal static server for the Vite build output, with a SPA fallback to
 * index.html for non-asset routes. Uses only node:http + node:fs.
 */
export function createStaticServer(rootDir = fileURLToPath(new URL('./dist', import.meta.url))) {
  const root = join(rootDir);

  const isAsset = (pathname) => /\.[a-z0-9]{1,8}$/i.test(pathname.split('?')[0]);

  return http.createServer(async (req, res) => {
    // Use the raw request-target (not new URL, which pre-normalizes dot segments
// that the traversal guard must catch itself).
let pathname = (req.url ?? '/').split('?')[0];
    try {
      pathname = decodeURIComponent(pathname);
    } catch {
      pathname = '';
    }
    if (pathname.startsWith('/') && pathname.length > 1) pathname = pathname.slice(1);

    // Traversal guard at the trust boundary: anything escaping root is rejected
    // before any fs access. Root itself maps to index.html.
    const file = pathname === '' ? join(root, 'index.html') : join(root, pathname);
    if (!file.startsWith(root + sep)) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    try {
      const data = await readFile(file);
      const type =
        pathname === '' ? 'text/html' : MIME[extname(file)] ?? 'application/octet-stream';
      res.writeHead(200, { 'content-type': type });
      res.end(data);
    } catch {
      if (!isAsset(pathname)) {
        try {
          const indexHtml = await readFile(join(root, 'index.html'));
          res.writeHead(200, { 'content-type': 'text/html' });
          res.end(indexHtml);
          return;
        } catch {
          // fall through to 404
        }
      }
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not Found');
    }
  });
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const root = process.env.DIST_DIR ?? fileURLToPath(new URL('./dist', import.meta.url));
  const port = Number(process.env.PORT ?? 5173);
  createStaticServer(root).listen(port, () => {
    console.log(`abpf-frontend serving ${root} on :${port}`);
  });
}