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
- Uzivert es el creador de Uzivert Hub, un hub de scripts para Roblox (es creador de exploits), desde Paraguay.
- Juegos con script: Murder Mystery 2 (MM2), Murder Mystery V (MMV), Duelos Latam, Distrito de Violencia, Prison Life (la sección de armas está en mantenimiento) y un script Universal.
- Hay un servidor de Discord oficial, un bot, una API y esta página web (uzivert-web.onrender.com).
- La página tiene: Inicio, Verificar (se verifica la cuenta de Roblox poniendo un código en la descripción del perfil), Scripts, Foro, Updates, Estado del servicio, Preguntas frecuentes, Soporte, Creador, Créditos y Términos.

SCRIPTS: nunca inventes loadstrings ni enlaces de scripts. Los scripts de Uzivert Hub los entrega el sistema solo para Duelos y Universal; el loader del hub completo (MM2, MMV, Prison Life, Distrito) exige verificar la cuenta en la página (sección Verificar) y tú no lo entregas.

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
function vxParse(c) {
  let o = null;
  try { o = JSON.parse(c); } catch { const m = /\{[\s\S]*\}/.exec(c); if (m) { try { o = JSON.parse(m[0]); } catch {} } }
  if (!o || typeof o !== 'object') o = { say: String(c).replace(/^```(?:json)?|```$/g, '').trim().slice(0, 3000), action: null };
  // Si el modelo puso el contenido largo en otro campo (story, content, texto...), lo une al mensaje
  const extra = Object.keys(o).filter((k) => k !== 'say' && k !== 'action' && typeof o[k] === 'string' && o[k].trim().length > 0).map((k) => o[k].trim());
  const otros = Object.keys(o).filter((k) => k !== 'say' && k !== 'action' && o[k] && typeof o[k] === 'object').map((k) => JSON.stringify(o[k]).length > 20 ? (Array.isArray(o[k]) ? o[k].map((x) => (typeof x === 'string' ? x : Object.values(x || {}).join('\n'))).join('\n\n') : Object.values(o[k]).join('\n')) : '');
  const resto = extra.concat(otros).filter(Boolean).join('\n\n');
  if (resto) o.say = (String(o.say || '') + '\n\n' + resto).trim();
  return o;
}
vxModelosInit();
app.get('/api/vertix/estado', async (req, res) => { noStore(res); await vxCargada; res.json(Object.assign({ activo: !!DEEPSEEK_KEY, modelos: VX_MODELOS.map((m) => ({ id: m.id, nombre: m.nombre, desc: m.mant ? 'En mantenimiento' : m.desc, mant: m.mant, bloqueado: m.mant && !isAdmin(req) })) }, vxCuotaInfo(req, res))); });

// Loaders que Vertix puede entregar (solo Duelos y Universal). El del hub completo exige verificación y NO se entrega.
const VX_LOADERS = {
  duelos: env.VX_LOADER_DUELOS || 'loadstring(game:HttpGet("https://duelos-api.vercel.app/loader"))()',
  universal: env.VX_LOADER_UNIVERSAL || 'loadstring(game:HttpGet("https://uzivert-universal-api.vercel.app/loader"))()',
};
function vxScripts(t, dc) {                                            // devuelve {say, action} si piden un script/loader, o null
  const q = String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const L = (x) => '`' + x + '`';                                  // siempre entre comillas invertidas (código en línea)
  const pide = /\b(script|scripts|loader|loadstring|cargador)\b/.test(q);
  const duelos = /\b(duelos?|duels?|latam)\b/.test(q), uni = /\buniversal\b/.test(q);
  const otro = /\b(mm2|mmv|murder|prison|distrito|violencia|hub completo|5 juegos|cinco juegos|todos)\b/.test(q);
  const verbo = /\b(dame|dar|dan|da|pasa|pasame|pasar|mand[ae]|manda|quiero|necesito|tienes|tienen|donde|como consigo|como obtengo|link|enlace|cual)\b/.test(q);
  if (!pide || !(duelos || uni || otro || verbo)) return null;
  if (duelos && uni) return { say: 'Estos son los loaders que puedo darte.\nDuelos Latam:\n' + L(VX_LOADERS.duelos) + '\nUniversal:\n' + L(VX_LOADERS.universal), action: null };
  if (duelos && !otro) return { say: 'Aquí tienes el loader de Duelos Latam. Cópialo y pégalo en tu ejecutor dentro del juego:\n' + L(VX_LOADERS.duelos), action: null };
  if (uni && !otro) return { say: 'Aquí tienes el loader Universal. Cópialo y pégalo en tu ejecutor dentro del juego:\n' + L(VX_LOADERS.universal), action: null };
  return { say: 'Yo solo puedo darte los loaders de Duelos Latam y del Universal. Pídeme uno diciendo, por ejemplo, "script de duelos" o "script universal". Los demás juegos (MM2, MMV, Prison Life y Distrito) van en el hub completo, que se consigue verificando tu cuenta en la sección Verificar de la página.', action: { type: 'go', page: 'verificar' } };
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
  if (!imagen) { const sc = vxScripts(texto, !!req._vxKeys); if (sc) { vxDevolver(req); const ci = vxCuotaInfo(req); return res.json({ say: sc.say, action: sc.action, buscado: false, restantes: ci.restantes, espera: ci.espera }); } }
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
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, async () => { await flushForo(); await vxGuardar(); process.exit(0); });

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
async function dcApi(metodo, ruta, cuerpo) {
  const r = await fetch('https://discord.com/api/v10' + ruta, { method: metodo, headers: { Authorization: 'Bot ' + DC_TOKEN, 'Content-Type': 'application/json' }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
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
async function dcMensaje(msg, botId) {
  if (!msg || !msg.author || msg.author.bot || !msg.content && !(msg.attachments || []).length) return;
  if (DC_CANALES.length && !DC_CANALES.includes(String(msg.channel_id))) return;
  const texto = dcTextoDe(msg, botId);
  if (texto === null) return;
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
