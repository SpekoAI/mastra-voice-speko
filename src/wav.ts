/**
 * Minimal WAV (RIFF) helpers.
 *
 * Speko's `/v1/synthesize` returns RAW PCM (s16le, mono, `audio/pcm;rate=N`).
 * Mastra consumers expect a playable container, so `speak()` wraps the PCM
 * into a WAV file by default.
 *
 * Ported verbatim from platform/packages/ai-sdk-provider/src/wav.ts
 * (wavDurationInSeconds intentionally omitted — not needed here).
 */

const RIFF_HEADER_BYTES = 44;

/** Parses the sample rate out of a `audio/pcm;rate=24000` content type. */
export function parsePcmSampleRate(contentType: string | undefined): number | undefined {
  if (!contentType) return undefined;
  const match = /^audio\/pcm\s*;\s*rate=(\d+)/i.exec(contentType.trim());
  if (!match?.[1]) return undefined;
  const rate = Number(match[1]);
  return Number.isFinite(rate) && rate > 0 ? rate : undefined;
}

export interface PcmFormat {
  sampleRate: number;
  /** Defaults to 1 (Speko synthesizes mono). */
  channels?: number;
  /** Defaults to 16 (s16le). */
  bitsPerSample?: number;
}

/** Wraps raw PCM samples into a WAV container. */
export function pcmToWav(pcm: Uint8Array, format: PcmFormat): Uint8Array {
  const channels = format.channels ?? 1;
  const bitsPerSample = format.bitsPerSample ?? 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = format.sampleRate * blockAlign;
  // RIFF chunks are word-aligned: an odd-sized data chunk (possible only on
  // a truncated stream, since s16le frames are even) gets one pad byte that
  // is NOT counted in the data chunk size but IS counted in the RIFF size.
  const padding = pcm.byteLength % 2;

  const out = new Uint8Array(RIFF_HEADER_BYTES + pcm.byteLength + padding);
  const view = new DataView(out.buffer);

  writeAscii(out, 0, 'RIFF');
  view.setUint32(4, 36 + pcm.byteLength + padding, true);
  writeAscii(out, 8, 'WAVE');
  writeAscii(out, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, format.sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(out, 36, 'data');
  view.setUint32(40, pcm.byteLength, true);
  out.set(pcm, RIFF_HEADER_BYTES);

  return out;
}

function writeAscii(target: Uint8Array, offset: number, value: string): void {
  for (let i = 0; i < value.length; i++) {
    target[offset + i] = value.charCodeAt(i);
  }
}
