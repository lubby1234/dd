// api/stream.js
// Vercel Node Runtime — CommonJS style

const http  = require('http');
const https = require('https');
const { URL } = require('url');

/** Default spoofed headers for all upstream requests */
const HEADERS = {
  'User-Agent': 'Mozilla/5.0',
  'Origin': 'https://forcedtoplay.xyz',
  'Referer': 'https://forcedtoplay.xyz/'
};

/**
 * Simple fetch helper that works inside the Node Serverless Runtime.
 * Uses http/https core modules so it’s compatible even when global fetch
 * isn’t available.
 */
function fetchUrl (url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const lib     = url.startsWith('https://') ? https : http;
    const headers = { ...HEADERS, ...extraHeaders };

    lib.get(url, { headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
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

/**
 * Main entry point — Vercel passes (req, res) exactly like Express.
 * Hit it at:
 *   https://<project>.vercel.app/api/stream?id=premium324
 * or for key rewrites:
 *   https://<project>.vercel.app/api/stream/key?<query>
 */
module.exports = async function handler (req, res) {
  try {
    // Parse original URL (includes path after /api/stream)
    const urlObj = new URL(req.url, `http://${req.headers.host}`);

    /* ---------------------------------------------------- *
     * 1) Handle AES-key proxy  (/key?...params)
     * ---------------------------------------------------- */
    if (urlObj.pathname === '/key') {
      // CORS pre-flight
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin':  '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': '*'
        });
        return res.end();
      }

      const queryString = urlObj.searchParams.toString();
      const keyUrl      = `https://top2.newkso.ru/wmsxx.php?${queryString}`;

      const keyRes = await fetchUrl(keyUrl, { Origin: 'https://forcedtoplay.xyz' });

      res.writeHead(keyRes.statusCode, {
        'Content-Type':              'application/octet-stream',
        'Content-Length':            keyRes.body.length,
        'Access-Control-Allow-Origin': '*'
      });
      return res.end(keyRes.body);
    }

    /* ---------------------------------------------------- *
     * 2) Main playlist proxy  (/stream?id=...)
     * ---------------------------------------------------- */
    const id = urlObj.searchParams.get('id');
    if (!id) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      return res.end('Missing id parameter');
    }

    // (a) Fetch the embedded player HTML to scrape auth vars
    const htmlUrl = `https://forcedtoplay.xyz/premiumtv/daddylivehd.php?id=${id}`;
    const htmlRes = await fetchUrl(htmlUrl);
    const html    = htmlRes.body.toString('utf8');

    // (b) Extract JS variables
    const channelKey = html.match(/var\s+channelKey\s*=\s*"([^"]+)";/)[1];
    const authTs     = html.match(/var\s+authTs\s*=\s*"([^"]+)";/)[1];
    const authRnd    = html.match(/var\s+authRnd\s*=\s*"([^"]+)";/)[1];
    const authSig    = html.match(/var\s+authSig\s*=\s*"([^"]+)";/)[1];

    // (c) Auth request to get temporary access
    const authUrl = `https://top2new.newkso.ru/auth.php?channel_id=${channelKey}` +
                    `&ts=${authTs}&rnd=${authRnd}&sig=${encodeURIComponent(authSig)}`;

    const authResApi = await fetchUrl(authUrl);
    const authJson   = JSON.parse(authResApi.body.toString('utf8'));
    if (authJson.status !== 'ok') throw new Error('Auth API returned error');

    // (d) Lookup which CDN shard to hit
    const lookupUrl = `https://forcedtoplay.xyz/server_lookup.php?channel_id=${channelKey}`;
    const lookupRes = await fetchUrl(lookupUrl);
    if (lookupRes.statusCode !== 200) throw new Error('Lookup API error');

    const { server_key: sk } = JSON.parse(lookupRes.body.toString('utf8'));

    // (e) Build the master playlist URL
    const m3u8Url = (sk === 'top1/cdn')
      ? `https://top1.newkso.ru/top1/cdn/${channelKey}/mono.m3u8`
      : `https://${sk}new.newkso.ru/${sk}/${channelKey}/mono.m3u8`;

    // (f) Retrieve and rewrite its key URI to point back to us
    const m3u8Res  = await fetchUrl(m3u8Url);
    let playlist   = m3u8Res.body.toString('utf8');
    const hostHdr  = req.headers['x-forwarded-host'] || req.headers.host;
    playlist = playlist.replace(
      /URI="https:\/\/[^"]+\/wmsxx\.php\?([^"]+)"/,
      `URI="https://${hostHdr}/api/stream/key?$1"`
    );

    // (g) Respond with modified playlist
    res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
    res.end(playlist);

  } catch (err) {
    console.error('Stream Proxy Error:', err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Error: ' + err.message);
  }
};
