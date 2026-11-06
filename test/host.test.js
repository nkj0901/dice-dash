// 방장 브라우저용 방 서버(HostRoom) 테스트
const assert = require('assert');
const { HostRoom, publicState } = require('./legacy_loader');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function setup() {
  const out = [];
  const send = (to, event, payload) => out.push({ to, event, payload: JSON.parse(JSON.stringify(payload)) });
  const host = HostRoom.create('ABCD', 'h', '방장', send);
  return { host, out, last: (ev) => [...out].reverse().find((m) => m.event === ev) };
}

test('입장 → 멤버 추가, 색상 다름', () => {
  const { host, last } = setup();
  host.handle('b', 'room:join', { nickname: '비' });
  const s = last('room:state').payload;
  assert.deepStrictEqual(s.members.map((m) => m.id), ['h', 'b']);
  assert.notStrictEqual(s.members[0].color, s.members[1].color);
});

test('닉네임 중복·게임 중 입장 거절은 본인에게만 오류', () => {
  const { host, last } = setup();
  host.handle('b', 'room:join', { nickname: '방장' });
  assert.deepStrictEqual(last('app:error'), { to: 'b', event: 'app:error', payload: { message: '이미 사용 중인 닉네임입니다.' } });
  host.handle('b', 'room:join', { nickname: '비' });
  host.handle('h', 'game:start');
  host.handle('c', 'room:join', { nickname: '씨' });
  assert.strictEqual(last('app:error').payload.message, '이미 게임이 진행 중인 방입니다.');
});

test('같은 사람이 입장 요청을 다시 보내도 중복 추가 안 됨', () => {
  const { host, last } = setup();
  host.handle('b', 'room:join', { nickname: '비' });
  host.handle('b', 'room:join', { nickname: '비' });
  assert.strictEqual(last('room:state').payload.members.length, 2);
});

test('방장만 시작, 2명 이상 필요', () => {
  const { host, last } = setup();
  host.handle('h', 'game:start');
  assert.strictEqual(last('app:error').payload.message, '2명 이상이어야 시작할 수 있습니다.');
  host.handle('b', 'room:join', { nickname: '비' });
  host.handle('b', 'game:start');
  assert.strictEqual(last('app:error').payload.message, '방장만 게임을 시작할 수 있습니다.');
  host.handle('h', 'game:start');
  assert.strictEqual(last('room:state').payload.status, 'playing');
});

test('굴리기 → 이벤트 브로드캐스트, 차례 넘어감', () => {
  const { host, last } = setup();
  host.handle('b', 'room:join', { nickname: '비' });
  host.handle('h', 'game:start');
  host.handle('b', 'game:roll');
  assert.strictEqual(last('app:error').payload.message, '지금은 내 차례가 아닙니다.');
  host.handle('h', 'game:roll');
  assert.strictEqual(last('game:events').to, null);
  assert.ok(last('game:events').payload.events.some((e) => e.type === 'roll'));
});

test('방 밖 사람의 게임 요청 거절', () => {
  const { host, last } = setup();
  host.handle('x', 'game:roll');
  assert.strictEqual(last('app:error').payload.message, '방에 참가하고 있지 않습니다.');
});

test('방장 이탈 → 마지막 상태로 다른 사람이 이어받아 계속 진행', () => {
  const { host, last } = setup();
  host.handle('b', 'room:join', { nickname: '비' });
  host.handle('c', 'room:join', { nickname: '씨' });
  host.handle('h', 'game:start');
  const state = last('room:state').payload;

  const out2 = [];
  const host2 = HostRoom.fromState(state, 'b', (to, event, payload) => out2.push({ to, event, payload }));
  host2.leave('h', { silent: true });
  host2.broadcast();
  const s = out2[out2.length - 1].payload;
  assert.strictEqual(s.hostId, 'b');
  assert.deepStrictEqual(s.members.map((m) => m.id), ['b', 'c']);
  assert.strictEqual(s.game.players.find((p) => p.id === 'h').alive, false);
  assert.strictEqual(s.status, 'playing');
  const cur = s.game.players[s.game.turnIndex].id;
  host2.handle(cur, 'game:roll');
  assert.ok(out2.some((m) => m.event === 'game:events'));
});

test('상태 직렬화 후에도 게임 종료 여부가 유지됨', () => {
  const { host, last } = setup();
  host.handle('b', 'room:join', { nickname: '비' });
  host.handle('h', 'game:start');
  host.leave('b');
  const s = last('room:state').payload;
  assert.strictEqual(s.status, 'finished');
  assert.strictEqual(s.game.finished, true);
  const host2 = HostRoom.fromState(s, 'h', () => {});
  host2.handle('h', 'game:roll');
});

test('초당 요청 제한', () => {
  const { host, out } = setup();
  for (let i = 0; i < 12; i++) host.handle('h', 'game:roll');
  assert.ok(out.some((m) => m.payload.message === '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.'));
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
