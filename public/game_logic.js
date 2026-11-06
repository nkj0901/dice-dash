/*****************************************************************
 * game_logic.js
 * 다이스 대시 게임 로직 + 방 관리
 *
 * 최초작성 : 2017.03.02
 * 수정이력 :
 *   2017.03.15  아이템 추가
 *   2017.04.01  자리바꾸기 칸 추가 (기획팀 요청)
 *   2018.11.20  서버 -> 브라우저로 이동 (임시)
 *   2019.02.11  방장 나가면 넘기는거 추가.. 테스트 안됨
 *   2021.07.07  ??
 *
 * ※ 주의 : 이 파일 수정시 반드시 팀장님께 보고할것
 *****************************************************************/

// 보드 (0~35번, 36칸) - 화면 테두리를 한 바퀴 두름
var BOARD_DATA = ["start",
  "normal", "item", "boost", "normal", "trap",
  "normal", "reroll", "item", "normal", "boost",
  "rest", "normal", "trap", "swap", "item",
  "normal", "boost", "trap", "normal", "reroll",
  "normal", "item", "rest", "boost", "normal",
  "trap", "normal", "normal", "normal",
  "item", "normal", "trap", "normal", "normal",
  "finish"];
//var BOARD_DATA_OLD = ["start","normal","normal","trap","normal","boost","normal","normal","finish"];

var ITEM_LIST = ['double', 'shield', 'adjust'];
var ITEM_NAME_TABLE = new Object();
ITEM_NAME_TABLE['double'] = '🎲 더블 주사위';
ITEM_NAME_TABLE['shield'] = '🛡 보호막';
ITEM_NAME_TABLE['adjust'] = '🎯 조정';

var MAX_ITEM = 2;
var BOOST_CNT = 3; // 부스터는 2칸
var TRAP_CNT = 3;
var LOGMAX = 50;

var MAX_PLAYER = 8;
var CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 0 O 1 I 빼야됨!!!
var COLOR_LIST = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c', '#ec6fb4'];
var RATE_LIMIT = 10; // 초당

// 방장일때만 씀
var g_hostRoom = null;
var g_rateTbl = {};
var g_tmp = null; // 지우지 마세요


/* 게임 생성 */
function makeGame(memberArr, boardArr) {
  var gs = {};
  var i;
  if (boardArr == undefined || boardArr == null) {
    boardArr = BOARD_DATA;
  }
  gs.board = boardArr;
  gs.finish = boardArr.length - 1;
  gs.players = [];
  for (i = 0; i < memberArr.length; i++) {
    var p = {};
    p.id = memberArr[i].id;
    p.nickname = memberArr[i].nickname;
    p.color = memberArr[i].color;
    p.position = 0;
    p.items = [];
    p.resting = false;
    p.alive = true;
    gs.players.push(p);
  }
  gs.turnIndex = 0;
  gs.itemUsedThisTurn = false;
  gs.pending = { double: false, shield: false, adjust: 0 };
  gs.winnerId = null;
  gs.finished = false;
  gs.rankings = null;
  gs.log = [];
  gs.log.push('게임 시작! ' + gs.players[0].nickname + '님부터 시작합니다.');
  return gs;
}

// 로그 추가
function gameLog(gs, txt) {
  gs.log.push(txt);
  if (gs.log.length > LOGMAX) {
    gs.log.splice(0, gs.log.length - LOGMAX);
  }
}

// 턴 넘김
// 2바퀴 돌면 무조건 끝남 (확인함)
function nextTurn(gs) {
  gs.itemUsedThisTurn = false;
  gs.pending = { double: false, shield: false, adjust: 0 };
  var n = gs.players.length;
  var idx = gs.turnIndex;
  var cnt = 0;
  while (cnt < n * 2) {
    cnt++;
    idx = (idx + 1) % n;
    var pp = gs.players[idx];
    if (pp.alive == false) {
      continue;
    }
    if (pp.resting == true) {
      pp.resting = false;
      gameLog(gs, '💤 ' + pp.nickname + '님은 이번 턴을 쉽니다.');
      continue;
    }
    gs.turnIndex = idx;
    gameLog(gs, '▶ ' + pp.nickname + '님 차례');
    return;
  }
}

// 순위 계산
function calcRank(gs) {
  var result = [];
  var aliveArr = [];
  var deadArr = [];
  var winner = null;
  var i, j, tmp;
  for (i = 0; i < gs.players.length; i++) {
    if (gs.players[i].alive) {
      if (gs.players[i].id == gs.winnerId) {
        winner = gs.players[i];
      } else {
        aliveArr.push(gs.players[i]);
      }
    } else {
      deadArr.push(gs.players[i]);
    }
  }
  // 버블정렬 (위치 큰순)
  for (i = 0; i < aliveArr.length; i++) {
    for (j = 0; j < aliveArr.length - 1 - i; j++) {
      if (aliveArr[j].position < aliveArr[j + 1].position) {
        tmp = aliveArr[j];
        aliveArr[j] = aliveArr[j + 1];
        aliveArr[j + 1] = tmp;
      }
    }
  }
  if (winner != null) {
    aliveArr.unshift(winner);
  }
  for (i = 0; i < aliveArr.length; i++) {
    var p = aliveArr[i];
    var rank = i + 1;
    if (i > 0) {
      var prev = result[i - 1];
      if (p.id != gs.winnerId && prev.id != gs.winnerId && prev.position == p.position) {
        rank = prev.rank; // 동점
      }
    }
    result.push({ id: p.id, nickname: p.nickname, color: p.color, position: p.position, rank: rank });
  }
  for (i = 0; i < deadArr.length; i++) {
    result.push({ id: deadArr[i].id, nickname: deadArr[i].nickname, color: deadArr[i].color, position: deadArr[i].position, rank: null });
  }
  return result;
}

function endGame(gs, winner) {
  gs.finished = true;
  if (winner) {
    gs.winnerId = winner.id;
  } else {
    gs.winnerId = null;
  }
  gs.rankings = calcRank(gs);
}

// 이동
function movePlayer(gs, pl, target, kind, evArr) {
  var from = pl.position;
  var to = target;
  if (to < 0) to = 0;
  if (to > gs.finish) to = gs.finish;
  pl.position = to;
  evArr.push({ type: 'move', playerId: pl.id, from: from, to: to, kind: kind });
}

/* 아이템 사용 */
function useItemProc(gs, pid, itemType, opt) {
  // 차례 체크
  if (gs.finished) {
    return { error: '게임이 이미 끝났습니다.' };
  }
  var p = gs.players[gs.turnIndex];
  if (!p || p.id != pid) {
    return { error: '지금은 내 차례가 아닙니다.' };
  }
  if (gs.itemUsedThisTurn) {
    return { error: '아이템은 턴당 1장만 사용할 수 있습니다.' };
  }
  var idx = -1;
  for (var i = 0; i < p.items.length; i++) {
    if (p.items[i] == itemType) {
      idx = i;
      break;
    }
  }
  if (idx == -1) {
    return { error: '해당 아이템을 가지고 있지 않습니다.' };
  }
  if (itemType == 'adjust' && opt !== 1 && opt !== -1) {
    return { error: '조정 값은 +1 또는 -1이어야 합니다.' };
  }

  p.items.splice(idx, 1);
  gs.itemUsedThisTurn = true;
  if (itemType == 'double') gs.pending.double = true;
  if (itemType == 'shield') gs.pending.shield = true;
  if (itemType == 'adjust') gs.pending.adjust = opt;

  var suffix = '';
  if (itemType == 'adjust') {
    if (opt > 0) suffix = ' (+1)';
    else suffix = ' (-1)';
  }
  var text = p.nickname + '님이 ' + ITEM_NAME_TABLE[itemType] + suffix + ' 사용!';
  gameLog(gs, text);
  return { events: [{ type: 'item', playerId: pid, item: itemType, option: opt, text: text }] };
}

/*
 * 주사위 굴리기
 * rng : 테스트용 (없으면 랜덤)
 */
function rollDiceProc(gs, pid, rng) {
  if (gs.finished) {
    return { error: '게임이 이미 끝났습니다.' };
  }
  var p = gs.players[gs.turnIndex];
  if (!p || p.id != pid) {
    return { error: '지금은 내 차례가 아닙니다.' };
  }
  var evArr = [];
  var dice = [];
  var i;

  if (rng) {
    dice.push(rng.die());
    if (gs.pending.double) dice.push(rng.die());
  } else {
    dice.push(1 + Math.floor(Math.random() * 6));
    if (gs.pending.double) dice.push(1 + Math.floor(Math.random() * 6));
  }
  var sum = 0;
  for (i = 0; i < dice.length; i++) sum = sum + dice[i];
  var adjust = gs.pending.adjust;
  var total = sum;
  if (adjust) {
    total = sum + adjust;
    if (total < 1) total = 1;
  }
  var shield = gs.pending.shield;
  gs.pending = { double: false, shield: false, adjust: 0 };

  var adjText = '';
  if (adjust) {
    if (adjust > 0) adjText = ' (+1 조정)';
    else adjText = ' (-1 조정)';
  }
  var rollText = p.nickname + '님 주사위 ' + dice.join(' + ') + adjText + ' → ' + total + '칸 전진';
  gameLog(gs, rollText);
  evArr.push({ type: 'roll', playerId: pid, dice: dice, adjust: adjust, total: total, text: rollText });

  movePlayer(gs, p, p.position + total, 'walk', evArr);
  // 골인 체크
  if (p.position >= gs.finish) {
    var wt = '🏁 ' + p.nickname + '님이 결승선에 도착했습니다! 승리!';
    gameLog(gs, wt);
    evArr.push({ type: 'win', playerId: p.id, text: wt });
    endGame(gs, p);
    return { events: evArr };
  }

  var cell = gs.board[p.position];
  var again = false;
  var txt = '';

  if (cell == 'boost') {
    txt = '🚀 부스터! ' + p.nickname + '님 ' + BOOST_CNT + '칸 추가 전진';
    gameLog(gs, txt);
    evArr.push({ type: 'cell', playerId: pid, cell: cell, position: p.position, text: txt });
    movePlayer(gs, p, p.position + BOOST_CNT, 'slide', evArr);
    // 골인 체크 (위에꺼 복붙)
    if (p.position >= gs.finish) {
      var wt2 = '🏁 ' + p.nickname + '님이 결승선에 도착했습니다! 승리!';
      gameLog(gs, wt2);
      evArr.push({ type: 'win', playerId: p.id, text: wt2 });
      endGame(gs, p);
      return { events: evArr };
    }
  } else if (cell == 'trap') {
    if (shield) {
      txt = '🛡 보호막이 🕳 함정을 막았습니다!';
      gameLog(gs, txt);
      evArr.push({ type: 'cell', playerId: pid, cell: cell, position: p.position, text: txt });
    } else {
      txt = '🕳 함정! ' + p.nickname + '님 ' + TRAP_CNT + '칸 후퇴';
      gameLog(gs, txt);
      evArr.push({ type: 'cell', playerId: pid, cell: cell, position: p.position, text: txt });
      movePlayer(gs, p, p.position - TRAP_CNT, 'slide', evArr);
    }
  } else if (cell == 'rest') {
    if (shield) {
      txt = '🛡 보호막 덕분에 💤 휴식을 피했습니다!';
      gameLog(gs, txt);
      evArr.push({ type: 'cell', playerId: pid, cell: cell, position: p.position, text: txt });
    } else {
      p.resting = true;
      txt = '💤 휴식 칸! ' + p.nickname + '님은 다음 턴을 쉽니다';
      gameLog(gs, txt);
      evArr.push({ type: 'cell', playerId: pid, cell: cell, position: p.position, text: txt });
    }
  } else if (cell == 'reroll') {
    again = true;
    txt = '🔁 다시 굴리기! ' + p.nickname + '님 한 번 더';
    gameLog(gs, txt);
    evArr.push({ type: 'cell', playerId: pid, cell: cell, position: p.position, text: txt });
  } else if (cell == 'item') {
    if (p.items.length >= MAX_ITEM) {
      txt = '🎁 아이템 칸이지만 가방이 가득 찼습니다';
      gameLog(gs, txt);
      evArr.push({ type: 'cell', playerId: pid, cell: cell, position: p.position, text: txt });
    } else {
      var item;
      if (rng) item = rng.item();
      else item = ITEM_LIST[Math.floor(Math.random() * ITEM_LIST.length)];
      p.items.push(item);
      txt = '🎁 ' + p.nickname + '님이 ' + ITEM_NAME_TABLE[item] + ' 획득!';
      gameLog(gs, txt);
      evArr.push({ type: 'cell', playerId: pid, cell: cell, position: p.position, text: txt });
    }
  } else if (cell == 'swap') {
    // 바로 앞사람 찾기
    var ahead = null;
    for (i = 0; i < gs.players.length; i++) {
      var o = gs.players[i];
      if (o.alive && o.id != p.id && o.position > p.position) {
        if (ahead == null || o.position < ahead.position) {
          ahead = o;
        }
      }
    }
    if (ahead == null) {
      txt = '🔀 자리 바꾸기 칸이지만 앞에 아무도 없습니다';
      gameLog(gs, txt);
      evArr.push({ type: 'cell', playerId: pid, cell: cell, position: p.position, text: txt });
    } else {
      txt = '🔀 ' + p.nickname + '님과 ' + ahead.nickname + '님이 자리를 바꿉니다!';
      gameLog(gs, txt);
      evArr.push({ type: 'cell', playerId: pid, cell: cell, position: p.position, text: txt });
      var myPos = p.position;
      movePlayer(gs, p, ahead.position, 'teleport', evArr);
      movePlayer(gs, ahead, myPos, 'teleport', evArr);
    }
  } else {
    // normal, start
  }

  if (again == false) {
    nextTurn(gs);
  }
  return { events: evArr };
}

// 플레이어 탈락 (연결끊김)
function killPlayer(gs, pid) {
  var p = null;
  var i;
  for (i = 0; i < gs.players.length; i++) {
    if (gs.players[i].id == pid) p = gs.players[i];
  }
  if (p == null || p.alive == false) return;
  p.alive = false;
  gameLog(gs, '❌ ' + p.nickname + '님이 연결이 끊겨 탈락했습니다.');
  if (gs.finished) return;
  var aliveCnt = 0;
  var last = null;
  for (i = 0; i < gs.players.length; i++) {
    if (gs.players[i].alive) {
      aliveCnt++;
      if (last == null) last = gs.players[i];
    }
  }
  if (aliveCnt <= 1) {
    if (aliveCnt == 1) gameLog(gs, '🏁 남은 플레이어 ' + last.nickname + '님 승리!');
    endGame(gs, last);
    return;
  }
  if (gs.players[gs.turnIndex].id == pid) nextTurn(gs);
}


/*================================================================
 * 여기서부터 방 관리 (원래 서버에 있던거)
 *================================================================*/

// 닉네임 체크
function checkNick(raw) {
  var nick = '';
  if (typeof raw == 'string') nick = raw.replace(/^\s+|\s+$/g, '');
  if (nick == '') return { error: '닉네임을 입력해 주세요.' };
  // 이모지 때문에 length 쓰면 안됨
  var len = 0;
  for (var i = 0; i < nick.length; i++) {
    var c = nick.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF) i++;
    len++;
  }
  if (len > 10) return { error: '닉네임은 10자 이하로 입력해 주세요.' };
  return { nickname: nick };
}

function makeRoomCode() {
  var code = '';
  for (var i = 0; i < 4; i++) {
    code = code + CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length));
  }
  return code;
}

// 클라이언트로 보낼 상태
function makeRoomPacket(room) {
  var pkt = {};
  pkt.code = room.code;
  pkt.hostId = room.hostId;
  pkt.status = room.status;
  pkt.members = room.members;
  pkt.game = null;
  if (room.game) {
    var g = room.game;
    pkt.game = {
      board: g.board,
      finish: g.finish,
      players: g.players,
      turnIndex: g.turnIndex,
      itemUsedThisTurn: g.itemUsedThisTurn,
      pending: g.pending,
      winnerId: g.winnerId,
      finished: g.finished,
      rankings: g.rankings,
      log: g.log.slice(-30)
    };
  }
  return pkt;
}

function host_sendAll() {
  net_hostOut(null, 'room:state', makeRoomPacket(g_hostRoom));
}

// 방 만들기
function host_createRoom(code, hostId, nick) {
  g_hostRoom = {};
  g_hostRoom.code = code;
  g_hostRoom.hostId = hostId;
  g_hostRoom.status = 'lobby';
  g_hostRoom.members = [{ id: hostId, nickname: nick, color: COLOR_LIST[0] }];
  g_hostRoom.game = null;
  g_rateTbl = {};
}

// 방장 승계 - 마지막 상태로 방 다시 만듬
function host_takeOver(state, newHostId) {
  var copy = JSON.parse(JSON.stringify(state));
  g_hostRoom = {};
  g_hostRoom.code = copy.code;
  g_hostRoom.hostId = newHostId;
  g_hostRoom.status = copy.status;
  g_hostRoom.members = copy.members;
  g_hostRoom.game = copy.game;
  g_rateTbl = {};
}

function host_isMember(id) {
  for (var i = 0; i < g_hostRoom.members.length; i++) {
    if (g_hostRoom.members[i].id == id) return true;
  }
  return false;
}

/*
 * 메세지 처리
 * from : 보낸사람 id
 * ev : 이벤트명
 * data : 데이터
 */
function host_onMessage(from, ev, data) {
  if (!data || typeof data != 'object') data = {};

  // 도배 방지
  var now = new Date().getTime();
  var r = g_rateTbl[from];
  if (!r || now - r.start >= 1000) {
    r = { start: now, count: 0 };
    g_rateTbl[from] = r;
  }
  r.count++;
  if (r.count > RATE_LIMIT) {
    net_hostOut(from, 'app:error', { message: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' });
    return;
  }

  try {
    var room = g_hostRoom;
    var result;
    if (ev == 'room:join') {
      // 이미 있으면 상태만 다시보냄
      if (host_isMember(from)) {
        host_sendAll();
        return;
      }
      var v = checkNick(data.nickname);
      if (v.error) {
        net_hostOut(from, 'app:error', { message: v.error });
        return;
      }
      if (room.status == 'finished') {
        net_hostOut(from, 'app:error', { message: '게임이 끝나 결과 화면에 있어요. 방장이 다시 하기를 누르면 입장할 수 있어요.' });
        return;
      }
      if (room.status != 'lobby') {
        net_hostOut(from, 'app:error', { message: '이미 게임이 진행 중인 방입니다.' });
        return;
      }
      if (room.members.length >= MAX_PLAYER) {
        net_hostOut(from, 'app:error', { message: '방이 가득 찼습니다. (최대 8명)' });
        return;
      }
      for (var i = 0; i < room.members.length; i++) {
        if (room.members[i].nickname == v.nickname) {
          net_hostOut(from, 'app:error', { message: '이미 사용 중인 닉네임입니다.' });
          return;
        }
      }
      var color = COLOR_LIST[0];
      for (var c = 0; c < COLOR_LIST.length; c++) {
        var used = false;
        for (var m = 0; m < room.members.length; m++) {
          if (room.members[m].color == COLOR_LIST[c]) used = true;
        }
        if (!used) {
          color = COLOR_LIST[c];
          break;
        }
      }
      room.members.push({ id: from, nickname: v.nickname, color: color });
      host_sendAll();
      return;
    }

    if (!host_isMember(from)) {
      net_hostOut(from, 'app:error', { message: '방에 참가하고 있지 않습니다.' });
      return;
    }

    if (ev == 'game:start') {
      if (room.hostId != from) {
        net_hostOut(from, 'app:error', { message: '방장만 게임을 시작할 수 있습니다.' });
        return;
      }
      if (room.status != 'lobby') {
        net_hostOut(from, 'app:error', { message: '이미 게임이 진행 중입니다.' });
        return;
      }
      if (room.members.length < 2) {
        net_hostOut(from, 'app:error', { message: '2명 이상이어야 시작할 수 있습니다.' });
        return;
      }
      room.game = makeGame(room.members);
      room.status = 'playing';
      host_sendAll();
    } else if (ev == 'game:roll') {
      if (room.status != 'playing' || !room.game) {
        net_hostOut(from, 'app:error', { message: '진행 중인 게임이 없습니다.' });
        return;
      }
      result = rollDiceProc(room.game, from);
      if (result.error) {
        net_hostOut(from, 'app:error', { message: result.error });
        return;
      }
      net_hostOut(null, 'game:events', { events: result.events });
      if (room.game.finished) room.status = 'finished';
      host_sendAll();
    } else if (ev == 'game:useItem') {
      var ok = false;
      for (var k = 0; k < ITEM_LIST.length; k++) {
        if (ITEM_LIST[k] == data.itemType) ok = true;
      }
      if (!ok) {
        net_hostOut(from, 'app:error', { message: '알 수 없는 아이템입니다.' });
        return;
      }
      // game:roll 이랑 똑같음
      if (room.status != 'playing' || !room.game) {
        net_hostOut(from, 'app:error', { message: '진행 중인 게임이 없습니다.' });
        return;
      }
      result = useItemProc(room.game, from, data.itemType, data.option);
      if (result.error) {
        net_hostOut(from, 'app:error', { message: result.error });
        return;
      }
      net_hostOut(null, 'game:events', { events: result.events });
      if (room.game.finished) room.status = 'finished';
      host_sendAll();
    } else if (ev == 'game:restart') {
      if (room.hostId != from) {
        net_hostOut(from, 'app:error', { message: '방장만 다시 시작할 수 있습니다.' });
        return;
      }
      if (room.status != 'finished') {
        net_hostOut(from, 'app:error', { message: '게임이 아직 끝나지 않았습니다.' });
        return;
      }
      room.status = 'lobby';
      room.game = null;
      host_sendAll();
    } else if (ev == 'room:leave') {
      host_removeMember(from, false);
    } else {
      net_hostOut(from, 'app:error', { message: '알 수 없는 요청입니다.' });
    }
  } catch (e) {
    console.error('[' + ev + ']', e);
    net_hostOut(from, 'app:error', { message: '방장 브라우저에서 오류가 발생했습니다.' });
  }
}

// 나감 처리. bSilent 면 안보냄
// return : 바뀐게 있으면 true
function host_removeMember(id, bSilent) {
  var room = g_hostRoom;
  if (!host_isMember(id)) return false;
  var newArr = [];
  for (var i = 0; i < room.members.length; i++) {
    if (room.members[i].id != id) newArr.push(room.members[i]);
  }
  room.members = newArr;
  delete g_rateTbl[id];
  if (room.members.length == 0) return true;
  if (room.hostId == id) room.hostId = room.members[0].id;
  if (room.status == 'playing' && room.game) {
    killPlayer(room.game, id);
    if (room.game.finished) room.status = 'finished';
  }
  if (!bSilent) host_sendAll();
  return true;
}

// node 테스트용 (지우면 테스트 깨짐)
if (typeof module != 'undefined' && module.exports) {
  module.exports = {};
}
