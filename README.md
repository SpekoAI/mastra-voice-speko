# @spekoai/mastra-voice

[Speko](https://speko.ai) voice provider for [Mastra](https://mastra.ai) — multi-vendor
STT/TTS through one API key. Speko routes each request to the best provider for your
language/latency/cost intent, with automatic failover across Deepgram, ElevenLabs,
Cartesia, OpenAI, and more.

## Install

```bash
npm i @spekoai/mastra-voice @mastra/core
```

## Setup

Set `SPEKO_API_KEY` in your environment (create one at
[platform.speko.dev/api-keys](https://platform.speko.dev/api-keys)), or pass
`apiKey` in the constructor.

## Usage

```ts
import { Agent } from '@mastra/core/agent';
import { SpekoVoice } from '@spekoai/mastra-voice';
import { createReadStream } from 'node:fs';

const voice = new SpekoVoice(); // full router, English intent

const agent = new Agent({
  name: 'support-agent',
  instructions: 'You are a helpful assistant.',
  model: /* your model */,
  voice,
});

// Text to speech — returns a Node stream containing one playable WAV file
const audio = await agent.voice.speak('Hello!', { speaker: 'aura-2-thalia-en' });

// Speech to text — returns the final transcript string
const text = await agent.voice.listen(createReadStream('question.wav'));
```

## Pinning providers

Omit pins entirely to let Speko's benchmark-scored router pick per request, or pin
either leg:

```ts
const voice = new SpekoVoice({
  speechModel: { name: 'elevenlabs:eleven_turbo_v2' },
  listeningModel: { name: 'deepgram:nova-3' },
  speaker: '<voice id>',
});
```

Pin strings accept three forms:

| Form | Example | Meaning |
| --- | --- | --- |
| `provider:model` | `deepgram:nova-3` | exact provider + model |
| bare provider | `elevenlabs` | provider's catalog default model |
| bare model | `sonic-2` | vendor reverse-looked-up from the model |

Discover what's available via `GET /v1/providers/known` and
`await voice.getSpeakers()`.

### Voice ids (`speaker`)

Voice ids are provider-native. Examples: Deepgram default `aura-2-thalia-en`,
OpenAI `coral`, ElevenLabs `QtY3JBOUKEB5xzrRfOKc`. Omitting `speaker` always
works — the server applies per-provider voice defaults. Note: ElevenLabs voices
are account-scoped and don't appear in `getSpeakers()`; ElevenLabs voice ids
still work when passed as `speaker`.

## Languages

`intent.language` is BCP-47 (`'en'`, `'es-MX'`, `'uz'`). Default `'en'`.
Override per constructor (`language`), per model config
(`speechModel.language` / `listeningModel.language`), or per call
(`options.language`) — call wins.

## Audio formats

- `speak()` returns a WAV file (buffered) by default. Pass `{ format: 'pcm' }`
  to stream raw s16le chunks as they arrive (lowest latency); the sample rate is
  announced on the returned stream's `'speko-format'` property:
  `{ encoding: 'pcm_s16le', sampleRate, channels: 1 }`.
- `listen()` accepts WAV by default; set `contentType` (e.g. `'audio/mpeg'`,
  `'audio/mp4'`) for other input formats.

## Options reference

### `SpekoSpeakOptions`

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `speaker` | `string` | constructor `speaker` | provider-native voice id |
| `language` | `string` | config language | BCP-47 intent language |
| `optimizeFor` | `'balanced' \| 'accuracy' \| 'latency' \| 'cost'` | — | routing intent |
| `model` | `string` | `speechModel.name` | per-call TTS pin |
| `speed` | `number` | — | 0.5–2 |
| `instructions` | `string` | — | ≤2000 chars style prompt; dropped by non-instruction models |
| `spokenForm` | `boolean` | — | deterministic number/URL normalization |
| `sampleRate` | `16000 \| 24000 \| 44100 \| 48000` | `24000` | pins output rate, locks failover to rate-compatible providers |
| `format` | `'wav' \| 'pcm'` | `'wav'` | see Audio formats |
| `sessionId` | `string` | — | usage attribution (`x-session-id`) |

### `SpekoListenOptions`

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `language` | `string` | config language | BCP-47 intent language |
| `optimizeFor` | `'balanced' \| 'accuracy' \| 'latency' \| 'cost'` | — | routing intent |
| `model` | `string` | `listeningModel.name` | per-call STT pin |
| `contentType` | `string` | `'audio/wav'` | MIME of the input audio |
| `keywords` | `string[]` | — | keyword boosts (≤200) |
| `diarization` | `boolean` | — | |
| `speakersExpected` | `number` | — | |
| `smartFormat` | `boolean` | — | |
| `fillerWords` | `boolean` | — | |
| `profanityFilter` | `boolean` | — | |
| `sessionId` | `string` | — | usage attribution (`x-session-id`) |

## With CompositeVoice

Mix Speko with other providers per leg:

```ts
import { CompositeVoice } from '@mastra/core/voice';
import { SpekoVoice } from '@spekoai/mastra-voice';

const voice = new CompositeVoice({
  input: new SpekoVoice({ listeningModel: { name: 'deepgram:nova-3' } }), // STT
  output: new SpekoVoice({ speechModel: { name: 'cartesia' } }),          // TTS
});
```

## Not yet supported

Realtime (`connect()` / `send()` / speech-to-speech) — this package is batch
`speak()`/`listen()` only. Speko has a live STT WebSocket server-side
(`WS /v1/transcribe/stream`) and a realtime sibling provider is planned.

## License

MIT
