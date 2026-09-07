import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const expected = `${manifest.name}/${manifest.version}`;
const require = createRequire(import.meta.url);
const builds = [await import('../dist/index.js'), require('../dist/index.cjs')];

for (const { SpekoVoice } of builds) {
  let requests = 0;
  const voice = new SpekoVoice({
    apiKey: 'package-version-check',
    baseUrl: 'https://package-version.invalid',
    fetch: async (_url, init) => {
      requests += 1;
      assert.equal(new Headers(init.headers).get('User-Agent'), expected,
        'Package User-Agent must match package.json before publication');
      return new Response(JSON.stringify({ error: 'local version check' }), { status: 401 });
    },
  });
  for (const invoke of [
    () => voice.getSpeakers(),
    () => voice.speak('package version check'),
    () => voice.listen(new Uint8Array([0])),
  ]) {
    await assert.rejects(invoke(), (error) => error.status === 401);
  }
  assert.equal(requests, 3);
}
console.log(`Package version check passed for ${expected}: ESM and CommonJS, three native HTTP paths each.`);
