/**
 * Bun global shim for vitest on Node.js
 *
 * Provides minimal Bun.serve() implementation using Node's http module.
 * Only needed when running tests via `npx vitest run` (Node runtime).
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';

interface BunServeOptions {
  port: number;
  fetch: (req: Request) => Response | Promise<Response>;
}

interface BunServer {
  stop: () => void;
  port: number;
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  port: number,
  fetchHandler: (req: Request) => Response | Promise<Response>,
): Promise<void> {
  try {
    const url = `http://localhost:${port}${req.url ?? '/'}`;
    const method = req.method ?? 'GET';
    const headerObj: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (v) headerObj[k] = Array.isArray(v) ? v.join(', ') : v;
    }

    let bodyStr: string | undefined;
    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      const combined = Buffer.concat(chunks);
      if (combined.length > 0) bodyStr = combined.toString('utf-8');
    }

    const request = new Request(url, {
      method,
      headers: headerObj,
      body: bodyStr,
    });

    const response = await fetchHandler(request);
    const respHeaders: Record<string, string> = {};
    response.headers.forEach((v, k) => { respHeaders[k] = v; });
    res.writeHead(response.status, respHeaders);

    const contentType = respHeaders['content-type'] ?? '';

    // Handle streaming responses (SSE)
    if (response.body && contentType.includes('text/event-stream')) {
      const reader = response.body.getReader();
      let done = false;
      while (!done) {
        const result = await reader.read();
        done = result.done;
        if (!done) {
          res.write(result.value);
        }
      }
      res.end();
    } else {
      // Standard response - read full body
      const text = await response.text();
      res.end(text);
    }
  } catch {
    res.writeHead(500);
    res.end('Internal Server Error');
  }
}

function bunServe(options: BunServeOptions): BunServer {
  const { port, fetch: fetchHandler } = options;

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handleRequest(req, res, port, fetchHandler);
  });

  server.listen(port);

  return {
    stop: () => {
      server.close();
      server.closeAllConnections();
    },
    port,
  };
}

// Install global Bun shim if not already available
if (typeof globalThis.Bun === 'undefined') {
  (globalThis as Record<string, unknown>).Bun = {
    serve: bunServe,
  };
}
