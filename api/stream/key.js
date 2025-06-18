// api/stream/key.js
const { fetchUrl, HEADERS } = require('../util');
const { URL } = require('url');

/* ---------------- shared one-time auth helper ---------------- */
global.authed = global.authed || new Set();

/**
 * Ensures this Lambda instance has called the correct auth.php for the channel.
 * If html is provided we can extract the real ts/rnd/sig straight away (stream.js case);
 * otherwise we fetch the embed ourselves (first call coming directly to /key).
 */
async function getKeyAuthFor(channelKey, embedHtml = null) {
  if (global.authed.has(channelKey)) return;

  if (!embedHtml) {
    const embedUrl = `https://forcedtoplay.xyz/premiumtv/daddylivehd.php?id=${channelKey.replace(/^premium/, '')}`;
    embedHtml = (await fetchUrl(embedUrl)).body.toString('utf8');
  }

  const authTs  = embedHtml.match(/var\s+authTs\s*=\s*"([^"]+)";/)[1];
  const authRnd = embedHtml.match(/var\s+authRnd\s*=\s*"([^"]+)";/)[1];
  const authSig = embedHtml.match(/var\s+authSig\s*=\s*"([^"]+)";/)[1];
  const host    = (embedHtml.match(/https?:\/\/([^/]+)\/auth\.php/) || [, 'top2new.newkso.ru'])[1];

  const authUrl = `https://${host}/auth.php?channel_id=${channelKey}&ts=${authTs}&rnd=${authRnd}&sig=${encodeURIComponent(authSig)}`;
  const resp    = JSON.parse((await fetchUrl(authUrl)).body);
  if (resp.status !== 'ok') throw new Error('Auth API returned: ' + resp.status);

  global.authed.add(channelKey);
}

module.exports.getKeyAuthFor = getKeyAuthFor;  // exported for stream.js reuse

/* ----------------------------- Lambda handler ----------------------------- */
module.exports.default = async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      return res.writeHead(204, {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
        'Access-Control-Allow-Headers': '*'
      }).end();
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const params = url.searchParams;
    const channelKey = (params.get('name') || '').toLowerCase(); // e.g. premium324
    if (!channelKey) return res.writeHead(400).end('Missing name parameter');

    await getKeyAuthFor(channelKey);          // make sure we’re authed
    const keyUrl = `https://top2.newkso.ru/wmsxx.php?${params.toString()}`;
    const keyRes = await fetchUrl(keyUrl);

    res.writeHead(keyRes.statusCode, {
      'Content-Type':               'application/octet-stream',
      'Content-Length':             keyRes.body.length,
      'Access-Control-Allow-Origin': '*'
    }).end(keyRes.body);
  } catch (err) {
    console.error(err);
    res.writeHead(500).end('Error: ' + err.message);
  }
};
