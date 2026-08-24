import { describe, expect, it } from 'vitest';
import { SpekoVoiceError } from '../errors.js';
import { SpekoVoice } from '../speko-voice.js';
import { webToNodeStream } from '../stream-utils.js';
import { pcmResponse, sseBody, sseResponse } from './helpers/mock-fetch.js';

const KEY = 'test-key';

function pcm(bytes: number): Uint8Array[] {
  return [new Uint8Array(bytes).fill(7)];
}

describe('abortSignal', () => {
  it('speak() passes the exact AbortSignal instance to fetch', async () => {
    const seen: Array<AbortSignal | null | undefined> = [];
    const fetchImpl: typeof globalThis.fetch = async (_input, init) => {
      seen.push(init?.signal);
      return pcmResponse(pcm(4));
    };
    const voice = new SpekoVoice({ apiKey: KEY, fetch: fetchImpl });
    const controller = new AbortController();
    await voice.speak('hi', { abortSignal: controller.signal });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(controller.signal);
  });

  it('listen() passes the exact AbortSignal instance to fetch', async () => {
    const seen: Array<AbortSignal | null | undefined> = [];
    const fetchImpl: typeof globalThis.fetch = async (_input, init) => {
      seen.push(init?.signal);
      return sseResponse(sseBody([{ event: 'done', data: { text: 'ok' } }]));
    };
    const voice = new SpekoVoice({ apiKey: KEY, fetch: fetchImpl });
    const controller = new AbortController();
    const text = await voice.listen(Buffer.from([1, 2]), { abortSignal: controller.signal });
    expect(text).toBe('ok');
    expect(seen[0]).toBe(controller.signal);
  });

  it('an already-aborted signal rejects speak() like fetch would', async () => {
    const fetchImpl: typeof globalThis.fetch = async (_input, init) => {
      if (init?.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
      return pcmResponse(pcm(4));
    };
    const voice = new SpekoVoice({ apiKey: KEY, fetch: fetchImpl });
    const controller = new AbortController();
    controller.abort();
    await expect(voice.speak('hi', { abortSignal: controller.signal })).rejects.toThrowError(/aborted/i);
  });
});

describe('webToNodeStream teardown and backpressure', () => {
  it('destroying the node stream cancels the web reader', async () => {
    let cancelled = false;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024));
      },
      cancel() {
        cancelled = true;
      },
    });
    const node = webToNodeStream(endless);
    await new Promise<void>((resolve) => {
      node.once('data', () => {
        node.destroy();
        resolve();
      });
    });
    // teardown is async: give the pump loop a tick to observe the close
    await new Promise((r) => setTimeout(r, 20));
    expect(cancelled).toBe(true);
  });

  it('delivers every byte in order through backpressure (writes past the highWaterMark)', async () => {
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < 128; i++) {
      const c = new Uint8Array(1024);
      c.fill(i);
      chunks.push(c);
    }
    let i = 0;
    const source = new ReadableStream<Uint8Array>({
      pull(controller) {
        const c = chunks[i];
        if (c === undefined) {
          controller.close();
          return;
        }
        i++;
        controller.enqueue(c);
      },
    });
    const node = webToNodeStream(source);
    // slow consumer: yield to the event loop between reads
    const received: Buffer[] = [];
    for await (const chunk of node) {
      received.push(Buffer.from(chunk as Uint8Array));
      await new Promise((r) => setImmediate(r));
    }
    const all = Buffer.concat(received);
    expect(all.byteLength).toBe(128 * 1024);
    for (let j = 0; j < 128; j++) {
      expect(all[j * 1024]).toBe(j);
    }
  });
});

describe('SpekoVoiceError.fromResponse fallbacks', () => {
  it('surfaces the body snippet when statusText is empty and the body is not JSON', async () => {
    const res = new Response('<html>upstream connect error</html>', { status: 502 });
    // Response constructed in Node has statusText '' unless provided
    const err = await SpekoVoiceError.fromResponse(res);
    expect(err.status).toBe(502);
    expect(err.message).toContain('upstream connect error');
  });

  it('uses a JSON {message, code} body (router error surface)', async () => {
    const res = new Response(
      JSON.stringify({ message: "store: property 'store' is unsupported", code: 'wrong_api_format' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
    const err = await SpekoVoiceError.fromResponse(res);
    expect(err.message).toContain("property 'store' is unsupported");
    expect(err.code).toBe('wrong_api_format');
  });
});

describe('listen() releases the SSE body after done', () => {
  it('cancels the response stream once the done event returns', async () => {
    let cancelled = false;
    const encoder = new TextEncoder();
    const payload = encoder.encode(
      sseBody([
        { event: 'meta', data: { provider: 'x' } },
        { event: 'done', data: { text: 'final' } },
      ]),
    );
    let sent = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(payload);
        }
        // never closes: a keep-alive socket that stays open after done
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchImpl: typeof globalThis.fetch = async () =>
      new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    const voice = new SpekoVoice({ apiKey: KEY, fetch: fetchImpl });
    const text = await voice.listen(Buffer.from([1]), {});
    expect(text).toBe('final');
    await new Promise((r) => setTimeout(r, 20));
    expect(cancelled).toBe(true);
  });
});
