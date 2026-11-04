'use strict';
const $ = (id) => document.getElementById(id);
let me = { verificado: false, staff: false, id: null };
let cat = null, abierto = null;
const txt = (tag, text, cls) => { const e = document.createElement(tag); e.textContent = text; if (cls) e.className = cls; return e; };
const fdate = (iso) => new Date(iso).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' });
// --- navegacion ---
function go(p) {
  document.querySelectorAll('.page').forEach((s) => s.classList.toggle('on', s.id === 'p-' + p));
  document.querySelectorAll('#nav a[data-p]').forEach((a) => a.classList.toggle('on', a.dataset.p === p));
  if (location.hash !== '#' + p) history.replaceState(null, '', '#' + p);
  scrollTo(0, 0);
  if (p === 'scripts') loadScripts();
  if (p === 'foro') showList();
}
document.querySelectorAll('[data-p]').forEach((a) => a.addEventListener('click', () => go(a.dataset.p)));
document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
const start = location.hash.slice(1);
if (['inicio', 'verificar', 'soporte', 'scripts', 'foro'].includes(start)) go(start);
api('/api/config').then((c) => { $('dc').href = c.discord; }).catch(() => {});

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
    show(vmsg, `Codigo para ${d.usuario}. Vale por ${d.minutos} minutos.`, true);
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
    if (!d.verificado && d.scripts.length) { show($('sc-lock'), 'Verifica tu cuenta para poder copiar los scripts.', false); const b = txt('button', 'Ir a verificar'); b.style.marginLeft = '10px'; b.onclick = () => go('verificar'); $('sc-lock').append(b); } else $('sc-lock').className = 'msg';
    d.scripts.forEach((s) => {
      const card = document.createElement('div'); card.className = 'card';
      const top = document.createElement('div'); top.className = 'sc';
      const info = document.createElement('div');
      info.append(txt('h3', s.name));
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
    if (t.cerrado) box.append(txt('p', 'Este tema esta cerrado.', 'nota'));
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
