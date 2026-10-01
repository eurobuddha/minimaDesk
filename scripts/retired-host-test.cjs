/*
 * retired-host-test.cjs — 31.125.188.214 must never be the VALUE of a default again.
 *
 * That IP was the ORIGINAL eurobuddha.com. Every duty it held has been moved off it (owner, 2026-10-01),
 * and it had been left behind in two live defaults here: the single bootstrap peer a fresh install gets
 * (PARLONS_DEFAULT_ROOTNODE) and a selectable Maxima relay labelled "Pi (home)". A default pointing at a
 * retired address fails in the worst way available — the node just never connects, and nothing on screen
 * tells the user that the host moved rather than their install being broken.
 *
 * It may still appear in a COMMENT recording the history, or in a migration's equality test (which has to
 * name the old address to recognise it). What must never come back is the IP as a value.
 * Run: node --test scripts/retired-host-test.cjs
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const RETIRED = '31.125.188.214';
const FILES = fs.readdirSync(path.join(ROOT, 'main')).filter(f => f.endsWith('.js')).map(f => 'main/' + f);

test('the retired IP is never ASSIGNED as a value anywhere in main/', () => {
  const offenders = [];
  for (const rel of FILES) {
    const lines = fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n');
    lines.forEach((l, i) => {
      if (!l.includes(RETIRED)) return;
      const code = l.split('//')[0];                       // a trailing comment is allowed to name it
      if (!code.includes(RETIRED)) return;                 // comment-only mention
      if (/===|!==|==|!=/.test(code)) return;              // a migration recognising the old value
      offenders.push(`${rel}:${i + 1}: ${l.trim()}`);
    });
  }
  assert.deepStrictEqual(offenders, [], 'retired IP used as a value:\n' + offenders.join('\n'));
});

test('the default bootstrap peer is a name, not a bare IP', () => {
  const src = fs.readFileSync(path.join(ROOT, 'main/node-manager.js'), 'utf8');
  const m = /PARLONS_DEFAULT_ROOTNODE\s*=\s*"([^"]+)"/.exec(src);
  assert.ok(m, 'PARLONS_DEFAULT_ROOTNODE not found');
  const host = m[1].split(':')[0];
  assert.ok(!/^\d+\.\d+\.\d+\.\d+$/.test(host), `bootstrap peer is a bare IP (${host}) — use a DNS name so it can move`);
});

test('the relay fleet offers no retired host, and still has a default', () => {
  const relays = require(path.join(ROOT, 'main/relays.js'));
  const list = relays.KNOWN_RELAYS || relays.knownRelays;
  assert.ok(Array.isArray(list) && list.length, 'KNOWN_RELAYS must be a non-empty exported list');
  assert.ok(!list.some(r => String(r.host).includes(RETIRED)), 'a retired host is still offered as a relay');
  assert.ok(list.some(r => String(r.host) === String(relays.DEFAULT_RELAY)), 'DEFAULT_RELAY must be one of the known relays');
});
