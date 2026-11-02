import { readFileSync } from 'node:fs';
const fixture = name => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8').replaceAll('bitcoin', 'coffee');
globalThis.fetch = async (url, init) => {
  if (process.env.TRENDS_TEST_FAILURE === 'blocked') return new Response('captcha');
  if (process.env.TRENDS_TEST_FAILURE === 'rate') return new Response('', { status: 429 });
  if (process.env.TRENDS_TEST_FAILURE === 'server') return new Response('', { status: 503 });
  const path = new URL(url).pathname;
  if (init.method === 'HEAD') return new Response(null, { headers: { 'set-cookie': 'NID=offline; Path=/' } });
  if (path.endsWith('/explore')) return new Response(fixture('explore-single-world.txt'));
  if (path.endsWith('/multiline')) return new Response(fixture('multiline-single-custom.txt'));
  throw new Error('Network is disabled in CLI tests');
};
