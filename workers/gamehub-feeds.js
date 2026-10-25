// Game Hub feeds: fetches the hub's news feeds server-side so the hub never depends on a third-party relay.
// Google News, KSL and the Tribune block Cloudflare's servers, so they are not listed.
// GET /feeds -> {fetched, feeds:[{url, ok, status, xml}]}. Only the allowlisted feeds below; cached at the edge for 10 minutes.
const FEEDS = [
  'https://www.reddit.com/r/steelers/hot/.rss',
  'https://www.reddit.com/r/UtahUtes/hot/.rss',
  'https://www.bing.com/news/search?q=Pittsburgh+Steelers&format=rss',
  'https://www.bing.com/news/search?q=%22Utah+Utes%22+football&format=rss',
  'https://www.behindthesteelcurtain.com/rss/current.xml',
  'https://steelersdepot.com/feed/',
  'https://www.deseret.com/arc/outboundfeeds/rss/category/sports/utah-utes/?outputType=xml'
];
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 GameHubFeeds/1.0';
const TTL = 600;

async function grab(url) {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8' },
      cf: { cacheTtl: TTL, cacheEverything: true }
    });
    const xml = await r.text();
    const ok = r.ok && /<(rss|feed|rdf:RDF)[\s>]/i.test(xml.slice(0, 2000));
    return { url, ok, status: r.status, xml: ok ? xml : '' };
  } catch (e) {
    return { url, ok: false, status: 0, xml: '' };
  }
}

export default {
  async fetch(req, env, ctx) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const u = new URL(req.url);
    if (u.pathname !== '/feeds') return new Response('Game Hub feeds', { headers: CORS });
    const cache = caches.default;
    const key = new Request(u.origin + '/feeds?list=' + FEEDS.length);
    const hit = await cache.match(key);
    if (hit) return hit;
    const feeds = await Promise.all(FEEDS.map(grab));
    const res = new Response(JSON.stringify({ fetched: new Date().toISOString(), feeds }), {
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=' + TTL }
    });
    if (feeds.some(f => f.ok)) ctx.waitUntil(cache.put(key, res.clone()));
    return res;
  }
};
