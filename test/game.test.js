// 의존성 없는 간단한 테스트 러너 (Node 16 호환)
const assert = require('assert');
const { createGame, roll, useItem, removePlayer } = require('./legacy_loader').game;

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function rng(dice, items = ['double']) {
  const d = [...dice];
  const it = [...items];
  return { die: () => d.shift(), item: () => it.shift() };
}

function newGame(n = 3) {
  const names = ['A', 'B', 'C', 'D'];
  return createGame(names.slice(0, n).map((x) => ({ id: x, nickname: x, color: '#000' })));
}

const pos = (g, id) => g.players.find((p) => p.id === id).position;
const turn = (g) => g.players[g.turnIndex].id;

test('일반 칸: 이동 후 다음 플레이어 차례', () => {
  const g = newGame();
  roll(g, 'A', rng([1]));
  assert.strictEqual(pos(g, 'A'), 1);
  assert.strictEqual(turn(g), 'B');
});

test('내 차례가 아니면 거부', () => {
  const g = newGame();
  const r = roll(g, 'B', rng([1]));
  assert.ok(r.error);
  assert.strictEqual(pos(g, 'B'), 0);
});

test('부스터: 3칸 추가 전진, 연쇄 효과 없음', () => {
  const g = newGame();
  roll(g, 'A', rng([3])); // 3: boost → 6 (normal)
  assert.strictEqual(pos(g, 'A'), 6);
});

test('함정: 3칸 후퇴', () => {
  const g = newGame();
  roll(g, 'A', rng([5])); // 5: trap → 2 (item 칸이지만 연쇄 없음)
  assert.strictEqual(pos(g, 'A'), 2);
  assert.strictEqual(g.players[0].items.length, 0);
});

test('보호막: 함정 무효화', () => {
  const g = newGame();
  g.players[0].items = ['shield'];
  assert.ok(!useItem(g, 'A', 'shield').error);
  roll(g, 'A', rng([5]));
  assert.strictEqual(pos(g, 'A'), 5);
});

test('휴식: 다음 내 턴을 건너뜀', () => {
  const g = newGame(2);
  g.players[0].position = 10;
  roll(g, 'A', rng([1])); // 11: rest
  assert.strictEqual(turn(g), 'B');
  roll(g, 'B', rng([1])); // B → 1, A 쉬고 다시 B
  assert.strictEqual(turn(g), 'B');
  assert.strictEqual(g.players[0].resting, false);
  roll(g, 'B', rng([3]));
  assert.strictEqual(turn(g), 'A');
});

test('보호막: 휴식 무효화', () => {
  const g = newGame(2);
  g.players[0].position = 10;
  g.players[0].items = ['shield'];
  useItem(g, 'A', 'shield');
  roll(g, 'A', rng([1]));
  assert.strictEqual(g.players[0].resting, false);
});

test('다시 굴리기: 같은 플레이어 차례 유지', () => {
  const g = newGame();
  roll(g, 'A', rng([1]));
  roll(g, 'B', rng([6])); // B → 6
  roll(g, 'C', rng([1]));
  roll(g, 'A', rng([6])); // A: 1 → 7 reroll
  assert.strictEqual(pos(g, 'A'), 7);
  assert.strictEqual(turn(g), 'A');
});

test('아이템 칸: 획득, 2장 초과 시 획득 안 함', () => {
  const g = newGame();
  roll(g, 'A', rng([2], ['adjust'])); // 2: item
  assert.deepStrictEqual(g.players[0].items, ['adjust']);
  const g2 = newGame();
  g2.players[0].items = ['double', 'shield'];
  roll(g2, 'A', rng([2], ['adjust']));
  assert.deepStrictEqual(g2.players[0].items, ['double', 'shield']);
});

test('자리 바꾸기: 바로 앞 플레이어와 교환', () => {
  const g = newGame();
  g.players[0].position = 13;
  g.players[1].position = 20;
  g.players[2].position = 16;
  roll(g, 'A', rng([1])); // 14: swap → 가장 가까운 앞(C, 16)
  assert.strictEqual(pos(g, 'A'), 16);
  assert.strictEqual(pos(g, 'C'), 14);
  assert.strictEqual(pos(g, 'B'), 20);
});

test('자리 바꾸기: 앞에 아무도 없으면 효과 없음', () => {
  const g = newGame();
  g.players[0].position = 13;
  roll(g, 'A', rng([1]));
  assert.strictEqual(pos(g, 'A'), 14);
});

test('더블 주사위: 2개 합만큼 이동', () => {
  const g = newGame();
  g.players[0].items = ['double'];
  useItem(g, 'A', 'double');
  roll(g, 'A', rng([4, 5])); // 9: normal
  assert.strictEqual(pos(g, 'A'), 9);
});

test('조정: +1/-1, 1 미만 불가', () => {
  const g = newGame();
  g.players[0].items = ['adjust', 'adjust'];
  assert.ok(useItem(g, 'A', 'adjust', 2).error);
  useItem(g, 'A', 'adjust', -1);
  roll(g, 'A', rng([1]));
  assert.strictEqual(pos(g, 'A'), 1);
  const g2 = newGame();
  g2.players[0].items = ['adjust'];
  useItem(g2, 'A', 'adjust', 1);
  roll(g2, 'A', rng([5])); // 6
  assert.strictEqual(pos(g2, 'A'), 6);
});

test('아이템은 턴당 1장, 미보유 아이템 거부', () => {
  const g = newGame();
  g.players[0].items = ['double', 'shield'];
  assert.ok(!useItem(g, 'A', 'double').error);
  assert.ok(useItem(g, 'A', 'shield').error);
  assert.ok(useItem(newGame(), 'A', 'shield').error);
});

test('결승 도달/초과 시 승리, 이후 행동 거부', () => {
  const g = newGame();
  g.players[0].position = 29;
  g.players[1].position = 12;
  g.players[2].position = 12;
  roll(g, 'A', rng([6]));
  assert.strictEqual(pos(g, 'A'), 35);
  assert.strictEqual(g.finished, true);
  assert.strictEqual(g.winnerId, 'A');
  assert.deepStrictEqual(g.rankings.map((r) => r.rank), [1, 2, 2]);
  assert.ok(roll(g, 'B', rng([1])).error);
});

test('이탈: 현재 차례면 턴 넘김, 1명 남으면 승리', () => {
  const g = newGame();
  removePlayer(g, 'A');
  assert.strictEqual(turn(g), 'B');
  roll(g, 'B', rng([1]));
  assert.strictEqual(turn(g), 'C');
  roll(g, 'C', rng([1]));
  assert.strictEqual(turn(g), 'B'); // 탈락한 A 건너뜀
  removePlayer(g, 'C');
  assert.strictEqual(g.finished, true);
  assert.strictEqual(g.winnerId, 'B');
  assert.strictEqual(g.rankings[g.rankings.length - 1].rank, null);
});

let failed = 0;
for (const t of tests) {
  try {
    t.fn();
    console.log(`  ✓ ${t.name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${t.name}\n    ${e.message}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} 통과`);
process.exit(failed ? 1 : 0);
