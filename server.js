'use strict';
const express = require('./mini');
const crypto = require('crypto');
const path = require('path');
const { localStore, githubStore } = require('./store');

const env = process.env;
const PORT = env.PORT || 3000;
const SITE_NAME = env.SITE_NAME || 'Uzivert Hub';
const ADMIN_KEY = env.ADMIN_KEY || '';
const WEBHOOK_SOPORTE = env.DISCORD_WEBHOOK_SOPORTE || '';
const WEBHOOK_VERIF = env.DISCORD_WEBHOOK_VERIFICACIONES || WEBHOOK_SOPORTE;
const LOADSTRING = env.LOADSTRING || 'loadstring(game:HttpGet("https://uzivert-api.vercel.app/loader"))()';
const DISCORD_INVITE = env.DISCORD_INVITE || 'https://discord.gg/vHhERWcbXe';
const ROBLOX_USERS = (env.ROBLOX_USERS_API || 'https://users.roblox.com').replace(/\/$/, '');
let SESSION_SECRET = env.SESSION_SECRET;
if (!SESSION_SECRET) { SESSION_SECRET = crypto.randomBytes(32).toString('hex'); console.warn('[aviso] SESSION_SECRET no definido: las sesiones se pierden al reiniciar.'); }
if (!ADMIN_KEY) console.warn('[aviso] ADMIN_KEY no definida: el panel admin queda deshabilitado.');
if (!WEBHOOK_SOPORTE) console.warn('[aviso] DISCORD_WEBHOOK_SOPORTE no definido: el soporte no podra enviar mensajes.');

const store = env.GITHUB_TOKEN && env.GITHUB_REPO
  ? githubStore({ api: env.GITHUB_API, token: env.GITHUB_TOKEN, repo: env.GITHUB_REPO, branch: env.GITHUB_BRANCH || 'main', dir: env.GITHUB_DIR || 'uzivert-web' })
  : localStore(env.DATA_DIR || path.join(__dirname, 'data'));
console.log(`[almacenamiento] ${store.kind} | node ${process.version} | fetch: ${typeof fetch}`);
if (typeof fetch !== 'function') console.error('[ERROR] Esta version de Node no tiene fetch. Usa Node 18 o mas nuevo (variable NODE_VERSION=20 en Render).');

// ---------- utilidades ----------
const b64u = (b) => Buffer.from(b).toString('base64url');
const sign = (obj) => { const p = b64u(JSON.stringify(obj)); return p + '.' + crypto.createHmac('sha256', SESSION_SECRET).update(p).digest('base64url'); };
function unsign(tok) {
  if (typeof tok !== 'string' || !tok.includes('.')) return null;
  const [p, s] = tok.split('.');
  const ok = crypto.createHmac('sha256', SESSION_SECRET).update(p).digest('base64url');
  const a = Buffer.from(s || ''), b = Buffer.from(ok);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { const o = JSON.parse(Buffer.from(p, 'base64url').toString()); return o.exp > Date.now() ? o : null; } catch { return null; }
}
function cookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((c) => { const i = c.indexOf('='); if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim()); });
  return out;
}
function setCookie(res, name, value, maxAgeSec) {
  const secure = process.env.NODE_ENV === 'production' || process.env.RENDER ? '; Secure' : '';
  const c = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAgeSec}; Path=/; HttpOnly; SameSite=Strict${secure}`;
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', prev ? [].concat(prev, c) : c);
}
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { hits.set(key, arr); return true; }
  arr.push(now); hits.set(key, arr); return false;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some((t) => now - t < 3600e3)) hits.delete(k); }, 600e3).unref();
const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const esc = (s) => s.replace(/([*_`~|>\\])/g, '\\$1').replace(/@/g, '@\u200b');

async function postWebhook(url, payload) {
  if (!url) throw new Error('webhook no configurado');
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allowed_mentions: { parse: [] }, ...payload }) });
  if (!r.ok) throw new Error('webhook ' + r.status);
}

// ---------- app ----------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; style-src-attr 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.use(express.json({ limit: '1.5mb' }));
const noStore = (res) => res.setHeader('Cache-Control', 'no-store');
const needJson = (req, res, next) => (req.is('application/json') && req.get('X-Requested-With') === 'uz' ? next() : res.status(400).json({ error: 'Peticion invalida' }));
const ip = (req) => req.ip || 'x';

app.get('/api/config', (req, res) => res.json({ nombre: SITE_NAME, discord: DISCORD_INVITE, soporte: !!WEBHOOK_SOPORTE }));

// ---------- SOPORTE -> webhook ----------
const ASUNTOS = ['Ayuda', 'Bug', 'Sugerencia', 'Apelacion', 'Otro'];
app.post('/api/soporte', needJson, async (req, res) => {
  noStore(res);
  const b = req.body || {};
  if (b.web) return res.json({ ok: true });                       // honeypot
  if (limited('sop:' + ip(req), 3, 10 * 60e3)) return res.status(429).json({ error: 'Espera unos minutos antes de enviar otro mensaje.' });
  const asunto = ASUNTOS.includes(b.asunto) ? b.asunto : 'Otro';
  const contacto = clean(b.contacto, 100);
  const mensaje = clean(b.mensaje, 1500);
  if (mensaje.length < 10) return res.status(400).json({ error: 'El mensaje es muy corto (minimo 10 caracteres).' });
  const u = unsign(cookies(req).uz_user);
  const fields = [
    { name: 'Asunto', value: asunto, inline: true },
    { name: 'Contacto', value: contacto ? esc(contacto) : 'No indicado', inline: true },
    { name: 'Roblox verificado', value: u ? esc(u.name) : 'No', inline: true },
  ];
  try {
    await postWebhook(WEBHOOK_SOPORTE, { username: SITE_NAME + ' | Soporte', embeds: [{ title: 'Nuevo mensaje de soporte', description: esc(mensaje), color: 0x8e94a3, fields, timestamp: new Date().toISOString() }] });
    res.json({ ok: true });
  } catch (e) { console.error('soporte:', e.message, e.cause ? (e.cause.code || e.cause.message) : ''); res.status(502).json({ error: 'No se pudo enviar el mensaje. Intenta de nuevo mas tarde.' }); }
});

// ---------- VERIFICACION (codigo en la descripcion de Roblox) ----------
const pending = new Map();                                         // token -> {code,id,name,exp}
setInterval(() => { const n = Date.now(); for (const [k, v] of pending) if (v.exp < n) pending.delete(k); }, 60e3).unref();
// Codigo de palabras comunes: Roblox censura (####) los codigos de letras al azar.
const PALABRAS = ['apple','banana','cherry','orange','lemon','mango','melon','peach','tiger','panda','koala','eagle','shark','whale','zebra','rabbit','turtle','monkey','dolphin','penguin','forest','river','mountain','ocean','island','desert','cloud','rainbow','sunset','planet','rocket','castle','bridge','garden','window','guitar','piano','camera','pencil','candle','mirror','blanket','pillow','basket','bottle','ladder','ticket','jacket','pocket'];
const newCode = () => Array.from({ length: 5 }, () => PALABRAS[crypto.randomInt(PALABRAS.length)]).join(' ');
const norm = (t) => String(t || '').toLowerCase().replace(/\s+/g, ' ');

async function loadVerified() { try { return JSON.parse((await store.read('verificados.json')) || '[]'); } catch { return []; } }

app.post('/api/verificar/iniciar', needJson, async (req, res) => {
  noStore(res);
  if (limited('vi:' + ip(req), 8, 10 * 60e3)) return res.status(429).json({ error: 'Demasiados intentos, espera unos minutos.' });
  const usuario = clean(req.body && req.body.usuario, 20);
  if (!/^[A-Za-z0-9_]{3,20}$/.test(usuario)) return res.status(400).json({ error: 'Usuario de Roblox invalido.' });
  try {
    const r = await fetch(`${ROBLOX_USERS}/v1/usernames/users`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usernames: [usuario], excludeBannedUsers: true }) });
    if (!r.ok) throw new Error('roblox ' + r.status);
    const d = await r.json();
    const u = d.data && d.data[0];
    if (!u) return res.status(404).json({ error: 'No encontramos ese usuario en Roblox.' });
    const token = crypto.randomBytes(18).toString('base64url');
    const code = newCode();
    pending.set(token, { code, id: u.id, name: u.name, exp: Date.now() + 15 * 60e3 });
    res.json({ token, code, usuario: u.name, minutos: 15 });
  } catch (e) { console.error('verif iniciar:', e.message, e.cause ? (e.cause.code || e.cause.message) : ''); res.status(502).json({ error: 'No pudimos consultar Roblox. Intenta de nuevo.' }); }
});

app.post('/api/verificar/confirmar', needJson, async (req, res) => {
  noStore(res);
  if (limited('vc:' + ip(req), 15, 10 * 60e3)) return res.status(429).json({ error: 'Demasiados intentos, espera unos minutos.' });
  const p = pending.get(clean(req.body && req.body.token, 60));
  if (!p || p.exp < Date.now()) return res.status(400).json({ error: 'El codigo expiro. Empieza de nuevo.' });
  try {
    const r = await fetch(`${ROBLOX_USERS}/v1/users/${p.id}`);
    if (!r.ok) throw new Error('roblox ' + r.status);
    const d = await r.json();
    if (!norm(d.description).includes(p.code)) return res.status(400).json({ error: 'No encontramos el codigo en tu descripcion. Guarda el perfil y prueba otra vez.' });
    pending.delete(clean(req.body.token, 60));
    const list = await loadVerified();
    if (!list.some((v) => v.id === p.id)) {
      list.push({ id: p.id, name: p.name, fecha: new Date().toISOString() });
      await store.write('verificados.json', JSON.stringify(list, null, 2));
      postWebhook(WEBHOOK_VERIF, { username: SITE_NAME + ' | Verificacion', embeds: [{ title: 'Cuenta verificada', color: 0x57f287, description: `**${esc(p.name)}** (ID ${p.id})\nhttps://www.roblox.com/users/${p.id}/profile`, timestamp: new Date().toISOString() }] }).catch((e) => console.error('webhook verif:', e.message));
    }
    setCookie(res, 'uz_user', sign({ id: p.id, name: p.name, exp: Date.now() + 30 * 864e5 }), 30 * 86400);
    res.json({ ok: true, usuario: p.name });
  } catch (e) { console.error('verif confirmar:', e.message); res.status(502).json({ error: 'No pudimos consultar Roblox. Intenta de nuevo.' }); }
});

app.get('/api/yo', (req, res) => { noStore(res); const u = unsign(cookies(req).uz_user); res.json({ verificado: !!u, usuario: u ? u.name : null }); });
app.get('/api/mi-script', (req, res) => {
  noStore(res);
  const u = unsign(cookies(req).uz_user);
  if (!u) return res.status(403).json({ error: 'Verifica tu cuenta primero.' });
  res.json({ loadstring: LOADSTRING });
});
app.post('/api/salir', needJson, (req, res) => { setCookie(res, 'uz_user', '', 0); res.json({ ok: true }); });

// ---------- SCRIPTS (panel privado) ----------
const SLUG = /^[a-z0-9][a-z0-9-]{1,39}$/;
let indexCache = null;
async function loadIndex() { if (!indexCache) { try { indexCache = JSON.parse((await store.read('scripts/index.json')) || '[]'); } catch { indexCache = []; } } return indexCache; }
async function saveIndex(list) { await store.write('scripts/index.json', JSON.stringify(list, null, 2)); indexCache = list; }

function adminOnly(req, res, next) {
  noStore(res);
  const s = unsign(cookies(req).uz_admin);
  if (!ADMIN_KEY || !s || s.admin !== true) return res.status(401).json({ error: 'No autorizado' });
  if (req.method !== 'GET' && req.get('X-Requested-With') !== 'uz') return res.status(400).json({ error: 'Peticion invalida' });
  next();
}
app.post('/api/admin/login', needJson, (req, res) => {
  noStore(res);
  if (!ADMIN_KEY) return res.status(503).json({ error: 'Panel deshabilitado: falta ADMIN_KEY.' });
  if (limited('adm:' + ip(req), 6, 15 * 60e3)) return res.status(429).json({ error: 'Demasiados intentos. Espera 15 minutos.' });
  const given = crypto.createHash('sha256').update(String(req.body && req.body.clave || '')).digest();
  const real = crypto.createHash('sha256').update(ADMIN_KEY).digest();
  if (!crypto.timingSafeEqual(given, real)) return res.status(401).json({ error: 'Clave incorrecta.' });
  setCookie(res, 'uz_admin', sign({ admin: true, exp: Date.now() + 12 * 3600e3 }), 12 * 3600);
  res.json({ ok: true });
});
app.post('/api/admin/logout', adminOnly, (req, res) => { setCookie(res, 'uz_admin', '', 0); res.json({ ok: true }); });
app.get('/api/admin/yo', adminOnly, (req, res) => res.json({ ok: true, almacenamiento: store.kind }));

app.get('/api/admin/scripts', adminOnly, async (req, res) => { try { res.json(await loadIndex()); } catch (e) { res.status(500).json({ error: 'No se pudo leer el almacenamiento.' }); } });
app.get('/api/admin/scripts/:slug', adminOnly, async (req, res) => {
  if (!SLUG.test(req.params.slug)) return res.status(400).json({ error: 'Slug invalido' });
  try {
    const meta = (await loadIndex()).find((s) => s.slug === req.params.slug);
    if (!meta) return res.status(404).json({ error: 'No existe' });
    res.json({ ...meta, code: (await store.read(`scripts/${meta.slug}.lua`)) || '' });
  } catch (e) { res.status(500).json({ error: 'No se pudo leer el almacenamiento.' }); }
});
app.put('/api/admin/scripts/:slug', adminOnly, async (req, res) => {
  const slug = req.params.slug;
  if (!SLUG.test(slug)) return res.status(400).json({ error: 'Slug invalido (minusculas, numeros y guiones, 2-40).' });
  const b = req.body || {};
  const code = String(b.code == null ? '' : b.code);
  if (!code.trim()) return res.status(400).json({ error: 'El script esta vacio.' });
  if (code.length > 1_000_000) return res.status(400).json({ error: 'El script es demasiado grande (max 1 MB).' });
  const meta = { slug, name: clean(b.name, 60) || slug, game: clean(b.game, 60), version: clean(b.version, 20), description: clean(b.description, 300), estado: b.estado === 'oculto' ? 'oculto' : 'activo', updatedAt: new Date().toISOString(), bytes: Buffer.byteLength(code) };
  try {
    await store.write(`scripts/${slug}.lua`, code);
    const list = (await loadIndex()).filter((s) => s.slug !== slug);
    list.push(meta); list.sort((a, c) => a.name.localeCompare(c.name));
    await saveIndex(list);
    cache.delete(slug);
    res.json({ ok: true, script: meta });
  } catch (e) { console.error('guardar script:', e.message); res.status(500).json({ error: 'No se pudo guardar en el almacenamiento.' }); }
});
app.delete('/api/admin/scripts/:slug', adminOnly, async (req, res) => {
  if (!SLUG.test(req.params.slug)) return res.status(400).json({ error: 'Slug invalido' });
  try {
    await store.remove(`scripts/${req.params.slug}.lua`);
    await saveIndex((await loadIndex()).filter((s) => s.slug !== req.params.slug));
    cache.delete(req.params.slug);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'No se pudo borrar.' }); }
});
// Diagnostico: prueba desde el servidor si llega a Roblox, a Discord y al almacenamiento.
app.get('/api/admin/diag', adminOnly, async (req, res) => {
  const out = { node: process.version, fetch: typeof fetch, almacenamiento: store.kind, webhook_soporte_definido: !!WEBHOOK_SOPORTE, webhook_verif_definido: !!WEBHOOK_VERIF, github_definido: !!(env.GITHUB_TOKEN && env.GITHUB_REPO) };
  if (typeof fetch !== 'function') return res.json(out);
  const probe = async (name, fn) => { try { const r = await fn(); out[name] = r; } catch (e) { out[name] = 'ERROR: ' + (e.cause && e.cause.code || e.message); } };
  await probe('roblox', async () => { const r = await fetch(`${ROBLOX_USERS}/v1/usernames/users`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usernames: ['Roblox'], excludeBannedUsers: true }) }); return 'HTTP ' + r.status; });
  await probe('discord_webhook', async () => { if (!WEBHOOK_SOPORTE) return 'no definido'; const r = await fetch(WEBHOOK_SOPORTE); return r.status === 200 ? 'OK (webhook valido)' : 'HTTP ' + r.status + (r.status === 404 ? ' (URL invalida o webhook borrado)' : r.status === 429 ? ' (Discord limita la IP de Render)' : ''); });
  await probe('almacenamiento_lectura', async () => { await store.read('scripts/index.json'); return 'OK'; });
  res.json(out);
});
app.get('/api/admin/verificados', adminOnly, async (req, res) => res.json(await loadVerified()));

// Entrega publica del script crudo: loadstring(game:HttpGet("https://TU-DOMINIO/s/slug"))()
const cache = new Map();
app.get('/s/:slug', async (req, res) => {
  res.type('text/plain; charset=utf-8').setHeader('Cache-Control', 'no-store');
  const slug = req.params.slug;
  if (!SLUG.test(slug)) return res.status(404).send('-- no encontrado');
  try {
    const meta = (await loadIndex()).find((s) => s.slug === slug);
    if (!meta || meta.estado !== 'activo') return res.status(404).send('-- no encontrado');
    const c = cache.get(slug);
    if (c && Date.now() - c.t < 30e3) return res.send(c.code);
    const code = await store.read(`scripts/${slug}.lua`);
    if (code == null) return res.status(404).send('-- no encontrado');
    cache.set(slug, { t: Date.now(), code });
    res.send(code);
  } catch (e) { res.status(502).send('-- error temporal'); }
});

// Archivos de la pagina: carpeta public/, o (si subiste todo suelto en la raiz) solo estos archivos permitidos.
const fs = require('fs');
const PUBLIC_DIR = path.join(__dirname, 'public');
if (fs.existsSync(path.join(PUBLIC_DIR, 'index.html'))) {
  app.use(express.static(PUBLIC_DIR));
} else {
  const PAGINA = new Set(['index.html', 'admin.html', 'style.css', 'app.js', 'admin.js', 'common.js']);
  const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8' };
  console.log('[aviso] No hay carpeta public/: sirviendo los archivos de la pagina desde la raiz.');
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let n = req.path === '/' ? 'index.html' : req.path === '/admin' ? 'admin.html' : req.path.slice(1);
    if (n === 'index') n = 'index.html';
    if (!PAGINA.has(n) || !fs.existsSync(path.join(__dirname, n))) return next();
    res.setHeader('Content-Type', MIME[path.extname(n)]);
    res.setHeader('Cache-Control', 'no-cache');
    fs.createReadStream(path.join(__dirname, n)).pipe(res);
  });
}
app.use('/api', (req, res) => res.status(404).json({ error: 'No encontrado' }));
app.use((err, req, res, next) => { if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Demasiado grande' }); if (err instanceof SyntaxError) return res.status(400).json({ error: 'JSON invalido' }); console.error(err); res.status(500).json({ error: 'Error interno' }); });

module.exports = app;
if (require.main === module) app.listen(PORT, () => console.log(`${SITE_NAME} web en puerto ${PORT}`));
