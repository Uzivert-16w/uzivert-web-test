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
const API_URL = (env.UZIVERT_API_URL || 'https://uzivert-api.onrender.com').replace(/\/$/, '');
const WEB_SECRET = env.WEB_SECRET || '';
const API_ADMIN_PASS = env.API_ADMIN_PASS || '';
const COPIAR_MAX = Number(env.COPIAR_CONTENIDO_MAX) || 3000;   // hasta este largo se copia el contenido en vez del link
const DISCORD_INVITE = env.DISCORD_INVITE || 'https://discord.gg/vHhERWcbXe';
const ROBLOX_USERS = (env.ROBLOX_USERS_API || 'https://users.roblox.com').replace(/\/$/, '');
let SESSION_SECRET = env.SESSION_SECRET;
if (!SESSION_SECRET) { SESSION_SECRET = crypto.randomBytes(32).toString('hex'); console.warn('[aviso] SESSION_SECRET no definido: las sesiones se pierden al reiniciar.'); }
if (!WEB_SECRET) console.warn('[aviso] WEB_SECRET no definido: las verificaciones de la página NO se registran en la API del hub (el loader no las reconoce).');
if (!ADMIN_KEY) console.warn('[aviso] ADMIN_KEY no definida: el panel admin queda deshabilitado.');
if (!WEBHOOK_SOPORTE) console.warn('[aviso] DISCORD_WEBHOOK_SOPORTE no definido: el soporte no podrá enviar mensajes.');

const store = env.GITHUB_TOKEN && env.GITHUB_REPO
  ? githubStore({ api: env.GITHUB_API, token: env.GITHUB_TOKEN, repo: env.GITHUB_REPO, branch: env.GITHUB_BRANCH || 'main', dir: env.GITHUB_DIR || 'uzivert-web' })
  : localStore(env.DATA_DIR || path.join(__dirname, 'data'));
console.log(`[almacenamiento] ${store.kind} | node ${process.version} | fetch: ${typeof fetch}`);
if (typeof fetch !== 'function') console.error('[ERROR] Esta versión de Node no tiene fetch. Usa Node 18 o más nuevo (variable NODE_VERSION=20 en Render).');

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
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: https:; media-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; style-src-attr 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.use(express.json({ limit: '1.5mb' }));
const noStore = (res) => res.setHeader('Cache-Control', 'no-store');
const needJson = (req, res, next) => (req.is('application/json') && req.get('X-Requested-With') === 'uz' ? next() : res.status(400).json({ error: 'Petición inválida' }));
const ip = (req) => req.ip || 'x';

app.get('/api/config', (req, res) => res.json({ nombre: SITE_NAME, discord: DISCORD_INVITE, soporte: !!WEBHOOK_SOPORTE, version: env.SITE_VERSION || 'v1.2' }));

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
  if (mensaje.length < 10) return res.status(400).json({ error: 'El mensaje es muy corto (mínimo 10 caracteres).' });
  const u = unsign(cookies(req).uz_user);
  const fields = [
    { name: 'Asunto', value: asunto, inline: true },
    { name: 'Contacto', value: contacto ? esc(contacto) : 'No indicado', inline: true },
    { name: 'Roblox verificado', value: u ? esc(u.name) : 'No', inline: true },
  ];
  try {
    await postWebhook(WEBHOOK_SOPORTE, { username: SITE_NAME + ' | Soporte', embeds: [{ title: 'Nuevo mensaje de soporte', description: esc(mensaje), color: 0x8e94a3, fields, timestamp: new Date().toISOString() }] });
    res.json({ ok: true });
  } catch (e) { console.error('soporte:', e.message, e.cause ? (e.cause.code || e.cause.message) : ''); res.status(502).json({ error: 'No se pudo enviar el mensaje. Intenta de nuevo más tarde.' }); }
});

// ---------- VERTIX (asistente con voz, DeepSeek) ----------
const DEEPSEEK_KEY = env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_URL = (env.DEEPSEEK_URL || 'https://api.deepseek.com/chat/completions');
const DEEPSEEK_MODEL = env.DEEPSEEK_MODEL || 'deepseek-chat';
if (!DEEPSEEK_KEY) console.warn('[aviso] DEEPSEEK_API_KEY no definida: el asistente Vertix queda deshabilitado.');
// Límite: más de 10 mensajes en 1 minuto => bloqueo de 10 minutos. El admin no tiene límite.
const VX_MAX = 10, VX_VENTANA = 60e3, VX_BLOQUEO = 10 * 60e3;
const vxEstado = new Map();                                        // ip -> {hits:[], hasta}
setInterval(() => { const n = Date.now(); for (const [k, v] of vxEstado) if (v.hasta < n && !v.hits.some((t) => n - t < VX_VENTANA)) vxEstado.delete(k); }, 60e3).unref();
function vertixEspera(req) {                                       // ms que debe esperar (0 = puede enviar)
  if (isAdmin(req)) return 0;
  const k = ip(req), n = Date.now();
  const e = vxEstado.get(k) || { hits: [], hasta: 0 };
  if (e.hasta > n) return e.hasta - n;
  e.hits = e.hits.filter((t) => n - t < VX_VENTANA);
  e.hits.push(n);
  if (e.hits.length > VX_MAX) { e.hasta = n + VX_BLOQUEO; e.hits = []; vxEstado.set(k, e); return VX_BLOQUEO; }
  vxEstado.set(k, e);
  return 0;
}
const VX_SITIOS = ['youtube', 'google', 'tiktok', 'discord', 'spotify', 'roblox'];
const VX_PAGINAS = ['inicio', 'verificar', 'soporte', 'scripts', 'foro', 'updates', 'estado', 'faq', 'creador', 'creditos'];
function vxPrompt() {
  const ahora = new Date().toLocaleString('es-PY', { timeZone: 'America/Asuncion', dateStyle: 'full', timeStyle: 'short' });
  return `Eres Vertix, el asistente de voz de Uzivert Hub (un hub de scripts para Roblox). Hablas en español, con respuestas muy cortas (máximo 2 frases), claras y amables. Fecha y hora actual en Paraguay: ${ahora}.
Responde SIEMPRE con un JSON con esta forma exacta: {"say":"texto que se dice en voz alta","action":null}
Si el usuario pide abrir o buscar algo, "action" puede ser:
- {"type":"open","site":"youtube|google|tiktok|discord|spotify|roblox","query":"texto a buscar, opcional"}
- {"type":"go","page":"inicio|verificar|soporte|scripts|foro|updates|estado|faq|creador|creditos"} para moverse dentro de esta página web.
No inventes otras acciones ni URLs. Si no hay nada que abrir, "action" es null. No uses emojis. No des información falsa sobre Uzivert Hub: si no sabes algo, dilo.`;
}
app.get('/api/vertix/estado', (req, res) => { noStore(res); res.json({ activo: !!DEEPSEEK_KEY, ilimitado: isAdmin(req) }); });
app.post('/api/vertix', needJson, async (req, res) => {
  noStore(res);
  if (!DEEPSEEK_KEY) return res.status(503).json({ error: 'Vertix no está disponible por ahora.' });
  const espera = vertixEspera(req);
  if (espera > 0) return res.status(429).json({ error: `Enviaste demasiados mensajes. Espera ${Math.ceil(espera / 60e3)} minuto(s) para volver a usar a Vertix.`, espera: Math.ceil(espera / 1000) });
  const b = req.body || {};
  const texto = clean(b.mensaje, 300);
  if (!texto) return res.status(400).json({ error: 'Escribe o di algo.' });
  const hist = (Array.isArray(b.historial) ? b.historial : []).slice(-6)
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: clean(m.content, 300) }));
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 25000);
  try {
    const r = await fetch(DEEPSEEK_URL, {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + DEEPSEEK_KEY },
      body: JSON.stringify({ model: DEEPSEEK_MODEL, messages: [{ role: 'system', content: vxPrompt() }, ...hist, { role: 'user', content: texto }], response_format: { type: 'json_object' }, max_tokens: 800, temperature: 0.6, ...(/gpt-oss/i.test(DEEPSEEK_MODEL) ? { reasoning_effort: 'low' } : {}) }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { console.error('deepseek:', r.status, JSON.stringify(d).slice(0, 200)); return res.status(502).json({ error: 'Vertix no pudo responder ahora. Intenta de nuevo en un momento.' }); }
    let out = {};
    try { out = JSON.parse(d.choices[0].message.content); } catch { out = { say: String((d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '').slice(0, 400), action: null }; }
    const say = clean(out.say, 400) || 'No te entendí, ¿puedes repetirlo?';
    let action = null;
    const a = out.action;
    if (a && a.type === 'open' && VX_SITIOS.includes(a.site)) action = { type: 'open', site: a.site, query: clean(a.query, 100) };
    else if (a && a.type === 'go' && VX_PAGINAS.includes(a.page)) action = { type: 'go', page: a.page };
    res.json({ say, action });
  } catch (e) { console.error('deepseek:', e.message); res.status(502).json({ error: 'Vertix no pudo responder ahora. Intenta de nuevo en un momento.' }); }
  finally { clearTimeout(to); }
});

// ---------- VERIFICACION (código en la descripción de Roblox) ----------
const pending = new Map();                                         // token -> {code,id,name,exp}
setInterval(() => { const n = Date.now(); for (const [k, v] of pending) if (v.exp < n) pending.delete(k); }, 60e3).unref();
// Código de palabras comunes: Roblox censura (####) los códigos de letras al azar.
const PALABRAS = ['apple','banana','cherry','orange','lemon','mango','melon','peach','tiger','panda','koala','eagle','shark','whale','zebra','rabbit','turtle','monkey','dolphin','penguin','forest','river','mountain','ocean','island','desert','cloud','rainbow','sunset','planet','rocket','castle','bridge','garden','window','guitar','piano','camera','pencil','candle','mirror','blanket','pillow','basket','bottle','ladder','ticket','jacket','pocket'];
// Registra la cuenta en la API del hub (la misma base que usa el bot y el loader).
async function registrarEnApi(p) {
  if (!WEB_SECRET) return true;
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 60000);   // Render gratis puede tardar ~50 s en despertar
  try {
    const r = await fetch(`${API_URL}/api/verificar_web`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-web-secret': WEB_SECRET }, body: JSON.stringify({ roblox_id: p.id, roblox_user: p.name }), signal: ctl.signal });
    const d = await r.json().catch(() => ({}));
    if (!(r.ok && d.ok === true)) console.error('api verificar_web:', r.status, d.error || '');
    return r.ok && d.ok === true;
  } catch (e) { console.error('api verificar_web:', e.message); return false; }
  finally { clearTimeout(to); }
}
const newCode = () => Array.from({ length: 5 }, () => PALABRAS[crypto.randomInt(PALABRAS.length)]).join(' ');
const norm = (t) => String(t || '').toLowerCase().replace(/\s+/g, ' ');

async function loadVerified() { try { return JSON.parse((await store.read('verificados.json')) || '[]'); } catch { return []; } }

app.post('/api/verificar/iniciar', needJson, async (req, res) => {
  noStore(res);
  if (limited('vi:' + ip(req), 8, 10 * 60e3)) return res.status(429).json({ error: 'Demasiados intentos, espera unos minutos.' });
  const usuario = clean(req.body && req.body.usuario, 20);
  if (!/^[A-Za-z0-9_]{3,20}$/.test(usuario)) return res.status(400).json({ error: 'Usuario de Roblox inválido.' });
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
  if (!p || p.exp < Date.now()) return res.status(400).json({ error: 'El código expiró. Empieza de nuevo.' });
  try {
    const r = await fetch(`${ROBLOX_USERS}/v1/users/${p.id}`);
    if (!r.ok) throw new Error('roblox ' + r.status);
    const d = await r.json();
    if (!norm(d.description).includes(p.code)) return res.status(400).json({ error: 'No encontramos el código en tu descripción. Guarda el perfil y prueba otra vez.' });
    if (!(await registrarEnApi(p))) return res.status(502).json({ error: 'Tu cuenta es correcta, pero no pudimos registrarla en el servidor del hub. Espera un minuto y toca Verificar de nuevo.' });
    pending.delete(clean(req.body.token, 60));
    const list = await loadVerified();
    if (!list.some((v) => v.id === p.id)) {
      list.push({ id: p.id, name: p.name, fecha: new Date().toISOString() });
      await store.write('verificados.json', JSON.stringify(list, null, 2));
      postWebhook(WEBHOOK_VERIF, { username: SITE_NAME + ' | Verificación', embeds: [{ title: 'Cuenta verificada', color: 0x57f287, description: `**${esc(p.name)}** (ID ${p.id})\nhttps://www.roblox.com/users/${p.id}/profile`, timestamp: new Date().toISOString() }] }).catch((e) => console.error('webhook verif:', e.message));
    }
    setCookie(res, 'uz_user', sign({ id: p.id, name: p.name, exp: Date.now() + 30 * 864e5 }), 30 * 86400);
    res.json({ ok: true, usuario: p.name });
  } catch (e) { console.error('verif confirmar:', e.message); res.status(502).json({ error: 'No pudimos consultar Roblox. Intenta de nuevo.' }); }
});

const isAdmin = (req) => { const a = unsign(cookies(req).uz_admin); return !!(ADMIN_KEY && a && a.admin === true); };
app.get('/api/yo', (req, res) => { noStore(res); const u = unsign(cookies(req).uz_user); res.json({ verificado: !!u, usuario: u ? u.name : null, id: u ? u.id : null, staff: isAdmin(req) }); });
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
  if (req.method !== 'GET' && req.get('X-Requested-With') !== 'uz') return res.status(400).json({ error: 'Petición inválida' });
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
  if (!SLUG.test(req.params.slug)) return res.status(400).json({ error: 'Slug inválido' });
  try {
    const meta = (await loadIndex()).find((s) => s.slug === req.params.slug);
    if (!meta) return res.status(404).json({ error: 'No existe' });
    res.json({ ...meta, code: (await store.read(`scripts/${meta.slug}.lua`)) || '' });
  } catch (e) { res.status(500).json({ error: 'No se pudo leer el almacenamiento.' }); }
});
// Logo: un link https de imagen, o el ID numérico del juego (se busca su icono en Roblox).
async function resolverLogo(v) {
  v = String(v || '').trim().slice(0, 300);
  if (!v) return '';
  if (/^https:\/\/[^\s"'<>]+$/i.test(v)) return v;
  if (/^\d{3,15}$/.test(v)) {
    const get = async (url) => { try { const r = await fetch(url, { signal: AbortSignal.timeout(8000) }); return r.ok ? await r.json() : null; } catch { return null; } };
    const icono = (d) => { const x = d && d.data && d.data[0]; return x && x.state === 'Completed' && /^https:\/\//.test(x.imageUrl || '') ? x.imageUrl : null; };
    const q = 'returnPolicy=PlaceHolder&size=256x256&format=Png&isCircular=false';
    // El número puede ser ID de lugar (place) o de universo: probamos las dos formas.
    const uni = await get(`https://apis.roblox.com/universes/v1/places/${v}/universe`);
    const candidatos = [];
    if (uni && uni.universeId) candidatos.push(uni.universeId);
    candidatos.push(v);
    for (const u of candidatos) { const url = icono(await get(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${u}&${q}`)); if (url) return url; }
    const url = icono(await get(`https://thumbnails.roblox.com/v1/places/gameicons?placeIds=${v}&${q}`));
    if (url) return url;
    throw new Error('Roblox no devolvió un icono para ese ID (puede ser que el juego no tenga icono todavía). Prueba con otro ID del juego o pega el link de una imagen.');
  }
  throw new Error('El logo debe ser un link que empiece con https:// o el ID del juego (solo números).');
}
app.put('/api/admin/scripts/:slug', adminOnly, async (req, res) => {
  const slug = req.params.slug;
  if (!SLUG.test(slug)) return res.status(400).json({ error: 'Slug inválido (minúsculas, números y guiones, 2-40).' });
  const b = req.body || {};
  const code = String(b.code == null ? '' : b.code);
  if (!code.trim()) return res.status(400).json({ error: 'El script está vacío.' });
  if (code.length > 1_000_000) return res.status(400).json({ error: 'El script es demasiado grande (max 1 MB).' });
  let logo = '';
  const previo = (await loadIndex()).find((x) => x.slug === slug);
  if (b.logo === undefined && previo) logo = previo.logo || '';
  else { try { logo = await resolverLogo(b.logo); } catch (e) { return res.status(400).json({ error: e.message }); } }
  const meta = { slug, logo, verificacion: b.verificacion === 'no' ? 'no' : 'si', situacion: ['ok', 'mant', 'caido'].includes(b.situacion) ? b.situacion : (previo && previo.situacion) || 'ok', name: clean(b.name, 60) || slug, game: clean(b.game, 60), version: clean(b.version, 20), description: clean(b.description, 300), estado: b.estado === 'oculto' ? 'oculto' : 'activo', updatedAt: new Date().toISOString(), bytes: Buffer.byteLength(code) };
  let aviso = '';
  try {
    await store.write(`scripts/${slug}.lua`, code);
    logoCache.delete(slug);
    if (logo) { try { await guardarLogo(slug, logo); } catch (e) { console.warn('logo:', e.message); aviso = 'el logo no se pudo descargar y guardar (' + e.message + '). Link: ' + logo; } }
    else { try { await store.remove(`logos/${slug}.txt`); } catch {} }
    const list = (await loadIndex()).filter((s) => s.slug !== slug);
    list.push(meta); list.sort((a, c) => a.name.localeCompare(c.name));
    await saveIndex(list);
    cache.delete(slug);
    res.json({ ok: true, script: meta, aviso });
  } catch (e) { console.error('guardar script:', e.message); res.status(500).json({ error: 'No se pudo guardar: ' + e.message }); }
});
app.delete('/api/admin/scripts/:slug', adminOnly, async (req, res) => {
  if (!SLUG.test(req.params.slug)) return res.status(400).json({ error: 'Slug inválido' });
  try {
    await store.remove(`scripts/${req.params.slug}.lua`);
    try { await store.remove(`logos/${req.params.slug}.txt`); } catch {}
    logoCache.delete(req.params.slug);
    await saveIndex((await loadIndex()).filter((s) => s.slug !== req.params.slug));
    cache.delete(req.params.slug);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'No se pudo borrar.' }); }
});
// Diagnóstico: prueba desde el servidor si llega a Roblox, a Discord y al almacenamiento.
app.get('/api/admin/diag', adminOnly, async (req, res) => {
  const out = { node: process.version, fetch: typeof fetch, almacenamiento: store.kind, webhook_soporte_definido: !!WEBHOOK_SOPORTE, webhook_verif_definido: !!WEBHOOK_VERIF, github_definido: !!(env.GITHUB_TOKEN && env.GITHUB_REPO) };
  if (typeof fetch !== 'function') return res.json(out);
  const probe = async (name, fn) => { try { const r = await fn(); out[name] = r; } catch (e) { out[name] = 'ERROR: ' + (e.cause && e.cause.code || e.message); } };
  await probe('roblox', async () => { const r = await fetch(`${ROBLOX_USERS}/v1/usernames/users`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usernames: ['Roblox'], excludeBannedUsers: true }) }); return 'HTTP ' + r.status; });
  await probe('discord_webhook', async () => { if (!WEBHOOK_SOPORTE) return 'no definido'; const r = await fetch(WEBHOOK_SOPORTE); return r.status === 200 ? 'OK (webhook valido)' : 'HTTP ' + r.status + (r.status === 404 ? ' (URL inválida o webhook borrado)' : r.status === 429 ? ' (Discord limita la IP de Render)' : ''); });
  if (env.GITHUB_TOKEN && env.GITHUB_REPO) await probe('github_repo', async () => {
    const r = await fetch(`${env.GITHUB_API || 'https://api.github.com'}/repos/${env.GITHUB_REPO}`, { headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'uzivert-web' } });
    if (r.status === 401) return 'HTTP 401: el token es inválido o venció';
    if (r.status === 404) return 'HTTP 404: el repo no existe o el token no tiene acceso a ese repo (revisa GITHUB_REPO y los permisos del token)';
    if (!r.ok) return 'HTTP ' + r.status;
    const d = await r.json();
    const push = d.permissions ? d.permissions.push : undefined;
    return `OK repo ${d.full_name}, rama por defecto: ${d.default_branch}${push === false ? ' | SIN permiso de escritura' : ''}${d.default_branch !== (env.GITHUB_BRANCH || 'main') ? ` | OJO: GITHUB_BRANCH debe ser ${d.default_branch}` : ''}`;
  });
  else out.github_aviso = 'Falta GITHUB_TOKEN o GITHUB_REPO: se está guardando en disco local (se pierde al reiniciar).';
  await probe('api_hub', async () => {
    if (!WEB_SECRET) return 'WEB_SECRET no definido: la verificación NO se registra en la API';
    const r = await fetch(`${API_URL}/api/verificar_web`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-web-secret': WEB_SECRET }, body: JSON.stringify({}) });
    return r.status === 400 ? 'OK (la API acepta el secreto)' : r.status === 401 ? 'ERROR 401: el WEB_SECRET no coincide con el de la API' : r.status === 404 ? 'ERROR 404: la API todavía no tiene /api/verificar_web (sube el index.js nuevo)' : 'HTTP ' + r.status;
  });
  await probe('almacenamiento_escritura', async () => { await store.write('diagnostico.txt', 'prueba ' + new Date().toISOString()); return 'OK: se escribió ' + (store.kind === 'github' ? `${env.GITHUB_DIR || 'uzivert-web'}/diagnostico.txt en ${env.GITHUB_REPO}` : 'diagnostico.txt en disco local'); });
  await probe('almacenamiento_lectura', async () => { await store.read('scripts/index.json'); return 'OK'; });
  res.json(out);
});
app.get('/api/admin/verificados', adminOnly, async (req, res) => res.json(await loadVerified()));


// ---------- LISTA PUBLICA DE SCRIPTS ----------
const baseUrl = (req) => (env.PUBLIC_URL || `${String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim()}://${req.headers.host}`).replace(/\/$/, '');
app.get('/api/scripts', async (req, res) => {
  noStore(res);
  try {
    const verificado = !!unsign(cookies(req).uz_user);
    const base = baseUrl(req);
    const activos = (await loadIndex()).filter((x) => x.estado === 'activo');
    // Si el script es corto (un loader), se copia su contenido directo y no sale el link de onrender.com.
    const textoCopiable = async (x) => {
      try {
        const c = cache.get(x.slug);
        let code = c && Date.now() - c.t < 30e3 ? c.code : await store.read(`scripts/${x.slug}.lua`);
        if (code != null && !(c && Date.now() - c.t < 30e3)) cache.set(x.slug, { t: Date.now(), code });
        if (code != null && code.trim().length <= COPIAR_MAX) return code.trim();
      } catch {}
      return `loadstring(game:HttpGet("${base}/s/${x.slug}"))()`;
    };
    const list = [];
    for (const x of activos) list.push({ slug: x.slug, name: x.name, game: x.game, version: x.version, description: x.description, updatedAt: x.updatedAt, logo: x.logo || '', situacion: x.situacion || 'ok', libre: x.verificacion === 'no', loadstring: (verificado || x.verificacion === 'no') ? await textoCopiable(x) : null });
    res.json({ verificado, scripts: list });
  } catch (e) { res.status(500).json({ error: 'No se pudo leer la lista.' }); }
});

// ---------- PANEL (usa la API de Uzivert; la clave de la API nunca llega al navegador) ----------
async function apiAdmin(ruta, params) {
  if (!API_ADMIN_PASS) { const e = new Error('Falta la variable API_ADMIN_PASS en el servicio de la página (es la contraseña de admin de tu API).'); e.status = 503; throw e; }
  const u = new URL(API_URL + ruta);
  u.searchParams.set('pass', API_ADMIN_PASS);
  for (const [k, v] of Object.entries(params || {})) u.searchParams.set(k, String(v));
  let r;
  try { r = await fetch(u, { signal: AbortSignal.timeout(30000) }); } catch { const e = new Error('No se pudo conectar con la API (puede estar despertando, prueba de nuevo en un momento).'); e.status = 502; throw e; }
  let d = null; try { d = await r.json(); } catch {}
  if (r.status === 401) { const e = new Error('La API rechazó la clave: revisa que API_ADMIN_PASS sea la contraseña de admin de la API.'); e.status = 502; throw e; }
  if (r.status === 404) { const e = new Error('Esa función todavía no existe en tu API (' + ruta + ').'); e.status = 501; throw e; }
  if (!r.ok) { const e = new Error((d && d.error) || 'Error de la API (' + r.status + ').'); e.status = 502; throw e; }
  return d;
}
const viaApi = (fn) => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message || 'Error.' }); } };
app.get('/api/admin/panel/verificados', adminOnly, viaApi(() => apiAdmin('/admin/verificados')));
app.get('/api/admin/panel/baneados', adminOnly, viaApi(() => apiAdmin('/admin/baneados')));
app.get('/api/admin/panel/conectados', adminOnly, viaApi(() => apiAdmin('/admin/conectados')));
app.get('/api/admin/panel/perfiles', adminOnly, viaApi(async () => { const r = await fetch(`${API_URL}/api/perfiles`, { signal: AbortSignal.timeout(30000) }); if (!r.ok) throw Object.assign(new Error('No se pudieron leer los perfiles.'), { status: 502 }); return r.json(); }));
app.post('/api/admin/panel/update', adminOnly, needJson, viaApi(async (req) => {
  const b = req.body || {};
  const titulo = clean(b.titulo, 100), desc = clean(b.desc, 1800), version = clean(b.version, 20);
  if (!titulo || !desc) throw Object.assign(new Error('Faltan el título o la descripción.'), { status: 400 });
  const d = await apiAdmin('/admin/crear_update', { titulo, desc, version });   // la API lo guarda y lo manda a Discord (webhook)
  updatesCache = { t: 0, data: null };
  return d;
}));
app.post('/api/admin/panel/verificar', adminOnly, needJson, viaApi(async (req) => {
  const id = clean(req.body && req.body.discord_id, 25);
  if (!/^\d{15,22}$/.test(id)) throw Object.assign(new Error('El ID de Discord son solo números.'), { status: 400 });
  return apiAdmin('/admin/perfil/verificar', { discord_id: id, valor: req.body.valor ? 1 : 0 });
}));
app.post('/api/admin/panel/perfil', adminOnly, needJson, viaApi(async (req) => {
  const b = req.body || {};
  const id = clean(b.discord_id, 25), roblox = clean(b.roblox_user, 40);
  if (!/^\d{15,22}$/.test(id)) throw Object.assign(new Error('El ID de Discord son solo números.'), { status: 400 });
  if (!roblox) throw Object.assign(new Error('Falta el usuario de Roblox.'), { status: 400 });
  const u = new URL(API_URL + '/api/perfil/editar');
  const p = { discord_id: id, roblox_user: roblox, display_name: clean(b.display_name, 32), custom_avatar: clean(b.custom_avatar, 300), bio: clean(b.bio, 190), banner: clean(b.banner, 300) };
  for (const [k, v] of Object.entries(p)) u.searchParams.set(k, v);
  const r = await fetch(u, { signal: AbortSignal.timeout(30000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.ok) throw Object.assign(new Error(d.error || 'No se pudo guardar el perfil.'), { status: r.status === 403 ? 403 : 502 });
  return d;
}));

// Updates públicos (los mismos que se publican desde el panel)
let updatesCache = { t: 0, data: null };
app.get('/api/updates', async (req, res) => {
  noStore(res);
  if (!updatesCache.data || Date.now() - updatesCache.t > 30e3) {
    try {
      const r = await fetch(`${API_URL}/api/updates`, { signal: AbortSignal.timeout(20000) });
      if (r.ok) { const d = await r.json(); updatesCache = { t: Date.now(), data: (Array.isArray(d) ? d : []).slice(0, 30).map((u) => ({ titulo: clean(u.titulo, 100), version: clean(u.version, 20), descripcion: clean(u.descripcion, 1800), fecha: u.fecha || null })) }; }
    } catch {}
  }
  res.json(updatesCache.data || []);
});

// ---------- ESTADO ----------
let estadoCache = { t: 0, data: null };
app.get('/api/estado', async (req, res) => {
  noStore(res);
  try {
    if (!estadoCache.data || Date.now() - estadoCache.t > 45e3) {
      let apiOk = false, ms = null;
      const t0 = Date.now();
      try { const r = await fetch(`${API_URL}/`, { signal: AbortSignal.timeout(15000) }); apiOk = r.status < 500; ms = Date.now() - t0; } catch {}
      const scripts = (await loadIndex()).filter((x) => x.estado === 'activo').map((x) => ({ name: x.name, game: x.game, version: x.version, situacion: x.situacion || 'ok', updatedAt: x.updatedAt }));
      estadoCache = { t: Date.now(), data: { web: { ok: true }, api: { ok: apiOk, ms }, scripts, chequeado: new Date().toISOString() } };
    }
    res.json(estadoCache.data);
  } catch (e) { res.status(500).json({ error: 'No se pudo leer el estado.' }); }
});

// Logo servido desde la propia página. Se guarda una copia en el almacenamiento (logos/<slug>.txt)
// para que no dependa de que Roblox responda cada vez (ni se pierda cuando Render reinicia).
const logoCache = new Map();
async function descargarLogo(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !u.hostname.includes('.') || /^[\d.]+$/.test(u.hostname)) throw new Error('logo no permitido');
  const r = await fetch(u, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'Mozilla/5.0 UzivertWeb' } });
  if (!r.ok) throw new Error('no se pudo descargar la imagen (HTTP ' + r.status + ')');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 2e6) throw new Error('imagen demasiado grande');
  // Roblox a veces manda un content-type raro: se detecta el formato por los primeros bytes.
  const h = buf.subarray(0, 12);
  let type = null;
  if (h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47) type = 'image/png';
  else if (h[0] === 0xff && h[1] === 0xd8) type = 'image/jpeg';
  else if (h.subarray(0, 3).toString() === 'GIF') type = 'image/gif';
  else if (h.subarray(0, 4).toString() === 'RIFF' && h.subarray(8, 12).toString() === 'WEBP') type = 'image/webp';
  if (!type) throw new Error('el link no es una imagen válida (tipo ' + (r.headers.get('content-type') || '?') + ')');
  return { type, buf };
}
async function guardarLogo(slug, url) {
  const l = await descargarLogo(url);
  await store.write(`logos/${slug}.txt`, `${l.type}\n${l.buf.toString('base64')}`);
  logoCache.set(slug, { url, type: l.type, buf: l.buf });
  return l;
}
async function leerLogo(slug, meta) {
  const c = logoCache.get(slug);
  if (c && c.url === meta.logo) return c;
  try {
    const t = await store.read(`logos/${slug}.txt`);
    if (t) { const k = t.indexOf('\n'); const type = t.slice(0, k); const buf = Buffer.from(t.slice(k + 1), 'base64'); if (buf.length) { const e = { url: meta.logo, type, buf }; logoCache.set(slug, e); return e; } }
  } catch {}
  const l = await guardarLogo(slug, meta.logo);   // primera vez / copia perdida: descarga y guarda
  return { url: meta.logo, ...l };
}
app.get('/logo/:slug', async (req, res) => {
  const slug = req.params.slug;
  if (!SLUG.test(slug)) return res.status(404).end('');
  try {
    const meta = (await loadIndex()).find((s) => s.slug === slug);
    if (!meta || !meta.logo) return res.status(404).end('');
    const c = await leerLogo(slug, meta);
    res.setHeader('Content-Type', c.type); res.setHeader('Cache-Control', 'public, max-age=3600');
    res.end(c.buf);
  } catch (e) { console.warn('logo', slug, e.message); res.status(404).end(''); }
});

// ---------- FORO ----------
const CATEGORIAS = ['General', 'Ayuda', 'Sugerencias', 'Scripts'];
const MAX_TEMAS = 300, MAX_RESP = 300;
let foro = null, foroTimer = null, foroSucio = false;
async function loadForo() {
  if (!foro) { try { foro = JSON.parse((await store.read('foro.json')) || 'null'); } catch { foro = null; } }
  if (!foro || !Array.isArray(foro.temas)) foro = { temas: [], baneados: [] };
  if (!Array.isArray(foro.baneados)) foro.baneados = [];
  return foro;
}
function guardarForo() {            // escritura diferida: agrupa varios mensajes en un solo guardado
  foroSucio = true;
  if (foroTimer) return;
  foroTimer = setTimeout(flushForo, 2000);
}
async function flushForo() {
  clearTimeout(foroTimer); foroTimer = null;
  if (!foroSucio || !foro) return;
  foroSucio = false;
  try { await store.write('foro.json', JSON.stringify(foro)); } catch (e) { foroSucio = true; console.error('guardar foro:', e.message); foroTimer = setTimeout(flushForo, 15000); }
}
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, async () => { await flushForo(); process.exit(0); });

const RE_LINK = /(https?:\/\/|www\.|discord\.gg|\b[a-z0-9-]{2,}\.(com|net|org|gg|io|ly|xyz|me|co|app|tk|ru|link|gl|cc|to|site|online|ml|ga|cf)\b)/i;
const nuevoId = () => crypto.randomBytes(5).toString('hex');
function autorDe(req) {
  const u = unsign(cookies(req).uz_user);
  if (u) return { id: u.id, name: u.name, staff: false };
  if (isAdmin(req)) return { id: 0, name: SITE_NAME, staff: true };
  return null;
}
const resumen = (t) => ({ id: t.id, titulo: t.titulo, categoria: t.categoria, autor: t.autor, fecha: t.fecha, ultima: t.ultima, respuestas: t.respuestas.length, fijado: !!t.fijado, cerrado: !!t.cerrado });
const puedeBorrar = (req, autor) => isAdmin(req) || (autor && autor.id > 0 && (unsign(cookies(req).uz_user) || {}).id === autor.id);
function validarTexto(texto, autor) {
  if (!autor.staff && RE_LINK.test(texto)) return 'Por seguridad no se permiten links en el foro.';
  return null;
}

app.get('/api/foro', async (req, res) => {
  noStore(res);
  const f = await loadForo();
  const cat = CATEGORIAS.includes(req.query && req.query.cat) ? req.query.cat : null;
  const lista = f.temas.filter((t) => !cat || t.categoria === cat).sort((a, b) => (b.fijado ? 1 : 0) - (a.fijado ? 1 : 0) || b.ultima.localeCompare(a.ultima)).slice(0, 60).map(resumen);
  res.json({ categorias: CATEGORIAS, temas: lista });
});
app.get('/api/foro/:id', async (req, res) => {
  noStore(res);
  const f = await loadForo();
  const t = f.temas.find((x) => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Ese tema no existe.' });
  const yo = unsign(cookies(req).uz_user);
  const marca = (a) => ({ ...a, mio: !!(yo && a.id > 0 && a.id === yo.id) });
  res.json({ ...resumen(t), texto: t.texto, autor: marca(t.autor), mensajes: t.respuestas.map((r) => ({ id: r.id, texto: r.texto, fecha: r.fecha, autor: marca(r.autor) })) });
});
app.post('/api/foro', needJson, async (req, res) => {
  noStore(res);
  const autor = autorDe(req);
  if (!autor) return res.status(403).json({ error: 'Verifica tu cuenta para publicar en el foro.' });
  const f = await loadForo();
  if (autor.id > 0 && f.baneados.includes(autor.id)) return res.status(403).json({ error: 'No puedes publicar en el foro.' });
  const b = req.body || {};
  const titulo = clean(b.titulo, 80), texto = clean(b.texto, 1500);
  const categoria = CATEGORIAS.includes(b.categoria) ? b.categoria : 'General';
  if (titulo.length < 3) return res.status(400).json({ error: 'El título es muy corto.' });
  if (texto.length < 5) return res.status(400).json({ error: 'El mensaje es muy corto.' });
  const bad = validarTexto(titulo + ' ' + texto, autor);
  if (bad) return res.status(400).json({ error: bad });
  if (limited('ft:' + (autor.id || ip(req)), 3, 10 * 60e3)) return res.status(429).json({ error: 'Vas muy rápido. Espera unos minutos.' });
  const ahora = new Date().toISOString();
  const t = { id: nuevoId(), titulo, texto, categoria, autor, fecha: ahora, ultima: ahora, fijado: false, cerrado: false, respuestas: [] };
  f.temas.push(t);
  if (f.temas.length > MAX_TEMAS) { const i = f.temas.findIndex((x) => !x.fijado); if (i >= 0) f.temas.splice(i, 1); }
  guardarForo();
  res.json({ ok: true, id: t.id });
});
app.post('/api/foro/:id/responder', needJson, async (req, res) => {
  noStore(res);
  const autor = autorDe(req);
  if (!autor) return res.status(403).json({ error: 'Verifica tu cuenta para responder.' });
  const f = await loadForo();
  if (autor.id > 0 && f.baneados.includes(autor.id)) return res.status(403).json({ error: 'No puedes publicar en el foro.' });
  const t = f.temas.find((x) => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Ese tema no existe.' });
  if (t.cerrado) return res.status(403).json({ error: 'Este tema está cerrado.' });
  if (t.respuestas.length >= MAX_RESP) return res.status(403).json({ error: 'Este tema está lleno.' });
  const texto = clean(req.body && req.body.texto, 1500);
  if (texto.length < 2) return res.status(400).json({ error: 'El mensaje es muy corto.' });
  const bad = validarTexto(texto, autor);
  if (bad) return res.status(400).json({ error: bad });
  if (limited('fr:' + (autor.id || ip(req)), 8, 10 * 60e3)) return res.status(429).json({ error: 'Vas muy rápido. Espera unos minutos.' });
  const r = { id: nuevoId(), autor, texto, fecha: new Date().toISOString() };
  t.respuestas.push(r); t.ultima = r.fecha;
  guardarForo();
  res.json({ ok: true, id: r.id });
});
app.delete('/api/foro/:id', needJson, async (req, res) => {
  noStore(res);
  const f = await loadForo();
  const i = f.temas.findIndex((x) => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Ese tema no existe.' });
  if (!puedeBorrar(req, f.temas[i].autor)) return res.status(403).json({ error: 'No puedes borrar esto.' });
  f.temas.splice(i, 1); guardarForo();
  res.json({ ok: true });
});
app.delete('/api/foro/:id/r/:rid', needJson, async (req, res) => {
  noStore(res);
  const f = await loadForo();
  const t = f.temas.find((x) => x.id === req.params.id);
  const i = t ? t.respuestas.findIndex((x) => x.id === req.params.rid) : -1;
  if (i < 0) return res.status(404).json({ error: 'Ese mensaje no existe.' });
  if (!puedeBorrar(req, t.respuestas[i].autor)) return res.status(403).json({ error: 'No puedes borrar esto.' });
  t.respuestas.splice(i, 1); guardarForo();
  res.json({ ok: true });
});
// Moderacion (solo admin)
app.post('/api/admin/foro/:id/fijar', adminOnly, async (req, res) => { const f = await loadForo(); const t = f.temas.find((x) => x.id === req.params.id); if (!t) return res.status(404).json({ error: 'No existe' }); t.fijado = !!(req.body && req.body.valor); guardarForo(); res.json({ ok: true }); });
app.post('/api/admin/foro/:id/cerrar', adminOnly, async (req, res) => { const f = await loadForo(); const t = f.temas.find((x) => x.id === req.params.id); if (!t) return res.status(404).json({ error: 'No existe' }); t.cerrado = !!(req.body && req.body.valor); guardarForo(); res.json({ ok: true }); });
app.post('/api/admin/foro/baneo', adminOnly, async (req, res) => {
  const f = await loadForo(); const id = Number(req.body && req.body.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID inválido' });
  f.baneados = f.baneados.filter((x) => x !== id); if (req.body.valor) f.baneados.push(id);
  guardarForo(); res.json({ ok: true, baneados: f.baneados });
});

// Entrega pública del script crudo: loadstring(game:HttpGet("https://TU-DOMINIO/s/slug"))()
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

// Video tutorial (con soporte de Range para que el celular pueda avanzar/reproducir).
app.get('/tutorial.mp4', (req, res) => {
  const f = [path.join(__dirname, 'public', 'tutorial.mp4'), path.join(__dirname, 'tutorial.mp4')].find((x) => require('fs').existsSync(x));
  if (!f) return res.status(404).type('text/plain').send('Video no disponible');
  const size = require('fs').statSync(f).size;
  res.setHeader('Content-Type', 'video/mp4'); res.setHeader('Accept-Ranges', 'bytes'); res.setHeader('Cache-Control', 'public, max-age=3600');
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (m && (m[1] || m[2])) {
    let a = m[1] ? parseInt(m[1], 10) : Math.max(0, size - parseInt(m[2], 10));
    let b = m[1] && m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1;
    if (a > b || a >= size) { res.statusCode = 416; res.setHeader('Content-Range', `bytes */${size}`); return res.end(); }
    res.statusCode = 206; res.setHeader('Content-Range', `bytes ${a}-${b}/${size}`); res.setHeader('Content-Length', b - a + 1);
    return require('fs').createReadStream(f, { start: a, end: b }).pipe(res);
  }
  res.setHeader('Content-Length', size);
  require('fs').createReadStream(f).pipe(res);
});

// Archivos de la página: carpeta public/, o (si subiste todo suelto en la raiz) solo estos archivos permitidos.
const fs = require('fs');
const PUBLIC_DIR = path.join(__dirname, 'public');
if (fs.existsSync(path.join(PUBLIC_DIR, 'index.html'))) {
  app.use(express.static(PUBLIC_DIR));
} else {
  const PAGINA = new Set(['index.html', 'admin.html', 'style.css', 'app.js', 'admin.js', 'common.js']);
  const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8' };
  console.log('[aviso] No hay carpeta public/: sirviendo los archivos de la página desde la raiz.');
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
app.use((err, req, res, next) => { if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Demasiado grande' }); if (err instanceof SyntaxError) return res.status(400).json({ error: 'JSON inválido' }); console.error(err); res.status(500).json({ error: 'Error interno' }); });

module.exports = app;
if (require.main === module) app.listen(PORT, () => console.log(`${SITE_NAME} web en puerto ${PORT}`));
