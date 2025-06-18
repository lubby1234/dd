// at the top of api/stream/key.js
global.keyCache = global.keyCache || new Map();

/**
 * Try to return a cached Buffer for this exact query string,
 * or undefined if missing / expired.
 */
function getCachedKey(keyUrl) {
  const entry = global.keyCache.get(keyUrl);
  if (!entry || Date.now() > entry.exp) {
    global.keyCache.delete(keyUrl);
    return;
  }
  return entry.buf;
}

/** Store the key Buffer for 24h */
function setCachedKey(keyUrl, buf) {
  global.keyCache.set(keyUrl, { 
    buf, 
    exp: Date.now() + 24 * 60 * 60 * 1000 
  });
}

// inside your key handler, just before fetchUrl:
const rawUrl = `https://top2.newkso.ru/wmsxx.php?${url.searchParams.toString()}`;

// try cache first
let keyBody = getCachedKey(rawUrl);
if (!keyBody) {
  // ensure auth has run…
  await getKeyAuthFor(channelKey);
  // actually fetch
  const upstream = await fetchUrl(rawUrl);
  keyBody = upstream.body;
  // cache it for 24h
  setCachedKey(rawUrl, keyBody);
}

// now return the Buffer
res.writeHead(200, {
  'Content-Type':               'application/octet-stream',
  'Content-Length':             keyBody.length,
  'Access-Control-Allow-Origin': '*'
});
return res.end(keyBody);
