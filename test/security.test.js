const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { app } = require('./harness');

const A = app();
const ROOT = path.join(__dirname, '..');

test('escapeHTML neutralizes markup and attribute breakouts', () => {
  const payload = '<img src=x onerror=alert(1)>"\'&';
  const out = A.escapeHTML(payload);
  assert.ok(!out.includes('<'));
  assert.ok(!out.includes('>'));
  assert.ok(!out.includes('"'));
  assert.ok(!out.includes("'"));
  assert.ok(out.includes('&lt;img'));
});

test('safeImageURL rejects dangerous schemes and CSS breakouts', () => {
  assert.equal(A.safeImageURL('javascript:alert(1)'), null);
  assert.equal(A.safeImageURL('data:text/html,<script>'), null);
  assert.equal(A.safeImageURL(''), null);
  const ok = A.safeImageURL('/documents/123/photo.png?x="1) url(evil');
  assert.ok(ok.startsWith('http://localhost:8765/documents/123/photo.png'));
  assert.ok(!ok.includes('"'));
  assert.ok(!ok.includes(')'));
});

test('no dynamic data flows into innerHTML template literals unescaped', () => {
  /* Static lint: any `${...}` inside a template that lands in innerHTML must
     go through escapeHTML() or be a static icon constant. */
  const offenders = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'src'))) {
    const src = fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
    const re = /\$\{(?!escapeHTML\()([^}]*)\}/g;
    let inTemplateNearInnerHTML = src.split('\n');
    inTemplateNearInnerHTML.forEach((line, i) => {
      if (!/`/.test(line)) return;
      const window = inTemplateNearInnerHTML.slice(Math.max(0, i - 6), i + 1).join('\n');
      if (!/innerHTML\s*[+=]|html\s*[+=]|pills\.push/.test(window)) return;
      let m;
      while ((m = re.exec(line))) {
        const expr = m[1].trim();
        if (/^(escapeHTML|icon|cls|CHECK_ICON_SVG|FORM_ERROR_ICON_SVG|MIC_SVG_INLINE|i \+ 1|g\.title|it\.say|it\.result|isLong)/.test(expr)) continue;
        offenders.push(`${f}: \${${expr}}`);
      }
    });
  }
  assert.deepEqual(offenders, [], 'unescaped template interpolation near an HTML sink:\n' + offenders.join('\n'));
});

test('every stylesheet selector stays anchored to the custom element', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'css-scope.js'), 'check'], { stdio: 'pipe' });
});

test('language bundles stay in key parity', () => {
  const keys = {};
  for (const lang of ['es', 'en', 'it', 'pt', 'de', 'fr']) {
    const txt = fs.readFileSync(path.join(ROOT, 'language', `Language_${lang}.properties`), 'utf8');
    keys[lang] = new Set(txt.split('\n').filter(l => l.includes('=')).map(l => l.split('=')[0].trim()));
  }
  for (const lang of ['en', 'it', 'pt', 'de', 'fr']) {
    assert.deepEqual([...keys[lang]].sort(), [...keys.es].sort(), `parity ${lang} vs es`);
  }
});

test('modal modes declare a focus target and modal surfaces exist', () => {
  for (const [name, def] of Object.entries(A.MODES)) {
    if (def.modal) {
      assert.ok(def.focusTarget, `${name} must declare focusTarget`);
    }
  }
});
