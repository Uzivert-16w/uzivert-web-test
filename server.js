'use strict';
const express = require('./mini');
const crypto = require('crypto');
const path = require('path');
const { localStore, githubStore } = require('./store');

// ---- registro de consola (lo muestra el panel admin; se ocultan claves y webhooks) ----
const LOGS = []; let logN = 0;
const ocultar = (t) => String(t).replace(/(Bearer\s+)\S+/gi, '$1[oculto]').replace(/((?:key|token|pass|password|secret|clave|authorization)["']?\s*[:=]\s*["']?)[^\s"',}&]+/gi, '$1[oculto]')
  .replace(/\b(?:nvapi-|gsk_|sk-|AQ\.|ghp_|github_pat_)[A-Za-z0-9_\-.]{8,}/g, '[oculto]').replace(/webhooks\/\d+\/[\w-]+/g, 'webhooks/[oculto]').replace(/[A-Za-z0-9_\-]{40,}/g, '[oculto]');
for (const [nivel, fn] of [['info', 'log'], ['aviso', 'warn'], ['error', 'error']]) {
  const orig = console[fn].bind(console);
  console[fn] = (...a) => { try { LOGS.push({ n: ++logN, ts: Date.now(), nivel, t: ocultar(a.map((x) => typeof x === 'string' ? x : (x && x.stack) || JSON.stringify(x)).join(' ')).slice(0, 600) }); if (LOGS.length > 600) LOGS.shift(); } catch {} orig(...a); };
}

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
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: https:; media-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; style-src-attr 'unsafe-inline'; script-src 'self'; frame-src https://www.youtube-nocookie.com https://www.youtube.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
app.use(express.json({ limit: '1.5mb' }));
const noStore = (res) => res.setHeader('Cache-Control', 'no-store');
const needJson = (req, res, next) => (req.is('application/json') && req.get('X-Requested-With') === 'uz' ? next() : res.status(400).json({ error: 'Petición inválida' }));
const ip = (req) => req.ip || 'x';

app.get('/api/config', (req, res) => res.json({ nombre: SITE_NAME, discord: DISCORD_INVITE, soporte: !!WEBHOOK_SOPORTE, version: env.SITE_VERSION || 'v1.2.1' }));

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
// Cuota: 50 mensajes por persona (IP). Al llegar a 0 espera 2 h (uso normal) o 3 h (si gastó los 50 en menos de 30 min). El admin no tiene límite.
const VX_MAX = 50, VX_ESPERA_BASE = 2 * 3600e3, VX_ESPERA_ALTA = 3 * 3600e3, VX_USO_RAPIDO = 30 * 60e3;
const vxEstado = new Map();                                        // 'c:<cookie>' | 'i:<hash ip>' -> {left, inicio, hasta, ult}
let vxSucio = false, vxTimer = null;
const vxHash = (x) => crypto.createHash('sha256').update(String(x) + (WEB_SECRET || 'uzivert-vx')).digest('hex').slice(0, 24);
const vxCargada = (async () => {                                   // la cuota sobrevive a reinicios de Render (se guarda en el almacenamiento)
  try { const j = JSON.parse((await store.read('vx-cuotas.json')) || '{}'); for (const k of Object.keys(j)) if (j[k] && typeof j[k].left === 'number') vxEstado.set(k, j[k]); } catch (e) { console.error('cuotas:', e.message); }
})();
function vxMarcar() { vxSucio = true; if (!vxTimer) vxTimer = setTimeout(vxGuardar, 20e3); }
async function vxGuardar() {
  clearTimeout(vxTimer); vxTimer = null;
  if (!vxSucio) return;
  vxSucio = false;
  try { const o = {}; for (const [k, v] of vxEstado) o[k] = v; await store.write('vx-cuotas.json', JSON.stringify(o)); } catch (e) { vxSucio = true; console.error('guardar cuotas:', e.message); vxTimer = setTimeout(vxGuardar, 60e3); }
}
setInterval(() => { const n = Date.now(); for (const [k, v] of vxEstado) if ((v.hasta && v.hasta < n) || (!v.hasta && n - (v.ult || 0) > 24 * 3600e3)) { vxEstado.delete(k); vxMarcar(); } }, 60e3).unref();
function vxId(req, res) {                                          // id anónimo por navegador (cookie), además de la IP
  if (req._vxid) return req._vxid;
  let id = cookies(req).uz_vx;
  if (!/^[a-f0-9]{20}$/.test(id || '')) id = crypto.randomBytes(10).toString('hex');
  if (res) setCookie(res, 'uz_vx', id, 365 * 86400);
  return (req._vxid = id);
}
function vxCuotaGet(req, res) {
  const n = Date.now(), ks = req._vxKeys || ['c:' + vxId(req, res), 'i:' + vxHash(ip(req))];
  const es = ks.map((k) => { let e = vxEstado.get(k); if (e && e.hasta && e.hasta <= n) { vxEstado.delete(k); e = null; } return e; }).filter(Boolean);
  const e = es.length ? es.reduce((a, c) => ({ left: Math.min(a.left, c.left), inicio: Math.min(a.inicio || n, c.inicio || n), hasta: Math.max(a.hasta, c.hasta), ult: Math.max(a.ult || 0, c.ult || 0), imgs: (a.imgs || []).length >= (c.imgs || []).length ? (a.imgs || []) : (c.imgs || []) }))
    : { left: VX_MAX, inicio: 0, hasta: 0, ult: n, imgs: [] };
  for (const k of ks) vxEstado.set(k, e);                          // mismo objeto bajo las dos claves
  return e;
}
function vxCuotaInfo(req, res) {
  if (isAdmin(req)) return { ilimitado: true, max: VX_MAX, restantes: VX_MAX, espera: 0 };
  const e = vxCuotaGet(req, res), n = Date.now();
  return { ilimitado: false, max: VX_MAX, restantes: e.left, espera: e.hasta > n ? Math.ceil((e.hasta - n) / 1000) : 0 };
}
function vertixEspera(req, res) {                                  // gasta 1 mensaje; devuelve ms de espera si no hay (0 = ok)
  if (isAdmin(req)) return 0;
  const e = vxCuotaGet(req, res), n = Date.now();
  if (e.hasta > n) return e.hasta - n;
  if (e.left <= 0) { e.hasta = n + VX_ESPERA_BASE; vxMarcar(); return VX_ESPERA_BASE; }
  if (e.left === VX_MAX) e.inicio = n;
  e.left--; e.ult = n;
  if (e.left === 0) e.hasta = n + ((n - e.inicio) < VX_USO_RAPIDO ? VX_ESPERA_ALTA : VX_ESPERA_BASE);
  vxMarcar();
  return 0;
}
const VX_FOTOS = 3, VX_FOTOS_VENTANA = 2 * 3600e3;                 // 3 fotos cada 2 horas
function vxFoto(req) {                                             // gasta una foto; devuelve ms de espera si ya no hay (0 = ok)
  if (isAdmin(req)) return 0;
  const e = vxCuotaGet(req), n = Date.now();
  e.imgs = (e.imgs || []).filter((t) => n - t < VX_FOTOS_VENTANA);
  if (e.imgs.length >= VX_FOTOS) return VX_FOTOS_VENTANA - (n - e.imgs[0]);
  e.imgs.push(n); e.ult = n; vxMarcar();
  return 0;
}
function vxFotoDevolver(req) { if (isAdmin(req)) return; const e = vxCuotaGet(req); if (e.imgs && e.imgs.length) { e.imgs.pop(); vxMarcar(); } }
function vxDevolver(req) {                                         // reembolsa un mensaje si la IA falló
  if (isAdmin(req)) return;
  const e = vxCuotaGet(req);
  e.left = Math.min(VX_MAX, e.left + 1); e.hasta = 0; vxMarcar();
}
// Versiones/modelos elegibles. Se pueden definir con VX_MODELOS (JSON: [{id,nombre,desc,model,url?,key?}]).
let VX_MODELOS = [];
function vxLimpiaJson(t) {                                         // tolera lo que mete el teléfono al pegar: comillas curvas, saltos, espacios raros
  t = String(t || '').replace(/[​-‍﻿ ]/g, ' ').replace(/[“”„‟«»]/g, '"').replace(/[‘’]/g, "'").trim();
  if (/^'.*'$/s.test(t) || (/^".*"$/s.test(t) && t[1] === '[')) t = t.slice(1, -1);
  const a = t.indexOf('['), b = t.lastIndexOf(']');
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  return t.replace(/,\s*([\]}])/g, '$1');
}
try { const j = JSON.parse(vxLimpiaJson(env.VX_MODELOS) || '[]'); if (Array.isArray(j)) VX_MODELOS = j.filter((m) => m && m.id && m.model).map((m) => ({ id: String(m.id).slice(0, 20), nombre: String(m.nombre || m.id).slice(0, 30), desc: String(m.desc || '').slice(0, 80), model: String(m.model), url: m.url ? String(m.url) : '', key: m.key ? String(m.key) : '', mant: !!m.mant })); } catch (e) { console.warn('[aviso] VX_MODELOS inválido: ' + e.message.replace(/"[^"]{20,}"/g, '"..."') + ' | empieza con: ' + JSON.stringify(String(env.VX_MODELOS || '').slice(0, 25)) + ' | termina con: ' + JSON.stringify(String(env.VX_MODELOS || '').slice(-3)) + ' | largo: ' + String(env.VX_MODELOS || '').length); }
function vxModelosInit() {
  if (VX_MODELOS.length) return;
  VX_MODELOS.push({ id: 'lite', nombre: 'Vertix Lite', desc: 'Rápido y ligero', model: DEEPSEEK_MODEL, url: '', key: '' });
  if (env.DEEPSEEK_MODEL2) VX_MODELOS.push({ id: 'pro', nombre: 'Vertix Pro', desc: 'Más inteligente', model: env.DEEPSEEK_MODEL2, url: '', key: '' });
}
const VX_SITIOS = ['youtube', 'google', 'tiktok', 'discord', 'spotify', 'roblox'];
const VX_PAGINAS = ['inicio', 'verificar', 'soporte', 'scripts', 'foro', 'updates', 'estado', 'faq', 'creador', 'creditos'];
const DEEPSEEK_MODEL2 = env.DEEPSEEK_MODEL2 || '';                 // modelo de respaldo (opcional)
function vxPrompt() {
  const ahora = new Date().toLocaleString('es-PY', { timeZone: 'America/Asuncion', dateStyle: 'full', timeStyle: 'short' });
  return `Eres Vertix (versión beta), el asistente de voz de Uzivert Hub. Hablas en español natural, directo y amable. Normalmente respondes corto (1 a 3 frases) porque tu respuesta se lee en voz alta, pero cuando te piden código o una explicación larga puedes extenderte. Fecha y hora actual en Paraguay: ${ahora}.

SOBRE UZIVERT HUB (esto lo sabes con seguridad):
- Uzivert es el creador de Uzivert Hub, un hub de scripts para Roblox, desde Paraguay. El proyecto lleva más o menos 1 mes en desarrollo: todavía es pequeño y le falta mucho por mejorar.
- Hay DOS tipos de scripts:
  1) El HUB GRANDE (se llama "Uzivert Hub | Oficial"): trae varios juegos en uno y YA NO necesita verificación: cualquiera lo puede usar. Sus juegos son MM2 (Murder Mystery 2, el principal), MMV (Murder Mystery V), Duelos Latam, Distrito de Violencia y Prison Life (en Prison Life la sección de armas está en mantenimiento).
  2) Los hubs APARTE: Duelos Murderer vs Sheriffs y el script Universal. Tampoco necesitan verificación.
  La verificación es OPCIONAL para todos: sirve para que al ejecutar el script te salga un cartel de bienvenida y tener tu perfil y el rol de Verificado. Nunca digas que hay que verificarse para usar un script. Sí hay baneos para quien abuse, y al ejecutar se registra el usuario de Roblox por seguridad.
- Para qué sirven: ayudan a jugar, tanto a jugadores nuevos como antiguos. No son para abusar. Ningún script está garantizado: se intenta que todos funcionen siempre, pero a veces fallan o necesitan actualización. Nunca prometas que funcionan siempre, ni digas que son seguros o indetectables.
- Hay un servidor de Discord oficial, un bot (Vertix también vive ahí), una API y esta página web (uzivert-web.onrender.com).
- La página tiene: Inicio, Verificar, Scripts, Foro, Updates, Estado del servicio, Preguntas frecuentes, Soporte, Donaciones (próximamente), Creador, Créditos y Términos.

VERIFICACIÓN (reglas fijas): nunca pidas ni aceptes contraseña, PIN, correo ni cookies de nadie; solo el usuario de Roblox. Si alguien no quiere poner el código en su perfil, dile con amabilidad que sin ese paso no se puede verificar. Se hace en la sección Verificar de la página: se verifica la cuenta de Roblox poniendo un código en la descripción del perfil. Si alguien no sabe cómo, explícaselo simple y con calma, y usa action {"type":"go","page":"verificar"}. No inventes pasos que no conozcas.

SOPORTE: si alguien dice que un script no funciona, pregúntale qué juego es y qué pasa (qué error o qué no carga). Ayuda con lo que sepas. Si no se resuelve o no sabes la respuesta, no inventes: mándalo a la sección Soporte (action go soporte) o al Discord, y menciona que la página Estado muestra si hay problemas del servicio.

SCRIPTS: nunca inventes loadstrings ni enlaces de scripts. El sistema entrega por su cuenta los loaders que da la página (Uzivert Hub, Duelos, Universal...): si alguien pide un script, el sistema se lo da; tú no escribas ningún link.

FOTOS: si el usuario envía una imagen, descríbela o respóndele sobre ella.

PROGRAMACIÓN: SÍ puedes ayudar con código, incluido Lua/Luau para Roblox Studio (scripts para crear juegos, partes, GUIs, sistemas, etc.). Cuando te pidan un ejemplo o un script, escríbelo completo en "say" dentro de un bloque con tres comillas invertidas, con una explicación breve. La única excepción: si piden el script/loadstring de un juego DEL HUB (MM2, MMV, Duelos, Distrito, Prison Life) o un exploit, diles que están en la pestaña Scripts de esta página (hay que verificar la cuenta de Roblox primero) y usa la acción go a "scripts". Si piden verificarse, go a "verificar".

REGLA CLAVE: TODO lo que quieras decir o escribir (historias, listas, código, explicaciones largas) va COMPLETO dentro del campo "say", con saltos de línea \n. Nunca pongas el contenido en otros campos ni escribas solo una introducción como "aquí tienes".

FORMATO: responde SIEMPRE con un JSON exacto: {"say":"lo que dices en voz alta","action":null}
"action" puede ser una de estas:
- {"type":"play","query":"canción o video a reproducir"}: reproduce música o videos de YouTube dentro de esta página. SÍ puedes hacerlo: úsalo siempre que pidan reproducir, poner o escuchar una canción, artista o video. Si el usuario dice "una canción de él/ella", usa el artista de la conversación. Pon en "say" algo corto como "Reproduciendo ...".
- {"type":"open","url":"https://..."}: abre CUALQUIER página web que te pidan (usa la dirección real y completa, siempre https).
- {"type":"open","site":"youtube|google|tiktok|discord|spotify|roblox","query":"búsqueda opcional"}: atajo para esos sitios, con búsqueda dentro del sitio.
- {"type":"go","page":"inicio|verificar|soporte|scripts|foro|updates|estado|faq|creador|creditos"}: moverte dentro de esta web.
Si no hay nada que hacer, "action" es null. No uses emojis. IMPORTANTE: no tienes herramientas ni funciones que llamar; nunca intentes llamar herramientas. Solo respondes con ese JSON. Cuando recibas un bloque "INFORMACIÓN DE INTERNET", úsalo para responder con seguridad y resume lo importante; si no alcanza, dilo con honestidad en vez de inventar. Si el usuario pide algo peligroso o ilegal, lo rechazas con una frase corta.`;
}
const vxLimpiar = (t) => String(t || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
function vxUrlOk(u) {
  try {
    const x = new URL(String(u));
    if (x.protocol !== 'https:' || x.username || x.password || String(u).length > 500) return null;
    const h = x.hostname.toLowerCase();
    if (h === 'localhost' || !h.includes('.') || /^(\d+\.){3}\d+$/.test(h) || h.endsWith('.local') || h.endsWith('.internal')) return null;
    return x.toString();
  } catch { return null; }
}
async function vxFetch(url, opts, ms) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms || 8000);
  try { return await fetch(url, Object.assign({ signal: c.signal }, opts || {})); } finally { clearTimeout(t); }
}
// Búsqueda en internet: Tavily (si hay key) o DuckDuckGo + Wikipedia en paralelo
async function vxTavily(q) {
  const out = [];
  const r = await vxFetch('https://api.tavily.com/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: env.TAVILY_API_KEY, query: q, max_results: 5, include_answer: true }) }, 9000);
  const d = await r.json();
  if (d.answer) out.push({ title: 'Resumen', snippet: String(d.answer).slice(0, 500), url: '' });
  for (const x of (d.results || []).slice(0, 5)) out.push({ title: clean(x.title, 120), snippet: clean(x.content, 350), url: x.url });
  return out;
}
async function vxDdg(q) {
  const out = [];
  const r = await vxFetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q) + '&kl=es-es', { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36', 'Accept-Language': 'es-ES,es;q=0.9' } }, 6000);
  const html = await r.text();
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) && out.length < 5) {
    let href = m[1]; const u = /[?&]uddg=([^&]+)/.exec(href); if (u) { try { href = decodeURIComponent(u[1]); } catch {} }
    out.push({ title: vxLimpiar(m[2]).slice(0, 120), snippet: vxLimpiar(m[3]).slice(0, 350), url: href });
  }
  return out;
}
async function vxWiki(q) {
  const out = [];
  const r = await vxFetch('https://es.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=' + encodeURIComponent(q) + '&gsrlimit=3&prop=extracts&exintro=1&explaintext=1&exsentences=3&format=json&utf8=1&origin=*', {}, 6000);
  const d = await r.json();
  for (const p of Object.values((d.query && d.query.pages) || {})) out.push({ title: p.title, snippet: clean(p.extract, 400), url: 'https://es.wikipedia.org/wiki/' + encodeURIComponent(String(p.title).replace(/ /g, '_')) });
  return out;
}
async function vxBuscar(q) {
  q = clean(q, 200);
  const tareas = env.TAVILY_API_KEY ? [vxTavily(q)] : [vxDdg(q), vxWiki(q)];
  const res = await Promise.all(tareas.map((p) => p.catch((e) => { console.error('busqueda:', e.message); return []; })));
  return res.flat().slice(0, 7);
}
// Busca un video en YouTube para reproducirlo (API oficial si hay key; si no, la página de resultados)
async function vxYoutube(q) {
  q = clean(q, 120); if (!q) return null;
  if (env.YOUTUBE_API_KEY) {
    try {
      const r = await vxFetch('https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&maxResults=1&q=' + encodeURIComponent(q) + '&key=' + encodeURIComponent(env.YOUTUBE_API_KEY), {}, 7000);
      const d = await r.json();
      const it = d.items && d.items[0];
      if (it && it.id && it.id.videoId) return { id: it.id.videoId, title: vxLimpiar(it.snippet && it.snippet.title) };
      if (d.error) console.error('youtube api:', JSON.stringify(d.error).slice(0, 160));
    } catch (e) { console.error('youtube api:', e.message); }
  }
  try {
    const r = await vxFetch('https://www.youtube.com/results?search_query=' + encodeURIComponent(q) + '&sp=EgIQAQ%253D%253D', { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36', 'Accept-Language': 'es-ES,es;q=0.9', Cookie: 'CONSENT=YES+1' } }, 8000);
    const html = await r.text();
    const m = /"videoRenderer":\{"videoId":"([\w-]{11})"[\s\S]{0,1500}?"title":\{"runs":\[\{"text":"([^"]*)"/.exec(html);
    if (m) return { id: m[1], title: vxLimpiar(m[2].replace(/\\u0026/g, '&').replace(/\\"/g, '"')) };
  } catch (e) { console.error('youtube scrape:', e.message); }
  return null;
}
const vxQuierePlay = (t) => /\b(reprod[uú]ce(me)?|reproducir|ponme|p[oó]n(me)?\s+(una|un|la|el|algo|m[uú]sica)|play|quiero (escuchar|o[ií]r)|escuchar|pon la canci[oó]n|canci[oó]n de)\b/i.test(String(t));
// ¿El mensaje pide información externa? (decidido por el servidor, el modelo no llama herramientas)
function vxNecesitaBusqueda(t) {
  const x = String(t).toLowerCase();
  if (/^\s*(abre|abrir|ve a|ir a|ll[eé]vame|pon|reproduce|verifica)/.test(x) || vxQuierePlay(x)) return false;
  return /\b(busca|buscar|búscame|buscame|investiga|googlea|qui[eé]n es|qui[eé]n fue|qu[eé] es|qu[eé] fue|noticias|cu[aá]ndo|cu[aá]nto cuesta|precio|clima|resultado|[uú]ltim[oa]s?|actual|hoy|biograf[ií]a|significa|d[oó]nde queda|capital de|cu[aá]ntos?)\b/.test(x);
}
function vxConsulta(t) {
  return clean(String(t).replace(/\b(puedes|podr[ií]as|por favor|vertix|oye|hey|busca(me|r)?|investiga|googlea|en internet|en google|sobre)\b/gi, ' ').replace(/\s+/g, ' '), 200) || clean(t, 200);
}
// Llamada al modelo con reintentos (429/5xx), respaldo y modo JSON tolerante
async function vxLLM(messages, op) {
  op = op || {};
  messages = messages.slice();
  const modelos = op.model ? [op.model] : (op.modelos && op.modelos.length ? op.modelos : [DEEPSEEK_MODEL].concat(DEEPSEEK_MODEL2 ? [DEEPSEEK_MODEL2] : []));
  let ultimo = null;
  for (const mo of modelos) {
    const modelo = typeof mo === 'string' ? mo : mo.model, murl = (typeof mo === 'object' && mo.url) || '', mkey = (typeof mo === 'object' && mo.key) || '';
    for (let intento = 0; intento < 3; intento++) {
      const json = intento < 2 && !/qwen/i.test(modelo);
      try {
        const r = await vxFetch(op.url || murl || DEEPSEEK_URL, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (op.key || mkey || DEEPSEEK_KEY) },
          body: JSON.stringify(Object.assign({ model: modelo, messages, max_tokens: 1800, temperature: 0.6 }, json ? { response_format: { type: 'json_object' } } : {}, /gpt-oss|gemini/i.test(modelo) ? { reasoning_effort: 'low' } : {})),
        }, op.model ? 45000 : 22000);
        const d = await r.json().catch(() => ({}));
        if (r.ok) {
          const c = d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
          if (c && String(c).replace(/<think>[\s\S]*?<\/think>/gi, '').trim()) return String(c).replace(/<think>[\s\S]*?<\/think>/gi, '');
          ultimo = { status: 200, msg: 'respuesta vacía' }; continue;
        }
        ultimo = { status: r.status, msg: JSON.stringify(d).slice(0, 200) };
        console.error('ia:', modelo, r.status, ultimo.msg);
        if (r.status === 429 || r.status >= 500) { await new Promise((ok) => setTimeout(ok, 1200 * (intento + 1))); continue; }
        if (r.status === 400) {                                   // p. ej. json_validate_failed / tool_use_failed: reintenta
          if (/tool/i.test(ultimo.msg) && !messages.__nota) { messages = messages.concat([{ role: 'user', content: 'Recuerda: no llames herramientas ni funciones. Responde únicamente con el JSON pedido.' }]); messages.__nota = true; }
          continue;
        }
        break;                                                    // 401/402/404...: pasa al modelo de respaldo
      } catch (e) { ultimo = { status: 0, msg: e.message }; console.error('ia:', modelo, e.message); break; }   // timeout/red: pasa ya al siguiente modelo
    }
  }
  const err = new Error((ultimo && ultimo.msg) || 'sin respuesta'); err.status = (ultimo && ultimo.status) || 0; throw err;
}
// Los modelos pequeños a veces rompen el JSON (p. ej. {"say":"texto. action":{...}}). Se rescata el texto y la acción.
function vxReparar(c) {
  const t = String(c).replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  const m = /^\s*\{?\s*"?say"?\s*:\s*"/.exec(t);
  if (!m) return null;
  let cuerpo = t.slice(m[0].length), action = null, fin = cuerpo.length, ult = null;
  const re = /["\s,]*"?action"?\s*:\s*(?=null|\{)/g; let x;
  while ((x = re.exec(cuerpo))) ult = x;
  if (ult) {
    fin = ult.index;
    const resto = cuerpo.slice(ult.index + ult[0].length);
    if (!/^null/.test(resto)) { let d = 0, e = -1; for (let i = 0; i < resto.length; i++) { if (resto[i] === '{') d++; else if (resto[i] === '}') { d--; if (d === 0) { e = i; break; } } } if (e > 0) { try { action = JSON.parse(resto.slice(0, e + 1)); } catch {} } }
  }
  let say = cuerpo.slice(0, fin).replace(/["\s,}]+$/, '');
  say = say.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
  return say ? { say: say.slice(0, 4000), action } : null;
}
function vxParse(c) {
  let o = null;
  try { o = JSON.parse(c); } catch { const m = /\{[\s\S]*\}/.exec(c); if (m) { try { o = JSON.parse(m[0]); } catch {} } }
  if (!o || typeof o !== 'object') o = vxReparar(c);
  if (!o || typeof o !== 'object') o = { say: String(c).replace(/^```(?:json)?|```$/g, '').trim().slice(0, 3000), action: null };
  // Si el modelo puso el contenido largo en otro campo (story, content, texto...), lo une al mensaje
  const extra = Object.keys(o).filter((k) => k !== 'say' && k !== 'action' && typeof o[k] === 'string' && o[k].trim().length > 0).map((k) => o[k].trim());
  const otros = Object.keys(o).filter((k) => k !== 'say' && k !== 'action' && o[k] && typeof o[k] === 'object').map((k) => JSON.stringify(o[k]).length > 20 ? (Array.isArray(o[k]) ? o[k].map((x) => (typeof x === 'string' ? x : Object.values(x || {}).join('\n'))).join('\n\n') : Object.values(o[k]).join('\n')) : '');
  const resto = extra.concat(otros).filter(Boolean).join('\n\n');
  if (resto) o.say = (String(o.say || '') + '\n\n' + resto).trim();
  return o;
}
vxModelosInit();
app.__vxParse = vxParse;
app.get('/api/vertix/estado', async (req, res) => { noStore(res); await vxCargada; res.json(Object.assign({ activo: !!DEEPSEEK_KEY, modelos: VX_MODELOS.map((m) => ({ id: m.id, nombre: m.nombre, desc: m.mant ? 'En mantenimiento' : m.desc, mant: m.mant, bloqueado: m.mant && !isAdmin(req) })) }, vxCuotaInfo(req, res))); });


// Guía de verificación (respuesta fija, sin IA: más confiable y no gasta tokens).
function vxVerif(t, dc, ctx) {
  const nz = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const q = nz(t), enVerif = /verific|codigo de 5 palabras/.test(nz(ctx));      // ¿se venía hablando de verificar?

  const sinPaso = /\b(no quiero|no voy a|no pienso|no puedo|sin poner|sin el codigo|prefiero no|no deseo)\b.{0,50}\b(codigo|perfil|descripcion|poner|ponerlo|pegar)\b|\b(sin|evitar).{0,25}\b(codigo|perfil|descripcion)\b/.test(q);
  const datos = /\b(contrasena|password|clave|pin|correo|email|mail|cookie|datos)\b/.test(q);
  if (!/\bverific/.test(q) && !(enVerif && (sinPaso || datos))) return null;
  const NADA = 'No necesitamos tu contraseña, tu PIN, tu correo ni ningún otro dato de tu cuenta. Solo tu nombre de usuario de Roblox.';
  if (sinPaso) return { say: 'Entiendo, pero sin ese paso no se puede verificar tu cuenta. Poner el código en la descripción de tu perfil es la única forma de comprobar que la cuenta es tuya. ' + NADA + ' Si cambias de opinión, solo dime "quiero verificarme".', action: null };
  if (datos && !/\b(como|quiero|ayuda|ayudame|paso)\b/.test(q)) return { say: NADA + ' La verificación solo pide poner un código en la descripción de tu perfil de Roblox. Si quieres empezar, dime "quiero verificarme".', action: null };
  if (/\b(por que|porque|para que|que es|que significa|sirve|funciona|seguro|riesgo|explica|explicame|diferencia|cuanto|cuando|donde)\b/.test(q)) return null;   // preguntas de fondo las responde la IA
  if (!/\b(como|quiero|ayuda|ayudame|empezar|empiezo|iniciar|inicio|hacer|hago|paso|pasos|puedo|necesito|me verifico|verificarme|verificarse|verifico mi|verificar mi|verificar mi cuenta)\b/.test(q)) return null;
  const pasos = 'Para verificarte solo necesitas tu usuario de Roblox. ' + NADA + '\n1. Escribe tu usuario.\n2. Te doy un código de 5 palabras.\n3. Pégalo en la descripción de tu perfil de Roblox y guarda.\n4. Toca verificar. El código vale 15 minutos.';
  if (dc) return { say: pasos + '\nLa verificación se hace en la página: https://uzivert-web.onrender.com (sección Verificar).', action: null };
  return { say: pasos, action: { type: 'verify' } };
}

// Loaders que Vertix entrega (fijos, sin buscar nada). Se pueden cambiar con variables de entorno.
const VX_BASE = (env.PUBLIC_URL || 'https://uzivert-web.onrender.com').replace(/\/$/, '');
const VX_LOADERS = {
  hub: env.VX_LOADER_HUB || `loadstring(game:HttpGet("${VX_BASE}/Api/UzivertHub/Auth2"))()`,
  duelos: env.VX_LOADER_DUELOS || `loadstring(game:HttpGet("${VX_BASE}/Api/Duelos/auth2/UzivertHub"))()`,
  universal: env.VX_LOADER_UNIVERSAL || `loadstring(game:HttpGet("${VX_BASE}/Api/Universal/Auth2/UzivertHub"))()`,
};
const vxNorm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function vxScripts(t, dc, hist) {                                      // devuelve {say, action} si piden un script/loader, o null
  const q = vxNorm(t);
  const L = (x) => '`' + x + '`';                                  // siempre entre comillas invertidas (código en línea)
  const enCtx = /(los loaders|puedo darte|te doy|pideme (uno|por)|script de duelos|script universal)/.test(vxNorm(hist));   // venia hablando de loaders
  const pide = /\b(script|scripts|loader|loaders|loadstring|cargador)\b/.test(q) || (enCtx && q.length < 60);
  const duelos = /\b(duelos?|duels?)\b/.test(q), uni = /\buniversal\b/.test(q);
  const hub = /\b(uzivert hub|hub (grande|completo|principal|oficial)|oficial|(\d+|cuatro|cinco|seis) juegos|mm2|mmv|prison|distrito|latam)\b/.test(q) && !(duelos && !/\b(hub (grande|completo|principal|oficial)|oficial)\b/.test(q));
  const verbo = /\b(dame|dar|dan|da|pasa|pasame|pasar|mand[ae]|manda|quiero|necesito|tienes|tienen|donde|como consigo|como obtengo|link|enlace|cual|cuales|lista|todos)\b/.test(q);
  if (!pide || !(duelos || uni || hub || verbo)) return null;
  const pedidos = [];
  if (hub) pedidos.push(['Uzivert Hub (el hub grande)', VX_LOADERS.hub]);
  if (duelos) pedidos.push(['Duelos (Murderer vs Sheriffs)', VX_LOADERS.duelos]);
  if (uni) pedidos.push(['Universal', VX_LOADERS.universal]);
  if (!pedidos.length) pedidos.push(['Uzivert Hub (el hub grande)', VX_LOADERS.hub], ['Duelos (Murderer vs Sheriffs)', VX_LOADERS.duelos], ['Universal', VX_LOADERS.universal]);
  if (pedidos.length === 1) return { say: 'Aquí tienes el loader de ' + pedidos[0][0] + '. Cópialo y pégalo en tu ejecutor dentro del juego:\n' + L(pedidos[0][1]), action: null };
  return { say: 'Estos son los loaders. Cópialos y pégalos en tu ejecutor dentro del juego:\n' + pedidos.map(([n, l]) => n + ':\n' + L(l)).join('\n'), action: null };
}

// Modelos pequeños a veces prometen el código ("aquí tienes el script") y no lo escriben. Se detecta y se reintenta.
const vxPideCodigo = (t) => /\b(script|scripts|c[oó]digo|codigo|lua|luau|funci[oó]n|gui|programa|hazme|haz un|haz una|crea un|crea una|escribe|p[aá]salo|pasalo|mu[eé]stramelo|d[aá]melo|damelo)\b/i.test(String(t));
const vxSoloIntro = (say) => say && !/```/.test(say) && say.length < 420 && /(aqu[ií] tienes|aqu[ií] est[aá]|ejemplo|a continuaci[oó]n|el siguiente|este script|te dejo)/i.test(say);
const vertixHandler = async (req, res) => {
  noStore(res);
  if (!DEEPSEEK_KEY) return res.status(503).json({ error: 'Vertix no está disponible por ahora.' });
  await vxCargada;
  const espera = vertixEspera(req, res);
  if (espera > 0) { const tm = Math.ceil(espera / 60e3), h = Math.floor(tm / 60), m = tm % 60; return res.status(429).json({ error: `Se acabaron tus mensajes. Vuelve en ${h ? h + ' h ' : ''}${m} min.`, espera: Math.ceil(espera / 1000), restantes: 0 }); }
  const b = req.body || {};
  let texto = clean(b.mensaje, 400);
  const imagen = (typeof b.imagen === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(b.imagen) && b.imagen.length < 1_000_000) ? b.imagen : '';
  if (!texto && imagen) texto = 'Describe esta imagen y dime qué ves.';
  if (!texto) { vxDevolver(req); return res.status(400).json({ error: 'Escribe o di algo.' }); }
  if (!imagen) { const sc = vxScripts(texto, !!req._vxKeys, (Array.isArray(b.historial) ? b.historial.slice(-2) : []).map((m) => (m && m.content) || '').join(' ')) || vxVerif(texto, !!req._vxKeys, (Array.isArray(b.historial) ? b.historial.slice(-2) : []).map((m) => (m && m.content) || '').join(' ')); if (sc) { vxDevolver(req); const ci = vxCuotaInfo(req); return res.json({ say: sc.say, action: sc.action, buscado: false, restantes: ci.restantes, espera: ci.espera }); } }
  if (imagen && !env.VISION_MODEL) { vxDevolver(req); return res.status(200).json({ restantes: vxCuotaInfo(req).restantes, say: 'Todavía no puedo ver fotos: falta configurar un modelo con visión en el servidor.', action: null }); }
  let fotoGastada = false;
  if (imagen) {
    const w = vxFoto(req);
    if (w > 0) { vxDevolver(req); const tm = Math.ceil(w / 60e3); return res.status(200).json({ restantes: vxCuotaInfo(req).restantes, action: null, say: `Llegaste al límite de ${VX_FOTOS} fotos cada 2 horas. Podrás enviar otra en ${tm >= 60 ? Math.floor(tm / 60) + ' h ' + (tm % 60) + ' min' : tm + ' min'}.` }); }
    fotoGastada = true;
  }
  const hist = (Array.isArray(b.historial) ? b.historial : []).slice(-10)
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: clean(m.content, 1200) }));
  try {
    let sistema = vxPrompt();
    let res1 = [];
    const buscado = !imagen && vxNecesitaBusqueda(texto);
    if (buscado) {
      try { res1 = await vxBuscar(vxConsulta(texto)); } catch (e) { console.error('vertix-buscar:', (e && e.stack) || e); }
      const lista = res1.length ? res1.map((x, n) => `${n + 1}. ${x.title}: ${x.snippet}${x.url ? ' (' + x.url + ')' : ''}`).join('\n') : '(la búsqueda no devolvió resultados)';
      sistema += `\n\nINFORMACIÓN DE INTERNET para la pregunta del usuario:\n${lista}`;
    }
    const msgs = [{ role: 'system', content: sistema }, ...hist, { role: 'user', content: imagen ? [{ type: 'text', text: texto }, { type: 'image_url', image_url: { url: imagen } }] : texto }];
    const admin = isAdmin(req), disp = VX_MODELOS.filter((m) => admin || !m.mant);
    const elegido = disp.find((m) => m.id === b.modelo) || disp[0];
    const orden = elegido ? [elegido].concat(disp.filter((m) => m !== elegido)) : [];
    const opVision = imagen ? { model: env.VISION_MODEL, url: env.VISION_URL || DEEPSEEK_URL, key: env.VISION_KEY || DEEPSEEK_KEY } : { modelos: orden };
    let out;
    try {
      out = vxParse(await vxLLM(msgs, opVision));
      const ultimoU = [...hist].reverse().find((m) => m.role === 'user');
      if (!imagen && out && vxSoloIntro(String(out.say || '')) && (vxPideCodigo(texto) || (ultimoU && vxPideCodigo(ultimoU.content)))) {
        const nota = msgs.concat([{ role: 'assistant', content: JSON.stringify({ say: String(out.say), action: null }) }, { role: 'user', content: 'No escribiste el código. Escríbelo ahora COMPLETO dentro del campo "say", en un bloque con tres comillas invertidas, sin introducción larga.' }]);
        for (const cand of [orden[0]].concat(orden.slice(1, 3))) {
          if (!cand) continue;
          try { const o2 = vxParse(await vxLLM(nota, { modelos: [cand] })); if (/```/.test(String(o2.say || ''))) { out = o2; break; } } catch (e2) { console.error('vertix-reintento-codigo:', e2.message); }
        }
      }
    } catch (e) {
      if (!buscado || !res1.length) throw e;
      console.error('vertix-llm-con-busqueda:', e.status, e.message);
      const top = res1[0];
      out = { say: `Encontré esto: ${top.snippet || top.title}`, action: top.url && vxUrlOk(top.url) ? { type: 'open', url: top.url } : null };
    }
    const say = clean(out.say, 3000) || 'No te entendí, ¿puedes repetirlo?';
    let action = null;
    let a = out.action;
    if (a && a.type === 'play' && !vxQuierePlay(texto)) a = null;                                   // el modelo no puede inventar reproducciones
    if (a && a.type === 'open' && !buscado && !/\b(abre|abrir|ve a|ir a|ll[eé]vame|entra|link|enlace|p[aá]gina|youtube|google|tiktok|spotify|discord|roblox|web)\b/i.test(texto)) a = null;
    if (a && a.type === 'open') {
      const u = a.url ? vxUrlOk(a.url) : null;
      if (u) action = { type: 'open', url: u };
      else if (VX_SITIOS.includes(a.site)) action = { type: 'open', site: a.site, query: clean(a.query, 100) };
    } else if (a && a.type === 'go' && VX_PAGINAS.includes(a.page)) action = { type: 'go', page: a.page };
    let say2 = say;
    if ((a && a.type === 'play') || (!action && vxQuierePlay(texto))) {
      const q = clean((a && a.query) || vxConsulta(texto), 120);
      const v = await vxYoutube(q);
      if (v) { action = { type: 'play', videoId: v.id, title: v.title, url: 'https://www.youtube.com/watch?v=' + v.id }; if (!(a && a.type === 'play')) say2 = 'Reproduciendo ' + (v.title || q); }
      else { action = { type: 'open', site: 'youtube', query: q }; if (!(a && a.type === 'play')) say2 = 'No pude reproducirlo aquí, pero te dejo la búsqueda en YouTube.'; }
    }
    res.json({ say: say2, action, buscado, restantes: vxCuotaInfo(req).restantes, espera: vxCuotaInfo(req).espera });
  } catch (e) {
    console.error('vertix:', e.status, e.message);
    const msg = e.status === 429 ? 'Estoy recibiendo muchos pedidos. Intenta de nuevo en unos segundos.' : (e.status === 401 || e.status === 402 || e.status === 404) ? 'Vertix está en mantenimiento por ahora.' : 'Vertix no pudo responder ahora. Intenta de nuevo en un momento.';
    vxDevolver(req); if (fotoGastada) vxFotoDevolver(req);
    res.status(502).json({ error: msg, restantes: vxCuotaInfo(req).restantes });
  }
};
app.post('/api/vertix', needJson, vertixHandler);

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
// Ruta personalizada del loader (ej: api/duelos/auth/UzivertHub): se sirve en https://sitio/<ruta> ademas de /s/<slug>.
const ALIAS = /^[A-Za-z0-9_-]{1,40}(\/[A-Za-z0-9_-]{1,40}){1,4}$/;
const ALIAS_RESERVADO = /^(s|admin|api\/admin)(\/|$)/i;
let aliasMap = new Map();
const rebuildAlias = (l) => { aliasMap = new Map((l || []).filter((x) => x.alias).map((x) => [String(x.alias).toLowerCase(), x.slug])); };
const loaderUrl = (base, x) => base + '/' + (x.alias ? x.alias : 's/' + x.slug);
function checkAlias(raw, slug, list) {          // devuelve { alias } o { error }
  const a = String(raw == null ? '' : raw).trim().replace(/^\/+|\/+$/g, '');
  if (!a) return { alias: '' };
  if (!ALIAS.test(a) || ALIAS_RESERVADO.test(a)) return { error: 'Ruta inválida: usa 2 a 5 partes con letras, números, - o _ separadas por / (ej: api/duelos/auth/UzivertHub).' };
  if (list.some((x) => x.slug !== slug && x.alias && x.alias.toLowerCase() === a.toLowerCase())) return { error: 'Esa ruta ya la usa otro script.' };
  return { alias: a };
}
async function loadIndex() { if (!indexCache) { try { indexCache = JSON.parse((await store.read('scripts/index.json')) || '[]'); } catch { indexCache = []; } rebuildAlias(indexCache); } return indexCache; }
async function saveIndex(list) { await store.write('scripts/index.json', JSON.stringify(list, null, 2)); indexCache = list; rebuildAlias(list); }
app.use(async (req, res, next) => {                // /api/duelos/auth/UzivertHub  ->  /s/<slug>
  try {
    if (req.method !== 'GET' || req.path.length < 5 || req.path.startsWith('/s/') || req.path.startsWith('/api/admin')) return next();
    if (!indexCache) await loadIndex();
    const sl = aliasMap.get(req.path.replace(/^\/+|\/+$/g, '').toLowerCase());
    if (sl) { req.path = '/s/' + sl; req.url = req.path; }
  } catch {}
  next();
});

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
  if (!crypto.timingSafeEqual(given, real)) { audit(req, 'login fallido', ''); return res.status(401).json({ error: 'Clave incorrecta.' }); }
  audit(req, 'login', '');
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
  const ali = b.alias === undefined ? { alias: (previo && previo.alias) || '' } : checkAlias(b.alias, slug, await loadIndex());
  if (ali.error) return res.status(400).json({ error: ali.error });
  const meta = { slug, alias: ali.alias, logo, verificacion: b.verificacion === 'no' ? 'no' : 'si', situacion: ['ok', 'mant', 'caido'].includes(b.situacion) ? b.situacion : (previo && previo.situacion) || 'ok', cartel: ['grande', 'costado'].includes(b.cartel) ? b.cartel : (previo && previo.cartel) || 'grande', name: clean(b.name, 60) || slug, game: clean(b.game, 60), version: clean(b.version, 20), description: clean(b.description, 300), estado: ['oculto', 'enlace'].includes(b.estado) ? b.estado : 'activo', updatedAt: new Date().toISOString(), bytes: Buffer.byteLength(code) };
  let aviso = '';
  try {
    await store.write(`scripts/${slug}.lua`, code);
    logoCache.delete(slug);
    if (logo) { try { await guardarLogo(slug, logo); } catch (e) { console.warn('logo:', e.message); aviso = 'el logo no se pudo descargar y guardar (' + e.message + '). Link: ' + logo; } }
    else { try { await store.remove(`logos/${slug}.txt`); } catch {} }
    const list = (await loadIndex()).filter((s) => s.slug !== slug);
    list.push(meta); list.sort((a, c) => a.name.localeCompare(c.name));
    await saveIndex(list);
    cache.delete(slug); audit(req, 'script: guardar', slug);
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
    cache.delete(req.params.slug); audit(req, 'script: borrar', req.params.slug);
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
// Estado rapido de los scripts (solo el indice, sin leer codigo): lo usa el bot de Discord.
app.get('/api/estado-scripts', async (req, res) => {
  noStore(res);
  try { res.json({ scripts: (await loadIndex()).filter((x) => x.estado === 'activo').map((x) => ({ slug: x.slug, name: x.name, situacion: x.situacion || 'ok' })) }); }
  catch { res.status(500).json({ error: 'No se pudo leer' }); }
});
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
      return `loadstring(game:HttpGet("${loaderUrl(base, x)}"))()`;
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
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, async () => { await flushForo(); await vxGuardar(); await svGuardar(); await ejGuardar(); await audGuardar(); process.exit(0); });

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
// Protección del loader: solo lo recibe un ejecutor de Roblox. Un navegador o una herramienta (curl, python...) ve "No autorizado".
// Es una barrera por cabeceras: frena a casi todos, pero alguien que falsifique las cabeceras a mano podría saltarla.
const SEG_WEBHOOK = env.DISCORD_WEBHOOK_SEGURIDAD || WEBHOOK_SOPORTE;
const segBloq = new Map();                                         // ip -> hasta (bloqueo temporal)
setInterval(() => { const n = Date.now(); for (const [k, v] of segBloq) if (v < n) segBloq.delete(k); }, 60e3).unref();
function esNavegadorOHerramienta(req) {
  const h = req.headers, ua = String(h['user-agent'] || '');
  if (h['sec-fetch-mode'] || h['sec-fetch-dest'] || h['sec-fetch-site'] || h['sec-ch-ua'] || h['upgrade-insecure-requests'] || /text\/html/i.test(String(h.accept || ''))) return 'navegador';
  if (/\b(curl|wget|python|aiohttp|httpx|requests|postman|insomnia|httpie|axios|node-fetch|undici|go-http|libwww|scrapy|powershell|spider|crawl)/i.test(ua)) return 'herramienta';
  return '';
}
const PAGINA_NO = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>No autorizado</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#050507;color:#f2f3f6;font:16px system-ui,sans-serif;text-align:center}div{padding:24px}h1{font-size:22px;margin:0 0 8px}p{color:#9a9da6;margin:0}</style><div><h1>No estás autorizado</h1><p>Este enlace solo funciona dentro de Roblox con el loader oficial.</p></div>';
// Cartel de mantenimiento: es el mismo de LOADER_OFICIAL (copiado tal cual). Se ejecuta en el juego en lugar del script cuando esta "En mantenimiento".
const MANT_DISCORD = DISCORD_INVITE;
const MANT_LUA = "    -- ========================================================================\n    -- UI DE MANTENIMIENTO (todo dibujado con Frames, sin emojis)\n    -- ========================================================================\n    local TweenService = game:GetService(\"TweenService\")\n    local RunService = game:GetService(\"RunService\")\n    local Debris = game:GetService(\"Debris\")\n    local UserInputService = game:GetService(\"UserInputService\")\n\n    local function mk(class, props, parent)\n        local o = Instance.new(class)\n        for k, v in pairs(props) do\n            o[k] = v\n        end\n        o.Parent = parent\n        return o\n    end\n    local function tw(obj, info, goal)\n        local t = TweenService:Create(obj, info, goal)\n        t:Play()\n        return t\n    end\n    local function ti(t, style, dir)\n        return TweenInfo.new(t, style or Enum.EasingStyle.Quint, dir or Enum.EasingDirection.Out)\n    end\n    local function corner(p, r)\n        return mk(\"UICorner\", { CornerRadius = UDim.new(0, r) }, p)\n    end\n    local function setLine(f, x1, y1, x2, y2, th)\n        local dx, dy = x2 - x1, y2 - y1\n        f.Size = UDim2.fromOffset(math.sqrt(dx * dx + dy * dy), th)\n        f.Position = UDim2.fromOffset((x1 + x2) / 2, (y1 + y2) / 2)\n        f.Rotation = math.deg(math.atan2(dy, dx))\n    end\n    local function line(parent, color, z)\n        return mk(\"Frame\", {\n            AnchorPoint = Vector2.new(0.5, 0.5), BackgroundColor3 = color, BorderSizePixel = 0, ZIndex = z or 1,\n        }, parent)\n    end\n    local function dot(parent, size, color, z)\n        local f = mk(\"Frame\", {\n            AnchorPoint = Vector2.new(0.5, 0.5), Size = UDim2.fromOffset(size, size),\n            BackgroundColor3 = color, BorderSizePixel = 0, ZIndex = z or 1,\n        }, parent)\n        corner(f, 999)\n        return f\n    end\n    -- rectangulo con posicion/tamano en pixeles\n    local function box(parent, x, y, w, h, color, r, z)\n        local f = mk(\"Frame\", {\n            Position = UDim2.fromOffset(x, y), Size = UDim2.fromOffset(w, h),\n            BackgroundColor3 = color, BorderSizePixel = 0, ZIndex = z or 1,\n        }, parent)\n        if r and r > 0 then corner(f, r) end\n        return f\n    end\n\n    local INK = Color3.fromRGB(18, 20, 30)\n    local SUB = Color3.fromRGB(96, 102, 124)\n    local GRAPH = Color3.fromRGB(40, 44, 62)\n    local GRAPH2 = Color3.fromRGB(72, 78, 104)\n    local PAPER = Color3.fromRGB(244, 245, 250)\n    local SILVER = Color3.fromRGB(176, 186, 214)\n\n    local W, H = 440, 270\n    local ups = {}\n\n    -- ========== Ventana ==========\n    local ScreenGui = mk(\"ScreenGui\", {\n        Name = \"UzivertMantenimiento\",\n        ResetOnSpawn = false,\n        IgnoreGuiInset = true,\n        DisplayOrder = 9999,\n        ZIndexBehavior = Enum.ZIndexBehavior.Sibling,\n    }, game:GetService(\"CoreGui\"))\n\n    local Panel = mk(\"Frame\", {\n        AnchorPoint = Vector2.new(0.5, 0.5),\n        Position = UDim2.fromScale(0.5, 0.5),\n        Size = UDim2.fromOffset(W, H),\n        BackgroundTransparency = 1,\n    }, ScreenGui)\n\n    local cam = workspace.CurrentCamera\n    local vp = cam and cam.ViewportSize or Vector2.new(1280, 720)\n    local base = math.clamp(math.min(vp.X / (W + 30), vp.Y / (H + 30)), 0.55, 1.3)\n    local popScale = mk(\"UIScale\", { Scale = 0 }, Panel)\n    tw(popScale, TweenInfo.new(0.6, Enum.EasingStyle.Back, Enum.EasingDirection.Out), { Scale = base })\n\n    -- resplandor suave alrededor\n    local glowA = mk(\"Frame\", {\n        AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.5), Size = UDim2.new(1, 50, 1, 50),\n        BackgroundColor3 = Color3.new(1, 1, 1), BackgroundTransparency = 0.85, BorderSizePixel = 0, ZIndex = 1,\n    }, Panel)\n    corner(glowA, 36)\n    local glowB = mk(\"Frame\", {\n        AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.5), Size = UDim2.new(1, 18, 1, 18),\n        BackgroundColor3 = Color3.fromRGB(218, 225, 243), BackgroundTransparency = 0.6, BorderSizePixel = 0, ZIndex = 2,\n    }, Panel)\n    corner(glowB, 22)\n\n    local Surface = mk(\"CanvasGroup\", {\n        Size = UDim2.fromScale(1, 1), BackgroundColor3 = PAPER, BorderSizePixel = 0,\n        ZIndex = 5, GroupTransparency = 1,\n    }, Panel)\n    corner(Surface, 14)\n    tw(Surface, ti(0.45), { GroupTransparency = 0 })\n\n    -- borde con degradado que gira\n    local border = mk(\"Frame\", { Size = UDim2.fromScale(1, 1), BackgroundTransparency = 1, ZIndex = 50 }, Panel)\n    corner(border, 14)\n    local bStroke = mk(\"UIStroke\", {\n        Thickness = 1.8, Color = Color3.new(1, 1, 1), ApplyStrokeMode = Enum.ApplyStrokeMode.Border,\n    }, border)\n    local bGrad = mk(\"UIGradient\", {\n        Color = ColorSequence.new({\n            ColorSequenceKeypoint.new(0, GRAPH),\n            ColorSequenceKeypoint.new(0.3, SILVER),\n            ColorSequenceKeypoint.new(0.5, Color3.new(1, 1, 1)),\n            ColorSequenceKeypoint.new(0.75, GRAPH2),\n            ColorSequenceKeypoint.new(1, GRAPH),\n        }),\n    }, bStroke)\n\n    -- fondo con degradado + nebulosas pastel que flotan\n    local bg = mk(\"Frame\", { Size = UDim2.fromScale(1, 1), BackgroundColor3 = Color3.new(1, 1, 1), BorderSizePixel = 0, ZIndex = 1 }, Surface)\n    mk(\"UIGradient\", {\n        Color = ColorSequence.new({\n            ColorSequenceKeypoint.new(0, Color3.fromRGB(255, 255, 255)),\n            ColorSequenceKeypoint.new(0.7, Color3.fromRGB(240, 243, 250)),\n            ColorSequenceKeypoint.new(1, Color3.fromRGB(222, 228, 243)),\n        }),\n        Rotation = 35,\n    }, bg)\n    -- ===== galaxia / nebulosa giratoria (mismo sistema del selector de gama del hub) =====\n    local function buildGalaxy(parent, cx, cy, size, alphaK, z, spd)\n        local sc = size / 150\n        spd = spd or 1\n        local G_CORE, G_MID, G_RIM = Color3.fromRGB(40, 44, 68), Color3.fromRGB(95, 102, 135), Color3.fromRGB(150, 158, 190)\n        local function lerp3(a, b, k)\n            return Color3.new(a.R + (b.R - a.R) * k, a.G + (b.G - a.G) * k, a.B + (b.B - a.B) * k)\n        end\n        local function circ(p, sz, color, tr, zz)\n            local f = mk(\"Frame\", {\n                AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.5), Size = UDim2.fromOffset(sz, sz),\n                BackgroundColor3 = color, BackgroundTransparency = tr, BorderSizePixel = 0, ZIndex = zz,\n            }, p)\n            mk(\"UICorner\", { CornerRadius = UDim.new(1, 0) }, f)\n            return f\n        end\n        local function blob(p, sz, color, layers, alpha)\n            local h = mk(\"Frame\", {\n                AnchorPoint = Vector2.new(0.5, 0.5), Size = UDim2.fromOffset(sz * sc, sz * sc), BackgroundTransparency = 1, ZIndex = z,\n            }, p)\n            for k = 1, layers do\n                circ(h, sz * sc * (1 - (k - 1) / layers), color, 1 - alpha * alphaK, z)\n            end\n            return h\n        end\n        local function layer(zz)\n            return mk(\"Frame\", {\n                AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.5), Size = UDim2.fromScale(1, 1),\n                BackgroundTransparency = 1, ZIndex = zz,\n            }, nil)\n        end\n\n        local holder = mk(\"Frame\", {\n            AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromOffset(cx, cy), Size = UDim2.fromOffset(size, size),\n            BackgroundTransparency = 1, ZIndex = z,\n        }, parent)\n        local scale = mk(\"UIScale\", { Scale = 1 }, holder)\n        local function newLayer()\n            local l = layer(z)\n            l.Parent = holder\n            return l\n        end\n\n        -- aura (anillos suaves) + halo + cuadrados que giran\n        local auras = {}\n        for i, sz in ipairs({ 186, 150, 112 }) do\n            auras[i] = circ(holder, sz * sc, G_MID, 0.93 + i * 0.01, z)\n        end\n        local halo = circ(holder, 150 * sc, G_MID, 0.93, z)\n        mk(\"UIStroke\", { Thickness = 1.2, Color = G_RIM, Transparency = 0.55 }, halo)\n        local squares = {}\n        for i = 1, 2 do\n            local sq = mk(\"Frame\", {\n                AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.5),\n                Size = UDim2.fromOffset((i == 1 and 140 or 128) * sc, (i == 1 and 140 or 128) * sc), BackgroundTransparency = 1, ZIndex = z,\n            }, holder)\n            mk(\"UIStroke\", { Thickness = 1.2, Color = G_RIM, Transparency = (i == 1) and 0.45 or 0.65 }, sq)\n            squares[i] = sq\n        end\n\n        -- gas\n        local gasL = newLayer()\n        blob(gasL, 150, Color3.fromRGB(110, 118, 150), 8, 0.05).Position = UDim2.fromScale(0.5, 0.5)\n        blob(gasL, 96, Color3.fromRGB(130, 140, 170), 6, 0.06).Position = UDim2.new(0.5, 14 * sc, 0.5, -8 * sc)\n        blob(gasL, 90, Color3.fromRGB(130, 138, 170), 6, 0.06).Position = UDim2.new(0.5, -16 * sc, 0.5, 10 * sc)\n\n        -- brazos en espiral: lo interno gira mas rapido que lo externo\n        local inner, outer = newLayer(), newLayer()\n        for arm = 0, 2 do\n            for i = 1, 10 do\n                local k = (i - 1) / 9\n                local r = (7 + (i - 1) * 6.2) * sc\n                local jitter = (((i * 37 + arm * 11) % 7) - 3) * 0.05\n                local a = (i - 1) * 0.55 + arm * 2.094 + jitter\n                local col = (k < 0.5) and lerp3(G_CORE, G_MID, k * 2) or lerp3(G_MID, (arm == 1) and Color3.fromRGB(130, 138, 170) or G_RIM, (k - 0.5) * 2)\n                local b = blob((i <= 4) and inner or outer, 38 - i * 1.9, col, 3, 0.085)\n                b.Position = UDim2.new(0.5, math.cos(a) * r, 0.5, math.sin(a) * r)\n            end\n        end\n\n        -- polvo de estrellas (gira al reves)\n        local dust = newLayer()\n        local dstars = {}\n        for i = 1, 20 do\n            local a = math.random() * math.pi * 2\n            local r = (10 + math.random() * 62) * sc\n            local d = circ(dust, 1.5 + (i % 3), Color3.fromRGB(60, 66, 96), 0.7, z)\n            d.Position = UDim2.new(0.5, math.cos(a) * r, 0.5, math.sin(a) * r)\n            dstars[i] = { d, math.random() * 6.28, 1 + math.random() * 2.5 }\n        end\n\n        -- nucleo brillante\n        local coreGlow = blob(holder, 74, Color3.fromRGB(80, 88, 118), 7, 0.08)\n        coreGlow.Position = UDim2.fromScale(0.5, 0.5)\n        local coreHot = blob(holder, 32, Color3.fromRGB(40, 44, 62), 5, 0.14)\n        coreHot.Position = UDim2.fromScale(0.5, 0.5)\n        local coreScale = mk(\"UIScale\", { Scale = 1 }, coreHot)\n\n        -- orbitadores\n        local orb = {}\n        for i = 1, 8 do\n            orb[i] = {\n                circ(holder, 3 + (i % 3), (i % 3 == 0) and G_MID or G_RIM, 0.35, z),\n                (80 + (i % 3) * 7) * sc, ((i % 2 == 0) and 1 or -1) * (0.3 + i * 0.06), i * 0.8,\n            }\n        end\n\n        local ang = 0\n        return function(t, dt)\n            ang = ang + dt * spd\n            inner.Rotation = (ang * 42) % 360\n            outer.Rotation = (ang * 22) % 360\n            dust.Rotation = (-ang * 12) % 360\n            gasL.Rotation = (ang * 6) % 360\n            scale.Scale = 1 + 0.03 * math.sin(t * 1.4)\n            coreScale.Scale = 1 + 0.12 * math.sin(t * 2.3)\n            squares[1].Rotation = (t * 28) % 360\n            squares[2].Rotation = (-t * 18 + 20) % 360\n            for i, a in ipairs(auras) do a.BackgroundTransparency = 0.93 + i * 0.01 + 0.03 * math.sin(t * (1.2 + i * 0.4) + i) end\n            halo.BackgroundTransparency = 0.93 + 0.03 * math.sin(t * 1.6)\n            for _, s in ipairs(dstars) do s[1].BackgroundTransparency = 0.75 - 0.7 * (0.5 + 0.5 * math.sin(t * s[3] + s[2])) end\n            for _, o in ipairs(orb) do\n                local a = t * o[3] + o[4]\n                o[1].Position = UDim2.new(0.5, math.cos(a) * o[2], 0.5, math.sin(a) * o[2])\n            end\n        end\n    end\n\n    -- estrella fugaz de vez en cuando\n    local function startComets(parent, w, h, gap, panel)\n        task.spawn(function()\n            task.wait(1.5 + math.random() * 2)\n            while panel.Parent do\n                local len = 70\n                local c = mk(\"Frame\", {\n                    AnchorPoint = Vector2.new(1, 0.5), Position = UDim2.fromOffset(w * (0.5 + math.random() * 0.5), math.random() * h * 0.4),\n                    Size = UDim2.fromOffset(len, 2), BackgroundColor3 = Color3.fromRGB(70, 78, 112), BorderSizePixel = 0, Rotation = 28, ZIndex = 4,\n                }, parent)\n                mk(\"UICorner\", { CornerRadius = UDim.new(1, 0) }, c)\n                mk(\"UIGradient\", { Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 1), NumberSequenceKeypoint.new(1, 0.1) }) }, c)\n                local p = c.Position\n                tw(c, TweenInfo.new(0.9, Enum.EasingStyle.Quad, Enum.EasingDirection.In), {\n                    Position = UDim2.fromOffset(p.X.Offset + 130, p.Y.Offset + 70), BackgroundTransparency = 1,\n                })\n                game:GetService(\"Debris\"):AddItem(c, 1)\n                task.wait(gap + math.random() * gap)\n            end\n        end)\n    end\n\n    do\n        local gUps = {\n            buildGalaxy(Surface, 322, 112, 230, 0.5, 2, 1),\n            buildGalaxy(Surface, 410, 244, 110, 0.5, 2, -1.3),\n        }\n        ups[#ups + 1] = function(t, dt)\n            for _, fn in ipairs(gUps) do fn(t, dt) end\n        end\n        startComets(Surface, W, H, 6, Panel)\n    end\n\n    -- ========================================================================\n    -- ESCENA: nino sentado jugando con su perro (todo con Frames)\n    -- ========================================================================\n    local SW, SH = 170, 184\n    local Scene = mk(\"CanvasGroup\", {\n        Position = UDim2.fromOffset(16, 16), Size = UDim2.fromOffset(SW, SH),\n        BackgroundColor3 = Color3.fromRGB(226, 231, 246), BorderSizePixel = 0, ZIndex = 6,\n    }, Surface)\n    corner(Scene, 12)\n    mk(\"UIStroke\", { Thickness = 1, Color = Color3.fromRGB(200, 207, 226), Transparency = 0.2 }, Scene)\n    mk(\"UIGradient\", {\n        Color = ColorSequence.new({\n            ColorSequenceKeypoint.new(0, Color3.fromRGB(236, 239, 250)),\n            ColorSequenceKeypoint.new(1, Color3.fromRGB(214, 221, 242)),\n        }),\n        Rotation = 90,\n    }, Scene)\n\n    local FLOOR = 128\n    -- piso de madera\n    box(Scene, 0, FLOOR, SW, SH - FLOOR, Color3.fromRGB(205, 192, 178), 0, 7)\n    box(Scene, 0, FLOOR, SW, 2, Color3.fromRGB(184, 170, 156), 0, 8)\n    for i = 1, 3 do box(Scene, 0, FLOOR + i * 17, SW, 1, Color3.fromRGB(190, 177, 163), 0, 8) end\n    -- alfombra\n    local rug = box(Scene, 4, FLOOR + 6, 118, 36, Color3.fromRGB(250, 246, 240), 18, 8)\n    mk(\"UIStroke\", { Thickness = 2, Color = Color3.fromRGB(150, 168, 214), Transparency = 0.1 }, rug)\n\n    -- ventana con luna y estrellas\n    box(Scene, 12, 12, 46, 46, Color3.new(1, 1, 1), 5, 7)\n    local sky = box(Scene, 16, 16, 38, 38, Color3.fromRGB(104, 116, 170), 3, 8)\n    sky.ClipsDescendants = true\n    local moon = dot(sky, 14, Color3.fromRGB(255, 244, 205), 9)\n    moon.Position = UDim2.fromOffset(26, 12)\n    local moonCut = dot(sky, 12, Color3.fromRGB(104, 116, 170), 10)\n    moonCut.Position = UDim2.fromOffset(30, 10)\n    local stars = {}\n    for i, p in ipairs({ { 8, 10 }, { 14, 26 }, { 28, 30 }, { 9, 33 }, { 32, 22 } }) do\n        local s = dot(sky, 2, Color3.new(1, 1, 1), 9)\n        s.Position = UDim2.fromOffset(p[1], p[2])\n        stars[i] = { s, i * 1.7, 1.5 + i * 0.4 }\n    end\n    box(Scene, 34, 15, 2, 40, Color3.new(1, 1, 1), 0, 10)\n    box(Scene, 15, 34, 40, 2, Color3.new(1, 1, 1), 0, 10)\n\n    -- mesita + tele\n    box(Scene, 108, 104, 56, 5, Color3.fromRGB(150, 118, 92), 2, 9)\n    box(Scene, 112, 109, 4, FLOOR - 109, Color3.fromRGB(130, 100, 78), 1, 8)\n    box(Scene, 156, 109, 4, FLOOR - 109, Color3.fromRGB(130, 100, 78), 1, 8)\n    box(Scene, 128, 100, 16, 4, Color3.fromRGB(60, 64, 84), 1, 9)\n    box(Scene, 112, 62, 48, 38, Color3.fromRGB(46, 50, 70), 5, 9)\n    local screen = box(Scene, 116, 66, 40, 30, Color3.fromRGB(120, 200, 255), 3, 10)\n    screen.ClipsDescendants = true\n    local hero = box(screen, 4, 18, 6, 6, Color3.new(1, 1, 1), 1, 11)\n    local heroEye = box(hero, 3, 1, 1, 2, Color3.fromRGB(30, 34, 50), 0, 12)\n    local coin = dot(screen, 5, Color3.fromRGB(255, 220, 90), 11)\n    local spike = box(screen, 30, 22, 6, 6, Color3.fromRGB(240, 90, 100), 1, 11)\n    spike.Rotation = 45\n    box(screen, 0, 24, 40, 6, Color3.fromRGB(60, 160, 100), 0, 10)\n    local tvGlow = dot(Scene, 120, Color3.fromRGB(150, 210, 255), 7)\n    tvGlow.Position = UDim2.fromOffset(100, 110)\n    tvGlow.BackgroundTransparency = 0.88\n\n    -- ---------- nino ----------\n    local kid = mk(\"Frame\", { Size = UDim2.fromOffset(SW, SH), BackgroundTransparency = 1, ZIndex = 12 }, Scene)\n    box(kid, 50, 124, 52, 5, Color3.fromRGB(0, 0, 0), 3, 11).BackgroundTransparency = 0.88      -- sombra\n    box(kid, 54, 112, 44, 14, Color3.fromRGB(72, 92, 156), 6, 13)                                -- piernas\n    box(kid, 92, 108, 14, 18, Color3.fromRGB(246, 246, 250), 6, 14)                              -- zapatilla\n    box(kid, 94, 120, 12, 3, Color3.fromRGB(120, 130, 170), 1, 15)\n    local torso = box(kid, 44, 70, 26, 46, Color3.fromRGB(232, 118, 100), 9, 14)                 -- remera\n    box(kid, 44, 100, 26, 4, Color3.fromRGB(255, 255, 255), 0, 15).BackgroundTransparency = 0.5\n    local head = mk(\"Frame\", { Position = UDim2.fromOffset(46, 36), Size = UDim2.fromOffset(30, 34), BackgroundTransparency = 1, ZIndex = 16 }, kid)\n    box(head, 4, 4, 24, 26, Color3.fromRGB(255, 214, 185), 11, 16)                               -- cara\n    box(head, 0, 0, 28, 14, Color3.fromRGB(86, 62, 50), 7, 18)                                   -- pelo arriba\n    box(head, 0, 4, 9, 22, Color3.fromRGB(86, 62, 50), 4, 17)                                    -- pelo nuca\n    box(head, 22, 4, 6, 6, Color3.fromRGB(86, 62, 50), 3, 18)                                    -- flequillo\n    local kidEye = box(head, 20, 16, 3, 5, Color3.fromRGB(30, 34, 50), 1, 19)\n    box(head, 18, 22, 5, 3, Color3.fromRGB(255, 150, 150), 1, 18).BackgroundTransparency = 0.45 -- cachete\n    box(head, 22, 25, 5, 2, Color3.fromRGB(190, 110, 100), 1, 19)                                -- boca\n    -- auriculares\n    local hp = box(head, 2, 2, 26, 12, Color3.fromRGB(40, 44, 62), 6, 17)\n    hp.BackgroundTransparency = 1\n    mk(\"UIStroke\", { Thickness = 2, Color = Color3.fromRGB(40, 44, 62) }, hp)\n    box(head, 0, 14, 7, 10, Color3.fromRGB(40, 44, 62), 3, 19)\n    -- brazo + control\n    local arm = line(kid, Color3.fromRGB(232, 118, 100), 17)\n    local hand = dot(kid, 8, Color3.fromRGB(255, 214, 185), 18)\n    local pad = box(kid, 80, 86, 20, 10, Color3.fromRGB(46, 50, 70), 4, 17)\n    local padBtn = dot(pad, 3, Color3.fromRGB(255, 120, 130), 18)\n    padBtn.Position = UDim2.fromOffset(15, 4)\n    local padBtn2 = dot(pad, 3, Color3.fromRGB(120, 220, 160), 18)\n    padBtn2.Position = UDim2.fromOffset(12, 7)\n    box(pad, 3, 3, 6, 2, Color3.fromRGB(150, 160, 190), 1, 18)\n    box(pad, 5, 1, 2, 6, Color3.fromRGB(150, 160, 190), 1, 18)\n\n    -- ---------- perro ----------\n    local dog = mk(\"Frame\", { Position = UDim2.fromOffset(-5, 0), Size = UDim2.fromOffset(SW, SH), BackgroundTransparency = 1, ZIndex = 13 }, Scene)\n    local FUR, FUR2, CREAM = Color3.fromRGB(226, 172, 96), Color3.fromRGB(176, 122, 62), Color3.fromRGB(250, 232, 200)\n    box(dog, 6, 124, 36, 5, Color3.fromRGB(0, 0, 0), 3, 11).BackgroundTransparency = 0.88\n    local tail = line(dog, FUR, 13)\n    corner(tail, 3)\n    local dBody = box(dog, 12, 92, 26, 36, FUR, 11, 14)\n    box(dog, 8, 108, 20, 19, FUR2, 9, 15)                                                          -- anca\n    box(dog, 30, 96, 8, 31, CREAM, 4, 15)                                                          -- pata delantera\n    box(dog, 30, 123, 11, 5, CREAM, 2, 16)\n    box(dog, 22, 112, 10, 15, CREAM, 5, 14)                                                        -- pecho\n    local dHead = mk(\"Frame\", { Position = UDim2.fromOffset(18, 70), Size = UDim2.fromOffset(40, 32), BackgroundTransparency = 1, ZIndex = 17 }, dog)\n    box(dHead, 2, 2, 26, 24, FUR, 10, 17)                                                          -- cabeza\n    box(dHead, 20, 12, 18, 12, CREAM, 6, 18)                                                       -- hocico\n    box(dHead, 32, 11, 6, 5, Color3.fromRGB(40, 36, 44), 3, 19)                                    -- nariz\n    local dEye = box(dHead, 20, 8, 4, 5, Color3.fromRGB(34, 28, 30), 2, 19)\n    box(dHead, 21, 8, 1.5, 1.5, Color3.new(1, 1, 1), 1, 20)\n    local dEar = box(dHead, 2, 0, 11, 20, FUR2, 5, 18)\n    dEar.Rotation = 12\n    local tongue = box(dHead, 27, 22, 5, 7, Color3.fromRGB(240, 120, 140), 2, 17)\n    box(dHead, 8, 24, 18, 4, Color3.fromRGB(90, 130, 220), 2, 18)                                  -- collar\n    dot(dHead, 4, Color3.fromRGB(255, 214, 100), 19).Position = UDim2.fromOffset(18, 30)\n    -- globito \"guau\"\n    local bubble = box(Scene, 4, 55, 40, 16, Color3.new(1, 1, 1), 8, 20)\n    bubble.BackgroundTransparency = 1\n    local bubbleStroke = mk(\"UIStroke\", { Thickness = 1.2, Color = GRAPH2, Transparency = 1 }, bubble)\n    local bubbleTxt = mk(\"TextLabel\", {\n        Size = UDim2.fromScale(1, 1), BackgroundTransparency = 1, Text = \"guau!\", Font = Enum.Font.GothamBold,\n        TextSize = 10, TextColor3 = INK, TextTransparency = 1, ZIndex = 21,\n    }, bubble)\n    task.spawn(function()\n        task.wait(2.5)\n        while Panel.Parent do\n            tw(bubble, ti(0.25), { BackgroundTransparency = 0.05 })\n            tw(bubbleStroke, ti(0.25), { Transparency = 0.2 })\n            tw(bubbleTxt, ti(0.25), { TextTransparency = 0 })\n            task.wait(1.4)\n            tw(bubble, ti(0.3), { BackgroundTransparency = 1 })\n            tw(bubbleStroke, ti(0.3), { Transparency = 1 })\n            tw(bubbleTxt, ti(0.3), { TextTransparency = 1 })\n            task.wait(5.5)\n        end\n    end)\n\n    -- particulas suaves en la escena\n    local motes = {}\n    for i = 1, 6 do\n        local m = dot(Scene, 3, Color3.new(1, 1, 1), 8)\n        m.BackgroundTransparency = 0.5\n        motes[i] = { m, math.random() * 6.28, 0.08 + math.random() * 0.08, math.random(10, 160) }\n    end\n\n    ups[#ups + 1] = function(t)\n        -- ventana\n        for _, s in ipairs(stars) do s[1].BackgroundTransparency = 0.1 + 0.75 * (0.5 + 0.5 * math.sin(t * s[3] + s[2])) end\n        -- tele: color de pantalla + juego\n        local hue = (t * 0.06) % 1\n        screen.BackgroundColor3 = Color3.fromHSV(0.55 + 0.05 * math.sin(t * 0.5), 0.45, 1)\n        tvGlow.BackgroundTransparency = 0.86 + 0.04 * math.sin(t * 3)\n        local hx = 4 + ((t * 14) % 36)\n        local hy = 18 - math.max(0, math.sin(t * 5.2)) * 11\n        hero.Position = UDim2.fromOffset(hx, hy)\n        spike.Position = UDim2.fromOffset(30 - ((t * 14) % 36) + 36 - 36, 22)\n        coin.Position = UDim2.fromOffset(20 + math.sin(t * 2) * 12, 8 + math.sin(t * 6) * 1.5)\n        -- nino: respira, cabecea, mueve el pulgar\n        local breath = math.sin(t * 1.6)\n        torso.Size = UDim2.fromOffset(26, 46 + breath)\n        kid.Position = UDim2.fromOffset(0, math.sin(t * 5) * 0.4 + (math.sin(t * 0.9) > 0.92 and -2 or 0))\n        head.Position = UDim2.fromOffset(46, 36 + math.sin(t * 1.6 + 0.4) * 0.8)\n        head.Rotation = math.sin(t * 0.7) * 2 + (math.sin(t * 5.2) > 0.7 and 3 or 0)\n        local blink = (t % 3.6) < 0.12\n        kidEye.Size = UDim2.fromOffset(3, blink and 1 or 5)\n        kidEye.Position = UDim2.fromOffset(20, blink and 18 or 16)\n        local jig = math.sin(t * 11) * 1.2\n        local hxp, hyp = 84 + jig * 0.4, 91 + jig\n        setLine(arm, 62, 82, hxp, hyp, 8)\n        hand.Position = UDim2.fromOffset(hxp + 2, hyp)\n        pad.Position = UDim2.fromOffset(80 + jig * 0.3, 86 + jig * 0.6)\n        padBtn.BackgroundTransparency = (math.sin(t * 9) > 0.3) and 0 or 0.5\n        padBtn2.BackgroundTransparency = (math.sin(t * 7 + 1) > 0.3) and 0 or 0.5\n        -- perro: cola, jadeo, orejas, mirada\n        local wag = math.sin(t * 10) * 0.55\n        local a = -0.75 + wag\n        setLine(tail, 12, 118, 12 - math.cos(a) * 20, 118 + math.sin(a) * 20, 6)\n        dHead.Rotation = math.sin(t * 0.9) * 3 + (math.sin(t * 5.2) > 0.7 and 2 or 0)\n        dHead.Position = UDim2.fromOffset(18, 70 + math.sin(t * 1.9) * 0.8)\n        dEar.Rotation = 12 + math.sin(t * 2.4) * 5\n        tongue.Size = UDim2.fromOffset(5, 6 + math.sin(t * 8) * 1.5)\n        local dblink = ((t + 1.3) % 4.2) < 0.12\n        dEye.Size = UDim2.fromOffset(4, dblink and 1 or 5)\n        dEye.Position = UDim2.fromOffset(20, dblink and 10 or 8)\n        dBody.Size = UDim2.fromOffset(26, 36 + math.sin(t * 2.1) * 0.8)\n        -- particulas\n        for _, m in ipairs(motes) do\n            local k = (t * m[3] + m[2]) % 1\n            m[1].Position = UDim2.fromOffset(m[4] + math.sin(t + m[2]) * 6, 124 - k * 112)\n            m[1].BackgroundTransparency = 0.45 + k * 0.55\n        end\n    end\n\n    -- ========== Texto (columna derecha) ==========\n    local TX, TW_ = 202, 222\n\n    local Titulo = mk(\"TextLabel\", {\n        Size = UDim2.new(0, TW_, 0, 44), Position = UDim2.fromOffset(TX, 28),\n        BackgroundTransparency = 1, Text = \"UZIVERT HUB\", Font = Enum.Font.Creepster, TextSize = 38,\n        TextColor3 = Color3.new(1, 1, 1), TextTransparency = 1, TextXAlignment = Enum.TextXAlignment.Left, ZIndex = 10,\n    }, Surface)\n    local titleGrad = mk(\"UIGradient\", {\n        Color = ColorSequence.new({\n            ColorSequenceKeypoint.new(0, GRAPH),\n            ColorSequenceKeypoint.new(0.5, Color3.fromRGB(120, 130, 170)),\n            ColorSequenceKeypoint.new(1, GRAPH),\n        }),\n        Offset = Vector2.new(-1, 0),\n    }, Titulo)\n    tw(titleGrad, TweenInfo.new(2.6, Enum.EasingStyle.Linear, Enum.EasingDirection.Out, -1), { Offset = Vector2.new(1, 0) })\n\n    -- etiqueta \"EN MANTENIMIENTO\" con engranaje giratorio\n    local pill = mk(\"Frame\", {\n        Position = UDim2.fromOffset(TX, 76), Size = UDim2.fromOffset(176, 22), BackgroundColor3 = Color3.fromRGB(255, 255, 255),\n        BackgroundTransparency = 1, BorderSizePixel = 0, ZIndex = 10,\n    }, Surface)\n    corner(pill, 11)\n    local pillStroke = mk(\"UIStroke\", { Color = GRAPH2, Thickness = 1.2, Transparency = 1 }, pill)\n    local gear = mk(\"Frame\", {\n        AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromOffset(15, 11), Size = UDim2.fromOffset(14, 14),\n        BackgroundTransparency = 1, ZIndex = 11,\n    }, pill)\n    local gearRing = mk(\"Frame\", {\n        AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.5), Size = UDim2.fromOffset(8, 8),\n        BackgroundTransparency = 1, ZIndex = 11,\n    }, gear)\n    corner(gearRing, 4)\n    mk(\"UIStroke\", { Thickness = 1.8, Color = GRAPH }, gearRing)\n    for i = 0, 3 do\n        local tooth = mk(\"Frame\", {\n            AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.5), Size = UDim2.fromOffset(2.4, 14),\n            BackgroundColor3 = GRAPH, BorderSizePixel = 0, Rotation = i * 45, ZIndex = 11,\n        }, gear)\n        corner(tooth, 1)\n    end\n    local pillLbl = mk(\"TextLabel\", {\n        Position = UDim2.fromOffset(30, 0), Size = UDim2.new(1, -38, 1, 0), BackgroundTransparency = 1,\n        Text = \"EN MANTENIMIENTO\", Font = Enum.Font.GothamBold, TextSize = 10, TextColor3 = GRAPH,\n        TextTransparency = 1, TextXAlignment = Enum.TextXAlignment.Left, ZIndex = 11,\n    }, pill)\n\n    local Mensaje = mk(\"TextLabel\", {\n        Size = UDim2.new(0, TW_, 0, 56), Position = UDim2.fromOffset(TX, 106),\n        BackgroundTransparency = 1,\n        Text = \"Estamos reparando bugs y puliendo cada detalle del hub.\\nVolvé en unos minutos.\",\n        TextColor3 = SUB, Font = Enum.Font.GothamMedium, TextSize = 12, TextWrapped = true, TextTransparency = 1,\n        TextXAlignment = Enum.TextXAlignment.Left, TextYAlignment = Enum.TextYAlignment.Top, ZIndex = 10,\n    }, Surface)\n\n    -- linea de estado con efecto maquina de escribir\n    local statusLbl = mk(\"TextLabel\", {\n        Size = UDim2.new(0, TW_, 0, 16), Position = UDim2.fromOffset(TX, 164), BackgroundTransparency = 1, Text = \"\",\n        Font = Enum.Font.GothamMedium, TextSize = 11, TextColor3 = GRAPH2, TextXAlignment = Enum.TextXAlignment.Left,\n        TextTransparency = 1, ZIndex = 10,\n    }, Surface)\n    task.spawn(function()\n        task.wait(1.4)\n        local msgs = {\n            \"Afinando los detalles...\", \"Puliendo las animaciones...\", \"Revisando cada funcion...\",\n            \"Probando que todo ande bien...\", \"Ya casi terminamos...\",\n        }\n        local i = 1\n        tw(statusLbl, ti(0.3), { TextTransparency = 0 })\n        while Panel.Parent do\n            statusLbl.Text = msgs[i]\n            local n = utf8.len(msgs[i]) or #msgs[i]\n            for g = 0, n do\n                statusLbl.MaxVisibleGraphemes = g\n                task.wait(0.04)\n            end\n            task.wait(1.6)\n            i = i % #msgs + 1\n        end\n    end)\n\n    -- barra de progreso indeterminada\n    local barBack = mk(\"Frame\", {\n        Position = UDim2.fromOffset(TX, 188), Size = UDim2.fromOffset(TW_, 5), BackgroundColor3 = Color3.fromRGB(214, 219, 234),\n        BackgroundTransparency = 1, BorderSizePixel = 0, ClipsDescendants = true, ZIndex = 10,\n    }, Surface)\n    corner(barBack, 3)\n    local barFill = mk(\"Frame\", {\n        Position = UDim2.fromScale(-0.35, 0), Size = UDim2.fromScale(0.35, 1), BackgroundColor3 = GRAPH, BorderSizePixel = 0, ZIndex = 11,\n    }, barBack)\n    corner(barFill, 3)\n    mk(\"UIGradient\", {\n        Color = ColorSequence.new({ ColorSequenceKeypoint.new(0, GRAPH2), ColorSequenceKeypoint.new(1, SILVER) }),\n    }, barFill)\n    tw(barFill, TweenInfo.new(1.3, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut, -1), { Position = UDim2.fromScale(1, 0) })\n\n    -- ========== Boton de Discord ==========\n    local DiscordBtn = mk(\"TextButton\", {\n        Size = UDim2.new(1, -32, 0, 42),\n        Position = UDim2.new(0, 16, 1, -14),\n        AnchorPoint = Vector2.new(0, 1),\n        BackgroundColor3 = Color3.new(1, 1, 1),\n        Text = \"\",\n        BorderSizePixel = 0,\n        AutoButtonColor = false,\n        ClipsDescendants = true,\n        ZIndex = 20,\n    }, Surface)\n    corner(DiscordBtn, 10)\n    mk(\"UIGradient\", {\n        Rotation = 0, Color = ColorSequence.new(Color3.fromRGB(104, 116, 255), Color3.fromRGB(72, 84, 222)),\n    }, DiscordBtn)\n    local btnStroke = mk(\"UIStroke\", { Thickness = 1.5, Color = Color3.fromRGB(170, 178, 255), Transparency = 0.5 }, DiscordBtn)\n    local btnScale = mk(\"UIScale\", { Scale = 1 }, DiscordBtn)\n\n    local eyeCol = Color3.fromRGB(84, 96, 232)\n    local logo = mk(\"Frame\", {\n        AnchorPoint = Vector2.new(0, 0.5), Position = UDim2.new(0, 16, 0.5, 0), Size = UDim2.fromOffset(28, 28),\n        BackgroundTransparency = 1, ZIndex = 22,\n    }, DiscordBtn)\n    local function white(x, y, w, h, r, rot)\n        local f = mk(\"Frame\", {\n            Position = UDim2.fromOffset(x, y), Size = UDim2.fromOffset(w, h), BackgroundColor3 = Color3.new(1, 1, 1),\n            BorderSizePixel = 0, Rotation = rot or 0, ZIndex = 22,\n        }, logo)\n        corner(f, r)\n        return f\n    end\n    local function cut(x, y, w, h, r)\n        local f = mk(\"Frame\", {\n            Position = UDim2.fromOffset(x, y), Size = UDim2.fromOffset(w, h), BackgroundColor3 = eyeCol,\n            BorderSizePixel = 0, ZIndex = 23,\n        }, logo)\n        corner(f, r)\n        return f\n    end\n    white(2, 6, 24, 17, 8)\n    white(3, 3, 9, 8, 3, -18)\n    white(16, 3, 9, 8, 3, 18)\n    white(5, 19, 6, 7, 3, 22)\n    white(17, 19, 6, 7, 3, -22)\n    local eyeL, eyeR = cut(7, 11, 5, 7, 3), cut(16, 11, 5, 7, 3)\n    cut(9, 20, 10, 2, 1)\n\n    local check = mk(\"Frame\", {\n        AnchorPoint = Vector2.new(0, 0.5), Position = UDim2.new(0, 16, 0.5, 0), Size = UDim2.fromOffset(28, 28),\n        BackgroundTransparency = 1, Visible = false, ZIndex = 22,\n    }, DiscordBtn)\n    setLine(line(check, Color3.new(1, 1, 1), 22), 6, 15, 12, 21, 3)\n    setLine(line(check, Color3.new(1, 1, 1), 22), 12, 21, 23, 8, 3)\n\n    local btnLabel = mk(\"TextLabel\", {\n        Position = UDim2.fromOffset(54, 0), Size = UDim2.new(1, -100, 1, 0), BackgroundTransparency = 1,\n        Text = \"Unirse al Discord\", TextColor3 = Color3.new(1, 1, 1), Font = Enum.Font.GothamBold, TextSize = 14,\n        TextXAlignment = Enum.TextXAlignment.Left, TextTruncate = Enum.TextTruncate.AtEnd, ZIndex = 22,\n    }, DiscordBtn)\n\n    local arrow = mk(\"Frame\", {\n        AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.new(1, -24, 0.5, 0), Size = UDim2.fromOffset(12, 12),\n        BackgroundTransparency = 1, ZIndex = 22,\n    }, DiscordBtn)\n    setLine(line(arrow, Color3.new(1, 1, 1), 22), 3, 1, 9, 6, 2)\n    setLine(line(arrow, Color3.new(1, 1, 1), 22), 9, 6, 3, 11, 2)\n\n    local shine = mk(\"Frame\", {\n        AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.new(0, -40, 0.5, 0), Size = UDim2.fromOffset(30, 120),\n        BackgroundColor3 = Color3.new(1, 1, 1), BackgroundTransparency = 0.82, BorderSizePixel = 0, Rotation = 20, ZIndex = 21,\n    }, DiscordBtn)\n    local function pasarBrillo()\n        shine.Position = UDim2.new(0, -40, 0.5, 0)\n        tw(shine, TweenInfo.new(0.7, Enum.EasingStyle.Quad), { Position = UDim2.new(1, 40, 0.5, 0) })\n    end\n    task.spawn(function()\n        task.wait(2)\n        while Panel.Parent do\n            pasarBrillo()\n            task.wait(3.5)\n        end\n    end)\n\n    ups[#ups + 1] = function(t)\n        local blink = (t % 3.4) < 0.12\n        local h = blink and 1 or 7\n        eyeL.Size = UDim2.fromOffset(5, h)\n        eyeR.Size = UDim2.fromOffset(5, h)\n        eyeL.Position = UDim2.fromOffset(7, blink and 14 or 11)\n        eyeR.Position = UDim2.fromOffset(16, blink and 14 or 11)\n        arrow.Position = UDim2.new(1, -24 + math.sin(t * 4) * 2, 0.5, 0)\n    end\n\n    DiscordBtn.MouseEnter:Connect(function()\n        tw(btnStroke, ti(0.15), { Transparency = 0 })\n        tw(btnScale, TweenInfo.new(0.15, Enum.EasingStyle.Back), { Scale = 1.02 })\n        pasarBrillo()\n    end)\n    DiscordBtn.MouseLeave:Connect(function()\n        tw(btnStroke, ti(0.15), { Transparency = 0.5 })\n        tw(btnScale, ti(0.15), { Scale = 1 })\n    end)\n\n    DiscordBtn.MouseButton1Click:Connect(function()\n        tw(btnScale, ti(0.07), { Scale = 0.97 })\n        local r = dot(DiscordBtn, 10, Color3.new(1, 1, 1), 21)\n        r.Position = UDim2.fromScale(0.5, 0.5)\n        r.BackgroundTransparency = 0.6\n        tw(r, ti(0.5), { Size = UDim2.fromOffset(420, 420), BackgroundTransparency = 1 })\n        Debris:AddItem(r, 0.6)\n        tw(btnScale, TweenInfo.new(0.2, Enum.EasingStyle.Back), { Scale = 1 })\n        if setclipboard then\n            setclipboard(DISCORD_URL)\n            btnLabel.Text = \"¡Link copiado!\"\n            logo.Visible = false\n            check.Visible = true\n            task.wait(2)\n            check.Visible = false\n            logo.Visible = true\n            btnLabel.Text = \"Unirse al Discord\"\n        else\n            btnLabel.Text = DISCORD_URL\n            task.wait(3)\n            btnLabel.Text = \"Unirse al Discord\"\n        end\n    end)\n\n    -- ========== Entrada escalonada ==========\n    task.delay(0.3, function()\n        Scene.Position = UDim2.fromOffset(16, 28)\n        tw(Scene, ti(0.6), { Position = UDim2.fromOffset(16, 16) })\n    end)\n    task.delay(0.35, function()\n        tw(Titulo, ti(0.5), { TextTransparency = 0, Position = UDim2.fromOffset(TX, 18) })\n    end)\n    task.delay(0.6, function()\n        tw(pill, ti(0.4), { BackgroundTransparency = 0 })\n        tw(pillStroke, ti(0.4), { Transparency = 0.2 })\n        tw(pillLbl, ti(0.4), { TextTransparency = 0 })\n    end)\n    task.delay(0.85, function()\n        tw(Mensaje, ti(0.5), { TextTransparency = 0 })\n        tw(barBack, ti(0.5), { BackgroundTransparency = 0 })\n    end)\n\n    -- ========== Animaciones por frame (un solo Heartbeat) ==========\n    local T0 = os.clock()\n    local conn\n    conn = RunService.Heartbeat:Connect(function(dt)\n        if not Panel.Parent then\n            conn:Disconnect()\n            return\n        end\n        local t = os.clock() - T0\n        bGrad.Rotation = (t * 45) % 360\n        glowA.BackgroundTransparency = 0.86 + 0.04 * math.sin(t * 1.4)\n        glowB.BackgroundTransparency = 0.62 + 0.06 * math.sin(t * 2.1 + 1)\n        gear.Rotation = (t * 70) % 360\n        for _, fn in ipairs(ups) do pcall(fn, t, dt) end\n    end)\n\n    -- ========== Arrastrar la ventana ==========\n    do\n        local dragging, dragStart, startPos\n        Surface.InputBegan:Connect(function(input)\n            if input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then\n                dragging, dragStart, startPos = true, input.Position, Panel.Position\n                input.Changed:Connect(function()\n                    if input.UserInputState == Enum.UserInputState.End then dragging = false end\n                end)\n            end\n        end)\n        UserInputService.InputChanged:Connect(function(input)\n            if dragging and (input.UserInputType == Enum.UserInputType.MouseMovement or input.UserInputType == Enum.UserInputType.Touch) then\n                local d = (input.Position - dragStart) / math.max(popScale.Scale, 0.1)\n                Panel.Position = UDim2.new(startPos.X.Scale, startPos.X.Offset + d.X, startPos.Y.Scale, startPos.Y.Offset + d.Y)\n            end\n        end)\n    end\n\n    return\n";
// En vivo: mientras el cartel esta puesto, el juego consulta el mismo link cada 15 s. Cuando se quita el mantenimiento, cierra el cartel y carga el script solo.
function luaVivo(url) {
  return '-- UZIVERT_MANT\nlocal UZ_URL = ' + JSON.stringify(url) + `
task.spawn(function()
  local t0 = os.clock()
  while os.clock() - t0 < 7200 do
    task.wait(15)
    local ok, res = pcall(function() return game:HttpGet(UZ_URL .. "?p=" .. os.time()) end)
    if ok and type(res) == "string" and #res > 0 and not res:find("UZIVERT_MANT", 1, true) then
      pcall(function()
        local roots = {game:GetService("CoreGui")}
        if gethui then local okh, h = pcall(gethui); if okh and h then table.insert(roots, h) end end
        local lp = game:GetService("Players").LocalPlayer
        if lp and lp:FindFirstChild("PlayerGui") then table.insert(roots, lp.PlayerGui) end
        for _, root in ipairs(roots) do
          for _, n in ipairs({"UzivertMantenimiento", "UzivertAviso"}) do
            local o = root:FindFirstChild(n)
            while o do pcall(function() o:Destroy() end); o = root:FindFirstChild(n) end
          end
        end
      end)
      local fn = loadstring(res)
      if fn then fn() end
      break
    end
  end
end)
`;
}
function luaMantenimiento(url) { return luaVivo(url) + 'print("UZIVERT HUB EN MANTENIMIENTO")\nlocal DISCORD_URL = ' + JSON.stringify(MANT_DISCORD) + '\n' + MANT_LUA; }
// Cartel chico al costado (el de LOADER_DUELOS / LOADER_UNIVERSAL, copiado tal cual). El subtitulo lleva el nombre del script.
const MANT_COSTADO = "local Players = game:GetService(\"Players\")\nlocal TweenService = game:GetService(\"TweenService\")\nlocal RunService = game:GetService(\"RunService\")\n\n-- Aviso chico al costado (todo dibujado con Frames)\nlocal function aviso(texto)\n    pcall(function()\n        local old = ((gethui and gethui()) or game:GetService(\"CoreGui\")):FindFirstChild(\"UzivertAviso\")\n        if old then old:Destroy() end\n    end)\n    local gui = Instance.new(\"ScreenGui\")\n    gui.Name = \"UzivertAviso\"\n    gui.ResetOnSpawn = false\n    gui.IgnoreGuiInset = true\n    gui.DisplayOrder = 999999\n    local ok = pcall(function() gui.Parent = (gethui and gethui()) or game:GetService(\"CoreGui\") end)\n    if not ok or not gui.Parent then gui.Parent = Players.LocalPlayer:WaitForChild(\"PlayerGui\") end\n\n    local card = Instance.new(\"Frame\")\n    card.AnchorPoint = Vector2.new(1, 0.5)\n    card.Position = UDim2.new(1, 300, 0.5, 0) -- fuera de pantalla (derecha)\n    card.Size = UDim2.fromOffset(250, 62)\n    card.BackgroundColor3 = Color3.fromRGB(14, 15, 24)\n    card.BorderSizePixel = 0\n    card.Parent = gui\n    Instance.new(\"UICorner\", card).CornerRadius = UDim.new(0, 12)\n\n    local st = Instance.new(\"UIStroke\", card)\n    st.Thickness = 1.6\n    st.Color = Color3.new(1, 1, 1)\n    local sg = Instance.new(\"UIGradient\", st)\n    sg.Color = ColorSequence.new({\n        ColorSequenceKeypoint.new(0, Color3.fromRGB(255, 190, 90)),\n        ColorSequenceKeypoint.new(0.5, Color3.fromRGB(255, 90, 90)),\n        ColorSequenceKeypoint.new(1, Color3.fromRGB(255, 190, 90)),\n    })\n\n    -- icono: circulo con \"!\"\n    local ico = Instance.new(\"Frame\", card)\n    ico.AnchorPoint = Vector2.new(0, 0.5)\n    ico.Position = UDim2.new(0, 14, 0.5, 0)\n    ico.Size = UDim2.fromOffset(32, 32)\n    ico.BackgroundColor3 = Color3.fromRGB(255, 170, 70)\n    ico.BorderSizePixel = 0\n    Instance.new(\"UICorner\", ico).CornerRadius = UDim.new(1, 0)\n    local ex = Instance.new(\"TextLabel\", ico)\n    ex.Size = UDim2.fromScale(1, 1)\n    ex.BackgroundTransparency = 1\n    ex.Text = \"!\"\n    ex.TextColor3 = Color3.new(1, 1, 1)\n    ex.Font = Enum.Font.GothamBlack\n    ex.TextSize = 20\n\n    local t1 = Instance.new(\"TextLabel\", card)\n    t1.Position = UDim2.new(0, 56, 0, 12)\n    t1.Size = UDim2.new(1, -66, 0, 20)\n    t1.BackgroundTransparency = 1\n    t1.Text = texto\n    t1.TextXAlignment = Enum.TextXAlignment.Left\n    t1.TextColor3 = Color3.new(1, 1, 1)\n    t1.Font = Enum.Font.GothamBold\n    t1.TextSize = 14\n\n    local t2 = Instance.new(\"TextLabel\", card)\n    t2.Position = UDim2.new(0, 56, 0, 32)\n    t2.Size = UDim2.new(1, -66, 0, 18)\n    t2.BackgroundTransparency = 1\n    t2.Text = SUB\n    t2.TextXAlignment = Enum.TextXAlignment.Left\n    t2.TextColor3 = Color3.fromRGB(150, 156, 180)\n    t2.Font = Enum.Font.Gotham\n    t2.TextSize = 11\n\n    -- barra de tiempo\n    local barBg = Instance.new(\"Frame\", card)\n    barBg.AnchorPoint = Vector2.new(0, 1)\n    barBg.Position = UDim2.new(0, 14, 1, -6)\n    barBg.Size = UDim2.new(1, -28, 0, 3)\n    barBg.BackgroundColor3 = Color3.fromRGB(40, 42, 60)\n    barBg.BorderSizePixel = 0\n    Instance.new(\"UICorner\", barBg).CornerRadius = UDim.new(1, 0)\n    local bar = Instance.new(\"Frame\", barBg)\n    bar.Size = UDim2.fromScale(1, 1)\n    bar.BackgroundColor3 = Color3.fromRGB(255, 170, 70)\n    bar.BorderSizePixel = 0\n    Instance.new(\"UICorner\", bar).CornerRadius = UDim.new(1, 0)\n\n    local conn = RunService.Heartbeat:Connect(function()\n        sg.Rotation = (os.clock() * 90) % 360\n    end)\n\n    TweenService:Create(card, TweenInfo.new(0.5, Enum.EasingStyle.Back, Enum.EasingDirection.Out), { Position = UDim2.new(1, -16, 0.5, 0) }):Play()\n    TweenService:Create(bar, TweenInfo.new(6, Enum.EasingStyle.Linear), { Size = UDim2.new(0, 0, 1, 0) }):Play()\n    task.delay(6, function()\n        TweenService:Create(card, TweenInfo.new(0.4, Enum.EasingStyle.Quad, Enum.EasingDirection.In), { Position = UDim2.new(1, 300, 0.5, 0) }):Play()\n        task.wait(0.45)\n        conn:Disconnect()\n        gui:Destroy()\n    end)\nend";
function luaMantCostado(nombre, url) { return luaVivo(url) + 'local SUB = ' + luaStr(('Uzivert Hub  |  ' + nombre)) + '\n' + MANT_COSTADO + '\naviso("Script en mantenimiento")\nreturn\n'; }
function luaStr(v) { return '"' + String(v == null ? '' : v).replace(/[\\"\r\n]/g, (c) => (c === '\\' ? '\\\\' : c === '"' ? '\\"' : ' ')) + '"'; }
app.get('/s/:slug', async (req, res) => {
  const quien = ip(req);
  const bloqueado = segBloq.get(quien);
  const razon = isAdmin(req) ? '' : (bloqueado && bloqueado > Date.now() ? 'bloqueado' : esNavegadorOHerramienta(req));
  if (razon) {
    res.status(403).setHeader('Cache-Control', 'no-store');
    if (razon !== 'bloqueado' && limited('seg:' + quien, 8, 10 * 60e3)) {   // 8 intentos en 10 min: bloqueo de 1 hora y aviso
      segBloq.set(quien, Date.now() + 3600e3); audit(req, 'IP bloqueada (auto)', quien + ' /s/' + clean(req.params.slug, 40));
      console.warn('[seguridad] IP bloqueada por insistir en /s/' + req.params.slug + ':', quien);
      postWebhook(SEG_WEBHOOK, { username: SITE_NAME + ' | Seguridad', embeds: [{ title: 'Intento de acceso al loader', color: 0xed4245, description: 'Alguien insistió en abrir un loader fuera de Roblox. Se bloqueó su IP por 1 hora.', fields: [{ name: 'Loader', value: '`' + clean(req.params.slug, 40) + '`', inline: true }, { name: 'Tipo', value: razon, inline: true }, { name: 'IP', value: '`' + quien + '`', inline: true }, { name: 'User-Agent', value: '`' + clean(req.headers['user-agent'], 150).replace(/`/g, "'") + '`' }], timestamp: new Date().toISOString() }] }).catch(() => {});
    }
    if (/text\/html/i.test(String(req.headers.accept || ''))) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.send(PAGINA_NO); }
    return res.type('text/plain; charset=utf-8').send('-- No estas autorizado');
  }
  res.type('text/plain; charset=utf-8').setHeader('Cache-Control', 'no-store');
  const slug = req.params.slug;
  if (!SLUG.test(slug)) return res.status(404).send('-- no encontrado');
  try {
    const meta = (await loadIndex()).find((s) => s.slug === slug);
    if (!meta || (meta.estado !== 'activo' && meta.estado !== 'enlace')) return res.status(404).send('-- no encontrado');
    if (meta.situacion === 'mant') return res.send(meta.cartel === 'costado' ? luaMantCostado(meta.name, loaderUrl(baseUrl(req), meta)) : luaMantenimiento(loaderUrl(baseUrl(req), meta)));
    if (!isAdmin(req)) contarEjec(slug, quien);
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

app.get('/favicon.ico', (req, res) => {                              // los navegadores lo piden solos
  const f = [path.join(__dirname, 'public', 'logo.png'), path.join(__dirname, 'logo.png')].find((x) => require('fs').existsSync(x));
  if (!f) return res.status(404).end();
  res.setHeader('Content-Type', 'image/png'); res.setHeader('Cache-Control', 'public, max-age=86400');
  require('fs').createReadStream(f).pipe(res);
});
// Archivos de la página: carpeta public/, o (si subiste todo suelto en la raiz) solo estos archivos permitidos.
const fs = require('fs');
const PUBLIC_DIR = path.join(__dirname, 'public');
if (fs.existsSync(path.join(PUBLIC_DIR, 'index.html'))) {
  app.use(express.static(PUBLIC_DIR));
} else {
  const PAGINA = new Set(['index.html', 'admin.html', 'style.css', 'app.js', 'admin.js', 'common.js', 'logo.png']);
  const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.png': 'image/png' };
  console.log('[aviso] No hay carpeta public/: sirviendo los archivos de la página desde la raiz.');
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let n = req.path === '/' ? 'index.html' : req.path === '/admin' ? 'admin.html' : req.path.slice(1);
    if (n === 'index') n = 'index.html';
    if (!PAGINA.has(n) || !fs.existsSync(path.join(__dirname, n))) return next();
    res.setHeader('Content-Type', MIME[path.extname(n)]);
    res.setHeader('Cache-Control', n === 'logo.png' ? 'public, max-age=86400' : 'no-cache');
    fs.createReadStream(path.join(__dirname, n)).pipe(res);
  });
}
// ---------- SOPORTE EN VIVO ----------
// Persona <-> admin (panel). Si no hay admin disponible (o no responde en 90 s) atiende Vertix, toma el caso y el contacto,
// y al terminar manda la conversación en un .txt al canal de soporte (webhook).
const SV = new Map();                                              // token -> chat
let svActivo = false, svVisto = 0, svSucio = false, svTimer = null;
const svDisponible = () => svActivo && Date.now() - svVisto < 150e3;
const svCargada = (async () => {
  try { const j = JSON.parse((await store.read('soporte-vivo.json')) || '{}'); svActivo = !!j.activo; for (const c of j.chats || []) if (c && c.token) SV.set(c.token, c); } catch (e) { console.error('[soporte-vivo] cargar:', e.message); }
})();
function svMarcar() { svSucio = true; if (!svTimer) svTimer = setTimeout(svGuardar, 8e3); }
async function svGuardar() {
  clearTimeout(svTimer); svTimer = null;
  if (!svSucio) return; svSucio = false;
  try { await store.write('soporte-vivo.json', JSON.stringify({ activo: svActivo, chats: [...SV.values()].filter((c) => c.estado === 'abierto' || !c.enviado) })); } catch (e) { svSucio = true; console.error('[soporte-vivo] guardar:', e.message); }
}
const svPush = (c, de, t) => { c.msgs.push({ n: c.msgs.length + 1, de, t: String(t).slice(0, 1500), ts: Date.now() }); c.ult = Date.now(); svMarcar(); };
const svVista = (c, desde) => ({ ok: true, modo: c.modo, estado: c.estado, msgs: c.msgs.filter((m) => m.n > (Number(desde) || 0)) });
const SV_HORA = (ts) => new Date(ts - 3 * 3600e3).toISOString().slice(11, 16);   // hora de Paraguay aproximada (UTC-3)

const SV_PROMPT = `Eres Vertix, el asistente de soporte de Uzivert Hub (scripts de Roblox). Ahora nadie del equipo está conectado, así que atiendes tú; el equipo leerá todo después y le responderá a la persona.
Habla en español, amable y corto (máximo 3 frases). Una sola pregunta a la vez.
Objetivo: 1) entender el caso: qué script o juego, qué pasa exactamente, qué error sale y qué ejecutor usa. 2) Pedir una forma de contactarlo: usuario de Roblox, Discord o correo (si todavía no la dio). 3) Con el caso y el contacto, despídete diciendo que el equipo le responderá pronto.
Reglas: no prometas plazos ni arreglos. Nunca pidas contraseñas, PIN, cookies ni códigos de seguridad. Si no quiere dar contacto, insiste una sola vez; si sigue sin querer, termina igual. Puedes sugerir lo básico (volver a ejecutar, actualizar el ejecutor) pero no inventes soluciones.
Responde SOLO un objeto JSON con esta forma: {"say":"tu mensaje","fin":false,"contacto":"","resumen":""}. "fin" pasa a true solo cuando ya tienes el caso y el contacto (o se negó dos veces). "contacto" es el contacto que dio ("" si no). "resumen" es el caso en 1 a 3 líneas (solo cuando fin sea true).`;

async function svVertix(c) {                                       // Vertix responde al chat
  if (c.pensando) return; c.pensando = true;
  try {
    const hist = c.msgs.slice(-24).map((m) => ({ role: m.de === 'usuario' ? 'user' : 'assistant', content: m.t }));
    const disp = VX_MODELOS.filter((m) => !m.mant);
    const raw = await vxLLM([{ role: 'system', content: SV_PROMPT + (c.contacto ? `\nContacto ya dado: ${c.contacto}` : '') }, ...hist], { modelos: disp });
    let o = null;
    try { o = JSON.parse(String(raw).replace(/^\s*```(?:json)?|```\s*$/g, '').trim()); } catch { const m = /\{[\s\S]*\}/.exec(raw); if (m) { try { o = JSON.parse(m[0]); } catch {} } }
    if (!o || typeof o.say !== 'string') o = { say: (vxParse(raw).say || '').toString(), fin: false };
    const say = clean(o.say, 700) || 'Cuéntame qué pasó y con qué script.';
    if (o.contacto && typeof o.contacto === 'string' && o.contacto.trim()) c.contacto = clean(o.contacto, 100);
    svPush(c, 'vertix', say);
    if (o.fin === true && c.msgs.some((m) => m.de === 'usuario')) { c.resumen = clean(o.resumen, 600); await svCerrar(c, 'Vertix terminó de tomar el caso'); }
  } catch (e) {
    console.error('[soporte-vivo] vertix:', e.message);
    svPush(c, 'vertix', 'Tuve un problema para responder. Déjame tu usuario de Roblox o Discord y el equipo te escribirá.');
  } finally { c.pensando = false; }
}
async function svEnviarTxt(c) {
  if (!WEBHOOK_SOPORTE) return true;
  const quien = [...new Set(c.msgs.map((m) => m.de))].filter((x) => x !== 'usuario').map((x) => x === 'admin' ? 'Equipo' : 'Vertix').join(' + ') || 'Nadie respondió';
  const lineas = [`SOPORTE EN VIVO - ${SITE_NAME}`, `Fecha: ${new Date(c.creado).toISOString().slice(0, 16).replace('T', ' ')} UTC`, `Nombre: ${c.nombre}`, `Contacto: ${c.contacto || '(no lo dio)'}`, `Atendido por: ${quien}`, `Cierre: ${c.motivo || '-'}`, c.resumen ? `Resumen de Vertix: ${c.resumen}` : '', '', '------------------------------------------']
    .concat(c.msgs.map((m) => `[${SV_HORA(m.ts)}] ${m.de === 'usuario' ? c.nombre : m.de === 'admin' ? 'Equipo' : 'Vertix'}: ${m.t.replace(/\n/g, ' ')}`)).filter((x, i) => x !== '' || i > 0);
  const fd = new FormData();
  fd.append('payload_json', JSON.stringify({ username: SITE_NAME + ' | Soporte en vivo', allowed_mentions: { parse: [] }, embeds: [{ title: 'Soporte en vivo: conversación cerrada', color: 0x8e94a3, fields: [
    { name: 'Nombre', value: esc(c.nombre) || '-', inline: true }, { name: 'Contacto', value: esc(c.contacto || 'No lo dio'), inline: true }, { name: 'Atendió', value: quien, inline: true }].concat(c.resumen ? [{ name: 'Resumen', value: esc(c.resumen).slice(0, 900) }] : []), timestamp: new Date().toISOString() }] }));
  fd.append('files[0]', new Blob([lineas.join('\n')], { type: 'text/plain' }), 'soporte-' + c.id + '.txt');
  const r = await fetch(WEBHOOK_SOPORTE, { method: 'POST', body: fd });
  if (!r.ok) throw new Error('webhook ' + r.status);
  return true;
}
async function svCerrar(c, motivo) {
  if (c.estado === 'cerrado') return;
  c.estado = 'cerrado'; c.motivo = motivo; c.cierre = Date.now();
  if (!c.msgs.some((m) => m.de === 'usuario')) { c.enviado = true; svMarcar(); return; }       // nunca escribió: no se manda nada
  try { await svEnviarTxt(c); c.enviado = true; } catch (e) { c.enviado = false; c.intentos = (c.intentos || 0) + 1; console.error('[soporte-vivo] enviar txt:', e.message); }
  svMarcar();
}
setInterval(async () => {
  const n = Date.now();
  for (const [t, c] of SV) {
    if (c.estado === 'abierto') {
      if (c.modo === 'humano' && c.espera && n - c.espera > 90e3) {                        // nadie respondió: toma Vertix
        c.modo = 'vertix'; c.espera = null;
        svPush(c, 'vertix', 'Parece que nadie del equipo está disponible ahora. Soy Vertix y voy a tomar tu caso para que te respondan después.');
        svVertix(c);
      } else if (n - c.ult > 20 * 60e3) await svCerrar(c, 'Se cerró por inactividad');
    } else if (c.estado === 'cerrado') {
      if (!c.enviado && (c.intentos || 0) < 5) { try { await svEnviarTxt(c); c.enviado = true; svMarcar(); } catch { c.intentos = (c.intentos || 0) + 1; } }
      else if (n - c.cierre > 15 * 60e3 && (c.enviado || c.intentos >= 5)) { SV.delete(t); svMarcar(); }
    }
  }
}, 15e3).unref();

const svDe = (req) => { const t = clean(req.query.token || (req.body && req.body.token), 60); return /^[A-Za-z0-9_-]{20,60}$/.test(t) ? SV.get(t) : null; };
app.get('/api/soporte/vivo/estado', async (req, res) => { noStore(res); await svCargada; res.json({ disponible: svDisponible() }); });
app.post('/api/soporte/vivo/iniciar', needJson, async (req, res) => {
  noStore(res); await svCargada;
  if (limited('sv:' + ip(req), 6, 3600e3)) return res.status(429).json({ error: 'Demasiados chats seguidos. Intenta más tarde.' });
  if (SV.size > 300) return res.status(503).json({ error: 'Soporte en vivo está lleno ahora. Usa el formulario de abajo.' });
  const b = req.body || {};
  const token = crypto.randomBytes(18).toString('base64url');
  const c = { token, id: crypto.randomBytes(4).toString('hex'), nombre: clean(b.nombre, 40) || 'Visitante', contacto: clean(b.contacto, 100), modo: svDisponible() ? 'humano' : 'vertix', estado: 'abierto', creado: Date.now(), ult: Date.now(), msgs: [], sinLeer: 0, espera: null };
  svPush(c, c.modo === 'humano' ? 'sistema' : 'vertix', c.modo === 'humano' ? 'Conectado con el equipo de soporte. Escribe tu mensaje y te responderán en breve.' : 'Hola, soy Vertix. Ahora no hay nadie del equipo conectado, así que te ayudo a dejar tu caso para que te respondan después. ¿Qué te pasó?');
  SV.set(token, c);
  res.json({ ok: true, token, modo: c.modo });
});
app.post('/api/soporte/vivo/enviar', needJson, async (req, res) => {
  noStore(res);
  const c = svDe(req); if (!c) return res.status(404).json({ error: 'El chat ya no existe.' });
  if (c.estado !== 'abierto') return res.status(400).json({ error: 'El chat ya terminó.' });
  if (limited('svm:' + c.token, 20, 60e3) || limited('svi:' + ip(req), 80, 600e3)) return res.status(429).json({ error: 'Vas muy rápido, espera un momento.' });
  const t = clean(req.body && req.body.texto, 800); if (!t) return res.status(400).json({ error: 'Escribe un mensaje.' });
  if (c.msgs.length >= 80) { await svCerrar(c, 'Límite de mensajes'); return res.json(svVista(c, req.body.desde)); }
  svPush(c, 'usuario', t);
  if (c.modo === 'humano') { c.sinLeer = (c.sinLeer || 0) + 1; if (!c.espera) c.espera = Date.now(); }
  else await svVertix(c);
  res.json(svVista(c, req.body.desde));
});
app.get('/api/soporte/vivo/mensajes', (req, res) => {
  noStore(res);
  if (limited('svp:' + ip(req), 90, 60e3)) return res.status(429).json({ error: 'Demasiadas consultas.' });
  const c = svDe(req); if (!c) return res.status(404).json({ error: 'El chat ya no existe.' });
  res.json(svVista(c, req.query.desde));
});
app.post('/api/soporte/vivo/cerrar', needJson, async (req, res) => {
  noStore(res);
  const c = svDe(req); if (!c) return res.json({ ok: true });
  await svCerrar(c, 'La persona terminó el chat'); res.json({ ok: true });
});
// ---- lado admin ----
app.get('/api/admin/soporte/estado', adminOnly, async (req, res) => { await svCargada; svVisto = Date.now(); res.json({ activo: svActivo, disponible: svDisponible() }); });
app.post('/api/admin/soporte/activo', adminOnly, async (req, res) => { await svCargada; svActivo = !!(req.body && req.body.valor); svVisto = Date.now(); svMarcar(); res.json({ activo: svActivo, disponible: svDisponible() }); });
app.get('/api/admin/soporte/chats', adminOnly, async (req, res) => {
  await svCargada; svVisto = Date.now();
  const l = [...SV.values()].filter((c) => c.estado === 'abierto').sort((a, b) => b.ult - a.ult).map((c) => ({ id: c.id, nombre: c.nombre, contacto: c.contacto, modo: c.modo, ult: c.ult, sinLeer: c.sinLeer || 0, ultimo: (c.msgs[c.msgs.length - 1] || {}).t || '' }));
  res.json({ activo: svActivo, disponible: svDisponible(), chats: l });
});
const svPorId = (id) => [...SV.values()].find((c) => c.id === String(id));
app.get('/api/admin/soporte/chat', adminOnly, (req, res) => {
  const c = svPorId(req.query.id); if (!c) return res.status(404).json({ error: 'Ese chat ya no existe.' });
  c.sinLeer = 0; res.json(Object.assign(svVista(c, req.query.desde), { nombre: c.nombre, contacto: c.contacto }));
});
app.post('/api/admin/soporte/responder', adminOnly, (req, res) => {
  const c = svPorId(req.body && req.body.id); if (!c || c.estado !== 'abierto') return res.status(404).json({ error: 'Ese chat ya terminó.' });
  const t = clean(req.body.texto, 800); if (!t) return res.status(400).json({ error: 'Escribe un mensaje.' });
  c.modo = 'humano'; c.espera = null; c.sinLeer = 0; svPush(c, 'admin', t);
  res.json(svVista(c, req.body.desde));
});
app.post('/api/admin/soporte/cerrar', adminOnly, async (req, res) => {
  const c = svPorId(req.body && req.body.id); if (c) await svCerrar(c, 'Lo cerró el equipo');
  res.json({ ok: true });
});

// ---------- ADMIN: auditoría, ejecuciones, bóveda, seguridad y consola ----------
const dia = (ts) => new Date((ts || Date.now()) - 3 * 3600e3).toISOString().slice(0, 10);     // día en hora de Paraguay
// Auditoría: quién hizo qué en el panel (últimas 300 acciones)
let AUD = [], audSucio = false, audTimer = null;
const audCargada = (async () => { try { AUD = JSON.parse((await store.read('auditoria.json')) || '[]'); } catch {} })();
function audit(req, accion, detalle) {
  AUD.push({ ts: Date.now(), ip: req ? ip(req) : '-', accion, detalle: clean(detalle, 160) }); if (AUD.length > 300) AUD.shift();
  audSucio = true; if (!audTimer) audTimer = setTimeout(audGuardar, 15e3);
}
async function audGuardar() { clearTimeout(audTimer); audTimer = null; if (!audSucio) return; audSucio = false; try { await store.write('auditoria.json', JSON.stringify(AUD)); } catch (e) { audSucio = true; console.error('auditoria:', e.message); } }

// Contador de ejecuciones: cada vez que un ejecutor descarga un loader de la página (/s/slug) cuenta una ejecución
let EJ = {}, ejSucio = false, ejTimer = null;
const ejCargada = (async () => { try { EJ = JSON.parse((await store.read('ejecuciones.json')) || '{}'); } catch {} })();
const ejRecientes = new Map();
function contarEjec(slug, quien) {
  const k = quien + '|' + slug, n = Date.now();
  if (n - (ejRecientes.get(k) || 0) < 5e3) return; ejRecientes.set(k, n);
  if (ejRecientes.size > 5000) for (const [x, t] of ejRecientes) if (n - t > 60e3) ejRecientes.delete(x);
  const e = EJ[slug] || (EJ[slug] = { total: 0, dias: {}, ult: 0 });
  e.total++; e.ult = n; const d = dia(n); e.dias[d] = (e.dias[d] || 0) + 1;
  const ks = Object.keys(e.dias).sort(); while (ks.length > 60) delete e.dias[ks.shift()];
  ejSucio = true; if (!ejTimer) ejTimer = setTimeout(ejGuardar, 20e3);
}
async function ejGuardar() { clearTimeout(ejTimer); ejTimer = null; if (!ejSucio) return; ejSucio = false; try { await store.write('ejecuciones.json', JSON.stringify(EJ)); } catch (e) { ejSucio = true; console.error('ejecuciones:', e.message); } }
async function ejResumen() {
  await ejCargada;
  const idx = await loadIndex(), hoy = dia(), dias = [];
  for (let i = 13; i >= 0; i--) { const d = dia(Date.now() - i * 864e5); dias.push({ d, n: Object.values(EJ).reduce((a, e) => a + (e.dias[d] || 0), 0) }); }
  const sem = new Set(dias.slice(-7).map((x) => x.d));
  const nombres = new Map(idx.map((s) => [s.slug, s.name]));
  const scripts = Object.keys(EJ).concat(idx.map((s) => s.slug).filter((s) => !EJ[s])).filter((v, i, a) => a.indexOf(v) === i).map((slug) => { const e = EJ[slug] || { total: 0, dias: {}, ult: 0 }; return { slug, name: nombres.get(slug) || slug + ' (borrado)', total: e.total, hoy: e.dias[hoy] || 0, sem: Object.entries(e.dias).filter(([d]) => sem.has(d)).reduce((a, [, n]) => a + n, 0), ult: e.ult }; }).sort((a, b) => b.total - a.total);
  return { scripts, dias, total: scripts.reduce((a, s) => a + s.total, 0), hoy: scripts.reduce((a, s) => a + s.hoy, 0) };
}
app.get('/api/admin/ejecuciones', adminOnly, async (req, res) => res.json(await ejResumen()));
app.get('/api/admin/auditoria', adminOnly, async (req, res) => { await audCargada; res.json(AUD.slice().reverse().slice(0, 150)); });
app.get('/api/admin/resumen', adminOnly, async (req, res) => {
  const e = await ejResumen(); await svCargada;
  res.json({ ejecHoy: e.hoy, ejecTotal: e.total, dias: e.dias, scripts: (await loadIndex()).length, chats: [...SV.values()].filter((c) => c.estado === 'abierto').length, soporte: svDisponible(), bloqueadas: segBloq.size, almacenamiento: store.kind, uptime: Math.round(process.uptime()), memoria: Math.round(process.memoryUsage().rss / 1048576) });
});
// IPs bloqueadas
app.get('/api/admin/seguridad', adminOnly, (req, res) => res.json({ bloqueadas: [...segBloq].filter(([, h]) => h > Date.now()).map(([ip, hasta]) => ({ ip, hasta })) }));
app.post('/api/admin/seguridad/bloquear', adminOnly, (req, res) => {
  const x = clean(req.body && req.body.ip, 60), h = Math.min(Math.max(Number(req.body && req.body.horas) || 24, 1), 24 * 30);
  if (!/^[0-9a-fA-F:.]{3,45}$/.test(x)) return res.status(400).json({ error: 'IP inválida.' });
  segBloq.set(x, Date.now() + h * 3600e3); audit(req, 'bloquear IP', x + ' ' + h + 'h'); res.json({ ok: true });
});
app.post('/api/admin/seguridad/desbloquear', adminOnly, (req, res) => { const x = clean(req.body && req.body.ip, 60); segBloq.delete(x); audit(req, 'desbloquear IP', x); res.json({ ok: true }); });

// ---- Bóveda: scripts completos, privados (nunca se sirven públicamente). Se cifran si defines BOVEDA_KEY ----
const BOV_KEY = env.BOVEDA_KEY ? crypto.createHash('sha256').update(env.BOVEDA_KEY).digest() : null;
const bovCifrar = (t) => { if (!BOV_KEY) return t; const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', BOV_KEY, iv); const e = Buffer.concat([c.update(t, 'utf8'), c.final()]); return 'enc:' + Buffer.concat([iv, c.getAuthTag(), e]).toString('base64'); };
const bovDescifrar = (t) => { if (t == null) return null; t = String(t); if (!t.startsWith('enc:')) return t; if (!BOV_KEY) throw new Error('Este archivo está cifrado: falta BOVEDA_KEY.'); const b = Buffer.from(t.slice(4), 'base64'), d = crypto.createDecipheriv('aes-256-gcm', BOV_KEY, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'); };
let bovCola = Promise.resolve();
const bovSerial = (fn) => { const p = bovCola.then(fn, fn); bovCola = p.catch(() => {}); return p; };
const bovIdx = async () => { try { return JSON.parse((await store.read('boveda/index.json')) || '[]'); } catch { return []; } };
const bovSave = (l) => store.write('boveda/index.json', JSON.stringify(l));
const BOV_ID = /^[a-f0-9]{12}$/;
const bovMeta = (m) => ({ slug: m.slug || '', alias: m.alias || '', id: m.id, nombre: m.nombre, carpeta: m.carpeta || '', tipo: m.tipo === 'loader' ? 'loader' : 'script', notas: m.notas || '', creado: m.creado, mod: m.mod, size: m.size, versiones: (m.vers || []).length, cifrado: !!m.cifrado });
const bovCampos = (b) => ({ tipo: b.tipo === 'loader' ? 'loader' : 'script', nombre: clean(b.nombre, 80), carpeta: clean(b.carpeta, 40), notas: clean(b.notas, 500), codigo: String(b.codigo == null ? '' : b.codigo) });
app.get('/api/admin/boveda', adminOnly, async (req, res) => res.json({ cifrado: !!BOV_KEY, archivos: (await bovIdx()).map(bovMeta).sort((a, b) => (a.tipo === b.tipo ? 0 : a.tipo === 'loader' ? -1 : 1) || (a.carpeta || '~').localeCompare(b.carpeta || '~') || a.nombre.localeCompare(b.nombre)) }));
app.get('/api/admin/boveda/:id', adminOnly, async (req, res) => {
  if (!BOV_ID.test(req.params.id)) return res.status(400).json({ error: 'ID inválido' });
  const m = (await bovIdx()).find((x) => x.id === req.params.id); if (!m) return res.status(404).json({ error: 'No existe.' });
  try { const codigo = bovDescifrar(await store.read(`boveda/${m.id}.lua`)); audit(req, 'bóveda: abrir', m.nombre); res.json(Object.assign(bovMeta(m), { codigo, vers: m.vers || [], loader: m.slug ? `loadstring(game:HttpGet("${loaderUrl(baseUrl(req), m)}"))()` : '' })); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/admin/boveda/:id/v/:v', adminOnly, async (req, res) => {
  if (!BOV_ID.test(req.params.id) || !/^\d{1,6}$/.test(req.params.v)) return res.status(400).json({ error: 'Inválido' });
  try { const t = await store.read(`boveda/${req.params.id}.v${req.params.v}.lua`); if (t == null) return res.status(404).json({ error: 'Esa versión ya no existe.' }); res.json({ codigo: bovDescifrar(t) }); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/admin/boveda/:id/descargar', adminOnly, async (req, res) => {
  if (!BOV_ID.test(req.params.id)) return res.status(400).end();
  const m = (await bovIdx()).find((x) => x.id === req.params.id); if (!m) return res.status(404).end();
  try { const t = bovDescifrar(await store.read(`boveda/${m.id}.lua`)); audit(req, 'bóveda: descargar', m.nombre); res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="${m.nombre.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'script'}.lua"`); res.send(t); } catch (e) { res.status(500).end(); }
});
app.post('/api/admin/boveda', adminOnly, (req, res) => bovSerial(async () => {
  const c = bovCampos(req.body || {});
  if (!c.nombre) return res.status(400).json({ error: 'Ponle un nombre.' });
  if (!c.codigo.trim()) return res.status(400).json({ error: 'El script está vacío.' });
  if (c.codigo.length > 1_200_000) return res.status(400).json({ error: 'Es demasiado grande (máx 1.2 MB).' });
  const l = await bovIdx(); if (l.length >= 300) return res.status(400).json({ error: 'Llegaste al límite de 300 archivos.' });
  const m = { id: crypto.randomBytes(6).toString('hex'), nombre: c.nombre, tipo: c.tipo, carpeta: c.carpeta, notas: c.notas, creado: Date.now(), mod: Date.now(), size: c.codigo.length, cifrado: !!BOV_KEY, vers: [], vn: 0 };
  await store.write(`boveda/${m.id}.lua`, bovCifrar(c.codigo)); l.push(m); await bovSave(l); audit(req, 'bóveda: crear', m.nombre); res.json({ ok: true, id: m.id });
}).catch((e) => res.status(500).json({ error: 'No se pudo guardar: ' + e.message })));
app.put('/api/admin/boveda/:id', adminOnly, (req, res) => bovSerial(async () => {
  if (!BOV_ID.test(req.params.id)) return res.status(400).json({ error: 'ID inválido' });
  const l = await bovIdx(), m = l.find((x) => x.id === req.params.id); if (!m) return res.status(404).json({ error: 'No existe.' });
  const c = bovCampos(req.body || {});
  if (!c.nombre || !c.codigo.trim()) return res.status(400).json({ error: 'Faltan el nombre o el script.' });
  if (c.codigo.length > 1_200_000) return res.status(400).json({ error: 'Es demasiado grande (máx 1.2 MB).' });
  const actual = await store.read(`boveda/${m.id}.lua`);
  if (actual != null && bovDescifrar(actual) !== c.codigo) {              // guarda la versión anterior (últimas 5)
    m.vn = (m.vn || 0) + 1; await store.write(`boveda/${m.id}.v${m.vn}.lua`, actual); m.vers = (m.vers || []).concat([{ v: m.vn, ts: m.mod, size: m.size }]);
    while (m.vers.length > 5) { const o = m.vers.shift(); try { await store.remove(`boveda/${m.id}.v${o.v}.lua`); } catch {} }
  }
  Object.assign(m, { nombre: c.nombre, tipo: c.tipo, carpeta: c.carpeta, notas: c.notas, mod: Date.now(), size: c.codigo.length, cifrado: !!BOV_KEY });
  await store.write(`boveda/${m.id}.lua`, bovCifrar(c.codigo)); if (m.slug) await bovPublicar(m, c.codigo, req); await bovSave(l); audit(req, 'bóveda: editar', m.nombre + (m.slug ? ' (loader actualizado)' : '')); res.json({ ok: true, actualizado: !!m.slug });
}).catch((e) => res.status(500).json({ error: 'No se pudo guardar: ' + e.message })));
// Publicar un archivo de la bóveda como loader de la página (solo con enlace: no aparece en la lista pública)
async function bovPublicar(m, code, req) {
  const prev = (await loadIndex()).find((x) => x.slug === m.slug) || {};
  const meta = Object.assign({ logo: '', situacion: 'ok', game: m.carpeta || '', version: '', description: '' }, prev, { slug: m.slug, name: m.nombre, verificacion: 'no', alias: m.alias !== undefined ? m.alias : (prev.alias || ''), estado: prev.estado === 'activo' ? 'activo' : 'enlace', bovedaId: m.id, updatedAt: new Date().toISOString(), bytes: Buffer.byteLength(code) });
  await store.write(`scripts/${m.slug}.lua`, code);
  const l = (await loadIndex()).filter((x) => x.slug !== m.slug); l.push(meta); l.sort((a, c) => a.name.localeCompare(c.name));
  await saveIndex(l); cache.delete(m.slug);
}
app.post('/api/admin/boveda/:id/publicar', adminOnly, (req, res) => bovSerial(async () => {
  if (!BOV_ID.test(req.params.id)) return res.status(400).json({ error: 'ID inválido' });
  const slug = clean(req.body && req.body.slug, 40).toLowerCase();
  if (!SLUG.test(slug)) return res.status(400).json({ error: 'Nombre del loader inválido (minúsculas, números y guiones, 2-40).' });
  const l = await bovIdx(), m = l.find((x) => x.id === req.params.id); if (!m) return res.status(404).json({ error: 'No existe.' });
  const otro = (await loadIndex()).find((x) => x.slug === slug && x.bovedaId !== m.id);
  if (otro) return res.status(409).json({ error: 'Ese nombre ya lo usa otro script de la página.' });
  if (l.some((x) => x.id !== m.id && x.slug === slug)) return res.status(409).json({ error: 'Ese nombre ya lo usa otro archivo de la bóveda.' });
  if (m.slug && m.slug !== slug) { try { await store.remove(`scripts/${m.slug}.lua`); await saveIndex((await loadIndex()).filter((x) => x.slug !== m.slug)); cache.delete(m.slug); } catch {} }
  if (req.body && req.body.alias !== undefined) { const ali = checkAlias(req.body.alias, slug, await loadIndex()); if (ali.error) return res.status(400).json({ error: ali.error }); m.alias = ali.alias; }
  m.slug = slug;
  await bovPublicar(m, bovDescifrar(await store.read(`boveda/${m.id}.lua`)), req); await bovSave(l);
  audit(req, 'bóveda: publicar', m.nombre + ' -> ' + (m.alias ? '/' + m.alias : '/s/' + slug)); res.json({ ok: true, slug, alias: m.alias || '', loader: `loadstring(game:HttpGet("${loaderUrl(baseUrl(req), m)}"))()` });
}).catch((e) => res.status(500).json({ error: 'No se pudo publicar: ' + e.message })));
app.post('/api/admin/boveda/:id/despublicar', adminOnly, (req, res) => bovSerial(async () => {
  if (!BOV_ID.test(req.params.id)) return res.status(400).json({ error: 'ID inválido' });
  const l = await bovIdx(), m = l.find((x) => x.id === req.params.id); if (!m) return res.status(404).json({ error: 'No existe.' });
  if (m.slug) { try { await store.remove(`scripts/${m.slug}.lua`); } catch {} await saveIndex((await loadIndex()).filter((x) => x.slug !== m.slug)); cache.delete(m.slug); audit(req, 'bóveda: despublicar', m.nombre + ' (/s/' + m.slug + ')'); m.slug = ''; await bovSave(l); }
  res.json({ ok: true });
}).catch((e) => res.status(500).json({ error: 'No se pudo despublicar: ' + e.message })));
app.delete('/api/admin/boveda/:id', adminOnly, (req, res) => bovSerial(async () => {
  if (!BOV_ID.test(req.params.id)) return res.status(400).json({ error: 'ID inválido' });
  const l = await bovIdx(), m = l.find((x) => x.id === req.params.id); if (!m) return res.json({ ok: true });
  if (m.slug) { try { await store.remove(`scripts/${m.slug}.lua`); await saveIndex((await loadIndex()).filter((x) => x.slug !== m.slug)); cache.delete(m.slug); } catch {} }
  try { await store.remove(`boveda/${m.id}.lua`); for (const v of m.vers || []) await store.remove(`boveda/${m.id}.v${v.v}.lua`).catch(() => {}); } catch {}
  await bovSave(l.filter((x) => x.id !== m.id)); audit(req, 'bóveda: borrar', m.nombre); res.json({ ok: true });
}).catch((e) => res.status(500).json({ error: 'No se pudo borrar: ' + e.message })));

// ---- Consola ----
app.get('/api/admin/consola/logs', adminOnly, (req, res) => { const d = Number(req.query.desde) || 0; res.json({ ultimo: logN, logs: LOGS.filter((l) => l.n > d).slice(-300) }); });
const fmtDur = (s) => { const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return (d ? d + 'd ' : '') + (h ? h + 'h ' : '') + m + 'm'; };
const AYUDA = ['Comandos:', '  estado               resumen del servidor', '  ejecuciones [slug]   ejecuciones de los loaders', '  soporte              chats de soporte en vivo abiertos', '  ips                  IPs bloqueadas', '  bloquear <ip> [h]    bloquea una IP en los loaders (24 h por defecto)', '  desbloquear <ip>     quita el bloqueo', '  ban <usuario>        banea del hub a un usuario de Roblox', '  unban <usuario>      lo desbanea', '  cache                vacía la memoria de scripts', '  limpiar              limpia la consola'].join('\n');
app.post('/api/admin/consola/cmd', adminOnly, async (req, res) => {
  if (limited('cons:' + ip(req), 60, 60e3)) return res.status(429).json({ error: 'Muy rápido.' });
  const t = clean(req.body && req.body.cmd, 200), [c0, ...a] = t.split(/\s+/), c = (c0 || '').toLowerCase();
  let out = '';
  try {
    if (!c) out = '';
    else if (c === 'ayuda' || c === 'help') out = AYUDA;
    else if (c === 'estado') { const e = await ejResumen(); await svCargada; out = [`Uptime: ${fmtDur(process.uptime())}`, `Node: ${process.version}  |  Memoria: ${Math.round(process.memoryUsage().rss / 1048576)} MB`, `Almacenamiento: ${store.kind}`, `Scripts: ${(await loadIndex()).length}  |  Ejecuciones hoy: ${e.hoy}  |  total: ${e.total}`, `Soporte: ${svDisponible() ? 'disponible' : 'no disponible'}  |  chats abiertos: ${[...SV.values()].filter((x) => x.estado === 'abierto').length}`, `IPs bloqueadas: ${[...segBloq].filter(([, h]) => h > Date.now()).length}`, `Vertix: ${DEEPSEEK_KEY ? 'activo' : 'sin clave'}  |  Discord bot: ${DC_TOKEN ? 'configurado' : 'no configurado'}`].join('\n'); }
    else if (c === 'ejecuciones') { const e = await ejResumen(); const f = a[0] ? e.scripts.filter((s) => s.slug === a[0]) : e.scripts; out = f.length ? f.map((s) => `${s.name.padEnd(28).slice(0, 28)} total ${String(s.total).padStart(6)}  hoy ${String(s.hoy).padStart(4)}  7d ${String(s.sem).padStart(5)}`).join('\n') : 'Sin datos.'; }
    else if (c === 'soporte') { await svCargada; const l = [...SV.values()].filter((x) => x.estado === 'abierto'); out = l.length ? l.map((x) => `${x.id}  ${x.nombre}  (${x.modo})  ${x.msgs.length} msgs`).join('\n') : 'No hay chats abiertos.'; }
    else if (c === 'ips') { const l = [...segBloq].filter(([, h]) => h > Date.now()); out = l.length ? l.map(([x, h]) => `${x}  hasta ${new Date(h - 3 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')}`).join('\n') : 'No hay IPs bloqueadas.'; }
    else if (c === 'bloquear') { const h = Math.min(Math.max(Number(a[1]) || 24, 1), 720); if (!/^[0-9a-fA-F:.]{3,45}$/.test(a[0] || '')) out = 'Uso: bloquear <ip> [horas]'; else { segBloq.set(a[0], Date.now() + h * 3600e3); audit(req, 'consola: bloquear', a[0] + ' ' + h + 'h'); out = `IP ${a[0]} bloqueada ${h} h (en los loaders /s).`; } }
    else if (c === 'desbloquear') { if (!a[0]) out = 'Uso: desbloquear <ip>'; else { segBloq.delete(a[0]); audit(req, 'consola: desbloquear', a[0]); out = `IP ${a[0]} desbloqueada.`; } }
    else if (c === 'ban' || c === 'unban') { if (!/^[A-Za-z0-9_]{3,20}$/.test(a[0] || '')) out = `Uso: ${c} <usuario de Roblox>`; else { const d = await apiAdmin('/admin/ban', { user: a[0], accion: c }); audit(req, 'consola: ' + c, a[0]); out = (d && d.mensaje) || 'Hecho.'; } }
    else if (c === 'cache') { cache.clear(); logoCache.clear(); out = 'Memoria de scripts vaciada.'; }
    else if (c === 'limpiar') { LOGS.length = 0; out = 'Registro limpio.'; }
    else out = `Comando desconocido: ${c}. Escribe ayuda.`;
  } catch (e) { out = 'Error: ' + e.message; }
  res.json({ out });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'No encontrado' }));
app.use((err, req, res, next) => { if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Demasiado grande' }); if (err instanceof SyntaxError) return res.status(400).json({ error: 'JSON inválido' }); console.error(err); res.status(500).json({ error: 'Error interno' }); });

module.exports = app;
app.__dc = { dcMensaje, dcTextoDe };

// ---------- BOT DE DISCORD "Vertix" (opcional): escribe "Vertix ..." en un canal y responde con la misma IA.
// Requiere la variable DISCORD_BOT_TOKEN y activar "Message Content Intent" en discord.com/developers.
const DC_TOKEN = env.DISCORD_BOT_TOKEN || '';
const DC_CANALES = (env.VERTIX_CANALES || '').split(',').map((x) => x.trim()).filter(Boolean);   // opcional: solo en estos canales
const DC_SITIOS = { youtube: (q) => q ? 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q) : 'https://www.youtube.com', google: (q) => q ? 'https://www.google.com/search?q=' + encodeURIComponent(q) : 'https://www.google.com', tiktok: (q) => q ? 'https://www.tiktok.com/search?q=' + encodeURIComponent(q) : 'https://www.tiktok.com', spotify: (q) => q ? 'https://open.spotify.com/search/' + encodeURIComponent(q) : 'https://open.spotify.com', discord: () => DISCORD_INVITE, roblox: () => 'https://www.roblox.com' };
const dcHist = new Map();                                          // userId -> [{role,content}]
const DC_API = (env.DISCORD_API_BASE || 'https://discord.com/api/v10').replace(/\/$/, '');
async function dcApi(metodo, ruta, cuerpo) {
  const r = await fetch(DC_API + ruta, { method: metodo, headers: { Authorization: 'Bot ' + DC_TOKEN, 'Content-Type': 'application/json' }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  if (!r.ok) throw new Error('discord ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 150));
  return r.status === 204 ? null : r.json().catch(() => null);
}
function dcTextoDe(msg, botId) {                                   // devuelve el texto tras "Vertix" o la mención, o null si no le hablan
  const c = String(msg.content || '');
  const mencion = new RegExp('^\\s*<@!?' + botId + '>[\\s,:.!?-]*', 'i').exec(c);
  if (mencion) return c.slice(mencion[0].length).trim();
  const m = /^\s*(?:hey\s+|oye\s+|ey\s+)?vertix\b[\s,:.!?¿¡-]*/i.exec(c);
  return m ? c.slice(m[0].length).trim() : null;
}
async function dcResponder(msg, texto) {
  const uid = String(msg.author.id);
  let imagen = '';
  const adj = (msg.attachments || []).find((a) => /^image\/(png|jpe?g|webp)/i.test(a.content_type || ''));
  if (adj) {
    if (adj.size > 700000) return 'Esa foto es muy pesada. Envíala más chica (menos de 700 KB).';
    try {
      const r = await fetch(adj.url); const buf = Buffer.from(await r.arrayBuffer());
      const tipo = /png/i.test(adj.content_type) ? 'png' : /webp/i.test(adj.content_type) ? 'webp' : 'jpeg';
      imagen = `data:image/${tipo};base64,` + buf.toString('base64');
    } catch { return 'No pude descargar la foto.'; }
  }
  const hist = dcHist.get(uid) || [];
  const req = { headers: {}, body: { mensaje: texto, historial: hist.slice(-8), imagen: imagen || undefined }, _vxKeys: ['d:' + uid] };
  const out = await new Promise((ok) => {
    const res = { code: 200, setHeader() {}, getHeader() {}, status(c) { this.code = c; return this; }, json(o) { ok(Object.assign({ _code: this.code }, o)); } };
    vertixHandler(req, res).catch(() => ok({ error: 'Vertix no pudo responder ahora.' }));
  });
  if (out.error) return out.error;
  let t = String(out.say || '');
  const a = out.action;
  if (a && a.type === 'play' && a.url) t += '\n' + a.url;
  else if (a && a.type === 'open') { const u = a.url || (DC_SITIOS[a.site] && DC_SITIOS[a.site](a.query)); if (u) t += '\n' + u; }
  hist.push({ role: 'user', content: texto }, { role: 'assistant', content: String(out.say || '') }); dcHist.set(uid, hist.slice(-10));
  if (typeof out.restantes === 'number' && out.restantes <= 5) t += `\n(te quedan ${out.restantes} mensajes)`;
  return t;
}
// ---- Comandos de moderación y perfiles (solo admins): Vertix lock / unlock / ban / unban / user <Roblox>
const DC_ADMINS = (env.VERTIX_ADMINS || '').split(',').map((x) => x.trim()).filter(Boolean);
const DC_SEND = (1n << 11n) | (1n << 38n);                         // SEND_MESSAGES | SEND_MESSAGES_IN_THREADS
const dcAyudaRe = /^(comandos|ayuda|help|(dime|dame|muestra|cuales|cuáles|qué|que)\b.{0,25}\bcomandos)\b/i;
const dcCmdRe = /^(lock|bloquear|unlock|desbloquear|ban|banear|unban|desbanear|user|usuario|perfil)\b\s*(.*)$/is;
async function dcEsAdmin(msg) {
  const id = String(msg.author.id);
  if (DC_ADMINS.includes(id)) return true;
  if (!msg.guild_id) return false;
  try { const g = await dcApi('GET', '/guilds/' + msg.guild_id); return g && String(g.owner_id) === id; } catch { return false; }
}
async function dcLock(msg, cerrar) {
  const gid = msg.guild_id, ch = msg.channel_id;
  const c = await dcApi('GET', '/channels/' + ch);
  const ow = (c.permission_overwrites || []).find((o) => String(o.id) === String(gid) && o.type === 0) || { allow: '0', deny: '0' };
  let allow = BigInt(ow.allow || 0), deny = BigInt(ow.deny || 0);
  if (cerrar) { await dcApi('POST', `/channels/${ch}/messages`, { content: '🔒' }).catch(() => {}); deny |= DC_SEND; allow &= ~DC_SEND; }
  else { deny &= ~DC_SEND; }
  await dcApi('PUT', `/channels/${ch}/permissions/${gid}`, { type: 0, allow: allow.toString(), deny: deny.toString() });
  if (!cerrar) await dcApi('POST', `/channels/${ch}/messages`, { content: '🔓' });
}
async function dcObjetivo(msg, arg) {                              // mención, ID o nombre exacto -> {id, name}
  const m = (msg.mentions || []).find((u) => !u.bot);
  if (m) return { id: m.id, name: m.username };
  const id = (String(arg).match(/\d{15,22}/) || [])[0];
  if (id) return { id, name: id };
  const q = String(arg).replace(/^@/, '').trim(); if (!q || !msg.guild_id) return null;
  const l = await dcApi('GET', `/guilds/${msg.guild_id}/members/search?query=${encodeURIComponent(q)}&limit=5`).catch(() => []);
  const ex = (l || []).filter((x) => x.user && [x.user.username, x.user.global_name, x.nick].some((n) => n && n.toLowerCase() === q.toLowerCase()));
  return ex.length === 1 ? { id: ex[0].user.id, name: ex[0].user.username } : null;
}
async function dcBan(msg, botId, arg, desban) {
  const t = await dcObjetivo(msg, arg);
  if (!t) return 'No encontré a ese usuario. Menciónalo o pasa su ID.';
  if (t.id === String(msg.author.id) || t.id === String(botId)) return 'No puedo hacer eso.';
  if (!desban) {
    const g = await dcApi('GET', '/guilds/' + msg.guild_id);
    if (String(g.owner_id) === t.id || DC_ADMINS.includes(t.id)) return 'No puedo banear a ese usuario.';
    await dcApi('PUT', `/guilds/${msg.guild_id}/bans/${t.id}`, { delete_message_seconds: 0 });
  } else await dcApi('DELETE', `/guilds/${msg.guild_id}/bans/${t.id}`);
  console.log(`[discord] ${desban ? 'unban' : 'ban'} ${t.id} por ${msg.author.id} en ${msg.guild_id}`);
  return '👍';
}
async function dcRbx(ruta, base, cuerpo) {
  const r = await fetch(base + ruta, cuerpo ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) } : undefined);
  if (!r.ok) throw new Error('roblox ' + r.status); return r.json();
}
async function dcHubLista(ruta) {                                  // lista de la base del hub (API); null si no se pudo consultar
  try {
    let d = await apiAdmin(ruta);
    if (d && !Array.isArray(d)) d = d.data || d.lista || d.verificados || d.baneados || d.items || d.rows || Object.values(d).find(Array.isArray) || [];
    if (d && d.length && !dcHubLista.v) { dcHubLista.v = 1; console.log('[discord] forma de ' + ruta + ':', Object.keys(d[0] || {}).join(',')); }
    return Array.isArray(d) ? d : null;
  } catch (e) { console.error('[discord] hub ' + ruta + ':', e.message); return null; }
}
function dcEnLista(lista, id, nombre) {
  if (!lista) return null;
  const n = String(nombre).toLowerCase();
  return lista.some((x) => {
    if (typeof x !== 'object' || !x) return String(x) === String(id) || String(x).toLowerCase() === n;
    return ['roblox_id', 'robloxId', 'roblox_user_id', 'user_id', 'userId', 'id'].some((k) => x[k] != null && String(x[k]) === String(id))
      || ['roblox_user', 'nombre', 'roblox_name', 'robloxUser', 'username', 'user', 'name'].some((k) => typeof x[k] === 'string' && x[k].toLowerCase() === n);
  });
}
async function dcPerfil(nombre) {                                  // devuelve {embeds:[...]} o texto de error
  nombre = String(nombre || '').trim().replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{3,20}$/.test(nombre)) return 'Escribe un usuario de Roblox válido. Ejemplo: Vertix user Builderman';
  const U = ROBLOX_USERS, F = (env.ROBLOX_FRIENDS_API || 'https://friends.roblox.com').replace(/\/$/, ''), T = (env.ROBLOX_THUMBS_API || 'https://thumbnails.roblox.com').replace(/\/$/, ''), I = (env.ROBLOX_INV_API || 'https://inventory.roblox.com').replace(/\/$/, '');
  const b = await dcRbx('/v1/usernames/users', U, { usernames: [nombre], excludeBannedUsers: false }).catch(() => null);
  const u0 = b && b.data && b.data[0]; if (!u0) return 'No encontré ese usuario en Roblox.';
  const id = u0.id, ok = (p) => p.catch(() => null);
  const [u, am, se, sg, av, hd, inv, ver, ban] = await Promise.all([
    ok(dcRbx('/v1/users/' + id, U)), ok(dcRbx(`/v1/users/${id}/friends/count`, F)), ok(dcRbx(`/v1/users/${id}/followers/count`, F)), ok(dcRbx(`/v1/users/${id}/followings/count`, F)),
    ok(dcRbx(`/v1/users/avatar?userIds=${id}&size=420x420&format=Png&isCircular=false`, T)), ok(dcRbx(`/v1/users/avatar-headshot?userIds=${id}&size=150x150&format=Png&isCircular=false`, T)),
    ok(dcRbx(`/v1/users/${id}/can-view-inventory`, I)), dcHubLista('/admin/verificados'), dcHubLista('/admin/baneados')]);
  const dato = (x) => x && x.data && x.data[0] && x.data[0].imageUrl;
  const nm = (u && u.name) || u0.name, verif = dcEnLista(ver, id, nm), baneHub = dcEnLista(ban, id, nm);
  const baneado = u && u.isBanned;
  const f = (n) => (n && typeof n.count === 'number') ? n.count.toLocaleString('es') : '-';
  const ts = (iso) => iso ? Math.floor(new Date(iso).getTime() / 1000) : null;
  const k = (x) => '`' + String(x).replace(/`/g, "'") + '`';
  const bio = u && u.description ? String(u.description).replace(/\s+/g, ' ').slice(0, 200) : '';
  const L = [`**Nombre:** ${k((u && u.name) || u0.name)}`, `**Nombre visible:** ${k((u && u.displayName) || u0.name)}`, `**ID:** ${k(id)}`, `**Descripción:** ${k(bio || 'Sin descripción')}`, '',
    `**Verificado:** ${verif === null ? 'No disponible' : verif ? 'Sí' : 'No'}`, `**Baneado del hub:** ${baneHub === null ? 'No disponible' : baneHub ? 'Sí' : 'No'}`, `**Cuenta de Roblox:** ${baneado ? 'Baneada' : 'Activa'}`,
    `**Inventario:** ${inv && typeof inv.canView === 'boolean' ? (inv.canView ? `[Público](https://www.roblox.com/users/${id}/inventory)` : 'Privado') : 'No disponible'}`,
    `**Amigos:** ${f(am)}  |  **Seguidores:** ${f(se)}  |  **Siguiendo:** ${f(sg)}`];
  if (u && u.created) L.push(`**Creada:** <t:${ts(u.created)}:D> (<t:${ts(u.created)}:R>)`);
  const emb = { title: `Información de ${(u && u.name) || u0.name}`, url: 'https://www.roblox.com/users/' + id + '/profile', color: (baneado || baneHub) ? 0xed4245 : verif ? 0x57f287 : 0x5865f2,
    description: L.join('\n'), footer: { text: 'Vertix | Uzivert Hub' } };
  const fa = dato(hd) || dato(av); if (fa) emb.thumbnail = { url: fa };
  return { embeds: [emb] };
}
async function dcComando(msg, botId, cmd, resto) {                 // devuelve true si lo manejó
  const c = cmd.toLowerCase(), esPerfil = /^(user|usuario|perfil)$/.test(c);
  const enviar = (cuerpo) => dcApi('POST', `/channels/${msg.channel_id}/messages`, Object.assign({ allowed_mentions: { parse: [] }, message_reference: { message_id: msg.id, fail_if_not_exists: false } }, typeof cuerpo === 'string' ? { content: cuerpo } : cuerpo));
  try {
    if (esPerfil) { dcApi('POST', `/channels/${msg.channel_id}/typing`).catch(() => {}); await enviar(await dcPerfil(resto)); return true; }
    if (!msg.guild_id) { await enviar('Ese comando solo funciona dentro de un servidor.'); return true; }
    if (!(await dcEsAdmin(msg))) { await enviar('No tienes permiso para eso.'); return true; }
    if (/^(lock|bloquear)$/.test(c)) await dcLock(msg, true);
    else if (/^(unlock|desbloquear)$/.test(c)) await dcLock(msg, false);
    else await enviar(await dcBan(msg, botId, resto, /^(unban|desbanear)$/.test(c)));
  } catch (e) {
    console.error('[discord] comando', c, e.message);
    const perm = /\b(403|50013|50001)\b/.test(e.message);
    await enviar(perm ? 'No tengo permisos para hacer eso. Revisa que mi rol esté por encima y tenga Banear miembros y Gestionar roles/canales.' : 'No pude completarlo.').catch(() => {});
  }
  return true;
}
const DC_AYUDA = { embeds: [{ title: 'Comandos de Vertix', color: 0x5865f2, description:
  'Escribe **Vertix** seguido de lo que necesites.\n\n`Vertix <pregunta>`  Pregúntame lo que quieras sobre Uzivert Hub o lo que sea.\n`Vertix user <usuario Roblox>`  Muestra el perfil: verificación en la página, inventario, amigos y más.\n`Vertix comandos`  Muestra esta lista.\n\n**Solo admins**\n`Vertix lock`  Bloquea el canal.\n`Vertix unlock`  Lo desbloquea.\n`Vertix ban <@usuario o ID>`  Banea del servidor.\n`Vertix unban <ID>`  Quita el baneo.', footer: { text: 'Vertix | Uzivert Hub' } }] };
async function dcMensaje(msg, botId) {
  if (!msg || !msg.author || msg.author.bot || !msg.content && !(msg.attachments || []).length) return;
  if (DC_CANALES.length && !DC_CANALES.includes(String(msg.channel_id))) return;
  const texto = dcTextoDe(msg, botId);
  if (texto === null) return;
  if (dcAyudaRe.test(texto.trim()) && !(msg.attachments || []).length) { await dcApi('POST', `/channels/${msg.channel_id}/messages`, Object.assign({ allowed_mentions: { parse: [] }, message_reference: { message_id: msg.id, fail_if_not_exists: false } }, DC_AYUDA)); return; }
  const mc = dcCmdRe.exec(texto.trim());
  if (mc && !(msg.attachments || []).length && await dcComando(msg, botId, mc[1], mc[2].trim())) return;
  const dm = !msg.guild_id;
  let resp;
  if (!texto && !(msg.attachments || []).length) resp = 'Dime qué necesitas. Ejemplo: Vertix qué es Uzivert Hub';
  else { dcApi('POST', `/channels/${msg.channel_id}/typing`).catch(() => {}); resp = await dcResponder(msg, texto || 'Describe esta imagen y dime qué ves.'); }
  resp = String(resp || '').trim() || 'No te entendí.';
  const trozos = []; while (resp.length > 1900) { let c = resp.lastIndexOf('\n', 1900); if (c < 800) c = 1900; trozos.push(resp.slice(0, c)); resp = resp.slice(c).trimStart(); } trozos.push(resp);
  for (let i = 0; i < Math.min(trozos.length, 4); i++) await dcApi('POST', `/channels/${msg.channel_id}/messages`, Object.assign({ content: trozos[i], allowed_mentions: { parse: [] } }, i === 0 && !dm ? { message_reference: { message_id: msg.id, fail_if_not_exists: false } } : {}));
}
function dcIniciar() {
  if (!DC_TOKEN) return;
  if (typeof WebSocket !== 'function') { console.error('[bot] Este Node no tiene WebSocket (usa Node 22 o más nuevo).'); return; }
  let ws, seq = null, sesion = '', urlRes = '', hb = null, botId = '', vivo = true, reintentos = 0;
  const conectar = (resumir) => {
    try { ws = new WebSocket((resumir && urlRes) || 'wss://gateway.discord.gg/?v=10&encoding=json'); } catch (e) { console.error('[bot] ws:', e.message); return setTimeout(() => conectar(false), 15000); }
    const enviar = (o) => { try { ws.send(JSON.stringify(o)); } catch {} };
    ws.onmessage = (ev) => {
      let p; try { p = JSON.parse(ev.data); } catch { return; }
      if (p.s != null) seq = p.s;
      if (p.op === 10) {
        vivo = true; clearInterval(hb);
        hb = setInterval(() => { if (!vivo) { try { ws.close(4000); } catch {} return; } vivo = false; enviar({ op: 1, d: seq }); }, p.d.heartbeat_interval);
        if (resumir && sesion) enviar({ op: 6, d: { token: DC_TOKEN, session_id: sesion, seq } });
        else enviar({ op: 2, d: { token: DC_TOKEN, intents: (1 << 0) | (1 << 9) | (1 << 12) | (1 << 15), properties: { os: 'linux', browser: 'uzivert', device: 'uzivert' }, presence: { status: 'online', activities: [{ name: 'Vertix | Uzivert Hub', type: 0 }], afk: false } } });
      } else if (p.op === 11) { vivo = true; }
      else if (p.op === 1) { enviar({ op: 1, d: seq }); }
      else if (p.op === 7) { try { ws.close(4000); } catch {} }
      else if (p.op === 9) { sesion = ''; seq = null; setTimeout(() => { try { ws.close(4000); } catch {} }, 2000); }
      else if (p.op === 0) {
        if (p.t === 'READY') { sesion = p.d.session_id; urlRes = p.d.resume_gateway_url ? p.d.resume_gateway_url + '/?v=10&encoding=json' : ''; botId = p.d.user.id; reintentos = 0; console.log('[bot] Vertix conectado como', p.d.user.username); }
        else if (p.t === 'MESSAGE_CREATE') dcMensaje(p.d, botId).catch((e) => console.error('[bot] mensaje:', e.message));
      }
    };
    ws.onclose = (ev) => {
      clearInterval(hb);
      if ([4004, 4010, 4011, 4012, 4013, 4014].includes(ev.code)) { console.error('[bot] Discord rechazó la conexión (código ' + ev.code + '). Revisa el token y los intents.'); return; }
      reintentos++; setTimeout(() => conectar(!!sesion && ev.code !== 4007 && ev.code !== 4009), Math.min(30000, 2000 * reintentos));
    };
    ws.onerror = () => {};
  };
  conectar(false);
}
if (require.main === module) { app.listen(PORT, () => console.log(`${SITE_NAME} web en puerto ${PORT}`)); dcIniciar(); }
