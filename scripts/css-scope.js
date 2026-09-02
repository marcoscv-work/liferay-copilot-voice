/* CSS scope tooling for styles.css.
 *
 *   node scripts/css-scope.js check      → exit 1 listing unscoped selectors
 *   node scripts/css-scope.js transform  → prefix unscoped selectors in place
 *
 * The stylesheet ships as a client extension cssURL, i.e. it lands globally
 * in the portal page: every selector must be anchored to the
 * <liferay-copilot-voice> element, with a short documented allowlist.
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'styles.css');
const PREFIX = 'liferay-copilot-voice';

/* Selectors allowed to remain unanchored, with the reason. */
const ALLOWED = [
  /^liferay-copilot-voice\b/,          // the element itself / already scoped
  /^body\.copilot-standalone\b/,       // standalone page opt-in
  /^\.portlet-boundary:has\(liferay-copilot-voice\)/, // hides OUR portlet chrome only
];
/* Selectors whose first compound lives on <body> — the prefix is inserted
   after it instead of in front. */
const BODY_CLASS = /^\.debug-live-regions\b/;

function splitTopLevel(sel) {
  const parts = [];
  let depth = 0, cur = '';
  for (const ch of sel) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

function processSelector(sel) {
  return splitTopLevel(sel).map(raw => {
    const s = raw.trim();
    if (!s) return raw;
    if (ALLOWED.some(re => re.test(s))) return s;
    if (s.includes(PREFIX)) return s; /* already anchored (e.g. body-class + prefix) */
    if (BODY_CLASS.test(s)) {
      return s.replace(BODY_CLASS, m => `${m} ${PREFIX}`).replace(`${PREFIX}  `, `${PREFIX} `);
    }
    return `${PREFIX} ${s}`;
  }).join(',\n');
}

function walk(css, mode, report) {
  let out = '';
  let i = 0;
  const n = css.length;
  let buf = '';
  while (i < n) {
    if (css[i] === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      const j = end === -1 ? n : end + 2;
      out += buf + css.slice(i, j);
      buf = '';
      i = j;
      continue;
    }
    const ch = css[i];
    if (ch === '{') {
      const sel = buf;
      const selTrim = sel.trim();
      // find matching close brace
      let depth = 1, j = i + 1;
      while (j < n && depth > 0) {
        if (css[j] === '/' && css[j + 1] === '*') { j = css.indexOf('*/', j) + 2 || n; continue; }
        if (css[j] === '{') depth++;
        else if (css[j] === '}') depth--;
        j++;
      }
      const body = css.slice(i + 1, j - 1);
      if (selTrim.startsWith('@media') || selTrim.startsWith('@supports')) {
        out += sel + '{' + walk(body, mode, report) + '}';
      } else if (selTrim.startsWith('@')) {
        out += sel + '{' + body + '}'; // @keyframes, @font-face — untouched
      } else {
        const indent = sel.match(/^\s*/)[0];
        const fixed = processSelector(selTrim);
        if (fixed.replace(/\s+/g, ' ') !== selTrim.replace(/\s+/g, ' ')) {
          report.push(selTrim.replace(/\s+/g, ' '));
        }
        out += indent + (mode === 'transform' ? fixed + ' ' : selTrim + ' ') + '{' + body + '}';
      }
      buf = '';
      i = j;
      continue;
    }
    buf += ch;
    i++;
  }
  return out + buf;
}

const mode = process.argv[2] || 'check';
const css = fs.readFileSync(FILE, 'utf8');
const report = [];
const result = walk(css, mode, report);

if (mode === 'transform') {
  fs.writeFileSync(FILE, result);
  console.log(`Prefixed ${report.length} selectors.`);
} else {
  if (report.length) {
    console.error(`UNSCOPED selectors (${report.length}):`);
    report.slice(0, 40).forEach(s => console.error('  ' + s));
    process.exit(1);
  }
  console.log('CSS scope check OK — every selector is anchored.');
}
