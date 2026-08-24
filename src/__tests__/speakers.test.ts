import { describe, expect, it } from 'vitest';

import { SpekoVoiceError } from '../errors.js';
import { SpekoVoice } from '../speko-voice.js';
import { createMockFetch, jsonResponse } from './helpers/mock-fetch.js';

const KEY = 'test-key';

describe('getSpeakers', () => {
  it('maps the /v1/voices catalog to voiceId rows', async () => {
    const fetch = createMockFetch(() =>
      jsonResponse({
        voices: [{ vendor: 'deepgram', id: 'aura-2-thalia-en', name: 'Thalia' }],
        providers: [{ key: 'deepgram', name: 'Deepgram', voicesFetchedLive: false }],
      }),
    );
    const voice = new SpekoVoice({ apiKey: KEY, fetch });

    await expect(voice.getSpeakers()).resolves.toEqual([
      { voiceId: 'aura-2-thalia-en', vendor: 'deepgram', name: 'Thalia' },
    ]);

    const req = fetch.requests[0]!;
    expect(req.url).toBe('https://api.speko.dev/v1/voices');
    expect(req.method).toBe('GET');
    expect(req.headers.authorization).toBe(`Bearer ${KEY}`);
  });

  it('rejects with SpekoVoiceError on HTTP failure', async () => {
    const fetch = createMockFetch(() => jsonResponse({ error: 'server exploded' }, 500));
    const voice = new SpekoVoice({ apiKey: KEY, fetch });

    const err = await voice.getSpeakers().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SpekoVoiceError);
    expect((err as SpekoVoiceError).status).toBe(500);
  });
});

describe('getListener', () => {
  it('resolves { enabled: true } with zero fetch calls', async () => {
    const fetch = createMockFetch(() => jsonResponse({}));
    const voice = new SpekoVoice({ apiKey: KEY, fetch });
    await expect(voice.getListener()).resolves.toEqual({ enabled: true });
    expect(fetch.requests).toHaveLength(0);
  });
});
