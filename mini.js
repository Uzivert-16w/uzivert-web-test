'use strict';
// Mini servidor tipo Express (sin dependencias): get/post/put/delete, use, json, static.
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.webp': 'image/webp' };

function compile(p) {
  const keys = [];
  const re = new RegExp('^' + p.replace(/:([A-Za-z_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  return { re, keys };
}

function createApp() {
  const stack = [];
  const settings = {};
  async function handle(req, res) {
    const u = new URL(req.url, 'http://x');
    req.path = u.pathname;
    req.query = Object.fromEntries(u.searchParams);
    req.get = (h) => req.headers[String(h).toLowerCase()];
    req.is = (t) => String(req.headers['content-type'] || '').toLowerCase().includes(t);
    req.params = {};
    req.body = {};
    req.ip = settings['trust proxy'] ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress : req.socket.remoteAddress;
    res.status = (c) => { res.statusCode = c; return res; };
    res.type = (t) => { res.setHeader('Content-Type', t); return res; };
    res.json = (o) => { if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(o)); };
    res.send = (s) => { if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(s); };
    let i = 0;
    const next = (err) => {
      while (i < stack.length) {
        const l = stack[i++];
        if (err) {
          if (l.fn.length === 4) { try { l.fn(err, req, res, next); } catch (e) { next(e); } return; }
          continue;
        }
        if (l.fn.length === 4) continue;
        if (l.method && l.method !== req.method) continue;
        if (l.route) {
          const m = l.route.re.exec(req.path);
          if (!m) continue;
          req.params = {};
          l.route.keys.forEach((k, n) => { try { req.params[k] = decodeURIComponent(m[n + 1]); } catch { req.params[k] = m[n + 1]; } });
        } else if (l.prefix && !(req.path === l.prefix || req.path.startsWith(l.prefix + '/'))) continue;
        try {
          const r = l.fn(req, res, next);
          if (r && typeof r.catch === 'function') r.catch(next);
        } catch (e) { next(e); }
        return;
      }
      if (err) { console.error(err); if (!res.headersSent) { res.statusCode = 500; res.end('Error interno'); } return; }
      if (!res.headersSent) { res.statusCode = 404; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end('No encontrado'); }
    };
    next();
  }
  const app = (req, res) => handle(req, res);
  app.disable = () => {};
  app.set = (k, v) => { settings[k] = v; };
  app.use = (a, b) => (typeof a === 'function' ? stack.push({ fn: a }) : stack.push({ prefix: a, fn: b }));
  ['get', 'post', 'put', 'delete'].forEach((m) => {
    app[m] = (p, ...fns) => fns.forEach((fn) => stack.push({ method: m.toUpperCase(), route: compile(p), fn }));
  });
  app.listen = (port, cb) => http.createServer(app).listen(port, cb);
  return app;
}

createApp.json = ({ limit = '1mb' } = {}) => {
  const max = typeof limit === 'number' ? limit : parseFloat(limit) * (/mb/i.test(limit) ? 1048576 : /kb/i.test(limit) ? 1024 : 1);
  return (req, res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) || !req.is('application/json')) return next();
    const chunks = []; let size = 0; let dead = false;
    req.on('data', (c) => { if (dead) return; size += c.length; if (size > max) { dead = true; next({ type: 'entity.too.large' }); } else chunks.push(c); });
    req.on('end', () => {
      if (dead) return;
      try { req.body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; next(); } catch { next(new SyntaxError('json')); }
    });
    req.on('error', next);
  };
};

createApp.static = (dir) => {
  const root = path.resolve(dir);
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let p; try { p = decodeURIComponent(req.path); } catch { return next(); }
    let file = path.join(root, p);
    if (!file.startsWith(root)) return next();
    const tryFiles = [file, file + '.html', path.join(file, 'index.html')];
    for (const f of tryFiles) {
      try {
        if (fs.statSync(f).isFile()) {
          res.setHeader('Content-Type', MIME[path.extname(f).toLowerCase()] || 'application/octet-stream');
          res.setHeader('Cache-Control', 'no-cache');
          return fs.createReadStream(f).pipe(res);
        }
      } catch {}
    }
    next();
  };
};

module.exports = createApp;
