// 화면 그리기(main.js) 테스트: 방 상태에서 온 값이 HTML로 해석되지 않는지 (#2)
const assert = require('assert');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const els = {};
const el = (id) => els[id] || (els[id] = { id, innerHTML: '', textContent: '', style: { setProperty() {} }, className: '', disabled: false });
const ctx = {
  window: { innerWidth: 1200, innerHeight: 800 },
  document: { getElementById: el },
  location: { origin: 'http://localhost' },
  console,
};
ctx.window.document = ctx.document;
vm.createContext(ctx);
for (const f of ['game_logic.js', 'main.js']) {
  const file = path.join(__dirname, '..', 'public', f);
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
}
const run = (code) => vm.runInContext(code, ctx);

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const EVIL = '<img src=x onerror=alert(1)>';

test('방 코드는 textContent로 들어간다', () => {
  ctx.__room = { code: EVIL, hostId: 'h', status: 'lobby', members: [{ id: 'h', nickname: 'a', color: '#e74c3c' }], game: null };
  run('g_room = __room; g_myId = "h"; drawLobby();');
  assert.strictEqual(el('lobby-code').textContent, EVIL);
  assert.strictEqual(el('lobby-code').innerHTML, '');
});

test('색상은 COLOR_LIST에 있는 값만 쓴다', () => {
  const html = run('charHtml(\'x" onmouseover="alert(1)\', "mini")');
  assert.ok(!html.includes('onmouseover'), html);
  assert.ok(html.includes('--c:#e74c3c'));
});

test('칸 종류·위치·아이템·순위의 이상한 값은 무시된다', () => {
  ctx.__room = {
    code: 'ABCD', hostId: 'h', status: 'finished',
    members: [{ id: 'h', nickname: 'a', color: '#e74c3c' }],
    game: {
      board: ['start', EVIL, 'finish'], turnIndex: 0, log: [], pending: {}, itemUsedThisTurn: false,
      players: [{ id: 'h', nickname: 'a', color: '#e74c3c', alive: true, position: EVIL, items: [EVIL, 'shield'], resting: false }],
      rankings: [{ id: 'h', nickname: 'a', color: '#e74c3c', rank: EVIL, position: EVIL }],
    },
  };
  run('g_room = __room; g_myId = "h"; drawBoard(); drawPlayers(); drawResult();');
  for (const id of ['board', 'player-list', 'rankings']) {
    assert.ok(!el(id).innerHTML.includes('<img src=x'), id + ': ' + el(id).innerHTML);
  }
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
