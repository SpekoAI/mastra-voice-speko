import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpekoVoiceError } from '../errors.js';
import { SpekoVoice } from '../speko-voice.js';
import { collect, createMockFetch, erroringStream, jsonResponse, pcmResponse } from './helpers/mock-fetch.js';

const KEY = 'test-key';

function pcmChunks(): Uint8Array[] {
  return [
    new Uint8Array([1, 2, 3, 4]),
    new Uint8Array([5, 6, 7, 8]),
    new Uint8Array([9, 10]),
    new Uint8Array([11, 12]),
  ];
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('constructor', () => {
  it('throws the exact key-missing message when no apiKey and no SPEKO_API_KEY', () => {
    vi.stubEnv('SPEKO_API_KEY', '');
    expect(() => new SpekoVoice()).toThrowError(
      'SPEKO_API_KEY must be set (or pass apiKey / speechModel.apiKey / listeningModel.apiKey). Create one at https://platform.speko.dev/api-keys',
    );
  });

  it('picks up SPEKO_API_KEY from the environment', () => {
    vi.stubEnv('SPEKO_API_KEY', 'env-key');
    expect(() => new SpekoVoice()).not.toThrow();
  });

  it('serializeForSpan exposes names but never the api key', () => {
    const voice = new SpekoVoice({ apiKey: KEY, speaker: 'aura-2-thalia-en' });
    const span = voice.serializeForSpan();
    expect(span).toMatchObject({
      component: 'VOICE',
      name: 'speko',
      speaker: 'aura-2-thalia-en',
      speechModel: { name: 'speko-router' },
      listeningModel: { name: 'speko-router' },
    });
    expect(JSON.stringify(span)).not.toContain(KEY);
  });
});

describe('speak', () => {
  it('string input returns a buffered WAV by default', async () => {
    const fetch = createMockFetch(() => pcmResponse(pcmChunks(), 24000));
    const voice = new SpekoVoice({ apiKey: KEY, fetch });

    const stream = await voice.speak('Hello world');
    expect(stream).toBeDefined();

    expect(fetch.requests).toHaveLength(1);
    const req = fetch.requests[0]!;
    expect(req.url).toBe('https://api.speko.dev/v1/synthesize');
    expect(req.method).toBe('POST');
    expect(req.headers.authorization).toBe(`Bearer ${KEY}`);
    const body = req.json() as Record<string, unknown>;
    expect(body.text).toBe('Hello world');
    expect(body.intent).toEqual({ language: 'en' });
    expect(body.sampleRate).toBe(24000);
    expect(body.constraints).toBeUndefined();
    expect(body.voice).toBeUndefined();

    const wav = await collect(stream as NodeJS.ReadableStream);
    const pcmLength = 12;
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE');
    expect(wav.readUInt32LE(24)).toBe(24000); // sample rate
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    expect(wav.readUInt16LE(34)).toBe(16); // bit depth
    expect(wav.readUInt32LE(40)).toBe(pcmLength); // data chunk size
    expect(wav.length).toBe(44 + pcmLength);
    expect([...wav.subarray(44)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('buffers a text stream input into the request body', async () => {
    const fetch = createMockFetch(() => pcmResponse(pcmChunks()));
    const voice = new SpekoVoice({ apiKey: KEY, fetch });

    await voice.speak(Readable.from(['Hel', 'lo']));
    const body = fetch.requests[0]!.json() as Record<string, unknown>;
    expect(body.text).toBe('Hello');
  });

  it.each([
    ['empty string', ''],
    ['whitespace', '   \n '],
  ])('rejects %s input without calling fetch', async (_label, input) => {
    const fetch = createMockFetch(() => pcmResponse(pcmChunks()));
    const voice = new SpekoVoice({ apiKey: KEY, fetch });
    await expect(voice.speak(input)).rejects.toThrowError('Input text is empty');
    expect(fetch.requests).toHaveLength(0);
  });

  it('rejects an empty text stream without calling fetch', async () => {
    const fetch = createMockFetch(() => pcmResponse(pcmChunks()));
    const voice = new SpekoVoice({ apiKey: KEY, fetch });
    await expect(voice.speak(Readable.from([]))).rejects.toThrowError('Input text is empty');
    expect(fetch.requests).toHaveLength(0);
  });

  it('maps pins, speaker, speed, instructions and language onto the body', async () => {
    const fetch = createMockFetch(() => pcmResponse(pcmChunks()));
    const voice = new SpekoVoice({
      apiKey: KEY,
      fetch,
      speechModel: { name: 'elevenlabs:eleven_turbo_v2' },
    });

    await voice.speak('Hola', {
      speaker: 'voiceX',
      speed: 1.2,
      instructions: 'calm',
      language: 'es',
    });
    const body = fetch.requests[0]!.json() as Record<string, unknown>;
    expect(body.constraints).toEqual({ allowedProviders: { tts: ['elevenlabs:eleven_turbo_v2'] } });
    expect(body.voice).toBe('voiceX');
    expect(body.speed).toBe(1.2);
    expect(body.instructions).toBe('calm');
    expect((body.intent as Record<string, unknown>).language).toBe('es');
  });

  it('per-call model overrides the constructor pin', async () => {
    const fetch = createMockFetch(() => pcmResponse(pcmChunks()));
    const voice = new SpekoVoice({
      apiKey: KEY,
      fetch,
      speechModel: { name: 'elevenlabs:eleven_turbo_v2' },
    });

    await voice.speak('Hi', { model: 'sonic-2' });
    const body = fetch.requests[0]!.json() as Record<string, unknown>;
    expect(body.constraints).toEqual({ allowedProviders: { tts: ['sonic-2'] } });
  });

  it("format 'pcm' streams the raw chunks and attaches speko-format", async () => {
    const fetch = createMockFetch(() => pcmResponse(pcmChunks(), 24000));
    const voice = new SpekoVoice({ apiKey: KEY, fetch });

    const stream = (await voice.speak('Hi', { format: 'pcm' })) as NodeJS.ReadableStream;
    expect((stream as unknown as Record<string, unknown>)['speko-format']).toEqual({
      encoding: 'pcm_s16le',
      sampleRate: 24000,
      channels: 1,
    });
    const bytes = await collect(stream);
    expect(bytes.subarray(0, 4).toString('ascii')).not.toBe('RIFF');
    expect([...bytes]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('the response Content-Type rate overrides the requested rate in the metadata', async () => {
    const fetch = createMockFetch(() => pcmResponse(pcmChunks(), 48000));
    const voice = new SpekoVoice({ apiKey: KEY, fetch });

    const stream = (await voice.speak('Hi', { format: 'pcm' })) as NodeJS.ReadableStream;
    expect(
      ((stream as unknown as Record<string, unknown>)['speko-format'] as Record<string, unknown>).sampleRate,
    ).toBe(48000);
  });

  it('HTTP 400 rejects with SpekoVoiceError carrying status and details', async () => {
    const details = [{ path: 'speed', message: 'out of range' }];
    const fetch = createMockFetch(() => jsonResponse({ error: 'invalid_provider_options', details }, 400));
    const voice = new SpekoVoice({ apiKey: KEY, fetch });

    const err = await voice.speak('Hi').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SpekoVoiceError);
    expect((err as SpekoVoiceError).status).toBe(400);
    expect((err as SpekoVoiceError).details).toEqual(details);
    expect((err as SpekoVoiceError).message).toContain('invalid_provider_options');
  });

  it("mid-stream failure in 'pcm' mode destroys the node stream", async () => {
    const fetch = createMockFetch(
      () =>
        new Response(erroringStream([new Uint8Array([1, 2])], new Error('upstream died')), {
          status: 200,
          headers: { 'Content-Type': 'audio/pcm;rate=24000' },
        }),
    );
    const voice = new SpekoVoice({ apiKey: KEY, fetch });

    const stream = (await voice.speak('Hi', { format: 'pcm' })) as NodeJS.ReadableStream;
    const err = await collect(stream).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('upstream died');
  });
});
