// A loopback HTTP server for a fake, answering from a handler (test-tiers.md).
import {
  type IncomingMessage,
  type ServerResponse,
  createServer,
} from "node:http";
import type { AddressInfo } from "node:net";

export interface Request {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingMessage["headers"];
  body: unknown;
}

export interface Reply {
  status?: number;
  body?: unknown;
}

export interface Served {
  url: string;
  requests: Request[];
  close(): Promise<void>;
}

async function bodyOf(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  const text = Buffer.concat(chunks).toString("utf8");
  if (text === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function serve(
  handle: (request: Request) => Reply | Promise<Reply>,
): Promise<Served> {
  const requests: Request[] = [];
  const server = createServer(
    (incoming: IncomingMessage, response: ServerResponse) => {
      void (async () => {
        const url = new URL(incoming.url ?? "/", "http://127.0.0.1");
        const request: Request = {
          method: incoming.method ?? "GET",
          path: url.pathname,
          query: url.searchParams,
          headers: incoming.headers,
          body: await bodyOf(incoming),
        };
        requests.push(request);
        const reply = await handle(request);
        response.writeHead(reply.status ?? 200, {
          "Content-Type": "application/json",
        });
        response.end(
          reply.body === undefined ? "" : JSON.stringify(reply.body),
        );
      })();
    },
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address: AddressInfo | string | null = server.address();
  const port =
    typeof address === "object" && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${String(port)}`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}
