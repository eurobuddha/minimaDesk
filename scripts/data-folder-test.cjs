// Reuses the VM/Electron isolation pattern in parlons-calls-test.cjs.
// All paths and filesystem operations below are fake; no user's wallet is opened.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function fixture({ home = '/users/test', existing = [], failMove = false } = {}) {
  const userData = '/users/test/Library/Application Support/minimaDesk';
  const legacy = path.join(userData, 'minima-data');
  const target = path.join(home, '.minimadesk-data');
  const temporary = path.join('/scratch', '.minimadesk-data');
  const present = new Set(existing.map(p => ({ legacy, target, temporary }[p] || p)));
  const moves = [];
  const fakeFs = { existsSync: p => present.has(p), renameSync(a,b) {
    moves.push([a,b]);if(failMove)throw new Error('EXDEV simulated');present.delete(a);present.add(b);
  } };
  const ctx = { module: { exports: {} }, require(n) {
    if(n==='electron')return { app: { getPath: k => k==='home'?home:userData } };
    if(n==='fs')return fakeFs;
    if(n==='os')return {tmpdir:()=>'/scratch'};
    if(n==='./params')return {};
    return require(n);
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../main/config.js'),'utf8'),ctx);
  return { cfg:ctx.module.exports, legacy,target,temporary,present,moves };
}
test('ordinary resolution and preview never move an existing wallet',()=>{
  const f=fixture({existing:['legacy']});
  assert.equal(f.cfg.defaultDataFolder(),f.legacy);
  assert.deepEqual(f.moves,[]);assert.ok(f.present.has(f.legacy));
});
test('startup migration preserves the existing successful rename behavior',()=>{
  const f=fixture({existing:['legacy']});
  assert.equal(f.cfg.defaultDataFolder({migrate:true}),f.target);
  assert.deepEqual(f.moves,[[f.legacy,f.target]]);assert.ok(f.present.has(f.target));
});
test('failed migration keeps using the existing wallet, including later reads',()=>{
  const f=fixture({existing:['legacy'],failMove:true});
  assert.equal(f.cfg.defaultDataFolder({migrate:true}),f.legacy);
  assert.equal(f.cfg.defaultDataFolder(),f.legacy);
  assert.equal(f.moves.length,1);assert.ok(!f.present.has(f.target));
});
test('an existing destination remains selected and neither directory is moved',()=>{
  const f=fixture({existing:['legacy','target']});
  assert.equal(f.cfg.defaultDataFolder({migrate:true}),f.target);assert.deepEqual(f.moves,[]);
});
test('new wallets with spaces in their home path use durable home storage',()=>{
  const f=fixture({home:'/users/Test User'});
  assert.equal(f.cfg.defaultDataFolder({migrate:true}),f.target);
  assert.notEqual(f.target,f.temporary);assert.deepEqual(f.moves,[]);
});
test('an existing old temporary wallet is retained until startup migration succeeds',()=>{
  const f=fixture({home:'/users/Test User',existing:['temporary']});
  assert.equal(f.cfg.defaultDataFolder(),f.temporary);assert.deepEqual(f.moves,[]);
  assert.equal(f.cfg.defaultDataFolder({migrate:true}),f.target);
  assert.deepEqual(f.moves,[[f.temporary,f.target]]);
});
test('failed temporary-wallet relocation retains its source instead of creating a replacement',()=>{
  const f=fixture({home:'/users/Test User',existing:['temporary'],failMove:true});
  assert.equal(f.cfg.defaultDataFolder({migrate:true}),f.temporary);
  assert.ok(f.present.has(f.temporary));assert.ok(!f.present.has(f.target));
});
test('actual node argument builder keeps previews read-only and migrates only on startup',()=>{
  const f=fixture({existing:['legacy']});
  const source=fs.readFileSync(path.join(__dirname,'../main/node-manager.js'),'utf8');
  const start=source.indexOf('  buildArgs(cfg =');
  const end=source.indexOf('\n  /**',start);
  const config={...f.cfg,effectiveParams:()=>({argv:[],conf:{}})};
  const made=[];
  const node=vm.runInNewContext('({'+source.slice(start,end)+'})',{
    config,fs:{mkdirSync:p=>made.push(p)},tokenizeArgs:()=>[]
  });
  node.jarPath=()=>'/fake/minima.jar';node.confPath=()=>'/fake/node.conf';node.writeConfFile=node.confPath;
  const cfg={nodeKind:'minima',basePort:20001,dataFolder:'',params:{},extraArgs:''};
  const preview=node.buildArgs(cfg,{dryRun:true});
  assert.equal(preview.args[preview.args.indexOf('-data')+1],f.legacy);
  assert.deepEqual(f.moves,[]);assert.deepEqual(made,[]);
  const argv=node.buildArgs(cfg);
  assert.equal(argv[argv.indexOf('-data')+1],f.target);
  assert.deepEqual(f.moves,[[f.legacy,f.target]]);assert.deepEqual(made,[f.target]);
});
