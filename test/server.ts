import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export type Route = (req: IncomingMessage, res: ServerResponse) => void;

/** A throwaway HTTP server on a random local port, so network tests never touch the internet. */
export async function startServer(routes: Record<string, Route>, fallback?: Route) {
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    const route = routes[path] ?? fallback;
    if (route) route(req, res);
    else res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export const text =
  (body: string, type = 'text/plain', status = 200): Route =>
  (_req, res) =>
    res.writeHead(status, { 'content-type': type }).end(body);

export const html = (body: string, status = 200) => text(body, 'text/html; charset=utf-8', status);

export const redirect =
  (location: string, status = 308): Route =>
  (_req, res) =>
    res.writeHead(status, { location }).end();

/** A port with nothing listening, for connection-refused cases. */
export async function deadUrl(): Promise<string> {
  const s = await startServer({});
  await s.close();
  return s.url;
}
