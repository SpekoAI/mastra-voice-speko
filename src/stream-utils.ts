import { PassThrough } from 'node:stream';

/**
 * Web ReadableStream<Uint8Array> → Node stream, with backpressure and teardown:
 * a full PassThrough pauses reads until 'drain', and destroying the returned
 * stream cancels the web reader so the underlying fetch body stops downloading.
 */
export function webToNodeStream(webStream: ReadableStream<Uint8Array>): PassThrough {
  const nodeStream = new PassThrough();
  const reader = webStream.getReader();
  let closed = false;
  const cancelReader = () => {
    closed = true;
    reader.cancel().catch(() => {});
  };
  nodeStream.once('close', cancelReader);
  nodeStream.once('error', cancelReader);
  (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done || closed) {
          if (!closed) nodeStream.end();
          break;
        }
        if (!nodeStream.write(Buffer.from(value))) {
          await new Promise<void>((resolve) => {
            const onDone = () => {
              nodeStream.off('drain', onDone);
              nodeStream.off('close', onDone);
              resolve();
            };
            nodeStream.once('drain', onDone);
            nodeStream.once('close', onDone);
          });
          if (closed) break;
        }
      }
    } catch (err) {
      if (!closed) nodeStream.destroy(err instanceof Error ? err : new Error(String(err)));
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
