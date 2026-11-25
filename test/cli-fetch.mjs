import { readFileSync } from 'node:fs';
const fixture = (name, keyword = 'coffee') => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8').replaceAll('bitcoin', keyword);
globalThis.fetch = async (url, init) => {
  if (process.env.TRENDS_TEST_FAILURE === 'blocked') return new Response('captcha');
  if (process.env.TRENDS_TEST_FAILURE === 'rate') return new Response('', { status: 429 });
  if (process.env.TRENDS_TEST_FAILURE === 'server') return new Response('', { status: 503 });
  const parsed = new URL(url);
  const path = parsed.pathname;
  let keyword = 'coffee';
  if (path.endsWith('/explore')) {
    const req = JSON.parse(parsed.searchParams.get('req'));
    keyword = req.comparisonItem?.[0]?.keyword ?? keyword;
  }
  if (init.method === 'HEAD') return new Response(null, { headers: { 'set-cookie': 'NID=offline; Path=/' } });
  if (path.endsWith('/explore')) return new Response(fixture('explore-single-world.txt', keyword));
  if (path.endsWith('/multiline')) return new Response(fixture('multiline-single-custom.txt', keyword));
  throw new Error('Network is disabled in CLI tests');
};
