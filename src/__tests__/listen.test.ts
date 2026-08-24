import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { SpekoVoiceError } from '../errors.js';
import { SpekoVoice } from '../speko-voice.js';
import {
  createMockFetch,
  jsonResponse,
  sseBody,
  sseChunkedResponse,
  sseResponse,
} from './helpers/mock-fetch.js';

const KEY = 'test-key';
const WAV_BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 5, 6, 7, 8]);

function happySse(): Response {
  return sseResponse(
    sseBody([
      { event: 'meta', data: { provider: 'deepgram', model: 'nova-3', failoverCount: 0 } },
      { event: 'transcript', data: { text: 'hello', isFinal: false, confidence: 0.7 } },
      { event: 'transcript', data: { text: 'hello world', isFinal: false, confidence: 0.8 } },
      {
        event: 'done',
        data: { text: 'hello world', provider: 'deepgram', model: 'nova-3', confidence: 0.93 },
      },
    ]),
  );
}

describe('listen', () => {
  it('happy path: posts raw bytes with intent header and returns the done text', async () => {
    const fetch = createMockFetch(happySse);
    const voice = new SpekoVoice({ apiKey: KEY, fetch });

    const result = await voice.listen(Readable.from([Buffer.from(WAV_BYTES)]));
    expect(result).toBe('hello world');
    expect(typeof result).toBe('string');

    expect(fetch.requests).toHaveLength(1);
    const req = fetch.requests[0]!;
    expect(req.url).toBe('https://api.speko.dev/v1/transcribe');
    expect(req.method).toBe('POST');
    expect(req.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(req.headers['content-type']).toBe('audio/wav');
    expect(JSON.parse(req.headers['x-speko-intent']!)).toEqual({ language: 'en' });
    expect(req.headers['x-speko-constraints']).toBeUndefined();
    expect(req.headers['x-speko-stt-options']).toBeUndefined();
    expect([...req.body!]).toEqual([...WAV_BYTES]);
  });

  it.each([
    ['Buffer', Buffer.from(WAV_BYTES)],
    ['Uint8Array', new Uint8Array(WAV_BYTES)],
    ['ArrayBuffer', WAV_BYTES.slice().buffer],
  ])('accepts %s input directly', async (_label, input) => {
    const fetch = createMockFetch(happySse);
    const voice = new SpekoVoice({ apiKey: KEY, fetch });
    await expect(voice.listen(input)).resolves.toBe('hello world');
    expect([...fetch.requests[0]!.body!]).toEqual([...WAV_BYTES]);
  });

  it('rejects a non-audio input without calling fetch', async () => {
    const fetch = createMockFetch(happySse);
    const voice = new SpekoVoice({ apiKey: KEY, fetch });
    await expect(voice.listen(42)).rejects.toThrowError(
      'Unsupported audio input: expected a readable stream or byte buffer',
    );
    expect(fetch.requests).toHaveLength(0);
  });

  it('maps options onto the request headers', async () => {
    const fetch = createMockFetch(happySse);
    const voice = new SpekoVoice({ apiKey: KEY, fetch });

    await voice.listen(Buffer.from(WAV_BYTES), {
      model: 'deepgram:nova-3',
      language: 'uz',
      keywords: ['Speko'],
      contentType: 'audio/mpeg',
      sessionId: 's1',
    });

    const req = fetch.requests[0]!;
    expect(req.headers['content-type']).toBe('audio/mpeg');
    expect(req.headers['x-session-id']).toBe('s1');
    expect(JSON.parse(req.headers['x-speko-intent']!)).toEqual({ language: 'uz' });
    expect(JSON.parse(req.headers['x-speko-constraints']!)).toEqual({
      allowedProviders: { stt: ['deepgram:nova-3'] },
    });
    expect(JSON.parse(req.headers['x-speko-stt-options']!)).toEqual({ keywords: ['Speko'] });
  });

  it('SSE error event inside a 200 rejects with the server code', async () => {
    const fetch = createMockFetch(() =>
      sseResponse(
        sseBody([
          { event: 'meta', data: { provider: 'deepgram' } },
          {
            event: 'error',
            data: { error: 'no provider available for intent', code: 'NO_PROVIDER_AVAILABLE' },
          },
        ]),
      ),
    );
    const voice = new SpekoVoice({ apiKey: KEY, fetch });

    const err = await voice.listen(Buffer.from(WAV_BYTES)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SpekoVoiceError);
    expect((err as SpekoVoiceError).code).toBe('NO_PROVIDER_AVAILABLE');
    expect((err as SpekoVoiceError).message).toBe('no provider available for intent');
  });

  it('SSE stream ending without done rejects INCOMPLETE_STREAM', async () => {
    const fetch = createMockFetch(() =>
      sseResponse(sseBody([{ event: 'transcript', data: { text: 'partial', isFinal: false } }])),
    );
    const voice = new SpekoVoice({ apiKey: KEY, fetch });

    const err = await voice.listen(Buffer.from(WAV_BYTES)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SpekoVoiceError);
    expect((err as SpekoVoiceError).code).toBe('INCOMPLETE_STREAM');
    expect((err as SpekoVoiceError).message).toBe('Transcription stream ended without a result');
  });

  it('HTTP 401 rejects with status 401', async () => {
    const fetch = createMockFetch(() => jsonResponse({ error: 'unauthorized' }, 401));
    const voice = new SpekoVoice({ apiKey: KEY, fetch });

    const err = await voice.listen(Buffer.from(WAV_BYTES)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SpekoVoiceError);
    expect((err as SpekoVoiceError).status).toBe(401);
  });

  it('rejects empty audio without calling fetch', async () => {
    const fetch = createMockFetch(happySse);
    const voice = new SpekoVoice({ apiKey: KEY, fetch });
    await expect(voice.listen(Buffer.alloc(0))).rejects.toThrowError('Audio input is empty');
    expect(fetch.requests).toHaveLength(0);
  });

  it('reassembles an SSE payload split across network chunks', async () => {
    const wire = sseBody([
      { event: 'meta', data: { provider: 'deepgram' } },
      { event: 'done', data: { text: 'split payload works' } },
    ]);
    const mid = wire.indexOf('split ') + 3; // cut inside the done event's data line
    const fetch = createMockFetch(() => sseChunkedResponse([wire.slice(0, mid), wire.slice(mid)]));
    const voice = new SpekoVoice({ apiKey: KEY, fetch });

    await expect(voice.listen(Buffer.from(WAV_BYTES))).resolves.toBe('split payload works');
  });
});
