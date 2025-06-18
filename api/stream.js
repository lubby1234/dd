// api/stream.js
const http  = require('http');
const https = require('https');
const { URL } = require('url');

/* ------------ shared constants & helpers ---------------- */
const HEADERS = {
  'User-Agent': 'Mozilla/5.0',
  Origin:  'https://forcedtoplay.xyz',
  Referer: 'https://forcedtoplay.xyz/'
};

function fetchUrl(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const lib     = url.startsWith('https://') ? https : http;
    const headers = { ...HEADERS, ...extraHeaders };
    lib.get(url, { headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () =>
        resolve({
          statusCode: res.statusCode,
          headers:    res.headers,
          body:       Buffer.concat(chunks)
        })
      );
    }).on('error', reject);
  });
}

/* ----- 24-h in-memory cache (per warm lambda) ------------ */
global.htmlCache = global.htmlCache || new Map();
function setHtml(key, val)  { global.htmlCache.set(key, { val, exp: Date.now()+86_400_000 }); }
function getHtml(key)       {
  const e = global.htmlCache.get(key);
  if (!e || Date.now() > e.exp) { global.htmlCache.delete(key); return; }
  return e.val;
}

/* -------------------- lambda handler -------------------- */
module.exports = async (req, res) => {
  try {
    const url   = new URL(req.url, `http://${req.headers.host}`);
    const id    = url.searchParams.get('id');
    if (!id) return res.writeHead(400).end('Missing id parameter');

    /* Fetch the embed HTML (cached) -------------------------------- */
    const embedUrl = `https://forcedtoplay.xyz/premiumtv/daddylivehd.php?id=${id}`;
    let html = getHtml(embedUrl);
    if (!html) {
      html = (await fetchUrl(embedUrl)).body.toString('utf8');
      setHtml(embedUrl, html);
    }

    /* Extract variables ------------------------------------------- */
    const channelKey = html.match(/var\s+channelKey\s*=\s*"([^"]+)";/)[1];
    const authTs     = html.match(/var\s+authTs\s*=\s*"([^"]+)";/)[1];
    const authRnd    = html.match(/var\s+authRnd\s*=\s*"([^"]+)";/)[1];
    const authSig    = html.match(/var\s+authSig\s*=\s*"([^"]+)";/)[1];

    /* Run the auth call (once per cold start) ---------------------- */
    global.authed = global.authed || new Set();
    if (!global.authed.has(channelKey)) {
      const host = (html.match(/https?:\/\/([^/]+)\/auth\.php/) || [, 'top2new.newkso.ru'])[1];
      const authUrl = `https://${host}/auth.php?channel_id=${channelKey}&ts=${authTs}&rnd=${authRnd}&sig=${encodeURIComponent(authSig)}`;
      const authJson = JSON.parse((await fetchUrl(authUrl)).body);
      if (authJson.status !== 'ok') throw new Error('Auth failed');
      global.authed.add(channelKey);
    }

    /* Lookup CDN & build m3u8 URL --------------------------------- */
    const { server_key: sk } =
      JSON.parse((await fetchUrl(`https://forcedtoplay.xyz/server_lookup.php?channel_id=${channelKey}`)).body);
    const m3u8Url =
      sk === 'top1/cdn'
        ? `https://top1.newkso.ru/${sk}/${channelKey}/mono.m3u8`
        : `https://${sk}new.newkso.ru/${sk}/${channelKey}/mono.m3u8`;

    /* Fetch playlist & rewrite key URI ---------------------------- */
    let playlist = (await fetchUrl(m3u8Url)).body.toString('utf8');
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    playlist = playlist.replace(
      /URI="https:\/\/[^"]+\/wmsxx\.php\?([^"]+)"/,
      `URI="https://${host}/api/stream/key?$1"`
    );

    res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' }).end(playlist);
  } catch (e) {
    console.error(e);
    res.writeHead(500).end('Error: ' + e.message);
  }
};
