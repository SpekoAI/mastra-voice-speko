import { describe, expect, it } from 'vitest';

import { parsePcmSampleRate, pcmToWav } from '../wav.js';

describe('parsePcmSampleRate', () => {
  it.each([
    ['audio/pcm;rate=24000', 24000],
    ['audio/pcm; rate=48000', 48000],
    ['audio/pcm ; rate=16000', 16000],
    ['AUDIO/PCM;RATE=44100', 44100],
  ])('parses %s → %d', (input, expected) => {
    expect(parsePcmSampleRate(input)).toBe(expected);
  });

  it.each([['audio/wav'], ['audio/pcm'], ['audio/pcm;rate=0'], ['text/plain'], [undefined]])(
    'returns undefined for %s',
    (input) => {
      expect(parsePcmSampleRate(input)).toBeUndefined();
    },
  );
});

describe('pcmToWav', () => {
  it('writes a correct 44-byte RIFF header for even-length PCM', () => {
    const pcm = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const wav = Buffer.from(pcmToWav(pcm, { sampleRate: 24000 }));

    expect(wav.length).toBe(44 + 6);
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(wav.readUInt32LE(4)).toBe(36 + 6); // RIFF size
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE');
    expect(wav.subarray(12, 16).toString('ascii')).toBe('fmt ');
    expect(wav.readUInt32LE(16)).toBe(16); // fmt chunk size
    expect(wav.readUInt16LE(20)).toBe(1); // PCM
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    expect(wav.readUInt32LE(24)).toBe(24000); // sample rate
    expect(wav.readUInt32LE(28)).toBe(24000 * 2); // byte rate
    expect(wav.readUInt16LE(32)).toBe(2); // block align
    expect(wav.readUInt16LE(34)).toBe(16); // bits per sample
    expect(wav.subarray(36, 40).toString('ascii')).toBe('data');
    expect(wav.readUInt32LE(40)).toBe(6); // data chunk size
    expect([...wav.subarray(44)]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('adds an uncounted pad byte for odd-length PCM', () => {
    const pcm = new Uint8Array([1, 2, 3]);
    const wav = Buffer.from(pcmToWav(pcm, { sampleRate: 16000 }));

    expect(wav.length).toBe(44 + 3 + 1); // one pad byte
    expect(wav.readUInt32LE(4)).toBe(36 + 3 + 1); // RIFF size counts the pad
    expect(wav.readUInt32LE(40)).toBe(3); // data size does NOT count the pad
    expect(wav[47]).toBe(0); // pad byte is zero
  });

  it('honors channels and bitsPerSample overrides', () => {
    const wav = Buffer.from(
      pcmToWav(new Uint8Array(8), { sampleRate: 48000, channels: 2, bitsPerSample: 16 }),
    );
    expect(wav.readUInt16LE(22)).toBe(2);
    expect(wav.readUInt16LE(32)).toBe(4); // block align
    expect(wav.readUInt32LE(28)).toBe(48000 * 4); // byte rate
  });
});
