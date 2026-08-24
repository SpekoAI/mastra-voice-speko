import { PassThrough } from 'node:stream';
import type { VoiceEventMap } from '@mastra/core/voice';
import { MastraVoice } from '@mastra/core/voice';

import { SpekoVoiceError } from './errors.js';
import { getJson, parseSseStream, postBytes, postJson } from './rest.js';
import { bufferNodeStream, streamToText, webToNodeStream } from './stream-utils.js';
import type {
  SpekoListeningModelConfig,
  SpekoListenOptions,
  SpekoSpeakerMetadata,
  SpekoSpeakOptions,
  SpekoSpeechModelConfig,
  SpekoVoiceConfig,
} from './types.js';
import { parsePcmSampleRate, pcmToWav } from './wav.js';

const DEFAULT_BASE_URL = 'https://api.speko.dev';
const DEFAULT_LANGUAGE = 'en';
const DEFAULT_SAMPLE_RATE = 24000 as const;
const ROUTER_MODEL_NAME = 'speko-router'; // display name for super() when no pin is set

interface VoicesResponse {
  voices: Array<{ vendor: string; id: string; name: string }>;
  providers?: Array<{ key: string; name: string; models?: string[]; voicesFetchedLive?: boolean }>;
}

export class SpekoVoice extends MastraVoice<
  unknown, // TOptions (no realtimeConfig)
  SpekoSpeakOptions, // TSpeakOptions
  SpekoListenOptions, // TListenOptions
  // biome-ignore lint/suspicious/noExplicitAny: matches Mastra's ToolsInput constraint; realtime tools are unused here
  Record<string, any>, // TTools (unused — no realtime)
  VoiceEventMap, // TEventArgs (defaults)
  SpekoSpeakerMetadata // TSpeakerMetadata
> {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly language: string;
  private readonly speech: SpekoSpeechModelConfig;
  private readonly listening: SpekoListeningModelConfig;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(config: SpekoVoiceConfig = {}) {
    const apiKey =
      config.apiKey ??
      config.speechModel?.apiKey ??
      config.listeningModel?.apiKey ??
      process.env.SPEKO_API_KEY;
    if (!apiKey) {
      throw new Error(
        'SPEKO_API_KEY must be set (or pass apiKey / speechModel.apiKey / listeningModel.apiKey). Create one at https://platform.speko.dev/api-keys',
      );
    }
    super({
      name: 'speko',
      speechModel: { name: config.speechModel?.name ?? ROUTER_MODEL_NAME, apiKey },
      listeningModel: { name: config.listeningModel?.name ?? ROUTER_MODEL_NAME, apiKey },
      speaker: config.speaker, // may be undefined: Speko applies per-provider voice defaults
    });
    this.apiKey = apiKey;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.language = config.language ?? DEFAULT_LANGUAGE;
    this.speech = config.speechModel ?? {};
    this.listening = config.listeningModel ?? {};
    this.fetchImpl = config.fetch ?? globalThis.fetch;
  }

  private authHeaders(sessionId?: string): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      ...(sessionId ? { 'x-session-id': sessionId } : {}),
    };
  }

  async speak(
    input: string | NodeJS.ReadableStream,
    options?: { speaker?: string } & SpekoSpeakOptions,
    // biome-ignore lint/suspicious/noConfusingVoidType: return type mandated by MastraVoice's abstract signature
  ): Promise<NodeJS.ReadableStream | void> {
    let text: string;
    if (typeof input === 'string') {
      text = input;
    } else {
      text = await streamToText(input);
    }
    if (!text.trim()) {
      throw new Error('Input text is empty');
    }

    const pin = options?.model ?? this.speech.name; // undefined = let router choose
    const requestedSampleRate = options?.sampleRate ?? this.speech.sampleRate ?? DEFAULT_SAMPLE_RATE;
    const optimizeFor = options?.optimizeFor ?? this.speech.optimizeFor;
    const voiceId = options?.speaker ?? this.speaker;

    const body = {
      text,
      intent: {
        language: options?.language ?? this.speech.language ?? this.language,
        ...(optimizeFor && { optimizeFor }),
      },
      ...(voiceId && { voice: voiceId }),
      sampleRate: requestedSampleRate, // ALWAYS pinned → PCM rate is deterministic
      ...(options?.speed !== undefined && { speed: options.speed }),
      ...(options?.instructions && { instructions: options.instructions }),
      ...(options?.spokenForm !== undefined && { spokenForm: options.spokenForm }),
      ...(pin && { constraints: { allowedProviders: { tts: [pin] } } }),
    };

    const res = await postJson(
      this.fetchImpl,
      `${this.baseUrl}/v1/synthesize`,
      body,
      this.authHeaders(options?.sessionId),
    );

    this.logger.debug('speko synthesize routed', {
      provider: res.headers.get('X-Speko-Provider') ?? undefined,
      model: res.headers.get('X-Speko-Model') ?? undefined,
      failoverCount: res.headers.get('X-Speko-Failover-Count') ?? undefined,
    });

    if (!res.body) {
      throw new SpekoVoiceError('Speko synthesize response had no body', { status: res.status });
    }

    const sampleRate =
      parsePcmSampleRate(res.headers.get('Content-Type') ?? undefined) ?? requestedSampleRate;

    if (options?.format === 'pcm') {
      const nodeStream = webToNodeStream(res.body);
      Object.assign(nodeStream, {
        'speko-format': { encoding: 'pcm_s16le', sampleRate, channels: 1 },
      });
      return nodeStream;
    }

    // 'wav' (default): buffer the full PCM response and wrap it in a RIFF container.
    const pcm = await bufferNodeStream(webToNodeStream(res.body));
    const wav = pcmToWav(pcm, { sampleRate });
    const out = new PassThrough();
    out.end(Buffer.from(wav));
    return out;
  }

  async listen(
    audioStream: NodeJS.ReadableStream | unknown,
    options?: SpekoListenOptions,
    // biome-ignore lint/suspicious/noConfusingVoidType: return type mandated by MastraVoice's abstract signature
  ): Promise<string | NodeJS.ReadableStream | void> {
    const audio = await this.bufferAudioInput(audioStream);
    if (audio.byteLength === 0) {
      throw new Error('Audio input is empty');
    }

    const optimizeFor = options?.optimizeFor ?? this.listening.optimizeFor;
    const intent = {
      language: options?.language ?? this.listening.language ?? this.language,
      ...(optimizeFor && { optimizeFor }),
    };
    const pin = options?.model ?? this.listening.name;

    const sttOptions: Record<string, unknown> = {};
    if (options?.keywords !== undefined) sttOptions.keywords = options.keywords;
    if (options?.diarization !== undefined) sttOptions.diarization = options.diarization;
    if (options?.speakersExpected !== undefined) sttOptions.speakersExpected = options.speakersExpected;
    if (options?.smartFormat !== undefined) sttOptions.smartFormat = options.smartFormat;
    if (options?.fillerWords !== undefined) sttOptions.fillerWords = options.fillerWords;
    if (options?.profanityFilter !== undefined) sttOptions.profanityFilter = options.profanityFilter;

    const headers: Record<string, string> = {
      ...this.authHeaders(options?.sessionId),
      'Content-Type': options?.contentType ?? 'audio/wav',
      'X-Speko-Intent': JSON.stringify(intent),
      ...(pin && { 'X-Speko-Constraints': JSON.stringify({ allowedProviders: { stt: [pin] } }) }),
      ...(Object.keys(sttOptions).length > 0 && {
        'X-Speko-Stt-Options': JSON.stringify(sttOptions),
      }),
    };

    const res = await postBytes(this.fetchImpl, `${this.baseUrl}/v1/transcribe`, audio, headers);

    if (!res.body) {
      throw new SpekoVoiceError('Speko transcribe response had no body', { status: res.status });
    }

    for await (const event of parseSseStream(res.body)) {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(event.data);
      } catch {
        continue; // ignore malformed events
      }
      switch (event.event) {
        case 'meta':
          this.logger.debug('speko transcribe routed', payload);
          break;
        case 'transcript':
          // interim results; batch caller wants the final
          break;
        case 'done':
          return payload.text as string;
        case 'error':
          throw new SpekoVoiceError(
            typeof payload.error === 'string' ? payload.error : 'Transcription failed',
            { code: typeof payload.code === 'string' ? payload.code : undefined },
          );
        default:
          break;
      }
    }

    throw new SpekoVoiceError('Transcription stream ended without a result', {
      code: 'INCOMPLETE_STREAM',
    });
  }

  private async bufferAudioInput(audioStream: NodeJS.ReadableStream | unknown): Promise<Uint8Array> {
    if (Buffer.isBuffer(audioStream)) return audioStream;
    if (audioStream instanceof Uint8Array) return audioStream;
    if (audioStream instanceof ArrayBuffer) return new Uint8Array(audioStream);
    if (
      audioStream !== null &&
      typeof audioStream === 'object' &&
      (typeof (audioStream as NodeJS.ReadableStream).pipe === 'function' ||
        typeof (audioStream as Partial<AsyncIterable<unknown>>)[Symbol.asyncIterator] === 'function')
    ) {
      return bufferNodeStream(audioStream as NodeJS.ReadableStream);
    }
    throw new Error('Unsupported audio input: expected a readable stream or byte buffer');
  }

  async getSpeakers(): Promise<Array<{ voiceId: string } & SpekoSpeakerMetadata>> {
    const data = await getJson<VoicesResponse>(
      this.fetchImpl,
      `${this.baseUrl}/v1/voices`,
      this.authHeaders(),
    );
    return data.voices.map((v) => ({ voiceId: v.id, vendor: v.vendor, name: v.name }));
  }

  async getListener(): Promise<{ enabled: boolean }> {
    return { enabled: true };
  }
}
