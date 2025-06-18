// api/stream/key.js
const { fetchUrl, HEADERS } = require('../util');
const { URL } = require('url');

global.authed = global.authed || new Set();
global.keyCache = global.keyCache || new Map();

function getKeyCache(url) {
  const entry = global.keyCache.get(url);
  if (!entry || Date.now() > entry.exp) {
    global.keyCache.delete(url);
    return null;
  }
  return entry.buf;
}

function setKeyCache(url, buf) {
  global.keyCache.set(url, { buf, exp: Date.now() + 86_400_000 });
}

async function getKeyAuthFor(channelKey, embedHtml = null) {
  if (global.authed.has(channelKey)) return;

  if (!embedHtml) {
    const embedUrl = `https://forcedtoplay.xyz/premiumtv/daddylivehd.php?id=${channelKey.replace(/^premium/, '')}`;
    embedHtml = (await fetchUrl(embedUrl)).body.toString('utf8');
  }

  const authTs  = embedHtml.match(/var\s+authTs\s*=\s*"([^"]+)";/)[1];
  const authRnd = embedHtml.match(/var\s+authRnd\s*=\s*"([^"]+)";/)[1];
  const authSig = embedHtml.match(/var\s+authSig\s*=\s*"([^"]+)";/)[1];
  const host    = (embedHtml.match(/https?:\/\/([^\/]+)\/auth\.php/) || [, 'top2new.newkso.ru'])[1];

  const authUrl = `https://${host}/auth.php?channel_id=${channelKey}&ts=${authTs}&rnd=${authRnd}&sig=${encodeURIComponent(authSig)}`;
  const resp    = JSON.parse((await fetchUrl(authUrl)).body.toString('utf8'));
  if (resp.status !== 'ok') throw new Error('Auth API returned: ' + resp.status);

  global.authed.add(channelKey);
}

/**
 * Handler for /api/stream/key
 */
async function handler(req, res) {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
        'Access-Control-Allow-Headers': '*'
      });
      return res.end();
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const params = url.searchParams;
    const channelKey = (params.get('name') || '').toLowerCase();
    if (!channelKey) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      return res.end('Missing name parameter');
    }

    // Ensure we've authenticated this Lambda for this channel
    await getKeyAuthFor(channelKey);

    const keyUrl = `https://top2.newkso.ru/wmsxx.php?${params.toString()}`;

    // Check if we have a cached key
    const cached = getKeyCache(keyUrl);
    if (cached) {
      res.writeHead(200, {
        'Content-Type':               'application/octet-stream',
        'Content-Length':             cached.length,
        'Access-Control-Allow-Origin': '*'
      });
      return res.end(cached);
    }

    // Fetch a fresh key and cache it
    const keyRes = await fetchUrl(keyUrl);
    setKeyCache(keyUrl, keyRes.body);

    res.writeHead(keyRes.statusCode, {
      'Content-Type':               'application/octet-stream',
      'Content-Length':             keyRes.body.length,
      'Access-Control-Allow-Origin': '*'
    });
    return res.end(keyRes.body);

  } catch (err) {
    console.error('Key Proxy Error:', err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Error: ' + err.message);
  }
}

module.exports = handler;
module.exports.getKeyAuthFor = getKeyAuthFor;
