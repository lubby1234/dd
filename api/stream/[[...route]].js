// api/stream/[...route].js
// Vercel Node Runtime — CommonJS

const http  = require('http');
const https = require('https');
const { URL } = require('url');

/** Default spoofed headers for all upstream requests */
const HEADERS = {
  'User-Agent': 'Mozilla/5.0',
  'Origin':     'https://forcedtoplay.xyz',
  'Referer':    'https://forcedtoplay.xyz/'
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

module.exports = async function handler(req, res) {
  try {
    // Parse the *full* URL that hit the function
    const urlObj = new URL(req.url, `http://${req.headers.host}`);

    /* ---------------- 1) AES-key proxy (/api/stream/key?...) ------------ */
    const trimmedPath = urlObj.pathname.replace(/^\/api\/stream/, '');
    if (trimmedPath === '/key') {
      // CORS pre-flight
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin':  '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': '*'
        });
        return res.end();
      }

      const qs    = urlObj.searchParams.toString();
      const keyUp = `https://top2.newkso.ru/wmsxx.php?${qs}`;
      const keyRs = await fetchUrl(keyUp, { Origin: 'https://forcedtoplay.xyz' });

      res.writeHead(keyRs.statusCode, {
        'Content-Type':               'application/octet-stream',
        'Content-Length':             keyRs.body.length,
        'Access-Control-Allow-Origin': '*'
      });
      return res.end(keyRs.body);
    }

    /* ---------------- 2) Main playlist proxy (/api/stream?id=…) --------- */
    const id = urlObj.searchParams.get('id');
    if (!id) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      return res.end('Missing id parameter');
    }

   // (a) Scrape auth vars and dynamic domain from embedded player HTML
  const htmlUrl = `https://forcedtoplay.xyz/premiumtv/daddylivehd.php?id=${id}`;
  const html    = (await fetchUrl(htmlUrl)).body.toString('utf8');
  
  // Extract required JS vars
  const channelKey = html.match(/var\s+channelKey\s*=\s*"([^"]+)";/)[1];
  const authTs     = html.match(/var\s+authTs\s*=\s*"([^"]+)";/)[1];
  const authRnd    = html.match(/var\s+authRnd\s*=\s*"([^"]+)";/)[1];
  const authSig    = html.match(/var\s+authSig\s*=\s*"([^"]+)";/)[1];
  
  // 🔥 Extract dynamic subdomain (e.g. "top2new") from player JS
  const domainMatch = html.match(/https:\/\/([a-z0-9]+new)\.newkso\.ru/i);
  if (!domainMatch) throw new Error('Failed to extract dynamic upstream domain');
  const dynamicHost = `${domainMatch[1]}.newkso.ru`;
  
  // (b) Auth handshake to dynamic domain
  const authUrl = `https://${dynamicHost}/auth.php?channel_id=${channelKey}` +
                  `&ts=${authTs}&rnd=${authRnd}&sig=${encodeURIComponent(authSig)}`;
  
  const authJson = JSON.parse((await fetchUrl(authUrl)).body.toString('utf8'));
  if (authJson.status !== 'ok') throw new Error('Auth API returned error');

    // (c) CDN shard lookup
    const lookupUrl = `https://forcedtoplay.xyz/server_lookup.php?channel_id=${channelKey}`;
    const { server_key: sk } =
      JSON.parse((await fetchUrl(lookupUrl)).body.toString('utf8'));

    // (d) Master playlist URL
    const m3u8Url = (sk === 'top1/cdn')
      ? `https://top1.newkso.ru/top1/cdn/${channelKey}/mono.m3u8`
      : `https://${sk}new.newkso.ru/${sk}/${channelKey}/mono.m3u8`;

    // (e) Fetch & rewrite key URI
    let playlist = (await fetchUrl(m3u8Url)).body.toString('utf8');

    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host  = req.headers['x-forwarded-host'] || req.headers.host;

    playlist = playlist.replace(
      /URI="[^"]*(?:wmsxx\.php|key)\?([^"]+)"/i,
      `URI="${proto}://${host}/api/stream/key?$1"`
    );

    // (f) Send modified playlist
    res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
    return res.end(playlist);

  } catch (err) {
    console.error('Stream Proxy Error:', err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    return res.end('Error: ' + err.message);
  }
};
