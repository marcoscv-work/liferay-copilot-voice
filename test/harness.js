/* Test harness: loads the 8 runtime modules into one vm context backed by a
 * permissive DOM stub, mirroring how element.js chains them in the browser
 * (shared global lexical scope, strict load order). Pure functions
 * (normalize, format pass, number/date parsing, escaping…) are then
 * exercised directly by the test files via app().
 *
 * The stub is intentionally forgiving: every element responds to the DOM
 * surface the modules touch at load/boot time. Anything network-ish rejects,
 * which exercises the same fallback paths as an offline browser.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeClassList() {
  const set = new Set();
  return {
    add: (...c) => c.forEach(x => set.add(x)),
    remove: (...c) => c.forEach(x => set.delete(x)),
    toggle: (c, force) => {
      const on = force === undefined ? !set.has(c) : !!force;
      on ? set.add(c) : set.delete(c);
      return on;
    },
    contains: c => set.has(c),
  };
}

function makeElement(tag = 'DIV') {
  const el = {
    tagName: tag.toUpperCase(),
    classList: makeClassList(),
    style: {},
    dataset: {},
    attributes: {},
    children: [],
    hidden: false,
    inert: false,
    value: '',
    textContent: '',
    innerHTML: '',
    disabled: false,
    offsetWidth: 100,
    offsetHeight: 100,
    scrollWidth: 100,
    clientWidth: 100,
    scrollHeight: 100,
    scrollLeft: 0,
    scrollTop: 0,
    addEventListener() {},
    removeEventListener() {},
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k] ?? null; },
    removeAttribute(k) { delete this.attributes[k]; },
    appendChild(c) { this.children.push(c); return c; },
    insertBefore(c) { this.children.unshift(c); return c; },
    focus() {},
    blur() {},
    click() {},
    closest() { return null; },
    querySelector() { return makeElement('SPAN'); },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { top: 0, left: 0, right: 100, bottom: 100, width: 100, height: 100 }; },
  };
  return el;
}

function buildSandbox() {
  const byId = new Map();
  const getElementById = id => {
    if (!byId.has(id)) byId.set(id, makeElement(id === 'bodyInput' ? 'TEXTAREA' : 'DIV'));
    return byId.get(id);
  };
  const documentStub = {
    getElementById,
    createElement: tag => makeElement(tag),
    querySelector: () => makeElement(),
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    contains: () => false,
    activeElement: null,
    body: makeElement('BODY'),
    documentElement: makeElement('HTML'),
    currentScript: null,
  };
  const sandbox = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    URL, URLSearchParams,
    document: documentStub,
    navigator: { language: 'es-ES', mediaDevices: undefined },
    location: { search: '', origin: 'http://localhost:8765', href: 'http://localhost:8765/', pathname: '/' },
    history: { replaceState() {} },
    performance: { now: () => Date.now() },
    requestAnimationFrame: fn => setTimeout(fn, 0),
    cancelAnimationFrame: id => clearTimeout(id),
    fetch: () => Promise.reject(new Error('offline test harness')),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    FormData: class FormData { append() {} },
    btoa: s => Buffer.from(s).toString('base64'),
    Audio: undefined,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  return sandbox;
}

let cachedApp = null;

function app() {
  if (cachedApp) return cachedApp;
  const sandbox = buildSandbox();
  const context = vm.createContext(sandbox);
  const SRC = path.join(__dirname, '..', 'src');
  const files = fs.readdirSync(SRC).filter(f => f.endsWith('.js')).sort();
  for (const f of files) {
    vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), context, { filename: f });
  }
  /* Pull the top-level bindings the tests exercise. */
  cachedApp = vm.runInContext(`({
    normalize, matchPhrase, s, escapeHTML, safeImageURL,
    applyInlinePunctuation, wrapAsQuestion, formatAsTitle, formatAsBody,
    parseNumberFromVoice, parseDateFromVoice, NUM_WORDS,
    capitalize, liferayErrorMessage, MODES, TRACKED_OVERLAYS,
    QUESTION_STARTERS,
    __setLocale: (loc) => { appConfig.locale = loc; },
    __setStrings: (obj) => { appConfig.strings = obj; },
  })`, context);
  cachedApp.__files = files;
  return cachedApp;
}

module.exports = { app };
