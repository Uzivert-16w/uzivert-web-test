'use strict';
// Fondo de estrellas + orb (comun a todas las paginas)
(function () {
  const c = document.getElementById('stars');
  if (c) {
    const x = c.getContext('2d'); let W, H, S = [];
    const size = () => { W = c.width = innerWidth; H = c.height = innerHeight; S = Array.from({ length: Math.round(W * H / 9000) }, () => ({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.3 + .2, p: Math.random() * 6 })); };
    size(); addEventListener('resize', size);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    (function loop(t) { x.clearRect(0, 0, W, H); x.fillStyle = '#fff'; S.forEach((s) => { x.globalAlpha = .3 + .35 * Math.sin(t / 700 + s.p); x.beginPath(); x.arc(s.x, s.y, s.r, 0, 7); x.fill(); }); if (!reduce) requestAnimationFrame(loop); })(0);
  }
  document.querySelectorAll('.orb').forEach((o) => {
    o.innerHTML = '<i class="g"></i><i class="r"></i><i class="c"></i><i class="q" style="width:24px;height:24px"></i><i class="q" style="width:20px;height:20px;border-color:#bec8e1"></i><i class="m"></i><i class="k"></i>';
    const [, r, , q1, q2] = o.children;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    (function a(t) { const s = t / 1000; r.style.background = `conic-gradient(from ${(s * 90) % 360}deg,#fff,#bec8e1 25%,rgba(255,255,255,.15) 55%,#fff)`; q1.style.transform = `translate(-50%,-50%) rotate(${(s * 24) % 360}deg)`; q2.style.transform = `translate(-50%,-50%) rotate(${(-s * 16) % 360}deg)`; if (!reduce) requestAnimationFrame(a); })(0);
  });
})();
window.api = async function (url, opts) {
  const o = Object.assign({ method: 'GET' }, opts || {});
  o.headers = Object.assign({ 'X-Requested-With': 'uz' }, o.headers || {});
  if (o.body && typeof o.body !== 'string') { o.body = JSON.stringify(o.body); o.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(url, o);
  let d = {}; try { d = await r.json(); } catch {}
  if (!r.ok) { const e = new Error(d.error || 'Error ' + r.status); e.status = r.status; throw e; }
  return d;
};
window.show = function (el, text, ok) { el.textContent = text; el.className = 'msg ' + (ok ? 'ok' : 'err'); };
window.copyText = async function (t, btn) {
  try { await navigator.clipboard.writeText(t); } catch { const a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select(); document.execCommand('copy'); a.remove(); }
  if (btn) { const o = btn.textContent; btn.textContent = 'Copiado'; setTimeout(() => (btn.textContent = o), 1400); }
};
