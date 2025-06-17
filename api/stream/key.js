// api/stream/key.js
const http = require('http');
const https = require('https');
const { URL } = require('url');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0',
  Origin: 'https://forcedtoplay.xyz',
  Referer: 'https://forcedtoplay.xyz/'
};

function fetchUrl(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https://') ? https : http;
    const headers = { ...HEADERS, ...extraHeaders };
    lib.get(url, { headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () =>
        resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks) })
      );
    }).on('error', reject);
  });
}

module.exports = async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*'
    });
    return res.end();
  }

  const qs = new URL(req.url, `http://${req.headers.host}`)
               .searchParams.toString();
  const keyUrl = `https://top2.newkso.ru/wmsxx.php?${qs}`;

  const keyRes = await fetchUrl(keyUrl, { Origin: 'https://forcedtoplay.xyz' });

  res.writeHead(keyRes.statusCode, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': keyRes.body.length,
    'Access-Control-Allow-Origin': '*'
  });
  res.end(keyRes.body);
};
