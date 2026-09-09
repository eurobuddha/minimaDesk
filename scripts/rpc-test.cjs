const assert = require('node:assert/strict');
const net = require('node:net');
const { test } = require('node:test');
const { rpcCall } = require('../main/rpc');
const fs = require('node:fs');
const vm = require('node:vm');

async function withServer(handler, run) {
  const server = net.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(server.address().port); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('an interrupted RPC response rejects instead of leaving the operation pending', async () => {
  await withServer(socket => socket.once('data', () => {
    socket.end('HTTP/1.1 200 OK\r\nContent-Length: 1000\r\nConnection: close\r\n\r\n{"status":');
  }), async port => {
    let timer;
    try {
      await assert.rejects(Promise.race([
        rpcCall(port, 'test-only', 'status'),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('operation stayed pending')), 1500); })
      ]), error => error.message !== 'operation stayed pending');
    } finally { clearTimeout(timer); }
  });
});

test('the existing LF-header parser and UTF-8 POST length remain compatible', async () => {
  const command = 'status ' + 'é'.repeat(6000);
  await withServer(socket => {
    let received = Buffer.alloc(0);
    socket.on('data', chunk => {
      received = Buffer.concat([received, chunk]);
      const end = received.indexOf('\r\n\r\n');
      if (end < 0) return;
      const header = received.subarray(0, end).toString();
      const length = Number(/content-length: (\d+)/i.exec(header)?.[1]);
      if (received.length - end - 4 < length) return;
      assert.equal(length, Buffer.byteLength(command));
      assert.equal(received.subarray(end + 4).toString(), command);
      assert.match(header, /^POST \/ HTTP/);
      const body = '{"status":true,"response":{"ok":true}}';
      socket.end('HTTP/1.1 200 OK\nContent-Length: ' + Buffer.byteLength(body) + '\nConnection: close\n\n' + body);
    });
  }, async port => assert.deepEqual(await rpcCall(port, 'test-only', command), { status: true, response: { ok: true } }));
});

test('the Parlons panel API also rejects an interrupted response after sign-in', async () => {
  await withServer(socket => socket.once('data', data => {
    if (data.toString().startsWith('GET /open?ticket=test-ticket ')) {
      socket.end('HTTP/1.1 302 Found\r\nSet-Cookie: parlons_session=test-session; HttpOnly\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
    } else {
      assert.match(data.toString(), /^POST \/api\/node.figures /);
      assert.match(data.toString(), /Cookie: parlons_session=test-session/i);
      socket.end('HTTP/1.1 200 OK\r\nContent-Length: 1000\r\nConnection: close\r\n\r\n{"ok":');
    }
  }), async port => {
    // Load the real bridge with a fake account location; no live ticket or Electron app.
    const module = { exports: {} };
    const source = fs.readFileSync(require.resolve('../main/parlonsapi'), 'utf8');
    vm.runInNewContext(source, { module, Buffer, require(name) {
      if (name === './config') return { panelPort: () => port };
      if (name === './node-manager') return { kind: () => 'parlons', dataDir: () => '/unused-test-account' };
      if (name === 'fs') return { readFileSync: () => '/open?ticket=test-ticket' };
      return require(name);
    } });
    let timer;
    try {
      await assert.rejects(Promise.race([
        module.exports.api('node.figures'),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('operation stayed pending')), 1500); })
      ]), error => error.message !== 'operation stayed pending');
    } finally { clearTimeout(timer); }
  });
});
