/* Compatibility smoke test against a real Liferay instance — one run per
 * release you intend to declare on the Marketplace listing.
 *
 *   SMOKE_URL=http://localhost:8080 SMOKE_USER=... SMOKE_PASS=... \
 *     node scripts/smoke-liferay.js
 *
 * Exercises exactly the API surface the copilot uses: space listing/typing,
 * space creation, web content, blog (with subtitle), document upload and
 * Object-definition discovery — then cleans up after itself and prints a
 * matrix row to paste into marketplace/STOREFRONT.md.
 */
const BASE = (process.env.SMOKE_URL || 'http://localhost:8080').replace(/\/+$/, '');
const USER = process.env.SMOKE_USER || 'test@liferay.com';
const PASS = process.env.SMOKE_PASS || 'test';
const AUTH = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');

const results = [];
let spaceERC = null;
let spaceId = null;

async function lr(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      Authorization: AUTH,
      Accept: 'application/json',
      'Accept-Language': 'en-US',
      ...(opts.body && typeof opts.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status} ${path} :: ${body.slice(0, 160)}`);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? res.json() : res.text();
}

async function step(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail || '' });
    console.log(`  ✔ ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (err) {
    results.push({ name, ok: false, detail: err.message });
    console.error(`  ✖ ${name} — ${err.message}`);
  }
}

(async () => {
  console.log(`Smoke test → ${BASE} (${USER})\n`);

  let portalVersion = 'unknown';
  try {
    const head = await fetch(BASE + '/c/portal/layout', { method: 'HEAD', redirect: 'manual' });
    portalVersion = head.headers.get('liferay-portal') || 'unknown';
  } catch (_) {}
  console.log(`Portal: ${portalVersion}\n`);

  await step('List asset libraries and detect Space typing', async () => {
    const data = await lr('/o/headless-asset-library/v1.0/asset-libraries?pageSize=50');
    const items = data.items || [];
    const typed = items.some(i => i.type === 'Space');
    return `${items.length} libraries, Space typing: ${typed ? 'yes' : 'NO (pre-2026.Q1 instance?)'}`;
  });

  await step('Create a temporary CMS Space', async () => {
    const sp = await lr('/o/headless-asset-library/v1.0/asset-libraries', {
      method: 'POST',
      body: JSON.stringify({ name: `Copilot smoke ${Date.now()}`, type: 'Space' }),
    });
    if (sp.type !== 'Space') throw new Error(`created type is ${sp.type}, not Space`);
    spaceERC = sp.externalReferenceCode;
    spaceId = sp.siteId;
    return `siteId ${spaceId}`;
  });

  if (spaceId) {
    await step('Create web content (basic-web-contents)', async () => {
      const r = await lr(`/o/cms/basic-web-contents/scopes/${spaceId}`, {
        method: 'POST',
        body: JSON.stringify({ title: 'Smoke web content', content: '<p>smoke</p>' }),
      });
      return `id ${r.id}`;
    });

    await step('Create blog entry (cms/blogs)', async () => {
      const r = await lr(`/o/cms/blogs/scopes/${spaceId}`, {
        method: 'POST',
        body: JSON.stringify({ title: 'Smoke blog', subtitle: 'sub', content: '<p>smoke</p>' }),
      });
      return `id ${r.id}`;
    });

    await step('Upload document (basic-documents)', async () => {
      const png = Buffer.from(
        '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
        '1f15c4890000000d49444154789c626001000000ffff030000060005' +
        '57bfabd40000000049454e44ae426082', 'hex');
      /* Current shape (2026 CMS): JSON with an embedded base64 FileEntry.
         Falls back to the legacy multipart shape for older releases. */
      try {
        const r = await lr(`/o/cms/basic-documents/scopes/${spaceId}`, {
          method: 'POST',
          body: JSON.stringify({
            title: 'Smoke doc',
            file: { fileBase64: png.toString('base64'), name: 'smoke.png', mimeType: 'image/png' },
          }),
        });
        return `id ${r.id} (json+base64)`;
      } catch (err) {
        if (!/^(400|415)/.test(err.message)) throw err;
        const fd = new FormData();
        fd.append('file', new Blob([png], { type: 'image/png' }), 'smoke.png');
        fd.append('title', 'Smoke doc');
        const r = await lr(`/o/cms/basic-documents/scopes/${spaceId}`, { method: 'POST', body: fd });
        return `id ${r.id} (legacy multipart)`;
      }
    });

    await step('List documents back (carousel source)', async () => {
      const d = await lr(`/o/cms/basic-documents/scopes/${spaceId}?pageSize=10`);
      if (!(d.items || []).length) throw new Error('uploaded document not listed');
      return `${d.items.length} item(s)`;
    });
  }

  await step('Discover Object definitions (dynamic flows)', async () => {
    const d = await lr('/o/object-admin/v1.0/object-definitions?pageSize=200');
    return `${(d.items || []).length} definitions readable`;
  });

  if (spaceERC) {
    await step('Cleanup: delete the temporary space', async () => {
      await lr(`/o/headless-asset-library/v1.0/asset-libraries/${spaceERC}`, { method: 'DELETE' });
    });
  }

  const failed = results.filter(r => !r.ok).length;
  console.log('\n── Matrix row (paste into marketplace/STOREFRONT.md) ──');
  console.log(`| ${portalVersion} | ${new Date().toISOString().slice(0, 10)} | ${USER} | ` +
    results.map(r => (r.ok ? '✅' : '❌') + ' ' + r.name.split(' ')[0].toLowerCase()).join(' · ') + ' |');
  process.exit(failed ? 1 : 0);
})();
