import { vi } from 'vitest';

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** Raw request body bytes (undefined for GET). */
  body?: Uint8Array;
  /** Body parsed as JSON (throws if not JSON). */
  json(): unknown;
}

export type MockFetch = typeof globalThis.fetch & {
  requests: RecordedRequest[];
  mock: ReturnType<typeof vi.fn>['mock'];
};

function normalizeHeaders(init?: RequestInit): Record<string, string> {
  const out: Record<string, string> = {};
  const headers = init?.headers;
  if (!headers) return out;
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      out[key.toLowerCase()] = value;
    });
  } else if (Array.isArray(headers)) {
    for (const [key, value] of headers) out[key.toLowerCase()] = value;
  } else {
    for (const [key, value] of Object.entries(headers)) out[key.toLowerCase()] = value;
  }
  return out;
}

function normalizeBody(init?: RequestInit): Uint8Array | undefined {
  const body = init?.body;
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  throw new Error(`mock-fetch: unsupported body type ${typeof body}`);
}

/**
 * Builds an injectable `fetch` that records every request and answers from a
 * queue (one responder per call; the last responder repeats).
 */
export function createMockFetch(...responders: Array<() => Response>): MockFetch {
  const requests: RecordedRequest[] = [];
  let call = 0;
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = normalizeBody(init);
    requests.push({
      url,
      method: init?.method ?? 'GET',
      headers: normalizeHeaders(init),
      body,
      json() {
        if (!body) throw new Error('no body');
        return JSON.parse(new TextDecoder().decode(body));
      },
    });
    const responder = responders[Math.min(call, responders.length - 1)];
    call++;
    if (!responder) throw new Error('mock-fetch: no responder configured');
    return responder();
  });
  const mocked = fn as unknown as MockFetch;
  mocked.requests = requests;
  return mocked;
}

/** Web ReadableStream that emits the given chunks then closes. */
export function chunkedStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[i];
      if (chunk === undefined) {
        controller.close();
        return;
      }
      i++;
      controller.enqueue(chunk);
    },
  });
}

/** Web ReadableStream that emits `chunks` then errors with `err`. */
export function erroringStream(chunks: Uint8Array[], err: Error): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[i];
      if (chunk === undefined) {
        controller.error(err);
        return;
      }
      i++;
      controller.enqueue(chunk);
    },
  });
}

/** 200 response streaming raw PCM chunks with a `audio/pcm;rate=N` content type. */
export function pcmResponse(
  chunks: Uint8Array[],
  rate = 24000,
  headers: Record<string, string> = {},
): Response {
  return new Response(chunkedStream(chunks), {
    status: 200,
    headers: { 'Content-Type': `audio/pcm;rate=${rate}`, ...headers },
  });
}

/** Serializes SSE events to wire format. */
export function sseBody(events: Array<{ event: string; data: unknown }>): string {
  return events.map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join('');
}

/** 200 text/event-stream response from a single string body. */
export function sseResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

/** 200 text/event-stream response delivered as the given byte chunks. */
export function sseChunkedResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(chunkedStream(chunks.map((c) => encoder.encode(c))), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

/** JSON response with arbitrary status. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Collects a Node readable stream into one Buffer. */
export async function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}
