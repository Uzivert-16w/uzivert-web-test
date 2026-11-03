'use strict';
// Almacenamiento: local (carpeta DATA_DIR) o GitHub (permanente, recomendado en Render gratis).
const fs = require('fs');
const path = require('path');

function localStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const full = (p) => path.join(dir, p);
  return {
    kind: 'local',
    async read(p) { try { return fs.readFileSync(full(p), 'utf8'); } catch { return null; } },
    async write(p, text) { fs.mkdirSync(path.dirname(full(p)), { recursive: true }); fs.writeFileSync(full(p), text); },
    async remove(p) { try { fs.unlinkSync(full(p)); } catch {} },
  };
}

function githubStore({ token, repo, branch, dir, api }) {
  const base = `${api || 'https://api.github.com'}/repos/${repo}/contents`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'uzivert-web',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const url = (p) => `${base}/${dir ? dir + '/' : ''}${p.split('/').map(encodeURIComponent).join('/')}`;
  let queue = Promise.resolve();               // serializa escrituras para evitar conflictos de sha
  const enqueue = (fn) => (queue = queue.then(fn, fn));
  const fail = async (what, r) => { let m = ''; try { m = (await r.json()).message || ''; } catch {} return new Error(`${what} ${r.status}${m ? ' - ' + m : ''}`); };
  async function getMeta(p) {
    const r = await fetch(`${url(p)}?ref=${encodeURIComponent(branch)}`, { headers });
    if (r.status === 404) return null;
    if (!r.ok) throw await fail('GitHub', r);
    return r.json();
  }
  return {
    kind: 'github',
    async read(p) {
      const m = await getMeta(p);
      if (!m) return null;
      if (m.content !== undefined && m.encoding === 'base64' && m.content !== '') return Buffer.from(m.content, 'base64').toString('utf8');
      const r = await fetch(m.download_url || url(p), { headers: { ...headers, Accept: 'application/vnd.github.raw+json' } });
      return r.ok ? r.text() : null;
    },
    write(p, text) {
      return enqueue(async () => {
        const m = await getMeta(p);
        const body = { message: `uzivert-web: ${p}`, content: Buffer.from(text, 'utf8').toString('base64'), branch };
        if (m && m.sha) body.sha = m.sha;
        const put = (bd) => fetch(url(p), { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(bd) });
        let r = await put(body);
        if (!r.ok && [404, 409, 422].includes(r.status) && !body.sha) {
          // repo vacio (sin commits): GitHub no acepta "branch" en el primer archivo; reintenta sin rama
          const e = await fail('GitHub PUT', r);
          if (/branch|empty/i.test(e.message)) { const { branch: _b, ...sinRama } = body; r = await put(sinRama); } else throw e;
        }
        if (!r.ok) throw await fail('GitHub PUT', r);
      });
    },
    remove(p) {
      return enqueue(async () => {
        const m = await getMeta(p);
        if (!m || !m.sha) return;
        const r = await fetch(url(p), { method: 'DELETE', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: `uzivert-web: borrar ${p}`, sha: m.sha, branch }) });
        if (!r.ok) throw await fail('GitHub DELETE', r);
      });
    },
  };
}

module.exports = { localStore, githubStore };
