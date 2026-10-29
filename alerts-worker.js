// Game Hub alerts: watches the hub schedule + ESPN, sends web push for time set/changed,
// 72 hours out and 1 hour out. KV binding: GH. Cron: every minute.
const HUB_RAW = 'https://raw.githubusercontent.com/cfredrickson79-cmyk/game-hub/main/game_hub_2026.html';
const HUB_URL = 'https://cfredrickson79-cmyk.github.io/game-hub/';
const ALLOW_ORIGINS = ['https://cfredrickson79-cmyk.github.io'];
const ESPN = {
  pitt: ['23', 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/pit/schedule?season=2026&seasontype=2'],
  utes: ['254', 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams/254/schedule?season=2026&seasontype=2']
};
const TEAM_LABEL = { pitt: 'Steelers', utes: 'Utes' };
const APP_NAME = { espn: 'ESPN', fox: 'Fox One', yt: 'YouTube TV', prime: 'Prime Video', pcock: 'Peacock', nfl: 'NFL+', max: 'Max', pplus: 'Paramount+' };
const REFRESH_MS = 15 * 60 * 1000;
const WINDOW_MS = 30 * 60 * 1000;
const HOUR = 3600 * 1000;
const MO = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

// ---------- small helpers ----------
const enc = new TextEncoder();
function b64u(buf) {
  const b = new Uint8Array(buf); let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64u(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
  const bin = atob(s); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function concat(...parts) {
  const n = parts.reduce((a, p) => a + p.length, 0); const out = new Uint8Array(n); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
function mtParts(ms) {
  const o = {};
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
    .formatToParts(new Date(ms)).forEach(p => { o[p.type] = p.value; });
  return { date: o.weekday + ' ' + o.month + ' ' + o.day, time: o.hour + ':' + o.minute + String(o.dayPeriod || '').charAt(0).toLowerCase() };
}
function mtHour(ms) {
  return +new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', hour: 'numeric', hourCycle: 'h23' }).format(new Date(ms)) % 24;
}
function etMidnight(ms) {
  const o = {};
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ms)).forEach(p => { o[p.type] = p.value; });
  return (+o.hour % 24) === 0 && +o.minute === 0;
}
// Mountain wall-clock -> UTC ms
function mtToUtc(y, m, d, h, mi) {
  let guess = Date.UTC(y, m, d, h + 7, mi);
  for (let i = 0; i < 2; i++) {
    const o = {};
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(guess)).forEach(p => { o[p.type] = p.value; });
    const shown = Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour % 24, +o.minute);
    guess += Date.UTC(y, m, d, h, mi) - shown;
  }
  return guess;
}

// ---------- schedule ----------
function parseRows(html, name) {
  const m = new RegExp('var ' + name + '=(\\[[\\s\\S]*?\\n\\]);').exec(html);
  return m ? JSON.parse(m[1]) : [];
}
function rowKickoff(r) {
  const dm = /^[A-Z][a-z]{2} ([A-Z][a-z]{2}) (\d{1,2})$/.exec(r[0] || '');
  const tm = /^(\d{1,2}):(\d{2})([ap])$/.exec(r[2] || '');
  if (!dm || !tm || MO[dm[1]] === undefined) return null;
  const mo = MO[dm[1]]; let h = +tm[1]; const mi = +tm[2];
  if (tm[3] === 'p' && h < 12) h += 12; if (tm[3] === 'a' && h === 12) h = 0;
  return mtToUtc(mo < 6 ? 2027 : 2026, mo, +dm[2], h, mi);
}
function espnNet(team, comp) {
  const b = (comp.broadcasts || []).slice().sort((x, y) => {
    const nat = z => /national/i.test(String((z && z.market && (z.market.type || z.market)) || '')) ? 0 : 1;
    return nat(x) - nat(y);
  });
  let names = [];
  b.forEach(x => { if (x.media && x.media.shortName) names.push(x.media.shortName); if (x.names) names = names.concat(x.names); });
  for (const raw of names) {
    const n = String(raw).toUpperCase().trim();
    if (team === 'pitt') {
      if (/^(CBS|FOX)$/.test(n)) return null;
      if (/NBC|PEACOCK/.test(n)) return 'pcock';
      if (/PRIME/.test(n)) return 'prime';
      if (/^(ESPN|ESPN2|ABC|ESPN\+)$/.test(n)) return 'espn';
      if (/^(NFL NETWORK|NFL NET|NFLN|NFL\+)$/.test(n)) return 'nfl';
      if (/YOUTUBE/.test(n)) return 'yt';
    } else {
      if (/^(ESPN|ESPN2|ESPNU|ESPN\+|ABC|ESPNEWS)$/.test(n)) return 'espn';
      if (/^(FOX|FS1)$/.test(n)) return 'fox';
      if (/^(TNT|TRUTV|TBS|MAX|HBO MAX)$/.test(n)) return 'max';
    }
  }
  return null;
}
async function buildGames(fetchFn) {
  const html = await (await fetchFn(HUB_RAW + '?t=' + Date.now(), { cf: { cacheTtl: 0 } })).text();
  const rows = { pitt: parseRows(html, 'steel'), utes: parseRows(html, 'utes') };
  if (!rows.pitt.length || !rows.utes.length) throw new Error('hub schedule not found');
  const games = {};
  for (const team of ['pitt', 'utes']) {
    let evs = [];
    try {
      const r = await fetchFn(ESPN[team][1]);
      if (r.ok) evs = ((await r.json()).events || []).slice().sort((a, b) => new Date(a.date) - new Date(b.date));
    } catch (e) { evs = []; }
    const used = {}; const seen = {};
    for (const r of rows[team]) {
      if (!r[4] || /\(preseason\)/i.test(r[1])) continue;
      seen[r[4]] = (seen[r[4]] || 0) + 1;
      const id = team + ':' + r[4] + ':' + seen[r[4]];
      const g = {
        id, team,
        label: TEAM_LABEL[team] + ' ' + r[1].replace(/\s*\([^)]*\)/g, '').trim(),
        ts: rowKickoff(r), net: r[3], done: false
      };
      const key = r[4].replace(/_c$/, '').replace(/_/g, ' ').toLowerCase();
      for (let i = 0; i < evs.length; i++) {
        if (used[i]) continue;
        const ev = evs[i], comp = (ev.competitions || [])[0];
        if (!comp || !comp.competitors) continue;
        let opp = null; comp.competitors.forEach(c => { if (String(c.id) !== ESPN[team][0]) opp = c; });
        const loc = opp && opp.team ? String(opp.team.location || '').toLowerCase() : '';
        if (loc !== key) continue;
        used[i] = true;
        if (comp.status && comp.status.type && comp.status.type.completed) { g.done = true; break; }
        const valid = ev.timeValid !== false && comp.timeValid !== false && !etMidnight(ev.date);
        if (valid) g.ts = Date.parse(ev.date);
        const net = espnNet(team, comp);
        if (net) g.net = net;
        break;
      }
      if (g.ts && g.net === 'tbd') { /* time known, channel not: keep tbd */ }
      games[id] = g;
    }
  }
  return games;
}
// ---------- channel from the announcement (news headlines) ----------
// ESPN adds a kickoff time on announcement day but the network only once it is picked ("ABC or ESPN").
// When a game has a time and no channel, read recent news headlines about the matchup; if every network
// they name streams in the same family app, use that app (hub + alerts). Anything ambiguous stays TBD.
const TEAM_WORDS = { pitt: ['Steelers', 'Pittsburgh'], utes: ['Utah', 'Utes'] };
const NET_RE = /(?:^|[^A-Za-z])(ABC|ESPN(?:2|U|EWS|\+)?|FOX|Fox|FS1|FS2|CBS|NBC|Peacock|TNT|truTV|TBS|HBO Max|Prime Video|NFL Network|The CW|CW|YouTube)(?![A-Za-z])/g;
const NEWSY_RE = /\b(tv|kick|kickoff|time|times|network|channel|broadcast|watch|stream|scheduled|set for)\b/i;
const HINT_RETRY_MS = 2 * HOUR;
function oppName(g) { return g.label.replace(/^\S+\s+(vs|at)\s+/i, '').trim(); }
function decodeXml(s) { return s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>'); }
async function newsHint(g, now, fetchFn) {
  const opp = oppName(g);
  const q = encodeURIComponent(TEAM_WORDS[g.team][0] + ' ' + opp + ' kickoff TV when:7d');
  const r = await fetchFn('https://news.google.com/rss/search?q=' + q + '&hl=en-US&gl=US&ceid=US:en', { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error('news ' + r.status);
  const xml = await r.text();
  const oppWords = opp.split(/\s+/).filter(w => w.length > 2);
  const apps = new Set(), unknown = new Set(), used = [];
  for (const it of xml.split('<item>').slice(1)) {
    const t = decodeXml((/<title>([\s\S]*?)<\/title>/.exec(it) || [])[1] || '');
    const pd = Date.parse((/<pubDate>([\s\S]*?)<\/pubDate>/.exec(it) || [])[1] || '');
    if (!t || !(pd > now - 7 * 24 * HOUR)) continue;
    const head = t.replace(/\s+-\s+[^-]+$/, ''); // drop " - Source"
    if (!TEAM_WORDS[g.team].some(w => head.includes(w)) || !oppWords.every(w => head.includes(w)) || !NEWSY_RE.test(head)) continue;
    let m, any = false; NET_RE.lastIndex = 0;
    while ((m = NET_RE.exec(head))) {
      any = true;
      const net = espnNet(g.team, { broadcasts: [{ media: { shortName: m[1].toUpperCase() } }] });
      if (net) apps.add(net); else unknown.add(m[1]);
    }
    if (any) used.push(head);
  }
  const net = apps.size === 1 && !unknown.size ? [...apps][0] : null;
  return { net, apps: [...apps], unknown: [...unknown], headlines: used.slice(0, 5) };
}
async function applyNetHints(env, games, now, fetchFn) {
  const hints = (await env.GH.get('netHints', 'json')) || {};
  let dirty = false;
  for (const id in hints) if (!games[id] || games[id].done || (hints[id].ts && hints[id].ts < now - 2 * 24 * HOUR)) { delete hints[id]; dirty = true; }
  for (const id in games) {
    const g = games[id];
    if (g.done || !g.ts || g.ts <= now || g.net !== 'tbd') continue;
    let h = hints[id];
    if (!h || h.ts !== g.ts || (!h.net && now - h.at >= HINT_RETRY_MS)) {
      try { h = Object.assign({ ts: g.ts, at: now }, await newsHint(g, now, fetchFn)); }
      catch (e) { h = { ts: g.ts, at: now, net: null, err: String(e.message || e) }; }
      hints[id] = h; dirty = true;
    }
    if (h.net && APP_NAME[h.net]) { g.net = h.net; g.netFrom = 'news'; }
  }
  if (dirty) await env.GH.put('netHints', JSON.stringify(hints));
}
function whenText(g) { const p = mtParts(g.ts); return p.date + ' · ' + p.time + ' MT'; }
function appPart(net) { return APP_NAME[net] ? ' · ' + APP_NAME[net] : ''; }
// Two title styles: 'full' = "Label: matchup" / detail ; 'label' = "Label" / "matchup · detail". KV key 'titleStyle' picks.
function two(id, lab, matchup, detail, g) {
  const tl = TEAM_LABEL[g.team] || '';
  return { id, net: g.net, ts: g.ts, full: { title: lab + ': ' + matchup, body: detail }, label: { title: lab, body: matchup + ' · ' + detail },
    team: { title: tl, body: lab + ' · ' + matchup.replace(tl + ' ', '') + ' · ' + detail } };
}
function pick(a, style) { return a[style] || a.full || { title: a.title, body: a.body }; }
function diffAnnouncements(oldG, newG, now) {
  const out = [];
  for (const id in newG) {
    const n = newG[id], o = oldG[id];
    if (!o || n.done || !n.ts || n.ts <= now) continue;
    if (!o.ts) {
      out.push(two(id, 'Time set', n.label, whenText(n), n));
    } else if (o.ts !== n.ts) {
      const np = mtParts(n.ts), op = mtParts(o.ts);
      const nowTxt = np.date === op.date ? np.time + ' MT' : np.date + ' · ' + np.time + ' MT';
      const wasTxt = np.date === op.date ? op.time : op.date + ' ' + op.time;
      out.push(two(id, 'Time change', n.label, 'Now ' + nowTxt + ', was ' + wasTxt, n));
    } else if (o.net !== n.net && APP_NAME[n.net]) {
      out.push(two(id, 'Channel change', n.label, whenText(n), n));
    }
  }
  return out;
}

// ---------- web push ----------
async function vapidKeys(env) {
  let v = await env.GH.get('vapid', 'json');
  if (v) return v;
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  v = { jwk: await crypto.subtle.exportKey('jwk', kp.privateKey), pub: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)) };
  await env.GH.put('vapid', JSON.stringify(v));
  return v;
}
async function vapidAuth(endpoint, v, now) {
  const aud = new URL(endpoint).origin;
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: HUB_URL })));
  const key = await crypto.subtle.importKey('jwk', v.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(head + '.' + claims));
  return 'vapid t=' + head + '.' + claims + '.' + b64u(sig) + ', k=' + v.pub;
}
async function hkdf(salt, ikm, info, bits) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, bits));
}
async function encryptPayload(sub, text) {
  const uaPub = unb64u(sub.keys.p256dh), auth = unb64u(sub.keys.auth);
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(auth, shared, concat(enc.encode('WebPush: info\0'), uaPub, asPub), 256);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 128);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 96);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(enc.encode(text), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]);
  return concat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}
async function pushOne(sub, msg, v, now, ttl, fetchFn) {
  const out = { title: msg.title, body: msg.body, icon: msg.icon, tag: msg.tag, url: msg.url };
  if (msg.app && /push\.apple\.com/.test(sub.endpoint)) out.body += ' · ' + msg.app;
  const body = await encryptPayload(sub, JSON.stringify(out));
  const r = await fetchFn(sub.endpoint, {
    method: 'POST',
    headers: { Authorization: await vapidAuth(sub.endpoint, v, now), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(Math.round(ttl / 1000)), Urgency: 'high' },
    body
  });
  return r.status;
}
async function broadcast(env, msg, ttl, now, fetchFn, onlyEndpoint) {
  const subs = (await env.GH.get('subs', 'json')) || [];
  const v = await vapidKeys(env);
  const keep = []; const results = [];
  for (const s of subs) {
    if (onlyEndpoint && s.endpoint !== onlyEndpoint) { keep.push(s); continue; }
    let st = 0;
    try { st = await pushOne(s, msg, v, now, ttl, fetchFn); } catch (e) { st = -1; }
    results.push(st);
    if (st === 404 || st === 410) continue;
    keep.push(s);
  }
  if (keep.length !== subs.length) await env.GH.put('subs', JSON.stringify(keep));
  return results;
}
function message(base, env, net, tag) {
  return { title: base.title, body: base.body, app: APP_NAME[net] || '', icon: APP_NAME[net] ? env.SELF + '/logo/' + net + '.png' : HUB_URL + 'icon-192.png', tag, url: HUB_URL };
}

// ---------- the every-minute tick ----------
export async function tick(env, now, fetchFn) {
  let st = (await env.GH.get('state', 'json')) || { games: null, sent: {}, queue: [], refreshedAt: 0 };
  let dirty = false; const log = [];
  const style = (await env.GH.get('titleStyle')) || 'full';
  if (!st.games || now - st.refreshedAt >= REFRESH_MS) {
    try {
      const games = await buildGames(fetchFn);
      try { await applyNetHints(env, games, now, fetchFn); } catch (e) { log.push('hints failed: ' + e.message); }
      if (st.games) for (const a of diffAnnouncements(st.games, games, now)) { st.queue.push(a); log.push('queued ' + a.title); }
      st.games = games; st.refreshedAt = now; dirty = true;
    } catch (e) { log.push('refresh failed: ' + e.message); }
  }
  const games = st.games || {};
  // reminders
  for (const id in games) {
    const g = games[id];
    if (g.done || !g.ts || g.ts <= now) continue;
    for (const [kind, lead, ttl] of [['72', 72 * HOUR, 6 * HOUR], ['1', HOUR, HOUR]]) {
      const k = id + '|' + kind + '|' + g.ts;
      if (st.sent[k] || now < g.ts - lead || now >= g.ts - lead + WINDOW_MS) continue;
      const p = mtParts(g.ts);
      const base = pick(kind === '72'
        ? two(id, '72 hours out', g.label, whenText(g), g)
        : two(id, 'Kickoff in 1 hour', g.label, p.time + ' MT', g), style);
      await broadcast(env, message(base, env, g.net, id + '|' + kind), ttl, now, fetchFn);
      st.sent[k] = now; dirty = true; log.push('sent ' + base.title);
    }
  }
  // announcements, held 10p-7a MT
  if (st.queue.length) {
    const h = mtHour(now);
    const quiet = h >= 22 || h < 7;
    const live = st.queue.filter(a => a.ts > now);
    if (live.length !== st.queue.length) { st.queue = live; dirty = true; }
    if (!quiet && st.queue.length) {
      for (const a of st.queue) { const m = pick(a, style); await broadcast(env, message(m, env, a.net, a.id + '|ann'), 12 * HOUR, now, fetchFn); log.push('sent ' + m.title); }
      st.queue = []; dirty = true;
    }
  }
  // prune sent keys for past games
  for (const k in st.sent) { const ts = +k.split('|')[2]; if (ts < now - 2 * 24 * HOUR) { delete st.sent[k]; dirty = true; } }
  if (dirty) await env.GH.put('state', JSON.stringify(st));
  return log;
}

// ---------- logos (served from the hub's own baked logos) ----------
async function logo(env, code, fetchFn) {
  const cached = await env.GH.get('logo:' + code, 'arrayBuffer');
  let bytes = cached ? new Uint8Array(cached) : null; let type = (await env.GH.get('logotype:' + code)) || 'image/png';
  if (!bytes) {
    const html = await (await fetchFn(HUB_RAW)).text();
    const m = /<script id="baked-logos" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
    if (!m) return null;
    const L = JSON.parse(m[1])[code];
    if (!L || !L.src) return null;
    const mm = /^data:([^;]+);base64,(.*)$/.exec(L.src);
    if (!mm) return null;
    type = mm[1]; bytes = unb64u(mm[2].replace(/\+/g, '-').replace(/\//g, '_'));
    await env.GH.put('logo:' + code, bytes); await env.GH.put('logotype:' + code, type);
  }
  return new Response(bytes, { headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=604800', 'Access-Control-Allow-Origin': '*' } });
}

function cors(req) {
  const o = req.headers.get('Origin');
  return { 'Access-Control-Allow-Origin': ALLOW_ORIGINS.includes(o) ? o : ALLOW_ORIGINS[0], 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' };
}
function json(obj, req, status) { return new Response(JSON.stringify(obj), { status: status || 200, headers: Object.assign({ 'Content-Type': 'application/json' }, cors(req)) }); }

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url); env.SELF = url.origin;
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
    if (url.pathname === '/vapid') return json({ key: (await vapidKeys(env)).pub }, req);
    if (url.pathname === '/subscribe' && req.method === 'POST') {
      const b = await req.json().catch(() => ({}));
      const s = b.sub;
      if (!s || !s.endpoint || !s.keys || !s.keys.p256dh || !s.keys.auth || !/^https:\/\//.test(s.endpoint)) return json({ ok: false }, req, 400);
      const subs = ((await env.GH.get('subs', 'json')) || []).filter(x => x.endpoint !== s.endpoint);
      subs.push({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth }, at: Date.now() });
      await env.GH.put('subs', JSON.stringify(subs));
      return json({ ok: true }, req);
    }
    if (url.pathname === '/unsubscribe' && req.method === 'POST') {
      const b = await req.json().catch(() => ({}));
      const subs = (await env.GH.get('subs', 'json')) || [];
      const keep = subs.filter(x => x.endpoint !== b.endpoint);
      if (keep.length !== subs.length) await env.GH.put('subs', JSON.stringify(keep));
      return json({ ok: true }, req);
    }
    if (url.pathname === '/test' && req.method === 'POST') {
      const admin = await env.GH.get('admin');
      if (!admin || url.searchParams.get('k') !== admin) return json({ ok: false }, req, 403);
      const b = await req.json().catch(() => ({}));
      const owner = await env.GH.get('owner');
      const r = await broadcast(env, message({ title: b.title || 'Game Hub test', body: b.body || 'Test alert' }, env, b.net || '', b.tag || 'test'), 600 * 1000, Date.now(), fetch, owner || undefined);
      return json({ ok: true, results: r }, req);
    }
    if (url.pathname === '/status') {
      const st = (await env.GH.get('state', 'json')) || {};
      const subs = (await env.GH.get('subs', 'json')) || [];
      const now = Date.now();
      const up = Object.values(st.games || {}).filter(g => g.ts && g.ts > now && !g.done).sort((a, b) => a.ts - b.ts).slice(0, 4)
        .map(g => ({ game: g.label, when: whenText(g), app: APP_NAME[g.net] || 'TBD' }));
      return json({ subscribers: subs.length, refreshed: st.refreshedAt ? new Date(st.refreshedAt).toISOString() : null, queued: (st.queue || []).map(a => pick(a, 'full').title), next: up }, req);
    }
    if (url.pathname === '/hints') {
      const probe = url.searchParams.get('probe');
      if (probe) {
        const st = (await env.GH.get('state', 'json')) || {}; const g = (st.games || {})[probe];
        if (!g) return json({ error: 'no such game' }, req, 404);
        return json(Object.assign({ game: g.label }, await newsHint(g, Date.now(), fetch)), req);
      }
      const h = (await env.GH.get('netHints', 'json')) || {}; const out = {};
      for (const id in h) if (h[id].net) out[id] = { net: h[id].net, ts: h[id].ts };
      return json(out, req);
    }
    const lm = /^\/logo\/([a-z]+)\.png$/.exec(url.pathname);
    if (lm) { const r = await logo(env, lm[1], fetch); return r || new Response('not found', { status: 404 }); }
    return new Response('Game Hub alerts', { headers: { 'Content-Type': 'text/plain' } });
  },
  async scheduled(event, env, ctx) {
    env.SELF = env.SELF_URL || '';
    ctx.waitUntil(tick(env, Date.now(), fetch));
  }
};
