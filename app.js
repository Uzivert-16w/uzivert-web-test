'use strict';
const $ = (id) => document.getElementById(id);
let me = { verificado: false, staff: false, id: null };
let cat = null, abierto = null;
const txt = (tag, text, cls) => { const e = document.createElement(tag); e.textContent = text; if (cls) e.className = cls; return e; };
const fdate = (iso) => new Date(iso).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' });
// --- menu lateral ---
function openMenu() { $('drawer').classList.add('on'); $('overlay').classList.add('on'); $('drawer').setAttribute('aria-hidden', 'false'); $('menu-btn').setAttribute('aria-expanded', 'true'); }
function closeMenu() { $('drawer').classList.remove('on'); $('overlay').classList.remove('on'); $('drawer').setAttribute('aria-hidden', 'true'); $('menu-btn').setAttribute('aria-expanded', 'false'); }
$('menu-btn').addEventListener('click', openMenu);
$('menu-close').addEventListener('click', closeMenu);
$('overlay').addEventListener('click', closeMenu);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
$('brand').addEventListener('click', () => go('inicio'));
// --- navegacion ---
// Logo de Discord en los botones .dcbtn
document.querySelectorAll('.dcbtn').forEach((b) => b.insertAdjacentHTML('afterbegin', '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189z"/></svg>'));
// Indicador deslizante de la pestaña activa
function movePill() {
  const on = document.querySelector('#nav a.on'), pill = $('pill'); if (!pill) return; if (!on) { pill.style.opacity = 0; return; }
  pill.style.width = on.offsetWidth + 'px'; pill.style.transform = 'translateX(' + on.offsetLeft + 'px)'; pill.style.opacity = 1;
}
addEventListener('resize', movePill); addEventListener('load', movePill);
// Video tutorial: se crea y reproduce al tocar el botón
$('vid-btn').addEventListener('click', () => {
  const box = $('vid-box'), btn = $('vid-btn');
  if (!box.classList.contains('hide')) { const v = box.querySelector('video'); if (v) v.pause(); box.classList.add('hide'); btn.lastChild.textContent = 'Ver video tutorial'; return; }
  if (!box.firstChild) {
    const v = document.createElement('video'); v.src = '/tutorial.mp4'; v.controls = true; v.playsInline = true; v.preload = 'metadata'; v.className = 'tuto';
    v.onerror = () => { box.textContent = ''; box.append(txt('p', 'El video todavía no está disponible.', 'nota')); };
    box.append(v);
  }
  box.classList.remove('hide'); btn.lastChild.textContent = 'Ocultar video';
  const v = box.querySelector('video'); if (v) { const pr = v.play(); if (pr && pr.catch) pr.catch(() => {}); }
});
// Página de Updates (los que publicas desde el panel)
async function cargarUpdates() {
  const box = $('up-box');
  try {
    const d = await api('/api/updates'); box.textContent = '';
    if (!d.length) { box.append(txt('p', 'Todavía no hay actualizaciones publicadas.', 'nota')); return; }
    d.forEach((u) => {
      const c = document.createElement('div'); c.className = 'card up';
      const top = document.createElement('div'); top.className = 'up-top';
      top.append(txt('h3', u.titulo)); if (u.version) top.append(txt('span', 'v' + String(u.version).replace(/^v/i, ''), 'badge'));
      c.append(top);
      if (u.fecha) c.append(txt('small', fdate(u.fecha), 'up-fecha'));
      c.append(txt('p', u.descripcion, 'up-desc'));
      box.append(c);
    });
  } catch { box.textContent = ''; box.append(txt('p', 'No se pudieron cargar las actualizaciones.', 'nota')); }
}
// Página de Estado
let estadoTimer = null;
const SIT = { ok: ['ok', 'Funcionando'], mant: ['mant', 'En mantenimiento'], caido: ['bad', 'No funciona'] };
function filaEstado(nombre, sub, cls, texto) {
  const r = document.createElement('div'); r.className = 'es-row';
  const l = document.createElement('div'); l.className = 'es-l'; l.append(txt('b', nombre)); if (sub) l.append(txt('span', sub));
  const e = document.createElement('div'); e.className = 'es-r'; e.append(txt('i', '', 'dot ' + cls), txt('span', texto));
  r.append(l, e); return r;
}
async function cargarEstado() {
  try {
    const d = await api('/api/estado');
    const box = $('es-box'); box.textContent = '';
    const todo = d.web.ok && d.api.ok && d.scripts.every((s) => s.situacion === 'ok');
    const top = document.createElement('div'); top.className = 'card es-top ' + (todo ? 'ok' : 'warn');
    top.append(txt('h3', todo ? 'Todo funciona con normalidad' : 'Hay servicios con problemas')); box.append(top);
    const c1 = document.createElement('div'); c1.className = 'card'; c1.append(txt('h4', 'Servicios'));
    c1.append(filaEstado('Página web', '', 'ok', 'Funcionando'));
    c1.append(filaEstado('API de verificación', d.api.ok && d.api.ms != null ? d.api.ms + ' ms' : '', d.api.ok ? 'ok' : 'bad', d.api.ok ? 'Funcionando' : 'No responde'));
    box.append(c1);
    const c2 = document.createElement('div'); c2.className = 'card'; c2.append(txt('h4', 'Scripts'));
    if (!d.scripts.length) c2.append(txt('p', 'Todavía no hay scripts publicados.', 'nota'));
    d.scripts.forEach((s) => { const x = SIT[s.situacion] || SIT.ok; c2.append(filaEstado(s.name, [s.game, s.version].filter(Boolean).join(' | '), x[0], x[1])); });
    box.append(c2);
    $('es-hora').textContent = 'Última comprobación: ' + fdate(d.chequeado) + '. Se actualiza sola cada minuto.';
  } catch (e) { $('es-box').textContent = ''; $('es-box').append(txt('p', 'No se pudo cargar el estado. Intenta de nuevo en un momento.', 'nota')); }
}
function go(p) {
  document.querySelectorAll('.page').forEach((s) => s.classList.toggle('on', s.id === 'p-' + p));
  document.querySelectorAll('#nav a[data-p]').forEach((a) => a.classList.toggle('on', a.dataset.p === p));
  if (estadoTimer) { clearInterval(estadoTimer); estadoTimer = null; }
  if (p === 'updates') cargarUpdates();
  if (p === 'estado') { cargarEstado(); estadoTimer = setInterval(cargarEstado, 60000); }
  movePill();
  if (location.hash !== '#' + p) history.replaceState(null, '', '#' + p);
  scrollTo(0, 0);
  if (p === 'scripts') loadScripts();
  if (p === 'foro') showList();
  if (p === 'vertix') vxInit();
}
document.querySelectorAll('[data-p]').forEach((a) => a.addEventListener('click', () => { closeMenu(); go(a.dataset.p); }));
document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
const start = location.hash.slice(1);
if (['inicio', 'verificar', 'soporte', 'scripts', 'foro', 'creador', 'creditos', 'terminos', 'estado', 'faq', 'updates', 'vertix'].includes(start)) go(start);
api('/api/config').then((c) => { $('dc').href = c.discord; $('dc2').href = c.discord; if (c.version) { $('ver').textContent = c.version; $('ver2').textContent = c.version; } }).catch(() => {});
$('year').textContent = new Date().getFullYear();

// --- soporte ---
$('s-msg').addEventListener('input', () => { $('s-count').textContent = $('s-msg').value.length + '/1500'; });
$('s-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const b = $('s-send'); b.disabled = true;
  try {
    await api('/api/soporte', { method: 'POST', body: { asunto: $('s-asunto').value, contacto: $('s-contacto').value, mensaje: $('s-msg').value, web: $('s-web').value } });
    show($('s-res'), 'Mensaje enviado. Te responderemos lo antes posible.', true);
    $('s-msg').value = ''; $('s-count').textContent = '0/1500';
  } catch (err) { show($('s-res'), err.message, false); }
  b.disabled = false;
});

// --- verificacion ---
let token = null;
const vmsg = $('v-msg');
async function loadMe() {
  try {
    const me = await api('/api/yo');
    if (me.verificado) {
      $('v-ok').style.display = 'block'; $('v-s1').classList.add('hide'); $('v-name').textContent = me.usuario;
      const s = await api('/api/mi-script'); $('v-ls').textContent = s.loadstring;
    }
  } catch {}
}
loadMe();
$('v-start').addEventListener('click', async () => {
  const b = $('v-start'); b.disabled = true; vmsg.className = 'msg';
  try {
    const d = await api('/api/verificar/iniciar', { method: 'POST', body: { usuario: $('v-user').value.trim() } });
    token = d.token; $('v-code').textContent = d.code;
    $('v-s1').classList.add('hide'); $('v-s2').classList.remove('hide');
    show(vmsg, `Código para ${d.usuario}. Vale por ${d.minutos} minutos.`, true);
  } catch (e) { show(vmsg, e.message, false); }
  b.disabled = false;
});
$('v-check').addEventListener('click', async () => {
  const b = $('v-check'); b.disabled = true;
  try {
    await api('/api/verificar/confirmar', { method: 'POST', body: { token } });
    $('v-s2').classList.add('hide'); vmsg.className = 'msg';
    await loadMe(); show(vmsg, 'Cuenta verificada correctamente.', true);
  } catch (e) { show(vmsg, e.message, false); }
  b.disabled = false;
});
$('v-cancel').addEventListener('click', () => { token = null; $('v-s2').classList.add('hide'); $('v-s1').classList.remove('hide'); vmsg.className = 'msg'; });
$('v-copy').addEventListener('click', (e) => copyText($('v-ls').textContent, e.target));
$('v-out').addEventListener('click', async () => { await api('/api/salir', { method: 'POST', body: {} }); location.reload(); });


// --- sesion ---
async function refreshMe() { try { me = await api('/api/yo'); } catch {} }

// --- scripts ---
async function loadScripts() {
  try {
    const d = await api('/api/scripts');
    const box = $('sc-list'); box.textContent = '';
    $('sc-empty').classList.toggle('hide', d.scripts.length > 0);
    if (!d.verificado && d.scripts.some((x) => !x.libre)) { show($('sc-lock'), 'Verifica tu cuenta para poder copiar los scripts.', false); const b = txt('button', 'Ir a verificar'); b.style.marginLeft = '10px'; b.onclick = () => go('verificar'); $('sc-lock').append(b); } else $('sc-lock').className = 'msg';
    d.scripts.forEach((s) => {
      const card = document.createElement('div'); card.className = 'card';
      const top = document.createElement('div'); top.className = 'sc';
      const tile = txt('div', (s.name || '?').trim().charAt(0).toUpperCase(), 'logo tile'); top.append(tile);
      if (s.logo) { const im = document.createElement('img'); im.className = 'logo'; im.alt = ''; im.onload = () => tile.replaceWith(im); im.src = '/logo/' + encodeURIComponent(s.slug) + '?v=' + encodeURIComponent(s.updatedAt || ''); }
      const info = document.createElement('div'); info.className = 'inf';
      info.append(txt('h3', s.name));
      if (s.libre) info.append(txt('span', 'Sin verificación', 'badge'));
      const sit = SIT[s.situacion] || SIT.ok; const st = document.createElement('div'); st.className = 'st ' + sit[0]; st.append(txt('i', '', 'dot ' + sit[0]), txt('span', sit[1])); info.append(st);
      const meta = [s.game, s.version, 'Actualizado ' + fdate(s.updatedAt)].filter(Boolean).join('  |  ');
      info.append(txt('div', meta, 'meta'));
      if (s.description) info.append(txt('p', s.description));
      const b = txt('button', s.loadstring ? 'Copiar script' : 'Bloqueado'); b.className = 'cp'; b.disabled = !s.loadstring;
      if (s.loadstring) b.onclick = () => copyText(s.loadstring, b);
      top.append(info, b); card.append(top); box.append(card);
    });
  } catch (e) { show($('sc-lock'), e.message, false); }
}

// --- foro ---
function showList() { $('f-lista').classList.remove('hide'); $('f-hilo').classList.add('hide'); abierto = null; loadTemas(); }
async function loadTemas() {
  await refreshMe();
  try {
    const d = await api('/api/foro' + (cat ? '?cat=' + encodeURIComponent(cat) : ''));
    const chips = $('f-cats'); chips.textContent = '';
    ['Todos', ...d.categorias].forEach((c) => { const e = txt('span', c, 'chip' + ((c === 'Todos' && !cat) || c === cat ? ' on' : '')); e.onclick = () => { cat = c === 'Todos' ? null : c; loadTemas(); }; chips.append(e); });
    const sel = $('f-cat'); if (!sel.children.length) d.categorias.forEach((c) => { const o = document.createElement('option'); o.textContent = c; sel.append(o); });
    const box = $('f-temas'); box.textContent = '';
    $('f-vacio').classList.toggle('hide', d.temas.length > 0);
    d.temas.forEach((t) => {
      const b = document.createElement('button'); b.className = 'tema';
      const l1 = document.createElement('b'); if (t.fijado) l1.append(txt('span', 'Fijado', 'badge pin')); l1.append(document.createTextNode(t.titulo));
      const l2 = document.createElement('div'); l2.className = 'meta';
      l2.append(txt('span', t.categoria, 'badge')); if (t.autor.staff) l2.append(txt('span', 'Staff', 'badge staff'));
      l2.append(document.createTextNode(`${t.autor.name}  |  ${t.respuestas} respuesta(s)  |  ${fdate(t.ultima)}${t.cerrado ? '  |  Cerrado' : ''}`));
      b.append(l1, l2); b.onclick = () => openTema(t.id); box.append(b);
    });
  } catch (e) { show($('f-msg'), e.message, false); }
}
$('f-nuevo').onclick = () => { if (!me.verificado && !me.staff) { go('verificar'); return; } $('f-form').classList.toggle('hide'); };
$('f-cancel').onclick = () => $('f-form').classList.add('hide');
$('f-form').addEventListener('submit', async (e) => {
  e.preventDefault(); const b = $('f-pub'); b.disabled = true;
  try { const r = await api('/api/foro', { method: 'POST', body: { categoria: $('f-cat').value, titulo: $('f-tit').value, texto: $('f-txt').value } }); $('f-tit').value = ''; $('f-txt').value = ''; $('f-form').classList.add('hide'); $('f-msg').className = 'msg'; openTema(r.id); }
  catch (err) { show($('f-msg'), err.message, false); }
  b.disabled = false;
});
function acciones(parent, texto, fn, cls) { const b = txt('button', texto, 'ghost mini ' + (cls || '')); b.style.marginLeft = '6px'; b.onclick = fn; parent.append(b); }
function autorLinea(a, fecha) { const d = document.createElement('div'); d.className = 'meta'; if (a.staff) d.append(txt('span', 'Staff', 'badge staff')); d.append(document.createTextNode(`${a.name}  |  ${fdate(fecha)}`)); return d; }
async function openTema(id) {
  abierto = id; await refreshMe();
  try {
    const t = await api('/api/foro/' + id);
    $('f-lista').classList.add('hide'); $('f-hilo').classList.remove('hide');
    const op = $('f-op'); op.textContent = '';
    const h = document.createElement('h3'); if (t.fijado) h.append(txt('span', 'Fijado', 'badge pin')); h.append(document.createTextNode(t.titulo)); op.append(h);
    const m = autorLinea(t.autor, t.fecha); m.prepend(txt('span', t.categoria, 'badge')); op.append(m, txt('div', t.texto, 'post'));
    const bar = document.createElement('div'); bar.className = 'row'; bar.style.marginTop = '10px';
    if (t.autor.mio || me.staff) acciones(bar, 'Borrar tema', async () => { if (!confirm('Borrar este tema?')) return; await api('/api/foro/' + id, { method: 'DELETE', body: {} }); showList(); }, 'danger');
    if (me.staff) {
      acciones(bar, t.fijado ? 'Quitar fijado' : 'Fijar', async () => { await api(`/api/admin/foro/${id}/fijar`, { method: 'POST', body: { valor: !t.fijado } }); openTema(id); });
      acciones(bar, t.cerrado ? 'Abrir' : 'Cerrar', async () => { await api(`/api/admin/foro/${id}/cerrar`, { method: 'POST', body: { valor: !t.cerrado } }); openTema(id); });
      if (t.autor.id > 0) acciones(bar, 'Banear autor', async () => { if (confirm('Banear a ' + t.autor.name + ' del foro?')) { await api('/api/admin/foro/baneo', { method: 'POST', body: { id: t.autor.id, valor: true } }); alert('Autor baneado.'); } }, 'danger');
    }
    if (bar.children.length) op.append(bar);
    const box = $('f-resp'); box.textContent = '';
    t.mensajes.forEach((r) => {
      const c = document.createElement('div'); c.className = 'card';
      c.append(autorLinea(r.autor, r.fecha), txt('div', r.texto, 'post'));
      if (r.autor.mio || me.staff) { const bb = document.createElement('div'); acciones(bb, 'Borrar', async () => { await api(`/api/foro/${id}/r/${r.id}`, { method: 'DELETE', body: {} }); openTema(id); }, 'danger'); c.append(bb); }
      box.append(c);
    });
    $('f-rform').classList.toggle('hide', t.cerrado);
    if (t.cerrado) box.append(txt('p', 'Este tema está cerrado.', 'nota'));
    $('f-rmsg').className = 'msg';
  } catch (e) { alert(e.message); showList(); }
}
$('f-volver').onclick = showList;
$('f-rform').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!me.verificado && !me.staff) { go('verificar'); return; }
  const b = $('f-rpub'); b.disabled = true;
  try { await api(`/api/foro/${abierto}/responder`, { method: 'POST', body: { texto: $('f-rtxt').value } }); $('f-rtxt').value = ''; openTema(abierto); }
  catch (err) { show($('f-rmsg'), err.message, false); }
  b.disabled = false;
});
movePill();
// Entrada escalonada de las tarjetas

// --- Vertix (asistente de voz) ---
const VX_URLS = {
  youtube: (q) => q ? 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q) : 'https://www.youtube.com',
  google: (q) => q ? 'https://www.google.com/search?q=' + encodeURIComponent(q) : 'https://www.google.com',
  tiktok: (q) => q ? 'https://www.tiktok.com/search?q=' + encodeURIComponent(q) : 'https://www.tiktok.com',
  discord: () => 'https://discord.gg/vHhERWcbXe',
  spotify: (q) => q ? 'https://open.spotify.com/search/' + encodeURIComponent(q) : 'https://open.spotify.com',
  roblox: () => 'https://www.roblox.com',
};
const VX_NOMBRES = { youtube: 'YouTube', google: 'Google', tiktok: 'TikTok', discord: 'Discord', spotify: 'Spotify', roblox: 'Roblox' };
let vxHist = [], vxListo = false, vxRec = null, vxEscuchando = false, vxOcupado = false;
function vxMsg(quien, texto) {
  const d = document.createElement('div'); d.className = 'vx-m ' + quien; d.textContent = texto;
  $('vx-log').appendChild(d); $('vx-log').scrollTop = 1e9; return d;
}
function vxHablar(t) {
  if (!$('vx-voz').checked || !('speechSynthesis' in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(t); u.lang = 'es-ES';
    const v = speechSynthesis.getVoices().find((x) => /^es/i.test(x.lang)); if (v) u.voice = v;
    speechSynthesis.speak(u);
  } catch {}
}
async function vxEnviar(texto) {
  texto = String(texto || '').trim(); if (!texto || vxOcupado) return;
  texto = texto.replace(/^\s*(hey\s+|oye\s+)?vertix[\s,:.]*/i, '') || texto;
  vxOcupado = true; $('vx-res').textContent = '';
  vxMsg('u', texto); const esp = vxMsg('a', '...');
  try {
    const d = await api('/api/vertix', { method: 'POST', body: { mensaje: texto, historial: vxHist } });
    esp.textContent = d.say;
    vxHist.push({ role: 'user', content: texto }, { role: 'assistant', content: d.say }); vxHist = vxHist.slice(-12);
    vxHablar(d.say);
    const a = d.action;
    if (a && a.type === 'go') { setTimeout(() => go(a.page), 900); }
    else if (a && a.type === 'open' && (a.url || VX_URLS[a.site])) {
      const url = a.url || VX_URLS[a.site](a.query);
      let nom = VX_NOMBRES[a.site]; if (!nom) { try { nom = new URL(url).hostname.replace(/^www\./, ''); } catch { nom = 'enlace'; } }
      const l = document.createElement('a'); l.className = 'btn'; l.href = url; l.target = '_blank'; l.rel = 'noopener'; l.textContent = 'Abrir ' + nom;
      esp.appendChild(document.createElement('br')); esp.appendChild(l);
      try { window.open(url, '_blank', 'noopener'); } catch {}
    }
  } catch (e) { esp.textContent = e.message; if (e.status === 429) { vxHablar('Espera unos minutos para volver a usarme.'); } }
  vxOcupado = false; $('vx-log').scrollTop = 1e9;
}
function vxInit() {
  if (vxListo) return; vxListo = true;
  api('/api/vertix/estado').then((d) => { $('vx-info').textContent = !d.activo ? 'No disponible por ahora' : d.ilimitado ? 'Sin límite de mensajes (admin)' : 'Límite: 10 mensajes por minuto'; }).catch(() => {});
  vxMsg('a', 'Hola, soy Vertix. ¿En qué te ayudo?');
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { $('vx-mic').disabled = true; $('vx-mic').textContent = 'Sin micrófono'; $('vx-res').textContent = 'Tu navegador no soporta voz. Usa Chrome, o escribe tu mensaje.'; $('vx-res').className = 'msg err'; }
  else {
    vxRec = new SR(); vxRec.lang = 'es-419'; vxRec.interimResults = true; vxRec.continuous = false; vxRec.maxAlternatives = 1;
    let vxFinal = '', vxParcial = '';
    vxRec.onstart = () => { vxFinal = ''; vxParcial = ''; $('vx-in').value = ''; };
    vxRec.onresult = (ev) => {
      let fin = '', par = '';
      for (let i = 0; i < ev.results.length; i++) { const r = ev.results[i]; if (r.isFinal) fin += r[0].transcript; else par += r[0].transcript; }
      vxFinal = fin; vxParcial = par; $('vx-in').value = (fin + ' ' + par).trim();
    };
    vxRec.onend = () => {
      vxEscuchando = false; $('vx-mic').classList.remove('on'); $('vx-mic').textContent = 'Hablar';
      const t = (vxFinal || vxParcial).trim(); $('vx-in').value = '';
      if (t) vxEnviar(t);
    };
    vxRec.onerror = (ev) => { if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') { $('vx-res').textContent = 'Permite el micrófono en el navegador para hablar con Vertix.'; $('vx-res').className = 'msg err'; } };
    $('vx-mic').addEventListener('click', () => {
      if (vxEscuchando) { try { vxRec.stop(); } catch {} return; }
      try { speechSynthesis.cancel(); vxRec.start(); vxEscuchando = true; $('vx-mic').classList.add('on'); $('vx-mic').textContent = 'Escuchando...'; } catch {}
    });
  }
  $('vx-send').addEventListener('click', () => { const t = $('vx-in').value; $('vx-in').value = ''; vxEnviar(t); });
  $('vx-in').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('vx-send').click(); } });
}
