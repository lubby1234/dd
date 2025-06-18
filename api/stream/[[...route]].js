// api/stream/[...route].js
// Vercel Node Serverless — CommonJS

const http  = require('http');
const https = require('https');
const { URL } = require('url');

/* ------------------------------------------------------------------ */
/*            Globals that survive across warm invocations            */
/* ------------------------------------------------------------------ */
const HEADERS = {
  'User-Agent': 'Mozilla/5.0',
  Origin:  'https://forcedtoplay.xyz',
  Referer: 'https://forcedtoplay.xyz/'
};

// 24-hour in-memory HTML cache (persists while the Lambda stays warm)
global.htmlCache = global.htmlCache || new Map();
function setHtmlCache(key, value) {
  global.htmlCache.set(key, { value, exp: Date.now() + 86_400_000 });
}
function getHtmlCache(key) {
  const entry = global.htmlCache.get(key);
  if (!entry || Date.now() > entry.exp) {
    global.htmlCache.delete(key);
    return undefined;
  }
  return entry.value;
}

/* ------------------------------------------------------------------ */
/*                         Helper: upstream GET                       */
/* ------------------------------------------------------------------ */
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

/* ------------------------------------------------------------------ */
/*                    Main entry – Vercel request handler             */
/* ------------------------------------------------------------------ */
module.exports = async function handler(req, res) {
  try {
    /* --------------------- Parse path & query --------------------- */
    // Example paths once deployed:
    //  • /api/stream            (main flow)
    //  • /api/stream/key        (key pass-through)
    const parsedUrl   = new URL(req.url, `http://${req.headers.host}`);
    const route       = parsedUrl.pathname.replace(/^\/api\/stream/, '') || '/';

    /* ----------------------- /key pass-through -------------------- */
    if (route === '/key') {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin':  '*',
          'Access-Control-Allow-Methods': 'GET,OPTIONS',
          'Access-Control-Allow-Headers': '*'
        });
        return res.end();
      }

      const keyUrl = `https://top2.newkso.ru/wmsxx.php?${parsedUrl.searchParams.toString()}`;
      const keyRes = await fetchUrl(keyUrl, { Origin: 'https://forcedtoplay.xyz' });

      res.writeHead(keyRes.statusCode, {
        'Content-Type':               'application/octet-stream',
        'Content-Length':             keyRes.body.length,
        'Access-Control-Allow-Origin': '*'
      });
      return res.end(keyRes.body);
    }

    /* --------------------------- Main flow ------------------------ */
    const id = parsedUrl.searchParams.get('id');
    if (!id) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      return res.end('Missing id parameter');
    }

    const embedUrl = `https://forcedtoplay.xyz/premiumtv/daddylivehd.php?id=${id}`;

    let html = getHtmlCache(embedUrl);
    if (!html) {
      const htmlRes = await fetchUrl(embedUrl);
      html = htmlRes.body.toString('utf8');
      setHtmlCache(embedUrl, html);
    }

    /* ---- Extract vars the page defines ---- */
    const channelKey = html.match(/var\s+channelKey\s*=\s*"([^"]+)";/)[1];
    const authTs     = html.match(/var\s+authTs\s*=\s*"([^"]+)";/)[1];
    const authRnd    = html.match(/var\s+authRnd\s*=\s*"([^"]+)";/)[1];
    const authSig    = html.match(/var\s+authSig\s*=\s*"([^"]+)";/)[1];

    /* ---- Build the same auth URL the page uses ---- */
    const authHost = (html.match(/https?:\/\/([^/]+)\/auth\.php/) || [, 'top2new.newkso.ru'])[1];
    const authUrl  = `https://${authHost}/auth.php`
                   + `?channel_id=${channelKey}&ts=${authTs}&rnd=${authRnd}`
                   + `&sig=${encodeURIComponent(authSig)}`;

    const authJson = JSON.parse((await fetchUrl(authUrl)).body.toString('utf8'));
    if (authJson.status !== 'ok') throw new Error('Auth API returned error');

    /* ---- Lookup CDN “server_key” ---- */
    const lookupUrl   = `https://forcedtoplay.xyz/server_lookup.php?channel_id=${channelKey}`;
    const { server_key: sk } =
      JSON.parse((await fetchUrl(lookupUrl)).body.toString('utf8'));

    /* ---- Build the m3u8 URL exactly as the page would ---- */
    const m3u8Url =
      sk === 'top1/cdn'
        ? `https://top1.newkso.ru/${sk}/${channelKey}/mono.m3u8`
        : `https://${sk}new.newkso.ru/${sk}/${channelKey}/mono.m3u8`;

    /* ---- Fetch & patch playlist so keys are proxied through us ---- */
    let playlist = (await fetchUrl(m3u8Url)).body.toString('utf8');
    const proxyHost = req.headers['x-forwarded-host'] || req.headers.host; // vercel.com / custom domain
    playlist = playlist.replace(
      /URI="https:\/\/[^"]+\/wmsxx\.php\?([^"]+)"/,
      `URI="https://${proxyHost}/api/stream/key?$1"`
    );

    res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
    return res.end(playlist);

  } catch (err) {
    console.error('Stream Proxy Error:', err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Error: ' + err.message);
  }
};
