/** BCP-47, e.g. 'en', 'es-MX', 'uz'. Speko REQUIRES intent.language on every route. */
export type SpekoLanguage = string;

export type SpekoOptimizeFor = 'balanced' | 'accuracy' | 'latency' | 'cost';

/**
 * Provider pin string, all three server-accepted forms:
 *  'provider:model' ('deepgram:nova-3', 'elevenlabs:eleven_turbo_v2'),
 *  bare provider ('elevenlabs' → its catalog default model),
 *  bare model ('sonic-2' → reverse-looked-up vendor).
 * Omit entirely to let Speko's benchmark-scored router pick.
 */
export type SpekoModelPin = string;

export interface SpekoSpeechModelConfig {
  /** TTS pin. Omit = Speko router chooses per intent. Sent as constraints.allowedProviders.tts:[name]. */
  name?: SpekoModelPin;
  apiKey?: string;
  /** Default language for synth intent. Falls back to top-level `language`, then 'en'. */
  language?: SpekoLanguage;
  optimizeFor?: SpekoOptimizeFor;
  /** Pinned output sample rate; locks failover to rate-compatible providers. Default 24000. */
  sampleRate?: 16000 | 24000 | 44100 | 48000;
}

export interface SpekoListeningModelConfig {
  /** STT pin, same three forms. Sent as constraints.allowedProviders.stt:[name]. */
  name?: SpekoModelPin;
  apiKey?: string;
  language?: SpekoLanguage;
  optimizeFor?: SpekoOptimizeFor;
}

export interface SpekoVoiceConfig {
  /** Speko API key. Fallback: process.env.SPEKO_API_KEY. Get one at platform.speko.ai/agents/keys. */
  apiKey?: string;
  /** Default 'https://api.speko.dev'. */
  baseUrl?: string;
  /** Default intent language for both legs (BCP-47). Default 'en'. */
  language?: SpekoLanguage;
  speechModel?: SpekoSpeechModelConfig;
  listeningModel?: SpekoListeningModelConfig;
  /** Default TTS voice id (provider-native, e.g. 'aura-2-thalia-en', an ElevenLabs voice id). Omit = provider default. */
  speaker?: string;
  /** Custom fetch (tests/proxies). Default: globalThis.fetch. */
  fetch?: typeof globalThis.fetch;
}

export interface SpekoSpeakOptions {
  // `speaker?: string` is contributed by the abstract signature's `{ speaker?: string } & TSpeakOptions`
  language?: SpekoLanguage;
  optimizeFor?: SpekoOptimizeFor;
  /** Per-call TTS pin override. */
  model?: SpekoModelPin;
  speed?: number; // 0.5–2
  instructions?: string; // ≤2000 chars style prompt; dropped by non-instruction models
  spokenForm?: boolean; // deterministic number/URL normalization
  /**
   * Pinned output sample rate. Production currently serves 24000 Hz for every
   * TTS provider; other rates fail with NO_PROVIDER_AVAILABLE (422) unless
   * rate-specific providers are enabled for your org.
   */
  sampleRate?: 16000 | 24000 | 44100 | 48000;
  /** Cancels the in-flight synthesize request (fetch abort). */
  abortSignal?: AbortSignal;
  /**
   * 'wav' (default): buffer full response, return a PassThrough containing one playable WAV.
   * 'pcm': stream raw s16le chunks as they arrive (lowest latency); sample rate is
   * announced via the 'speko-format' property attached to the returned stream.
   */
  format?: 'wav' | 'pcm';
  /** Usage attribution — forwarded as x-session-id. */
  sessionId?: string;
}

export interface SpekoListenOptions {
  language?: SpekoLanguage;
  optimizeFor?: SpekoOptimizeFor;
  /** Per-call STT pin override. */
  model?: SpekoModelPin;
  /** MIME of the input audio. Default 'audio/wav'. */
  contentType?: string;
  /** Keyword boosts (≤200). Sent inside X-Speko-Stt-Options. */
  keywords?: string[];
  diarization?: boolean;
  speakersExpected?: number;
  smartFormat?: boolean;
  fillerWords?: boolean;
  profanityFilter?: boolean;
  sessionId?: string;
  /** Cancels the in-flight transcribe request (fetch abort). */
  abortSignal?: AbortSignal;
}

/** getSpeakers() row metadata (TSpeakerMetadata). */
export interface SpekoSpeakerMetadata {
  vendor: string; // e.g. 'deepgram', 'cartesia'
  name: string; // human-readable voice name
}
