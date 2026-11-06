/*****************************************************************
 * main.js
 * 화면 처리
 *
 * 2017.03.02  최초작성
 * 2017.03.20  애니메이션 추가 (속도 문제있음)
 * 2018.05.03  아이템 UI 변경
 * 2019.02.11  방장 표시
 *****************************************************************/

// 전역변수
var g_room = null;          // 현재 방
var g_deferred = null;      // 애니메이션중에 온거
var g_queue = [];           // 이벤트 큐
var g_animating = false;
var g_displayPos = {};      // 애니메이션중 위치
var g_selItem = null;       // 선택한 아이템 "double:0" 이런식
var g_curEvents = null;
var g_curIdx = 0;
var g_toastTimer = null;
var g_diceTimer = null;
var COLS = 12;              // 보드 격자 크기 (drawBoard에서 화면 방향에 맞춰 다시 정함)
var ROWS = 8;
var temp1, temp2; // 쓰는곳 있음
var g_hopId = null;         // 지금 칸을 건너뛰며 이동 중인 플레이어

var CELL_ICON = {
  start: '🚩', finish: '🏁', normal: '', boost: '🚀', trap: '🕳',
  rest: '💤', reroll: '🔁', item: '🎁', swap: '🔀'
};
var CELL_NAME = {
  start: '출발', finish: '결승', normal: '', boost: '부스터 +3', trap: '함정 -3',
  rest: '휴식', reroll: '다시 굴리기', item: '아이템', swap: '자리 바꾸기'
};
var ITEM_ICON = { double: '🎲', shield: '🛡', adjust: '🎯' };
var ITEM_NAME = { double: '더블 주사위', shield: '보호막', adjust: '조정' };
var ITEM_DESC = {
  double: '이번 턴 주사위 2개를 굴려 합만큼 이동',
  shield: '이번 턴 도착 칸이 함정·휴식이면 무효',
  adjust: '주사위 결과에 +1 또는 -1 적용'
};
var DICE_FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];


// html 특수문자 처리
function escHtml(s) {
  if (s == null) return '';
  s = String(s);
  s = s.replace(/&/g, '&amp;');
  s = s.replace(/</g, '&lt;');
  s = s.replace(/>/g, '&gt;');
  s = s.replace(/"/g, '&quot;');
  s = s.replace(/'/g, '&#39;');
  return s;
}

function toast(msg, kind) {
  if (kind == undefined) kind = 'error';
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + kind;
  clearTimeout(g_toastTimer);
  g_toastTimer = setTimeout(function () {
    t.className = 'toast';
  }, 2600);
}

function showScreen(name) {
  var list = document.getElementsByClassName('screen');
  for (var i = 0; i < list.length; i++) {
    if (list[i].id == 'screen-' + name) {
      list[i].className = 'screen active';
    } else {
      list[i].className = 'screen';
    }
  }
}

function getCookieNick() {
  // 쿠키 -> localStorage 로 바꿈
  try {
    return localStorage.getItem('dice-dash-nickname') || '';
  } catch (e) {
    return '';
  }
}

/*===================== 입장화면 =====================*/

function btnCreate_Click() {
  var nick = document.getElementById('nickname').value.replace(/^\s+|\s+$/g, '');
  if (nick == '') {
    toast('닉네임을 입력해 주세요.');
    document.getElementById('nickname').focus();
    return;
  }
  try { localStorage.setItem('dice-dash-nickname', nick); } catch (e) {}
  net_createRoom(nick);
}

function btnJoin_Click() {
  // btnCreate_Click 이랑 같음
  var nick = document.getElementById('nickname').value.replace(/^\s+|\s+$/g, '');
  if (nick == '') {
    toast('닉네임을 입력해 주세요.');
    document.getElementById('nickname').focus();
    return;
  }
  try { localStorage.setItem('dice-dash-nickname', nick); } catch (e) {}
  var code = document.getElementById('room-code').value.replace(/^\s+|\s+$/g, '').toUpperCase();
  if (code.length != 4) {
    toast('4자리 방 코드를 입력해 주세요.');
    return;
  }
  net_joinRoom(nick, code);
}

/*===================== 대기실 =====================*/

function btnCopy_Click() {
  if (!g_room || !g_room.code) return;
  var code = g_room.code;
  // 클립보드 복사 (구형 방식)
  var ta = document.createElement('textarea');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  ta.value = code;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
  toast('방 코드 ' + code + ' 복사됨', 'info');
}

function btnLeave_Click(where) {
  if (where == 'game') {
    if (g_room && g_room.status == 'playing') {
      if (!confirm('게임 중에 나가면 탈락 처리됩니다. 나갈까요?')) return;
    }
  }
  net_leaveRoom();
}

function drawLobby() {
  document.getElementById('lobby-code').innerHTML = g_room.code;
  document.getElementById('lobby-count').innerHTML = g_room.members.length;
  var html = '';
  for (var i = 0; i < g_room.members.length; i++) {
    var m = g_room.members[i];
    html += '<li>';
    html += charHtml(m.color, 'mini');
    html += '<span style="flex:1">' + escHtml(m.nickname) + '</span>';
    if (m.id == g_room.hostId) html += '<span class="tag host">방장</span>';
    if (m.id == g_myId) html += '<span class="tag">나</span>';
    html += '</li>';
  }
  document.getElementById('lobby-members').innerHTML = html;

  if (g_room.hostId == g_myId) {
    document.getElementById('btn-start').style.display = '';
    if (g_room.members.length < 2) {
      document.getElementById('btn-start').disabled = true;
      document.getElementById('lobby-wait').innerHTML = '2명 이상 모이면 시작할 수 있어요.';
    } else {
      document.getElementById('btn-start').disabled = false;
      document.getElementById('lobby-wait').innerHTML = '';
    }
  } else {
    document.getElementById('btn-start').style.display = 'none';
    document.getElementById('btn-start').disabled = g_room.members.length < 2;
    document.getElementById('lobby-wait').innerHTML = '방장이 게임을 시작할 때까지 기다려 주세요.';
  }
}

/*===================== 게임화면 =====================*/

// 플레이어 캐릭터 (동글동글한 말랑이). 색깔마다 귀/장식이 다름.
// 장식 종류는 COLOR_LIST(game_logic.js) 순서에 맞춰 고정 → 대기실·보드·순위표에서 같은 모습.
var CHAR_KINDS = ['cat', 'bunny', 'bear', 'sprout', 'antenna', 'chick', 'horn', 'bow'];
function charHtml(color, extraCls, title) {
  var idx = COLOR_LIST.indexOf(color);
  if (idx < 0) idx = 0;
  var kind = CHAR_KINDS[idx % CHAR_KINDS.length];
  var html = '<div class="char k-' + kind + (extraCls ? ' ' + extraCls : '') + '" style="--c:' + color + '"';
  if (title) html += ' title="' + escHtml(title) + '"';
  html += '><span class="face"></span></div>';
  return html;
}

// 보드 격자 크기 정하기: 칸 수(n)가 둘레(2*(가로+세로)-4)를 채우도록.
// 가로 화면은 넓게(36칸 → 12x8), 세로 화면은 길게(36칸 → 7x13).
function calcBoardSize(n) {
  var half = Math.ceil((n + 4) / 2); // 가로 + 세로
  var bPortrait = window.innerWidth < window.innerHeight;
  var cols = Math.round(half * (bPortrait ? 0.35 : 0.6));
  if (cols < 3) cols = 3;
  if (cols > half - 3) cols = half - 3;
  return { cols: cols, rows: half - cols, portrait: bPortrait };
}

// i번 칸의 격자 위치. 왼쪽 위에서 시작해 시계 방향으로 테두리를 돈다.
function perimeterCell(i, cols, rows) {
  if (i < cols) return { row: 0, col: i };
  i -= cols;
  if (i < rows - 1) return { row: i + 1, col: cols - 1 };
  i -= rows - 1;
  if (i < cols - 1) return { row: rows - 1, col: cols - 2 - i };
  i -= cols - 1;
  return { row: rows - 2 - i, col: 0 };
}

// 보드 그리기 (화면 테두리를 두르는 트랙, 가운데는 패널)
function drawBoard() {
  var g = g_room.game;
  var turnId = null;
  if (g_room.status == 'playing') turnId = g.players[g.turnIndex].id;
  var size = calcBoardSize(g.board.length);
  COLS = size.cols;
  ROWS = size.rows;
  var arena = document.getElementById('arena');
  arena.style.setProperty('--cols', COLS);
  arena.style.setProperty('--rows', ROWS);
  arena.className = 'arena ' + (size.portrait ? 'portrait' : 'landscape');
  var html = '';
  for (var i = 0; i < g.board.length; i++) {
    var type = g.board[i];
    var pc = perimeterCell(i, COLS, ROWS);
    var icon = CELL_ICON[type];
    var name = CELL_NAME[type];
    if (icon == undefined) { icon = ''; name = ''; }
    html += '<div class="cell t-' + type + '" data-index="' + i + '" style="grid-row:' + (pc.row + 1) + ';grid-column:' + (pc.col + 1) + '">';
    html += '<span class="num">' + i + '</span>';
    html += '<span class="icon">' + icon + '</span>';
    html += '<span class="name">' + name + '</span>';
    html += '<div class="tokens">';
    for (var j = 0; j < g.players.length; j++) {
      var p = g.players[j];
      var pos = p.position;
      if (g_displayPos[p.id] != undefined) pos = g_displayPos[p.id];
      if (p.alive && pos == i) {
        var cls = 'token';
        if (p.id == g_hopId) cls += ' hop';          // 한 칸씩 이동 중
        else if (p.id == turnId) cls += ' current';  // 내 차례 - 제자리 콩콩
        html += charHtml(p.color, cls, p.nickname);
      }
    }
    html += '</div></div>';
  }
  document.getElementById('board').innerHTML = html;
}

function drawPlayers() {
  var g = g_room.game;
  var turnId = null;
  if (g_room.status == 'playing') turnId = g.players[g.turnIndex].id;
  var html = '';
  for (var i = 0; i < g.players.length; i++) {
    var p = g.players[i];
    var cls = '';
    if (p.id == turnId) cls = 'turn';
    cls = cls + ' ';
    if (!p.alive) cls = cls + 'out';
    html += '<li class="' + cls + '">';
    html += charHtml(p.color, 'mini');
    html += '<span class="pname">' + escHtml(p.nickname) + (p.id == g_myId ? ' (나)' : '') + '</span>';
    if (p.resting) html += '<span title="다음 턴 쉼">💤</span>';
    var itemStr = '';
    for (var k = 0; k < p.items.length; k++) {
      if (k > 0) itemStr += ' ';
      itemStr += ITEM_ICON[p.items[k]];
    }
    html += '<span class="pitems">' + itemStr + '</span>';
    var pos = p.position;
    if (g_displayPos[p.id] != undefined) pos = g_displayPos[p.id];
    html += '<span class="ppos">' + (p.alive ? pos + '칸' : '탈락') + '</span>';
    html += '</li>';
  }
  document.getElementById('player-list').innerHTML = html;
}

function drawLog() {
  var html = '';
  for (var i = 0; i < g_room.game.log.length; i++) {
    html += '<li>' + escHtml(g_room.game.log[i]) + '</li>';
  }
  var log = document.getElementById('log');
  log.innerHTML = html;
  log.scrollTop = log.scrollHeight;
}

// 컨트롤 영역 (주사위버튼, 아이템)
function drawControls() {
  var g = g_room.game;
  var playing = g_room.status == 'playing';
  var cur = null;
  if (playing) cur = g.players[g.turnIndex];
  var myTurn = playing && cur.id == g_myId;
  var canAct = myTurn && !g_animating;

  var ind = document.getElementById('turn-indicator');
  if (!playing) {
    ind.innerHTML = '게임 종료';
    ind.className = 'turn-indicator';
  } else if (myTurn) {
    ind.innerHTML = '🎯 내 차례!';
    ind.className = 'turn-indicator mine';
  } else {
    ind.innerHTML = '▶ ' + escHtml(cur.nickname) + '님 차례';
    ind.className = 'turn-indicator';
  }

  document.getElementById('btn-roll').disabled = !canAct;

  var pend = '';
  if (g.pending.double) pend += '🎲 더블 주사위';
  if (g.pending.shield) {
    if (pend != '') pend += ', ';
    pend += '🛡 보호막';
  }
  if (g.pending.adjust) {
    if (pend != '') pend += ', ';
    if (g.pending.adjust > 0) pend += '🎯 조정 +1';
    else pend += '🎯 조정 -1';
  }
  if (playing && pend != '') document.getElementById('pending').innerHTML = '적용 중: ' + pend;
  else document.getElementById('pending').innerHTML = '';

  var me = null;
  for (var i = 0; i < g.players.length; i++) {
    if (g.players[i].id == g_myId) me = g.players[i];
  }
  var items = [];
  if (me && me.alive) items = me.items;
  var canUseItem = canAct && !g.itemUsedThisTurn;
  if (!canUseItem) g_selItem = null;

  var html = '';
  if (items.length == 0) {
    html = '<span class="empty">없음 — 🎁 칸에서 획득</span>';
  } else {
    for (var k = 0; k < items.length; k++) {
      var key = items[k] + ':' + k;
      html += '<button class="item-chip' + (g_selItem == key ? ' selected' : '') + '" title="' + ITEM_DESC[items[k]] + '"';
      html += ' onclick="itemChip_Click(\'' + key + '\')"' + (canUseItem ? '' : ' disabled') + '>';
      html += ITEM_ICON[items[k]] + ' ' + ITEM_NAME[items[k]] + '</button>';
    }
  }
  document.getElementById('my-items').innerHTML = html;

  var box = document.getElementById('item-confirm');
  if (g_selItem == null) {
    box.innerHTML = '';
  } else {
    var type = g_selItem.split(':')[0];
    var h = '<span class="desc">' + ITEM_DESC[type] + '</span>';
    if (type == 'adjust') {
      h += '<button class="btn small" onclick="useItem_Click(1)">+1 사용</button>';
      h += '<button class="btn small" onclick="useItem_Click(-1)">-1 사용</button>';
    } else {
      h += '<button class="btn small primary" onclick="useItem_Click()">사용하기</button>';
    }
    h += '<button class="btn ghost small" onclick="g_selItem = null; drawControls();">취소</button>';
    box.innerHTML = h;
  }
}

function itemChip_Click(key) {
  if (g_selItem == key) g_selItem = null;
  else g_selItem = key;
  drawControls();
}

function useItem_Click(opt) {
  var type = g_selItem.split(':')[0];
  net_send('game:useItem', { itemType: type, option: opt });
  g_selItem = null;
}

function btnRoll_Click() {
  document.getElementById('btn-roll').disabled = true;
  net_send('game:roll');
}

// 결과창
function drawResult() {
  var g = g_room.game;
  if (g_room.status != 'finished') {
    document.getElementById('result').className = 'overlay hidden';
    return;
  }
  document.getElementById('result').className = 'overlay';
  var html = '';
  var r = g.rankings;
  if (r == null) r = [];
  for (var i = 0; i < r.length; i++) {
    html += '<li class="' + (r[i].rank == 1 ? 'first' : '') + '">';
    html += '<span class="rank">' + (r[i].rank ? r[i].rank + '위' : '-') + '</span>';
    html += charHtml(r[i].color, 'mini');
    html += '<span class="pname">' + escHtml(r[i].nickname) + (r[i].rank == 1 ? ' 🏆' : '') + '</span>';
    html += '<span class="ppos">' + (r[i].rank ? r[i].position + '칸' : '탈락') + '</span>';
    html += '</li>';
  }
  document.getElementById('rankings').innerHTML = html;
  if (g_room.hostId == g_myId) {
    document.getElementById('btn-restart').style.display = '';
    document.getElementById('result-wait').innerHTML = '';
  } else {
    document.getElementById('btn-restart').style.display = 'none';
    document.getElementById('result-wait').innerHTML = '방장이 다시 하기를 누르면 대기실로 돌아갑니다.';
  }
}

// 전체 다시그리기
function render() {
  if (g_room == null) {
    showScreen('entry');
    return;
  }
  if (g_room.status == 'lobby' || !g_room.game) {
    showScreen('lobby');
    drawLobby();
    return;
  }
  showScreen('game');
  document.getElementById('game-code').innerHTML = g_room.code;
  drawBoard();
  drawPlayers();
  drawLog();
  drawControls();
  drawResult();
}

/*===================== 애니메이션 =====================*/

function flashCell(idx) {
  var cells = document.getElementsByClassName('cell');
  for (var i = 0; i < cells.length; i++) {
    if (cells[i].getAttribute('data-index') == String(idx)) {
      var c = cells[i];
      c.className = c.className + ' flash';
      setTimeout(function () {
        c.className = c.className.replace(' flash', '');
      }, 700);
      return;
    }
  }
}

function runQueue() {
  if (g_animating) return;
  g_animating = true;
  if (g_room && g_room.game) drawControls();
  playNext();
}

function playNext() {
  if (g_curEvents == null || g_curIdx >= g_curEvents.length) {
    if (g_queue.length > 0) {
      g_curEvents = g_queue.shift();
      g_curIdx = 0;
      playNext();
      return;
    }
    // 끝
    g_curEvents = null;
    g_animating = false;
    g_displayPos = {};
    if (g_deferred) {
      g_room = g_deferred;
      g_deferred = null;
    }
    render();
    return;
  }
  var ev = g_curEvents[g_curIdx];
  g_curIdx++;
  try {
    playOneEvent(ev);
  } catch (e) {
    console.error(e);
    playNext();
  }
}

// 이벤트 하나 재생. 끝나면 playNext() 불러야됨!!
function playOneEvent(ev) {
  var p = null;
  for (var i = 0; i < g_room.game.players.length; i++) {
    if (g_room.game.players[i].id == ev.playerId) p = g_room.game.players[i];
  }

  if (ev.type == 'roll') {
    var dice = document.getElementById('dice');
    dice.className = 'dice rolling';
    var end = new Date().getTime() + 700;
    clearInterval(g_diceTimer);
    g_diceTimer = setInterval(function () {
      if (new Date().getTime() < end) {
        var s = '';
        for (var k = 0; k < ev.dice.length; k++) {
          if (k > 0) s += ' ';
          s += DICE_FACES[Math.floor(Math.random() * 6)];
        }
        dice.innerHTML = s;
        return;
      }
      clearInterval(g_diceTimer);
      dice.className = 'dice';
      var s2 = '';
      for (var k2 = 0; k2 < ev.dice.length; k2++) {
        if (k2 > 0) s2 += ' ';
        s2 += DICE_FACES[ev.dice[k2] - 1];
      }
      dice.innerHTML = s2;
      document.getElementById('banner').innerHTML = escHtml(ev.text);
      setTimeout(playNext, 350);
    }, 70);
  } else if (ev.type == 'move') {
    if (p == null) {
      playNext();
      return;
    }
    if (ev.kind == 'teleport') {
      g_displayPos[p.id] = ev.to;
      drawBoard();
      flashCell(ev.to);
      setTimeout(playNext, 350);
      return;
    }
    var step = 1;
    if (ev.to < ev.from) step = -1;
    var delay = 160;
    if (ev.kind == 'slide') delay = 90; // 미끄러지는건 빠르게
    temp1 = ev.from + step;
    // 한칸씩 이동
    var moveStep = function () {
      if (g_room == null || g_room.game == null) {
        playNext();
        return;
      }
      if ((step > 0 && temp1 > ev.to) || (step < 0 && temp1 < ev.to)) {
        g_hopId = null;
        playNext();
        return;
      }
      g_hopId = p.id;
      g_displayPos[p.id] = temp1;
      drawBoard();
      drawPlayers();
      temp1 = temp1 + step;
      setTimeout(moveStep, delay);
    };
    moveStep();
  } else if (ev.type == 'cell') {
    flashCell(ev.position);
    document.getElementById('banner').innerHTML = escHtml(ev.text);
    setTimeout(playNext, 700);
  } else if (ev.type == 'item') {
    document.getElementById('banner').innerHTML = escHtml(ev.text);
    setTimeout(playNext, 300);
  } else if (ev.type == 'win') {
    document.getElementById('banner').innerHTML = escHtml(ev.text);
    setTimeout(playNext, 900);
  } else {
    playNext();
  }
}

/*===================== 통신 콜백 (network.js 에서 부름) =====================*/

function ui_onRoomState(state) {
  if (g_animating || g_queue.length > 0) {
    g_deferred = state;
    return;
  }
  var wasGame = false;
  if (g_room && g_room.game) wasGame = true;
  g_room = state;
  if (!wasGame && state.game) {
    document.getElementById('banner').innerHTML = '';
    document.getElementById('dice').innerHTML = '🎲';
  }
  render();
}

function ui_onGameEvents(data) {
  if (!g_room || !g_room.game) return;
  g_queue.push(data.events);
  runQueue();
}

function ui_onRoomLeft() {
  g_room = null;
  g_deferred = null;
  g_queue = [];
  render();
}

function ui_onError(msg) {
  toast(msg);
  if (g_room && g_room.game) drawControls();
}

function ui_onDisconnect() {
  if (g_room) toast('서버와 연결이 끊겼습니다. 다시 입장해 주세요.');
  g_room = null;
  g_deferred = null;
  g_queue = [];
  render();
}

window.onload = function () {
  document.getElementById('nickname').value = getCookieNick();
  document.getElementById('lobby-url').innerHTML = location.origin;
  render();
};

// 화면 방향이 바뀌면 보드 배치(가로/세로)도 다시 그림
window.onresize = function () {
  if (g_room != null && g_room.game && g_room.status != 'lobby') drawBoard();
};
