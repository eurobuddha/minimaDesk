// The Parlons Node gains the keets transport (KeetChat interop) only when the
// bundled sidecar exists, and the flags ride -Dparlons.node.args with OUR
// binary as the sidecar runtime. Extracted from the real source, like
// data-folder-test does, so a refactor that drops the flags fails here.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function builder(sidecarExists, keetsJar = true) {
  const source = fs.readFileSync(path.join(__dirname, '../main/node-manager.js'), 'utf8');
  const start = source.indexOf('  buildParlonsArgs(');
  const end = source.indexOf('\n  start()', start);
  const node = vm.runInNewContext('({' + source.slice(start, end) + '})', {
    fs: { existsSync: () => sidecarExists },
    process: { execPath: '/fake/Electron' },
    tokenizeArgs: () => [],
    PARLONS_REFUSED: new Set(),
    PARLONS_KEETS: keetsJar,
    PARLONS_DEFAULT_ROOTNODE: 'fake:9001',
  });
  node.parlonsJarPath = () => '/fake/parlons-node.jar';
  node.keetsSidecarPath = () => '/fake/res/keets-sidecar/index.js';
  node.confPath = () => '/fake/node.conf';
  node.writeConfFile = node.confPath;
  return node;
}

const CFG = { heapMb: 0, contribute: false, extraArgs: '' };

function nodeArgsOf(argv) {
  const d = argv.find((a) => String(a).startsWith('-Dparlons.node.args='));
  assert.ok(d, 'parlons.node.args present');
  return d;
}

test('keets flags ride parlons.node.args when the sidecar is bundled', () => {
  const argv = builder(true).buildParlonsArgs(CFG, '/data', 20001, [], {}, true).args;
  const flags = nodeArgsOf(argv);
  assert.match(flags, /-keets -keetssidecar "\/fake\/res\/keets-sidecar\/index\.js" -keetsnode "\/fake\/Electron"/);
});

test('no sidecar bundled -> no keets flags (dev checkout still boots)', () => {
  const flags = nodeArgsOf(builder(false).buildParlonsArgs(CFG, '/data', 20001, [], {}, true).args);
  assert.ok(!flags.includes('-keets'), 'keets flags absent: ' + flags);
});

test('pinned jar without the keets line (0.2.123, MDS) -> no keets flags even with the sidecar bundled', () => {
  const flags = nodeArgsOf(builder(true, false).buildParlonsArgs(CFG, '/data', 20001, [], {}, true).args);
  assert.ok(!flags.includes('-keets'), 'keets flags absent: ' + flags);
});

test('the shipped pin and PARLONS_KEETS agree (0.2.142+ has MDS and keets)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../main/node-manager.js'), 'utf8');
  const pin = require('../package.json').parlonsNode;
  assert.strictEqual(pin, '0.2.143');
  assert.match(src, /const PARLONS_KEETS = true;/);
});
