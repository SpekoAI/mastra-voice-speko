# @spekoai/mastra-voice

## 0.1.0

Initial release.

- `SpekoVoice` class implementing Mastra's `MastraVoice` contract.
- `speak()` — batch TTS via `POST /v1/synthesize` (buffered WAV by default, raw
  PCM streaming via `{ format: 'pcm' }`).
- `listen()` — batch STT via `POST /v1/transcribe` (SSE response, returns the
  final transcript string).
- `getSpeakers()` — live voice catalog via `GET /v1/voices`.
- `getListener()` — static `{ enabled: true }`.
- Provider pinning through `constraints.allowedProviders` (all three pin forms:
  `provider:model`, bare provider, bare model).
- No realtime surface in this release (`connect`/`send` inherit the base no-ops).
