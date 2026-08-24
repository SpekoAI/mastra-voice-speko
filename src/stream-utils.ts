import { PassThrough } from 'node:stream';

/** Web ReadableStream<Uint8Array> → Node stream. Deepgram-provider pattern, verbatim behavior. */
export function webToNodeStream(webStream: ReadableStream<Uint8Array>): PassThrough {
  const nodeStream = new PassThrough();
  const reader = webStream.getReader();
  (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          nodeStream.end();
          break;
        }
        nodeStream.write(Buffer.from(value));
      }
    } catch (err) {
      nodeStream.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  })();
  return nodeStream;
}

/** for-await chunks → single Buffer (used by listen() and by buffered 'wav' speak). */
export async function bufferNodeStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** stream → utf-8 text (used by speak() text-stream input). */
export async function streamToText(stream: NodeJS.ReadableStream): Promise<string> {
  return (await bufferNodeStream(stream)).toString('utf-8');
}
