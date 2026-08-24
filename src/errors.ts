/** Error thrown for every Speko HTTP or SSE failure. Never carries the API key. */
export class SpekoVoiceError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(message: string, opts: { status?: number; code?: string; details?: unknown } = {}) {
    super(message);
    this.name = 'SpekoVoiceError';
    this.status = opts.status;
    this.code = opts.code;
    this.details = opts.details;
  }

  static async fromResponse(res: Response): Promise<SpekoVoiceError> {
    let parsed: { error?: unknown; details?: unknown; code?: unknown } | undefined;
    let textSnippet: string | undefined;
    try {
      const text = await res.text();
      textSnippet = text.slice(0, 200);
      parsed = JSON.parse(text);
    } catch {
      // non-JSON body; keep the text snippet (if any)
    }
    const serverError =
      typeof parsed?.error === 'string'
        ? parsed.error
        : typeof (parsed as { message?: unknown } | undefined)?.message === 'string'
          ? (parsed as { message: string }).message
          : undefined;
    // statusText is always a string ('' over HTTP/2), so pick the first NON-EMPTY source.
    const reason = serverError || res.statusText || textSnippet || 'request failed';
    const message = `Speko API error ${res.status}: ${reason}`;
    return new SpekoVoiceError(message, {
      status: res.status,
      code: typeof parsed?.code === 'string' ? parsed.code : undefined,
      details: parsed?.details,
    });
  }
}
