// api/util.js
const http  = require('http');
const https = require('https');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0',
  Origin:  'https://forcedtoplay.xyz',
  Referer: 'https://forcedtoplay.xyz/'
};

function fetchUrl(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const lib     = url.startsWith('https://') ? https : http;
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

module.exports = { fetchUrl, HEADERS };
