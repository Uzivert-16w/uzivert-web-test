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
function clearEd() { ['e-name', 'e-slug', 'e-game', 'e-ver', 'e-desc', 'e-code', 'e-logo'].forEach((i) => ($(i).value = '')); $('e-estado').value = 'activo'; $('e-verif').value = 'si'; $('e-file').value = ''; $('em').className = 'msg'; }
function showLink(slug) { $('e-link').classList.remove('hide'); $('e-ls').textContent = lsFor(slug); }
$('new').onclick = () => { editing = null; clearEd(); $('e-slug').disabled = false; $('ed-t').textContent = 'Nuevo script'; $('e-link').classList.add('hide'); $('ed').classList.remove('hide'); $('e-name').focus(); };
async function openEd(slug) {
  try {
    const s = await api('/api/admin/scripts/' + encodeURIComponent(slug));
    editing = slug; clearEd();
    $('e-name').value = s.name; $('e-slug').value = s.slug; $('e-slug').disabled = true; $('e-game').value = s.game; $('e-ver').value = s.version; $('e-desc').value = s.description; $('e-estado').value = s.estado; $('e-logo').value = s.logo || ''; $('e-verif').value = s.verificacion === 'no' ? 'no' : 'si'; $('e-code').value = s.code;
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
    await api('/api/admin/scripts/' + encodeURIComponent(slug), { method: 'PUT', body: { name: $('e-name').value, game: $('e-game').value, version: $('e-ver').value, description: $('e-desc').value, estado: $('e-estado').value, logo: $('e-logo').value, verificacion: $('e-verif').value, code: $('e-code').value } });
    editing = slug; $('e-slug').disabled = true; showLink(slug); show($('em'), 'Guardado.', true); refresh();
  } catch (e) { show($('em'), e.message, false); }
  b.disabled = false;
};
$('e-cancel').onclick = () => $('ed').classList.add('hide');
$('e-copy').onclick = (e) => copyText($('e-ls').textContent, e.target);
async function verif() { try { const v = await api('/api/admin/verificados'); $('vcount').textContent = v.length + ' cuenta(s) verificada(s).'; $('vpre').textContent = v.map((x) => `${x.name} (${x.id}) - ${x.fecha.slice(0, 10)}`).join('\n') || '(vacio)'; } catch {} }
$('vlist').onclick = () => $('vpre').classList.toggle('hide');
$('diag').onclick = async () => { const p = $('dpre'); p.classList.remove('hide'); p.textContent = 'Probando...'; try { p.textContent = JSON.stringify(await api('/api/admin/diag'), null, 2); } catch (e) { p.textContent = e.message; } };
boot();
