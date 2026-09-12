const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
const source = fs.readFileSync(process.env.PARLONS_VIEW_SOURCE || path.join(__dirname, '../renderer/src/shell/views/ParlonsView.tsx'), 'utf8');
// Run the actual component with deterministic hook/IPC boundaries. JSX is a plain tree;
// this checks effects and session lifecycle, not browser layout or Electron navigation policy.
function fixture(active = true) {
  const slots = [], effects = [], intervals = new Map(), timers = new Map();
  let cursor = 0, dirty = true, tree, tick = 0, urlCalls = 0, failed = false;
  const status = {kind: 'parlons', state: 'running', startedTs: 100, parlons: {ready: true}};
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { const next = typeof value === 'function' ? value(slots[i]) : value; if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; } }]; },
    useRef(initial) { const i = cursor++; return slots[i] || (slots[i] = {current: initial}); },
    useEffect(fn, deps) { const i = cursor++, prev = slots[i]; if (!prev || deps.some((d, n) => !Object.is(d, prev.deps[n]))) { slots[i] = {deps, cleanup: prev && prev.cleanup}; effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = fn(); }); } }
  };
  const context = vm.createContext({exports: {}, require(name) { if (name === 'react') return react; if (name === 'react/jsx-runtime') return {jsx: (type, props) => ({type, props}), jsxs: (type, props) => ({type, props}), Fragment: 'fragment'}; if (name === '../ShellContext') return {useShell: () => ({ports: {kind: 'parlons'}, switchTab() {}}), useShellStatus: () => status}; throw new Error(name); },
    window: {minima: {parlonsStatus: async () => { if (failed) throw new Error('offline'); return {ready: true, panelPort: 123}; }, parlonsPanelUrl: async () => 'http://127.0.0.1:123/ticket/' + (++urlCalls)}},
    setInterval(fn) { intervals.set(++tick, fn); return tick; }, clearInterval(id) { intervals.delete(id); },
    setTimeout(fn) { timers.set(++tick, fn); return tick; }, clearTimeout(id) { timers.delete(id); }
  });
  vm.runInContext(ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020}}).outputText, context);
  return {
    async flush() { for (let i = 0; i < 30; i++) { if (dirty) { dirty = false; cursor = 0; tree = context.exports.default({active}); while (effects.length) effects.shift()(); } await Promise.resolve(); } },
    all(type) { const found = []; function walk(node) { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) return node.forEach(walk); if (node.type === type) found.push(node); walk(node.props?.children); } walk(tree); return found; },
    poll(value) { failed = value; for (const fn of intervals.values()) fn(); }, get calls() { return urlCalls; },
  };
}
test('Reload obtains another one-time link without requiring a node restart', async () => {
  const f = fixture(); await f.flush(); assert.equal(f.calls, 1);
  const reload = f.all('button').find(b => b.props.children === 'Reload'); assert.ok(reload);
  reload.props.onClick(); await f.flush(); assert.equal(f.calls, 2);
  assert.match(f.all('webview')[0].props.src, /ticket\/2$/);
});
test('status failure is visible and recovery obtains a fresh link after unmounting', async () => {
  const f = fixture(); await f.flush(); f.poll(true); await f.flush();
  assert.equal(f.all('webview').length, 0);
  assert.ok(f.all('div').some(n => String(n.props.children).includes('Could not check')));
  f.poll(false); await f.flush(); assert.equal(f.calls, 2); assert.match(f.all('webview')[0].props.src, /ticket\/2$/);
});

test("receiver loads before visiting the Parlons tab", async () => { const f = fixture(false); await f.flush(); assert.equal(f.calls, 1); assert.equal(f.all("webview").length, 1); });
