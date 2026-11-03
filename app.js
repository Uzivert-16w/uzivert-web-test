'use strict';
const $ = (id) => document.getElementById(id);
// --- navegacion ---
function go(p) {
  document.querySelectorAll('.page').forEach((s) => s.classList.toggle('on', s.id === 'p-' + p));
  document.querySelectorAll('#nav a[data-p]').forEach((a) => a.classList.toggle('on', a.dataset.p === p));
  if (location.hash !== '#' + p) history.replaceState(null, '', '#' + p);
  scrollTo(0, 0);
}
document.querySelectorAll('[data-p]').forEach((a) => a.addEventListener('click', () => go(a.dataset.p)));
document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
const start = location.hash.slice(1);
if (['inicio', 'verificar', 'soporte'].includes(start)) go(start);
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
