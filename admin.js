'use strict';
const $ = (id) => document.getElementById(id);
let editing = null;
let known = [];
const base = location.origin;
function lsFor(slug) { return `loadstring(game:HttpGet("${base}/s/${slug}"))()`; }

async function boot() {
  try { const me = await api('/api/admin/yo'); $('login').classList.add('hide'); $('panel').classList.remove('hide'); $('out').classList.remove('hide'); $('stor').textContent = me.almacenamiento === 'github' ? 'Guardado permanente en GitHub.' : 'Guardado en disco local: en Render gratis se pierde al reiniciar. Configura GITHUB_TOKEN para guardado permanente.'; refresh(); verif(); if (window.__adminIr) window.__adminIr(window.__adminTab() || 'resumen'); }
  catch { $('login').classList.remove('hide'); $('panel').classList.add('hide'); }
}
async function login() {
  try { await api('/api/admin/login', { method: 'POST', body: { clave: $('key').value } }); $('key').value = ''; boot(); }
  catch (e) { show($('lm'), e.message, false); }
}
$('go').addEventListener('click', login);
$('key').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
$('out').addEventListener('click', async () => { await api('/api/admin/logout', { method: 'POST', body: {} }); location.reload(); });

function td(text) { const t = document.createElement('td'); t.textContent = text || '-'; return t; }
async function refresh() {
  const list = await api('/api/admin/scripts'); known = list.map((s) => s.slug);
  const body = $('rows'); body.textContent = '';
  const vis = list.filter((s) => !s.interno);   // los scripts que ejecutan los loaders (Boveda > Scripts) no se listan aca
  $('empty').classList.toggle('hide', vis.length > 0);
  vis.forEach((s) => {
    const tr = document.createElement('tr');
    tr.append(td(s.name), td(s.game), td(s.version));
    const st = document.createElement('td'); const tag = document.createElement('span'); tag.className = 'tag' + (s.estado === 'activo' ? '' : ' off'); tag.textContent = s.estado; st.append(tag); tr.append(st);
    const ac = document.createElement('td');
    const b1 = document.createElement('button'); b1.className = 'ghost'; b1.textContent = 'Editar'; b1.onclick = () => openEd(s.slug);
    const b2 = document.createElement('button'); b2.className = 'danger'; b2.textContent = 'Borrar'; b2.style.marginLeft = '6px'; b2.onclick = () => del(s);
    ac.append(b1, b2); tr.append(ac); body.append(tr);
  });
}
function makeSlug() {
  let s = ($('e-slug').value || $('e-name').value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36);
  if (s.length < 2) return '';
  let out = s, n = 2;
  while (known.includes(out)) out = s + '-' + n++;
  $('e-slug').value = out;
  return out;
}
function clearEd() { ['e-name', 'e-slug', 'e-game', 'e-ver', 'e-desc', 'e-code', 'e-logo'].forEach((i) => ($(i).value = '')); $('e-estado').value = 'activo'; $('e-verif').value = 'si'; $('e-sit').value = 'ok'; $('e-cartel').value = 'grande'; $('e-file').value = ''; $('em').className = 'msg'; }
function showLink(slug) { $('e-link').classList.remove('hide'); $('e-ls').textContent = lsFor(slug); }
$('new').onclick = () => { editing = null; clearEd(); $('e-slug').disabled = false; $('ed-t').textContent = 'Nuevo script'; $('e-link').classList.add('hide'); $('ed').classList.remove('hide'); $('e-name').focus(); };
async function openEd(slug) {
  try {
    const s = await api('/api/admin/scripts/' + encodeURIComponent(slug));
    editing = slug; clearEd();
    $('e-name').value = s.name; $('e-slug').value = s.slug; $('e-slug').disabled = true; $('e-game').value = s.game; $('e-ver').value = s.version; $('e-desc').value = s.description; $('e-estado').value = s.estado; $('e-logo').value = s.logo || ''; $('e-sit').value = s.situacion || 'ok'; $('e-cartel').value = s.cartel === 'costado' ? 'costado' : 'grande'; $('e-verif').value = s.verificacion === 'no' ? 'no' : 'si'; $('e-code').value = s.code;
    $('ed-t').textContent = 'Editar: ' + s.name; showLink(slug); $('ed').classList.remove('hide'); $('ed').scrollIntoView({ behavior: 'smooth' });
  } catch (e) { alert(e.message); }
}
async function del(s) {
  if (!confirm(`Borrar "${s.name}"? El link deja de funcionar.`)) return;
  try { await api('/api/admin/scripts/' + encodeURIComponent(s.slug), { method: 'DELETE' }); $('ed').classList.add('hide'); refresh(); } catch (e) { alert(e.message); }
}
$('e-file').addEventListener('change', async () => {
  const f = $('e-file').files[0]; if (!f) return;
  if (f.size > 1_000_000) { show($('em'), 'El archivo supera 1 MB.', false); return; }
  $('e-code').value = await f.text();
  if (!$('e-name').value) $('e-name').value = f.name.replace(/\.[^.]+$/, '');
});
$('e-save').onclick = async () => {
  const slug = editing || makeSlug();
  if (!slug) { show($('em'), 'Pon un nombre para el script.', false); return; }
  if (!$('e-code').value.trim()) { show($('em'), 'Pega el loader o el script.', false); return; }
  const b = $('e-save'); b.disabled = true;
  try {
    const rr = await api('/api/admin/scripts/' + encodeURIComponent(slug), { method: 'PUT', body: { name: $('e-name').value, game: $('e-game').value, version: $('e-ver').value, description: $('e-desc').value, estado: $('e-estado').value, logo: $('e-logo').value, verificacion: $('e-verif').value, situacion: $('e-sit').value, cartel: $('e-cartel').value, code: $('e-code').value } });
    editing = slug; $('e-slug').disabled = true; showLink(slug); show($('em'), rr && rr.aviso ? 'Guardado, pero ' + rr.aviso : 'Guardado.', !(rr && rr.aviso)); refresh();
  } catch (e) { show($('em'), e.message, false); }
  b.disabled = false;
};
$('e-cancel').onclick = () => $('ed').classList.add('hide');
$('e-copy').onclick = (e) => copyText($('e-ls').textContent, e.target);
async function verif() { try { const v = await api('/api/admin/verificados'); $('vcount').textContent = v.length + ' cuenta(s) verificada(s).'; $('vpre').textContent = v.map((x) => `${x.name} (${x.id}) - ${x.fecha.slice(0, 10)}`).join('\n') || '(vacio)'; } catch {} }
$('vlist').onclick = () => $('vpre').classList.toggle('hide');
$('diag').onclick = async () => { const p = $('dpre'); p.classList.remove('hide'); p.textContent = 'Probando...'; try { p.textContent = JSON.stringify(await api('/api/admin/diag'), null, 2); } catch (e) { p.textContent = e.message; } };
$('u-pub').onclick = async () => {
  const titulo = $('u-t').value.trim(), version = $('u-v').value.trim(), desc = $('u-d').value.trim();
  if (!titulo || !desc) { show($('u-m'), 'Faltan el título o la descripción.', false); return; }
  const b = $('u-pub'); b.disabled = true;
  try { await api('/api/admin/panel/update', { method: 'POST', body: { titulo, version, desc } }); ['u-t', 'u-v', 'u-d'].forEach((i) => ($(i).value = '')); show($('u-m'), 'Actualización publicada.', true); }
  catch (e) { show($('u-m'), e.message, false); }
  b.disabled = false;
};
$('u-ver').onclick = async () => {
  const p = $('u-list'); p.classList.toggle('hide'); if (p.classList.contains('hide')) return;
  p.textContent = 'Cargando...';
  try { const l = await api('/api/updates'); p.textContent = l.length ? l.map((u) => `${u.titulo}${u.version ? ' (v' + String(u.version).replace(/^v/i, '') + ')' : ''}\n${u.descripcion}`).join('\n\n') : 'No hay actualizaciones.'; }
  catch (e) { p.textContent = e.message; }
};
boot();

// ---- soporte en vivo ----
(function () {
  let sel = '', desde = 0, activo = false;
  const log = $('sv-log');
  function pinta(m) {
    const d = document.createElement('div'); d.className = 'sv-m ' + (m.de === 'admin' ? 'u' : m.de === 'usuario' ? 'a' : m.de === 'vertix' ? 'v' : 's');
    if (m.de === 'usuario' || m.de === 'vertix') { const b = document.createElement('b'); b.textContent = m.de === 'vertix' ? 'Vertix' : 'Persona'; d.append(b); }
    const t = document.createElement('span'); t.textContent = m.t; d.append(t); log.append(d);
  }
  function tog(a, disp) { activo = a; $('sv-tog').textContent = a ? (disp ? 'Disponible: SÍ (toca para desactivar)' : 'Activado (esperando esta página)') : 'Disponible: NO (toca para activar)'; }
  async function lista() {
    if (document.hidden || $('panel').classList.contains('hide')) return;
    try {
      const r = await api('/api/admin/soporte/chats'); tog(r.activo, r.disponible);
      const box = $('sv-lista'); box.textContent = '';
      if (!r.chats.length) { const p = document.createElement('p'); p.textContent = 'No hay chats abiertos.'; box.append(p); }
      r.chats.forEach((c) => {
        const d = document.createElement('div'); d.className = 'sv-it' + (c.id === sel ? ' on' : '');
        if (c.sinLeer) { const n = document.createElement('span'); n.className = 'n'; n.textContent = c.sinLeer; d.append(n); }
        const b = document.createElement('b'); b.textContent = c.nombre + (c.modo === 'vertix' ? ' (Vertix)' : ''); const s = document.createElement('small'); s.textContent = (c.contacto ? c.contacto + ' | ' : '') + c.ultimo;
        d.append(b, s); d.onclick = () => abre(c.id, c.nombre, c.contacto); box.append(d);
      });
      if (sel && !r.chats.some((c) => c.id === sel)) { sel = ''; $('sv-box').classList.add('hide'); }
      if (sel) await trae();
    } catch {}
  }
  async function trae() {
    try { const r = await api('/api/admin/soporte/chat?id=' + sel + '&desde=' + desde); r.msgs.forEach((m) => { pinta(m); desde = Math.max(desde, m.n); }); if (r.msgs.length) log.scrollTop = log.scrollHeight; $('sv-quien').textContent = r.nombre + (r.contacto ? ' | ' + r.contacto : '') + ' | ' + (r.modo === 'vertix' ? 'atiende Vertix' : 'atiendes tú'); }
    catch (e) { if (e.status === 404) { sel = ''; $('sv-box').classList.add('hide'); } }
  }
  function abre(id) { sel = id; desde = 0; log.textContent = ''; $('sv-box').classList.remove('hide'); trae(); }
  $('sv-tog').addEventListener('click', async () => { try { const r = await api('/api/admin/soporte/activo', { method: 'POST', body: { valor: !activo } }); tog(r.activo, r.disponible); } catch (e) { show($('sv-m'), e.message, false); } });
  $('sv-form').addEventListener('submit', async (e) => {
    e.preventDefault(); const t = $('sv-in').value.trim(); if (!t || !sel) return; $('sv-in').value = '';
    try { const r = await api('/api/admin/soporte/responder', { method: 'POST', body: { id: sel, texto: t, desde } }); r.msgs.forEach((m) => { pinta(m); desde = Math.max(desde, m.n); }); log.scrollTop = log.scrollHeight; }
    catch (err) { show($('sv-m'), err.message, false); }
  });
  $('sv-close').addEventListener('click', async () => { if (!sel) return; try { await api('/api/admin/soporte/cerrar', { method: 'POST', body: { id: sel } }); } catch {} sel = ''; $('sv-box').classList.add('hide'); lista(); });
  setInterval(lista, 4000); setTimeout(lista, 800);
})();

// ---- pestañas ----
(function () {
  const bar = $('tabs'); let actual = '';
  function ir(t) {
    actual = t;
    bar.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    document.querySelectorAll('#panel .tab').forEach((d) => d.classList.toggle('hide', d.dataset.t !== t));
    try { localStorage.setItem('adm_tab', t); } catch {}
    if (t === 'resumen') resumen(); if (t === 'boveda') bvLista(); if (t === 'seguridad') seguridad(); if (t === 'consola') { setTimeout(() => { const x = $('co-term'); x.scrollTop = x.scrollHeight; }, 50); }
  }
  bar.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) ir(b.dataset.t); });
  let t0 = 'resumen'; try { t0 = localStorage.getItem('adm_tab') || 'resumen'; } catch {}
  if (!bar.querySelector(`[data-t="${t0}"]`)) t0 = 'resumen';
  window.__adminTab = () => actual; window.__adminIr = ir;
  setTimeout(() => ir(t0), 0);
  setInterval(() => { if (document.hidden) return; if (actual === 'resumen') resumen(); if (actual === 'seguridad') seguridad(); }, 15000);
})();

// ---- resumen ----
const fmtT = (s) => { const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return (d ? d + 'd ' : '') + (h ? h + 'h ' : '') + m + 'm'; };
const fmtF = (ts) => { if (!ts) return '-'; const d = new Date(ts); return d.toLocaleDateString('es', { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }); };
async function resumen() {
  if ($('panel').classList.contains('hide')) return;
  try {
    const [r, e] = await Promise.all([api('/api/admin/resumen'), api('/api/admin/ejecuciones')]);
    const st = $('rs-stats'); st.textContent = '';
    [['Ejecuciones hoy', r.ejecHoy], ['Ejecuciones totales', r.ejecTotal], ['Scripts', r.scripts], ['Chats de soporte', r.chats], ['Soporte', r.soporte ? 'Disponible' : 'No disponible'], ['IPs bloqueadas', r.bloqueadas], ['Servidor activo', fmtT(r.uptime)], ['Memoria', r.memoria + ' MB']].forEach(([k, v]) => {
      const d = document.createElement('div'); d.className = 'stat'; const b = document.createElement('b'); b.textContent = v; const s = document.createElement('span'); s.textContent = k; d.append(b, s); st.append(d);
    });
    const bars = $('rs-bars'); bars.textContent = ''; const max = Math.max(1, ...e.dias.map((x) => x.n));
    e.dias.forEach((x) => { const c = document.createElement('div'); c.className = 'bar'; const i = document.createElement('i'); i.style.height = Math.max(3, Math.round(x.n / max * 100)) + '%'; i.title = x.d + ': ' + x.n; const n = document.createElement('em'); n.textContent = x.n || ''; const l = document.createElement('small'); l.textContent = x.d.slice(8); c.append(n, i, l); bars.append(c); });
    const rows = $('rs-rows'); rows.textContent = '';
    if (!e.scripts.length) { const tr = document.createElement('tr'); tr.append(td('Todavía no hay ejecuciones.')); rows.append(tr); }
    e.scripts.forEach((s) => { const tr = document.createElement('tr'); tr.append(td(s.name), td(String(s.total)), td(String(s.hoy)), td(String(s.sem)), td(fmtF(s.ult))); rows.append(tr); });
  } catch {}
}

// ---- seguridad ----
async function seguridad() {
  if ($('panel').classList.contains('hide')) return;
  try {
    const [s, a] = await Promise.all([api('/api/admin/seguridad'), api('/api/admin/auditoria')]);
    const box = $('se-ips'); box.textContent = '';
    if (!s.bloqueadas.length) { const p = document.createElement('p'); p.textContent = 'No hay IPs bloqueadas.'; box.append(p); }
    s.bloqueadas.forEach((x) => { const d = document.createElement('div'); d.className = 'sv-it'; const b = document.createElement('b'); b.textContent = x.ip; const sm = document.createElement('small'); sm.textContent = 'hasta ' + fmtF(x.hasta); const u = document.createElement('button'); u.className = 'ghost'; u.style.cssText = 'float:right;padding:6px 12px'; u.textContent = 'Desbloquear'; u.onclick = async () => { await api('/api/admin/seguridad/desbloquear', { method: 'POST', body: { ip: x.ip } }); seguridad(); }; d.append(u, b, sm); box.append(d); });
    $('se-aud').textContent = a.length ? a.map((x) => `${fmtF(x.ts)}  ${x.ip}  ${x.accion}${x.detalle ? ': ' + x.detalle : ''}`).join('\n') : 'Sin actividad.';
  } catch {}
}
$('se-add').onclick = async () => { try { await api('/api/admin/seguridad/bloquear', { method: 'POST', body: { ip: $('se-ip').value.trim(), horas: Number($('se-h').value) || 24 } }); $('se-ip').value = ''; show($('se-m'), 'IP bloqueada.', true); seguridad(); } catch (e) { show($('se-m'), e.message, false); } };

// ---- bóveda ----
(function () {
  let lista = [], cur = null;
  const m = (t, ok) => show($('bv-m'), t, ok);
  window.bvLista = async function () {
    try {
      const r = await api('/api/admin/boveda'); lista = r.archivos;
      $('bv-info').textContent = r.cifrado ? 'Aquí guardas tus scripts completos. Son privados y están cifrados.' : 'Aquí guardas tus scripts completos. Son privados. Para cifrarlos define BOVEDA_KEY en Render.';
      const carp = [...new Set(lista.map((x) => x.carpeta).filter(Boolean))].sort();
      const f = $('bv-fil'), v = f.value; f.textContent = ''; f.append(new Option('Todas las carpetas', '')); carp.forEach((c) => f.append(new Option(c, c))); f.value = carp.includes(v) ? v : '';
      $('bv-dl').textContent = ''; carp.forEach((c) => { const o = document.createElement('option'); o.value = c; $('bv-dl').append(o); });
      pinta();
    } catch (e) { m(e.message, false); }
  };
  function pinta() {
    const box = $('bv-lista'); box.textContent = ''; const f = $('bv-fil').value; const l = lista.filter((x) => !f || x.carpeta === f);
    const item = (x) => { const d = document.createElement('div'); d.className = 'sv-it' + (cur === x.id ? ' on' : ''); const b = document.createElement('b'); b.textContent = x.nombre; const s = document.createElement('small'); s.textContent = (x.carpeta ? x.carpeta + ' | ' : '') + Math.round(x.size / 1024 * 10) / 10 + ' KB | ' + fmtF(x.mod) + (x.versiones ? ' | ' + x.versiones + ' versiones' : '') + (x.slug ? ' | link: /s/' + x.slug : ''); d.append(b, s); d.onclick = () => abre(x.id); return d; };
    [['loader', 'Loaders'], ['script', 'Scripts (los que ejecuta el loader)']].forEach(([t, tit]) => {
      const g = l.filter((x) => x.tipo === t); const h = document.createElement('h4'); h.textContent = tit + ' (' + g.length + ')'; h.style.margin = '14px 0 6px'; box.append(h);
      if (!g.length) { const p = document.createElement('p'); p.textContent = 'Nada todavía.'; p.style.margin = '0'; box.append(p); }
      g.forEach((x) => box.append(item(x)));
    });
  }
  $('bv-fil').onchange = pinta;
  function mostrarLoader(slug, loader, alias) {
    $('bv-alias').value = alias || ''; $('bv-slug').value = slug || ''; $('bv-slug').disabled = false;
    $('bv-loader').classList.toggle('hide', !loader); $('bv-loader').textContent = loader || '';
    $('bv-loaderrow').classList.toggle('hide', !loader); $('bv-unpub').classList.toggle('hide', !slug);
    $('bv-pubbtn').textContent = slug ? 'Actualizar nombre / republicar' : 'Publicar loader';
    $('bv-pub').classList.toggle('hide', !cur);
  }
  function limpia() { cur = null; ['bv-n', 'bv-c', 'bv-no', 'bv-code', 'bv-slug', 'bv-alias'].forEach((i) => ($(i).value = '')); $('bv-tp').value = 'script'; mostrarLoader('', ''); $('bv-vers').classList.add('hide'); $('bv-m').className = 'msg'; }
  async function abre(id) {
    try {
      const r = await api('/api/admin/boveda/' + id); cur = id; $('bv-n').value = r.nombre; $('bv-c').value = r.carpeta; $('bv-tp').value = r.tipo || 'script'; $('bv-no').value = r.notas; $('bv-code').value = r.codigo; $('bv-t').textContent = 'Editar: ' + r.nombre;
      const vs = $('bv-vsel'); vs.textContent = ''; vs.append(new Option('Elige una versión...', '')); (r.vers || []).slice().reverse().forEach((v) => vs.append(new Option('Versión ' + v.v + ' | ' + fmtF(v.ts), v.v))); $('bv-vers').classList.toggle('hide', !(r.vers || []).length);
      mostrarLoader(r.slug, r.loader, r.alias); $('bv-ed').classList.remove('hide'); $('bv-del').classList.remove('hide'); $('bv-dl-btn').classList.remove('hide'); $('bv-m').className = 'msg'; pinta(); $('bv-ed').scrollIntoView({ behavior: 'smooth' });
    } catch (e) { m(e.message, false); }
  }
  const bvNuevo = (tp) => { limpia(); $('bv-tp').value = tp; $('bv-pub').classList.add('hide'); $('bv-t').textContent = tp === 'loader' ? 'Nuevo loader' : 'Nuevo script'; $('bv-ed').classList.remove('hide'); $('bv-del').classList.add('hide'); $('bv-dl-btn').classList.add('hide'); pinta(); $('bv-ed').scrollIntoView({ behavior: 'smooth' }); };
  $('bv-newl').onclick = () => bvNuevo('loader'); $('bv-news').onclick = () => bvNuevo('script');
  $('bv-x').onclick = () => { $('bv-ed').classList.add('hide'); limpia(); pinta(); };
  $('bv-file').addEventListener('change', async () => { const f = $('bv-file').files[0]; if (!f) return; if (f.size > 1_200_000) { m('El archivo supera 1.2 MB.', false); return; } $('bv-code').value = await f.text(); if (!$('bv-n').value) $('bv-n').value = f.name.replace(/\.[^.]+$/, ''); });
  $('bv-vsel').onchange = async () => { const v = $('bv-vsel').value; if (!v || !cur) return; try { const r = await api(`/api/admin/boveda/${cur}/v/${v}`); if (confirm('¿Cargar esa versión en el editor? Aún tienes que guardar.')) $('bv-code').value = r.codigo; } catch (e) { m(e.message, false); } $('bv-vsel').value = ''; };
  $('bv-save').onclick = async () => {
    const body = { tipo: $('bv-tp').value, nombre: $('bv-n').value, carpeta: $('bv-c').value, notas: $('bv-no').value, codigo: $('bv-code').value };
    if (!body.nombre.trim()) { m('Ponle un nombre.', false); return; } if (!body.codigo.trim()) { m('Pega o sube el script.', false); return; }
    const b = $('bv-save'); b.disabled = true;
    try {
      if (cur) await api('/api/admin/boveda/' + cur, { method: 'PUT', body }); else { const r = await api('/api/admin/boveda', { method: 'POST', body }); cur = r.id; }
      m('Guardado.', true); await bvLista(); abre(cur);
    } catch (e) { m(e.message, false); }
    b.disabled = false;
  };
  $('bv-del').onclick = async () => { if (!cur || !confirm('¿Borrar este archivo y sus versiones? No se puede deshacer.')) return; try { await api('/api/admin/boveda/' + cur, { method: 'DELETE' }); $('bv-ed').classList.add('hide'); limpia(); bvLista(); } catch (e) { m(e.message, false); } };
  $('bv-dl-btn').onclick = () => { if (cur) location.href = `/api/admin/boveda/${cur}/descargar`; };
  $('bv-pubbtn').onclick = async () => {
    if (!cur) { m('Primero guarda el archivo.', false); return; }
    const slug = $('bv-slug').value.trim().toLowerCase(); if (!slug) { m('Escribe un nombre para el loader.', false); return; }
    try { const r = await api(`/api/admin/boveda/${cur}/publicar`, { method: 'POST', body: { slug, alias: $('bv-alias').value } }); mostrarLoader(r.slug, r.loader, r.alias); m('Loader publicado.', true); bvLista(); } catch (e) { m(e.message, false); }
  };
  $('bv-unpub').onclick = async () => { if (!cur || !confirm('¿Despublicar el loader? El link dejará de funcionar.')) return; try { await api(`/api/admin/boveda/${cur}/despublicar`, { method: 'POST', body: {} }); mostrarLoader('', ''); m('Loader despublicado.', true); bvLista(); } catch (e) { m(e.message, false); } };
  $('bv-lcopy').onclick = (e) => copyText($('bv-loader').textContent, e.target);
  $('bv-copy').onclick = (e) => copyText($('bv-code').value, e.target);
})();

// ---- consola ----
(function () {
  let ultimo = 0, pausa = false, hist = [], hi = 0; const term = $('co-term');
  const linea = (txt, cls) => { const d = document.createElement('div'); d.className = 'l ' + (cls || ''); d.textContent = txt; term.append(d); while (term.children.length > 700) term.firstChild.remove(); };
  const filtra = () => { const q = $('co-fil').value.toLowerCase(); term.querySelectorAll('.l').forEach((d) => (d.style.display = !q || d.textContent.toLowerCase().includes(q) ? '' : 'none')); };
  async function logs() {
    if (pausa || document.hidden || $('panel').classList.contains('hide') || window.__adminTab() !== 'consola') return;
    try {
      const r = await api('/api/admin/consola/logs?desde=' + ultimo); const abajo = term.scrollHeight - term.scrollTop - term.clientHeight < 40;
      r.logs.forEach((l) => linea(new Date(l.ts).toLocaleTimeString('es') + '  ' + l.t, l.nivel)); ultimo = r.ultimo;
      if (r.logs.length) { filtra(); if (abajo) term.scrollTop = term.scrollHeight; }
    } catch {}
  }
  setInterval(logs, 2000); setTimeout(logs, 1000);
  async function cmd(t) {
    t = t.trim(); if (!t) return; hist.push(t); hi = hist.length; linea('> ' + t, 'cmd');
    if (t.toLowerCase() === 'limpiar') { term.textContent = ''; }
    try { const r = await api('/api/admin/consola/cmd', { method: 'POST', body: { cmd: t } }); if (r.out) r.out.split('\n').forEach((x) => linea(x, 'out')); } catch (e) { linea('Error: ' + e.message, 'error'); }
    term.scrollTop = term.scrollHeight;
  }
  $('co-form').addEventListener('submit', (e) => { e.preventDefault(); const v = $('co-in').value; $('co-in').value = ''; cmd(v); });
  $('co-in').addEventListener('keydown', (e) => { if (e.key === 'ArrowUp' && hi > 0) { $('co-in').value = hist[--hi]; e.preventDefault(); } else if (e.key === 'ArrowDown') { hi = Math.min(hi + 1, hist.length); $('co-in').value = hist[hi] || ''; e.preventDefault(); } });
  $('co-chips').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) cmd(b.dataset.c); });
  $('co-pause').onclick = () => { pausa = !pausa; $('co-pause').textContent = pausa ? 'Reanudar' : 'Pausar'; };
  $('co-clear').onclick = () => { term.textContent = ''; };
  $('co-fil').addEventListener('input', filtra);
})();

// ---- Banner y fondo de Creador
(function () {
  const redim = (file, maxW) => new Promise((ok, err) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, maxW / img.width), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      let q = 0.86, d = c.toDataURL('image/jpeg', q);
      while (d.length > 1400000 && q > 0.4) { q -= 0.1; d = c.toDataURL('image/jpeg', q); }
      ok(d);
    };
    img.onerror = () => err(new Error('No se pudo leer la imagen.'));
    img.src = url;
  });
  const msg = (t, bien) => { const m = $('cr-msg'); m.textContent = t; m.className = 'msg ' + (bien ? 'ok' : 'err'); };
  const vista = (tipo, hay) => { const p = $('cr-' + tipo + '-p'); if (hay) { p.src = '/api/creador-img/' + tipo + '?v=' + Date.now(); p.style.display = 'block'; } else p.style.display = 'none'; };
  ['banner', 'fondo'].forEach((tipo) => {
    $('cr-' + tipo + '-f').addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        msg('Subiendo...', true);
        const data = await redim(f, tipo === 'banner' ? 1600 : 1800);
        await api('/api/admin/creador-img/' + tipo, { method: 'PUT', body: { data } });
        msg((tipo === 'banner' ? 'Banner' : 'Fondo') + ' actualizado.', true); vista(tipo, true);
      } catch (er) { msg(er.message || 'No se pudo subir.', false); }
      e.target.value = '';
    });
    $('cr-' + tipo + '-x').addEventListener('click', async () => {
      try { await api('/api/admin/creador-img/' + tipo, { method: 'DELETE' }); vista(tipo, false); msg('Quitado.', true); } catch (er) { msg(er.message, false); }
    });
  });
  fetch('/api/creador-info').then((r) => r.json()).then((i) => { vista('banner', !!i.banner); vista('fondo', !!i.fondo); }).catch(() => {});
})();
