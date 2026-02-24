#!/usr/bin/env node
'use strict';

/**
 * Persona Builder — local dev server
 *
 * Zero npm dependencies — just Node.js ≥ 14.
 *
 * What it does:
 *   1. Loads DEEPSEEK_KEY from .env
 *   2. Proxies POST /api/deepseek  →  api.deepseek.com  (server-side, no CORS)
 *   3. Serves static files (index.html, config.example.js, etc.)
 *   4. Blocks .env and server.js from being served
 *
 * Usage:
 *   cp .env.example .env        # add your key
 *   node server.js              # http://localhost:3000
 */

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

/* ── Load .env ──────────────────────────────────────────────────────── */
try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8')
    .split('\n')
    .forEach(line => {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    });
} catch (_) { /* .env is optional — key can also be passed as env var */ }

const PORT         = parseInt(process.env.PORT || '3000', 10);
const DEEPSEEK_KEY = process.env.DEEPSEEK_KEY;

if (!DEEPSEEK_KEY) {
  console.error('\n  ✗  DEEPSEEK_KEY is not set.');
  console.error('     Copy .env.example → .env and add your DeepSeek API key.\n');
  process.exit(1);
}

/* ── MIME map ───────────────────────────────────────────────────────── */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.txt':  'text/plain',
};

/* ── Blocked filenames (never served) ──────────────────────────────── */
const BLOCKED = new Set(['.env', 'server.js', 'config.js']);

/* ── HTTP server ────────────────────────────────────────────────────── */
const server = http.createServer((req, res) => {
  const reqUrl   = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = reqUrl.pathname;

  /* CORS headers (for local dev convenience) */
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  /* ── /api/ping  →  health check ────────────────────────────────── */
  if (pathname === '/api/ping' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, key: !!DEEPSEEK_KEY }));
    return;
  }

  /* ── /api/deepseek  →  proxy to api.deepseek.com ───────────────── */
  if (pathname === '/api/deepseek' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end',  ()    => {
      const proxyOptions = {
        hostname: 'api.deepseek.com',
        path:     '/v1/chat/completions',
        method:   'POST',
        headers:  {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${DEEPSEEK_KEY}`,
          'Content-Length': Buffer.byteLength(body),
        },
      };

      const proxyReq = https.request(proxyOptions, upstream => {
        res.writeHead(upstream.statusCode, { 'Content-Type': 'application/json' });
        upstream.pipe(res);
      });

      proxyReq.on('error', err => {
        console.error('  DeepSeek proxy error:', err.message);
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: err.message } }));
        }
      });

      proxyReq.write(body);
      proxyReq.end();
    });
    return;
  }

  /* ── Static file server ─────────────────────────────────────────── */
  const basename = path.basename(pathname);
  if (BLOCKED.has(basename)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  const filePath = path.join(
    __dirname,
    pathname === '/' ? 'index.html' : pathname
  );

  /* Basic path traversal guard */
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403); res.end('403 Forbidden'); return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const line = '─'.repeat(44);
  console.log(`\n  ┌${line}┐`);
  console.log(`  │  Persona Builder  →  http://localhost:${PORT}          │`);
  console.log(`  └${line}┘`);
  console.log(`\n  DeepSeek key : ✓  loaded from .env`);
  console.log(`  Proxy route  :    POST /api/deepseek`);
  console.log(`  Press Ctrl+C to stop\n`);
});
