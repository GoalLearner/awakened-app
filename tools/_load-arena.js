// Shared headless loader: stubs a minimal DOM so app.js's IIFE reaches the
// window.Arena export, then exports Arena. Dev-only; not bundled.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function inert() {
  const f = function () { return proxy; };
  const proxy = new Proxy(f, {
    get(_t, p) {
      if (p === Symbol.toPrimitive) return () => '';
      if (p === Symbol.iterator) return function* () {};
      if (p === 'length') return 0;
      if (p === 'value' || p === 'textContent' || p === 'innerHTML') return '';
      if (p === 'parentNode' || p === 'firstChild' || p === 'nextSibling') return null;
      return proxy;
    },
    set() { return true; }, apply() { return proxy; }, has() { return true; },
  });
  return proxy;
}
const store = {};
const localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; },
  clear: () => { for (const k in store) delete store[k]; }, key: () => null, length: 0,
};
const documentStub = new Proxy({
  getElementById: () => inert(), querySelector: () => inert(), querySelectorAll: () => [],
  createElement: () => inert(), createElementNS: () => inert(), createDocumentFragment: () => inert(),
  addEventListener: () => {}, removeEventListener: () => {},
  body: inert(), documentElement: inert(), head: inert(), readyState: 'complete', cookie: '',
}, { get(t, p) { return (p in t) ? t[p] : inert(); } });
const win = {};
const windowStub = new Proxy(win, {
  get(t, p) {
    if (p in t) return t[p];
    switch (p) {
      case 'document': return documentStub;
      case 'localStorage': return localStorage;
      case 'navigator': return { userAgent: 'node', language: 'en' };
      case 'location': return { href: 'http://localhost/', hostname: 'localhost', search: '', pathname: '/' };
      case 'addEventListener': case 'removeEventListener': case 'scrollTo': case 'dispatchEvent': return () => {};
      case 'matchMedia': return () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      case 'requestAnimationFrame': return () => 0;
      case 'cancelAnimationFrame': case 'clearTimeout': case 'clearInterval': return () => {};
      case 'setTimeout': case 'setInterval': return () => 0;
      case 'getComputedStyle': return () => inert();
      default: return undefined;
    }
  },
  set(t, p, v) { t[p] = v; return true; }, has() { return true; },
});
const sandbox = {
  window: windowStub, document: documentStub, localStorage,
  navigator: windowStub.navigator, location: windowStub.location, console,
  setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
  requestAnimationFrame: () => 0, cancelAnimationFrame: () => {}, getComputedStyle: () => inert(),
  matchMedia: windowStub.matchMedia,
  Math, JSON, Date, Object, Array, Proxy, Reflect, Symbol, Map, Set, WeakMap, WeakSet, Promise, RegExp, Error,
  parseInt, parseFloat, isFinite, isNaN, encodeURIComponent, decodeURIComponent,
  btoa: (s) => Buffer.from(s).toString('base64'), atob: (s) => Buffer.from(s, 'base64').toString(),
  fetch: () => Promise.reject(new Error('no fetch in sim')),
};
sandbox.globalThis = sandbox; sandbox.self = windowStub;

const code = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const ctx = vm.createContext(sandbox);
let loadErr = null;
try { vm.runInContext(code, ctx, { filename: 'app.js' }); } catch (e) { loadErr = e; }
const Arena = windowStub.Arena || win.Arena;
if (!Arena || !Arena.simAscent) {
  console.error('FATAL: Arena.simAscent not exposed.', loadErr && loadErr.stack ? loadErr.stack.split('\n').slice(0, 5).join('\n') : loadErr);
  process.exit(1);
}
module.exports = { Arena, loadErr };
