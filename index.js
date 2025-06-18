const http    = require('http');
const https   = require('https');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0',
  'Origin':      'https://forcedtoplay.xyz',
  'Referer':     'https://forcedtoplay.xyz/'
};

// ——— Simple 24h in-memory cache for the embed HTML ———
const htmlCache = new Map();
function setHtmlCache(key, value, id, ip) {
  htmlCache.set(key, value);
  console.log(`[HTML Cached] id=${id} ip=${ip} → ${key}`);
  setTimeout(() => {
    htmlCache.delete(key);
    console.log(`[HTML Expired] id=${id} ip=${ip} → ${key}`);
  }, 24 * 60 * 60 * 1000);
}
function getHtmlCache(key) {
  return htmlCache.get(key);
}
// ——————————————————————————————————————————————

function fetchUrl(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const lib     = url.startsWith('https://') ? https : http;
    const headers = { ...HEADERS, ...extraHeaders };
    lib.get(url, { headers }, res => {
      let data = [];
      res.on('data', c => data.push(c));
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers:    res.headers,
        body:       Buffer.concat(data)
      }));
    }).on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);

    // —— AES key proxy (unchanged) ——
    if (urlObj.pathname === '/key') {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': '*'
        });
        return res.end();
      }
      const qs     = urlObj.searchParams.toString();
      const keyUrl = `https://top2.newkso.ru/wmsxx.php?${qs}`;
      console.log('Proxying key fetch to:', keyUrl);
      const keyRes = await fetchUrl(keyUrl, { Origin: 'https://forcedtoplay.xyz' });
      res.writeHead(keyRes.statusCode, {
        'Content-Type':               'application/octet-stream',
        'Content-Length':             keyRes.body.length,
        'Access-Control-Allow-Origin': '*'
      });
      return res.end(keyRes.body);
    }

    // —— Main flow: require ?id=
    const id = urlObj.searchParams.get('id');
    if (!id) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      return res.end('Missing id parameter');
    }

    // Grab client IP
    const ip = req.socket.remoteAddress;

    // 1) Fetch or reuse the cached HTML
    const embedUrl = `https://forcedtoplay.xyz/premiumtv/daddylivehd.php?id=${id}`;
    let html = getHtmlCache(embedUrl);
    if (html) {
      console.log(`[HTML Cache Hit]    id=${id} ip=${ip} → ${embedUrl}`);
    } else {
      console.log(`[HTML Cache MISS]   id=${id} ip=${ip} → ${embedUrl}`);
      const htmlRes = await fetchUrl(embedUrl);
      html = htmlRes.body.toString('utf8');
      setHtmlCache(embedUrl, html, id, ip);
    }

    // 2) Extract auth vars from that HTML
    const channelKey = html.match(/var\s+channelKey\s*=\s*"([^"]+)";/)[1];
    const authTs     = html.match(/var\s+authTs\s*=\s*"([^"]+)";/)[1];
    const authRnd    = html.match(/var\s+authRnd\s*=\s*"([^"]+)";/)[1];
    const authSig    = html.match(/var\s+authSig\s*=\s*"([^"]+)";/)[1];

    // 3) Call auth API
    const authUrl = `https://top2new.newkso.ru/auth.php?channel_id=${channelKey}`
                  + `&ts=${authTs}&rnd=${authRnd}&sig=${encodeURIComponent(authSig)}`;
    const authResApi = await fetchUrl(authUrl);
    const authJson   = JSON.parse(authResApi.body.toString('utf8'));
    if (authJson.status !== 'ok') throw new Error('Auth API returned error');

    // 4) Lookup server_key
    const lookupUrl = `https://forcedtoplay.xyz/server_lookup.php?channel_id=${channelKey}`;
    const lookupRes = await fetchUrl(lookupUrl);
    if (lookupRes.statusCode !== 200) throw new Error('Lookup API error');
    const { server_key: sk } = JSON.parse(lookupRes.body.toString('utf8'));

    // 5) Always fetch a fresh playlist
    const m3u8Url = sk === 'top1/cdn'
      ? `https://top1.newkso.ru/top1/cdn/${channelKey}/mono.m3u8`
      : `https://${sk}new.newkso.ru/${sk}/${channelKey}/mono.m3u8`;

    const m3u8Res = await fetchUrl(m3u8Url);
    let playlist  = m3u8Res.body.toString('utf8');

    // 6) Rewrite key URI and return
    const proxyHost = req.headers.host;
    playlist = playlist.replace(
      /URI=\"https:\/\/[^\"]+\/wmsxx\.php\?([^\"]+)\"/,
      `URI=\"http://${proxyHost}/key?$1\"`
    );

    res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
    res.end(playlist);

  } catch (err) {
    console.error('Stream Proxy Error:', err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Error: ' + err.message);
  }
});

server.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`));
