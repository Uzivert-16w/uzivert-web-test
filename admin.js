'use strict';
const $ = (id) => document.getElementById(id);
let editing = null;
let known = [];
const base = location.origin;
function lsFor(slug) { return `loadstring(game:HttpGet("${base}/s/${slug}"))()`; }

async function boot() {
  try { const me = await api('/api/admin/yo'); $('login').classList.add('hide'); $('panel').classList.remove('hide'); $('out').classList.remove('hide'); $('stor').textContent = me.almacenamiento === 'github' ? 'Guardado permanente en GitHub.' : 'Guardado en disco local: en Render gratis se pierde al reiniciar. Configura GITHUB_TOKEN para guardado permanente.'; refresh(); verif(); }
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
  $('empty').classList.toggle('hide', list.length > 0);
  list.forEach((s) => {
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
function clearEd() { ['e-name', 'e-slug', 'e-game', 'e-ver', 'e-desc', 'e-code', 'e-logo'].forEach((i) => ($(i).value = '')); $('e-estado').value = 'activo'; $('e-verif').value = 'si'; $('e-sit').value = 'ok'; $('e-file').value = ''; $('em').className = 'msg'; }
function showLink(slug) { $('e-link').classList.remove('hide'); $('e-ls').textContent = lsFor(slug); }
$('new').onclick = () => { editing = null; clearEd(); $('e-slug').disabled = false; $('ed-t').textContent = 'Nuevo script'; $('e-link').classList.add('hide'); $('ed').classList.remove('hide'); $('e-name').focus(); };
async function openEd(slug) {
  try {
    const s = await api('/api/admin/scripts/' + encodeURIComponent(slug));
    editing = slug; clearEd();
    $('e-name').value = s.name; $('e-slug').value = s.slug; $('e-slug').disabled = true; $('e-game').value = s.game; $('e-ver').value = s.version; $('e-desc').value = s.description; $('e-estado').value = s.estado; $('e-logo').value = s.logo || ''; $('e-sit').value = s.situacion || 'ok'; $('e-verif').value = s.verificacion === 'no' ? 'no' : 'si'; $('e-code').value = s.code;
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
    const rr = await api('/api/admin/scripts/' + encodeURIComponent(slug), { method: 'PUT', body: { name: $('e-name').value, game: $('e-game').value, version: $('e-ver').value, description: $('e-desc').value, estado: $('e-estado').value, logo: $('e-logo').value, verificacion: $('e-verif').value, situacion: $('e-sit').value, code: $('e-code').value } });
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
