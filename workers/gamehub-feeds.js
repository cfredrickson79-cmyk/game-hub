// Game Hub feeds: fetches the hub's news feeds server-side so the hub never depends on a third-party relay.
// Google News, KSL and the Tribune block Cloudflare's servers, so they are not listed.
// Headlines pass through the profanity filter below before they leave the Worker.
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
// Profanity filter shared by the gamehub-feeds Worker and the hub page.
// Each match becomes [[rx:N]] (N = length); the hub draws that as a blurred placeholder, so the word itself never reaches the screen.
// Patterns are anchored to word starts to avoid false hits (Dick LeBeau, Gamecocks, "fire retardant", Cockburn, Scunthorpe).
var RX_PATTERNS = [
  /\bf+[u\*@#v]+c+k+\w*/gi,                 // fuck, fucking, fvck, f*ck, fuuuck
  /\bf+[\*#@$]{2,}\w*/gi,                   // f***, f**king
  /\bf(?:ck|cking|ckin|kn|king|kin|uk|uks|ukin\w*|ucc\w*)\b/gi, // fck, fkn, fking, fuk (not Fuqua: Frenchy Fuqua is a Steelers legend)
  /\bmotherf\w*/gi, /\bmf(?:er|ers|ing|in)?\b/gi, /\bmofo\w*/gi,
  /\b(?:wtf|stfu|gtfo|lmfao)\b/gi,
  /\b(?:bull|horse|dip|chicken)?sh[i1!\*]+t(?:s|ty|tier|tiest|ting|ted|show|shows|head|heads|bag|bags|ter)?\b/gi, // shit, sh*t, bullshit, shitty (not shiitake)
  /\bs\*{2,}t?\b/gi,                        // s**t
  /\bshite?\b/gi,
  /\b(?:dumb|jack|bad|smart|fat|lame)?ass(?:hole|holes|hat|es|wipe)?\b/gi, // ass, asshole, dumbass (not class/assist)
  /\ba[\*\$]{2,}(?:hole)?\w*/gi,            // a**, a**hole
  /\bb[i1!\*]+tch\w*/gi,                    // bitch, b*tch
  /\b(?:god)?damn(?:it|ed|n)?\b/gi, /\bgoddam\w*/gi,
  /\bbastard\w*/gi, /\bpiss(?:ed|ing|es)?\b/gi, /\bdouche\w*/gi,
  /\bcunt\w*/gi, /\bpuss(?:y|ies)\b/gi, /\bdickhead\w*/gi,
  /\bn[i1!]gg\w*/gi, /\bfag(?:s|got\w*)?\b/gi, /\bretard(?:s|ed)?\b/gi
];
function rxClean(s) {
  s = String(s || '');
  for (var i = 0; i < RX_PATTERNS.length; i++) {
    RX_PATTERNS[i].lastIndex = 0;
    s = s.replace(RX_PATTERNS[i], function (m) { return '[[rx:' + Math.min(10, Math.max(3, m.length)) + ']]'; });
  }
  return s;
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 GameHubFeeds/1.0';
const TTL = 600;

async function grab(url) {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8' },
      cf: { cacheTtl: TTL, cacheEverything: true }
    });
    // headlines only: links keep their original text so they still open
    const xml = (await r.text()).replace(/(<title[^>]*>)([\s\S]*?)(<\/title>)/gi, (m, a, b, c) => a + rxClean(b) + c);
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
    const key = new Request(u.origin + '/feeds?v=3&list=' + FEEDS.length);
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
