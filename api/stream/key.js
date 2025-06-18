// api/stream/key.js
const http  = require('http');
const https = require('https');
const { URL } = require('url');

/* -- same headers helper -------------------------------------- */
const HEADERS = {
  'User-Agent': 'Mozilla/5.0',
  Origin:  'https://forcedtoplay.xyz',
  Referer: 'https://forcedtoplay.xyz/'
};
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https://') ? https : http;
    lib.get(url, { headers: HEADERS }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () =>
        resolve({
          statusCode: res.statusCode,
          body:       Buffer.concat(chunks)
        })
      );
    }).on('error', reject);
  });
}

/* -- optional one-time auth to avoid 403 on cold start -------- */
global.authed = global.authed || new Set();
async function ensureAuth(channelKey) {
  if (global.authed.has(channelKey)) return;
  const now = Date.now().toString().slice(0, 10);
  const rnd = Math.random().toString(16).slice(2, 10);
  const fakeSig = '00000000000000000000000000000000'; // placeholder
  const url = `https://top2new.newkso.ru/auth.php?channel_id=${channelKey}&ts=${now}&rnd=${rnd}&sig=${fakeSig}`;
  try { await fetchUrl(url); } catch (_) {}
  global.authed.add(channelKey);
}

/* ---------------- lambda handler ----------------------------- */
module.exports = async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      return res.writeHead(204, {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
        'Access-Control-Allow-Headers': '*'
      }).end();
    }

    const url    = new URL(req.url, `http://${req.headers.host}`);
    const params = url.searchParams.toString();

    /* extract channelKey from ?name=premium324… */
    const name   = url.searchParams.get('name') || '';
    const channelKey = name.replace(/^premium/, '');
    if (channelKey) await ensureAuth(channelKey);

    const keyUrl = `https://top2.newkso.ru/wmsxx.php?${params}`;
    const keyRes = await fetchUrl(keyUrl);

    res.writeHead(keyRes.statusCode, {
      'Content-Type':               'application/octet-stream',
      'Content-Length':             keyRes.body.length,
      'Access-Control-Allow-Origin': '*'
    }).end(keyRes.body);

  } catch (e) {
    console.error(e);
    res.writeHead(500).end('Error: ' + e.message);
  }
};
