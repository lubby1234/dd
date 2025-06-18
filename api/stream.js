// api/stream.js
const { getKeyAuthFor } = require('./stream/key');   // reuse helper!
const { fetchUrl, HEADERS } = require('./util');      // small utils below
const { URL } = require('url');

module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const id  = url.searchParams.get('id');
    if (!id) return res.writeHead(400).end('Missing id parameter');

    /* --- pull HTML & vars (cached) --------------------------------- */
    const embedUrl = `https://forcedtoplay.xyz/premiumtv/daddylivehd.php?id=${id}`;
    const html = await fetchCachedHtml(embedUrl);

    const channelKey = html.match(/var\s+channelKey\s*=\s*"([^"]+)";/)[1];

    /* --- make sure we've authed this Lambda instance --------------- */
    await getKeyAuthFor(channelKey, html);   // <— real auth happens here

    /* --- build m3u8 url ------------------------------------------- */
    const { server_key: sk } =
      JSON.parse((await fetchUrl(`https://forcedtoplay.xyz/server_lookup.php?channel_id=${channelKey}`)).body);

    const m3u8 =
      sk === 'top1/cdn'
        ? `https://top1.newkso.ru/${sk}/${channelKey}/mono.m3u8`
        : `https://${sk}new.newkso.ru/${sk}/${channelKey}/mono.m3u8`;

    /* --- patch playlist ------------------------------------------- */
    let playlist = (await fetchUrl(m3u8)).body.toString('utf8');
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    playlist = playlist.replace(
      /URI="https:\/\/[^"]+\/wmsxx\.php\?([^"]+)"/,
      `URI="https://${host}/api/stream/key?$1"`
    );

    res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' }).end(playlist);
  } catch (err) {
    console.error(err);
    res.writeHead(500).end('Error: ' + err.message);
  }
};

/* ---------- tiny local helpers & cache shared across warm invocations ------ */
global.htmlCache = global.htmlCache || new Map();
async function fetchCachedHtml(url) {
  const cached = global.htmlCache.get(url);
  if (cached && Date.now() < cached.exp) return cached.val;
  const html = (await fetchUrl(url)).body.toString('utf8');
  global.htmlCache.set(url, { val: html, exp: Date.now() + 86_400_000 });
  return html;
}
