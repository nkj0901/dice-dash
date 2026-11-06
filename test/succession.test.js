// 방장 승계(network.js) 테스트: 방장과 다음 순번이 거의 동시에 나가도 남은 사람이 이어받는지 (#3)
const assert = require('assert');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

function client(myId) {
  const store = { 'diceDash.myId': myId };
  const ctx = {
    window: { sessionStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } } },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    console, JSON, Math, Date, Promise,
  };
  vm.createContext(ctx);
  for (const f of ['game_logic.js', 'network.js']) {
    const file = path.join(__dirname, '..', 'public', f);
    vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
  }
  const sent = [];
  const handlers = {};
  let presence = {};
  const ch = {
    on: (type, filter, fn) => { handlers[type + ':' + filter.event] = fn; return ch; },
    subscribe: () => ch,
    track: () => Promise.resolve(),
    send: (m) => { sent.push(m); return Promise.resolve(); },
    presenceState: () => Object.assign({}, presence),
  };
  ctx.__ch = ch;
  vm.runInContext('g_sb = { channel: function () { return __ch; }, removeChannel: function () { return Promise.resolve(); } }; net_open("ABCD", "join");', ctx);
  return {
    ctx, sent,
    sync(ids) { presence = {}; for (const id of ids) presence[id] = [{ id }]; handlers['presence:sync'](); },
    setState(st) { ctx.__st = st; vm.runInContext('g_lastState = __st;', ctx); },
    hostId() { return vm.runInContext('g_hostRoom ? g_hostRoom.hostId : null', ctx); },
  };
}

const state = {
  code: 'ABCD', hostId: 'H', status: 'lobby', game: null,
  members: [{ id: 'H', nickname: 'h', color: '#e74c3c' }, { id: 'B', nickname: 'b', color: '#3498db' }, { id: 'C', nickname: 'c', color: '#2ecc71' }],
};

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('방장이 나가면 다음 순번이 바로 이어받는다', () => {
  const b = client('B');
  b.sync(['H', 'B', 'C']);
  b.setState(state);
  b.sync(['B', 'C']);
  assert.strictEqual(b.hostId(), 'B');
});

test('방장과 다음 순번이 시차를 두고 같이 나가도 남은 사람이 이어받는다', () => {
  const c = client('C');
  c.sync(['H', 'B', 'C']);
  c.setState(state);
  c.sync(['B', 'C']);           // H만 빠짐 → B가 이어받을 차례라 기다림
  assert.strictEqual(c.hostId(), null);
  c.sync(['C']);                // B도 빠짐 → 상태의 방장(H)이 여전히 없으니 C가 이어받음
  assert.strictEqual(c.hostId(), 'C');
  assert.ok(c.sent.some((m) => m.event === 's2c' && m.payload.event === 'room:state' && m.payload.payload.hostId === 'C'));
});

test('방장을 presence로 본 적이 없으면 이어받지 않는다', () => {
  const c = client('C');
  c.setState(state);
  c.sync(['C']);
  assert.strictEqual(c.hostId(), null);
});

let passed = 0;
for (const t of tests) {
  try {
    t.fn();
    passed++;
    console.log(`  ✓ ${t.name}`);
  } catch (e) {
    console.log(`  ✗ ${t.name}\n    ${e.message}`);
  }
}
console.log(`\n${passed}/${tests.length} 통과`);
if (passed !== tests.length) process.exit(1);
