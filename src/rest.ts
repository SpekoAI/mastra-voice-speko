import { SpekoVoiceError } from './errors.js';

export type FetchImpl = typeof globalThis.fetch;

/** POST a JSON body. Throws SpekoVoiceError on non-2xx. */
export async function postJson(
  fetchImpl: FetchImpl,
  url: string,
  body: unknown,
  headers: Record<string, string>,
): Promise<Response> {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await SpekoVoiceError.fromResponse(res);
  return res;
}

/** POST raw bytes. Throws SpekoVoiceError on non-2xx. */
export async function postBytes(
  fetchImpl: FetchImpl,
  url: string,
  body: Uint8Array,
  headers: Record<string, string>,
): Promise<Response> {
  const res = await fetchImpl(url, { method: 'POST', headers, body: body as BodyInit });
  if (!res.ok) throw await SpekoVoiceError.fromResponse(res);
  return res;
}

/** GET a JSON resource. Throws SpekoVoiceError on non-2xx. */
export async function getJson<T>(
  fetchImpl: FetchImpl,
  url: string,
  headers: Record<string, string>,
): Promise<T> {
  const res = await fetchImpl(url, { method: 'GET', headers });
  if (!res.ok) throw await SpekoVoiceError.fromResponse(res);
  return (await res.json()) as T;
}

export interface SseEvent {
  event: string;
  data: string;
}

/**
 * Minimal SSE reader: splits the byte stream on blank lines, reads `event:`
 * and `data:` fields (multi-line `data:` joins with '\n'). Handles payloads
 * split across network chunks.
 */
export async function* parseSseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic scanner loop
      while ((sep = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep).replace(/^\r?\n\r?\n/, '');
        const event = parseSseBlock(block);
        if (event) yield event;
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      const event = parseSseBlock(buffer);
      if (event) yield event;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseSseBlock(block: string): SseEvent | undefined {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).replace(/^ /, ''));
    }
  }
  if (dataLines.length === 0) return undefined;
  return { event, data: dataLines.join('\n') };
}
