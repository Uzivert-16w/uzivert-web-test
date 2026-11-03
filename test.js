'use strict';
// Prueba local con Discord y Roblox simulados:  node test.js
const http = require('http');
let hooks = [], robloxDesc = '';
const mock = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    if (req.url === '/hook') { hooks.push(JSON.parse(b)); res.writeHead(204); return res.end(); }
    if (req.url === '/hook-bad') { res.writeHead(500); return res.end(); }
    if (req.url === '/v1/usernames/users') { const u = JSON.parse(b).usernames[0]; res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ data: u === 'NoExiste' ? [] : [{ id: 123, name: u }] })); }
    if (req.url === '/v1/users/123') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ description: robloxDesc })); }
    res.writeHead(404); res.end();
  });
}).listen(9100, async () => {
  process.env.DISCORD_WEBHOOK_SOPORTE = 'http://127.0.0.1:9100/hook';
  process.env.ROBLOX_USERS_API = 'http://127.0.0.1:9100';
  process.env.ADMIN_KEY = 'clave-de-prueba'; process.env.SESSION_SECRET = 'x'.repeat(40);
  process.env.DATA_DIR = require('path').join(require('os').tmpdir(), 'uz-test-' + Date.now());
  const app = require('./server.js');
  const srv = app.listen(9101);
  const B = 'http://127.0.0.1:9101';
  let ok = 0, fail = 0;
  const t = (n, c) => { if (c) { ok++; console.log('  ok  ' + n); } else { fail++; console.log('FALLA ' + n); } };
  const J = { 'Content-Type': 'application/json', 'X-Requested-With': 'uz' };
  const call = async (m, u, body, cookie, hdr) => { const r = await fetch(B + u, { method: m, headers: { ...(body !== undefined ? J : {}), ...(cookie ? { Cookie: cookie } : {}), ...(hdr || {}) }, body: body !== undefined ? JSON.stringify(body) : undefined }); let d = null; const txt = await r.text(); try { d = JSON.parse(txt); } catch { d = txt; } return { s: r.status, d, c: (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map((x) => x.split(';')[0]).join('; ') }; };

  // soporte
  let r = await call('POST', '/api/soporte', { asunto: 'Bug', contacto: '@everyone hola', mensaje: 'Mensaje de prueba @everyone **negrita**' });
  t('soporte envia (200)', r.s === 200 && hooks.length === 1);
  t('soporte escapa @everyone', !/@everyone/.test(JSON.stringify(hooks[0])) && hooks[0].allowed_mentions.parse.length === 0);
  r = await call('POST', '/api/soporte', { mensaje: 'corto' }); t('soporte rechaza corto (400)', r.s === 400);
  r = await call('POST', '/api/soporte', { mensaje: 'esto es spam de bot largo', web: 'x' }); t('honeypot silencioso', r.s === 200 && hooks.length === 1);
  r = await fetch(B + '/api/soporte', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' }); t('sin header X-Requested-With (400)', r.status === 400);
  await call('POST', '/api/soporte', { mensaje: 'segundo mensaje valido' }); await call('POST', '/api/soporte', { mensaje: 'tercer mensaje valido ok' });
  r = await call('POST', '/api/soporte', { mensaje: 'cuarto mensaje valido ok' }); t('rate limit soporte (429)', r.s === 429);

  // verificacion
  r = await call('POST', '/api/verificar/iniciar', { usuario: 'NoExiste' }); t('usuario inexistente (404)', r.s === 404);
  r = await call('POST', '/api/verificar/iniciar', { usuario: 'a b!' }); t('usuario invalido (400)', r.s === 400);
  r = await call('POST', '/api/verificar/iniciar', { usuario: 'Uzivert' }); t('iniciar ok con codigo UZV-', r.s === 200 && /^UZV-[A-Z0-9]{8}$/.test(r.d.code));
  const { token, code } = r.d;
  r = await call('GET', '/api/mi-script'); t('mi-script sin verificar (403)', r.s === 403);
  robloxDesc = 'hola sin codigo'; r = await call('POST', '/api/verificar/confirmar', { token }); t('confirmar sin codigo (400)', r.s === 400);
  robloxDesc = 'bio ' + code; r = await call('POST', '/api/verificar/confirmar', { token }); t('confirmar con codigo (200)', r.s === 200 && /uz_user=/.test(r.c));
  const uc = r.c;
  r = await call('GET', '/api/yo', undefined, uc); t('/api/yo verificado', r.d.verificado === true && r.d.usuario === 'Uzivert');
  r = await call('GET', '/api/mi-script', undefined, uc); t('mi-script con cookie', r.s === 200 && /loadstring/.test(r.d.loadstring));
  r = await call('GET', '/api/mi-script', undefined, uc.replace(/.$/, 'X')); t('cookie manipulada rechazada', r.s === 403);
  r = await call('POST', '/api/verificar/confirmar', { token }); t('token no reutilizable (400)', r.s === 400);
  await new Promise((x) => setTimeout(x, 100)); t('webhook de verificacion enviado', hooks.some((h) => h.embeds && h.embeds[0].title === 'Cuenta verificada'));

  // admin
  r = await call('GET', '/api/admin/scripts'); t('admin sin login (401)', r.s === 401);
  r = await call('POST', '/api/admin/login', { clave: 'mala' }); t('login clave mala (401)', r.s === 401);
  r = await call('POST', '/api/admin/login', { clave: 'clave-de-prueba' }); t('login ok', r.s === 200 && /uz_admin=/.test(r.c));
  const ac = r.c;
  r = await call('GET', '/api/admin/scripts', undefined, uc); t('cookie de usuario no sirve de admin (401)', r.s === 401);
  r = await call('PUT', '/api/admin/scripts/mm2-hub', { name: 'MM2 Hub', game: 'MM2', version: 'v1.0', estado: 'activo', code: 'print("hola")' }, ac); t('crear script', r.s === 200);
  r = await call('PUT', '/api/admin/scripts/Mal Slug', { code: 'x' }, ac); t('slug invalido rechazado', r.s === 400 || r.s === 404);
  r = await call('PUT', '/api/admin/scripts/../etc', { code: 'x' }, ac); t('path traversal rechazado', r.s !== 200);
  r = await call('PUT', '/api/admin/scripts/mm2-hub', { code: 'print("hola")' }, ac, { 'X-Requested-With': 'otro' }); t('PUT sin header CSRF (400)', r.s === 400);
  r = await call('GET', '/s/mm2-hub'); t('entrega publica /s/slug', r.s === 200 && r.d === 'print("hola")');
  r = await call('PUT', '/api/admin/scripts/mm2-hub', { name: 'MM2 Hub', estado: 'activo', code: 'print("v2")' }, ac); r = await call('GET', '/s/mm2-hub'); t('editar invalida cache', r.d === 'print("v2")');
  r = await call('PUT', '/api/admin/scripts/mm2-hub', { name: 'MM2 Hub', estado: 'oculto', code: 'print("v2")' }, ac); r = await call('GET', '/s/mm2-hub'); t('oculto da 404', r.s === 404);
  r = await call('GET', '/api/admin/scripts', undefined, ac); t('listado admin', r.s === 200 && r.d.length === 1 && r.d[0].estado === 'oculto');
  r = await call('GET', '/api/admin/scripts/mm2-hub', undefined, ac); t('leer codigo', r.d.code === 'print("v2")');
  r = await call('GET', '/api/admin/verificados', undefined, ac); t('lista verificados', r.d.length === 1 && r.d[0].name === 'Uzivert');
  r = await call('DELETE', '/api/admin/scripts/mm2-hub', undefined, ac, { 'X-Requested-With': 'uz' }); t('borrar script', r.s === 200);
  r = await call('GET', '/s/mm2-hub'); t('borrado da 404', r.s === 404);
  for (let i = 0; i < 6; i++) r = await call('POST', '/api/admin/login', { clave: 'mala' }); t('rate limit login (429)', r.s === 429);

  // estaticos
  r = await call('GET', '/'); t('index.html', r.s === 200 && /UZIVERT/.test(r.d));
  r = await call('GET', '/admin'); t('admin.html', r.s === 200);
  r = await call('GET', '/../server.js'); t('no expone server.js', r.s === 404 || !/ADMIN_KEY/.test(String(r.d)));
  r = await call('GET', '/%2e%2e/server.js'); t('traversal codificado', !/ADMIN_KEY/.test(String(r.d)));
  r = await call('GET', '/api/nada'); t('api 404 json', r.s === 404);
  console.log(`\n${ok} ok, ${fail} fallas`);
  srv.close(); mock.close(); process.exit(fail ? 1 : 0);
});
