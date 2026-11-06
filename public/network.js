/*****************************************************************
 * network.js
 * 통신 모듈 (Supabase)
 *
 * 2018.11.20  socket.io -> supabase 로 변경
 * 2019.02.11  presence 추가
 *
 * 순서 바꾸지 말것. main.js 보다 먼저 로드되야함
 *****************************************************************/

var CHANNEL_PREFIX = 'dice-dash:';

// 내 아이디
var g_myId = '';
if (window.crypto && window.crypto.randomUUID) {
  g_myId = window.crypto.randomUUID();
} else {
  g_myId = 'p-' + new Date().getTime().toString(36) + Math.random().toString(36).slice(2);
}

var g_sb = null;
var g_channel = null;
var g_lastState = null;   // 마지막 방 상태
var g_bJoining = false;
var g_joinNick = '';
var g_joinCode = '';
var g_joinRetryTimer = null;
var g_joinTimeoutTimer = null;
var g_bClosing = false;
var g_seenTbl = {};       // presence 본 사람들
var g_bReadyCalled = false;
var g_readyMode = '';     // 'create' / 'join'
var g_createNick = '';
var g_createCode = '';
var flag = false;         // ??

// 초기화
if (window.DICE_CONFIG && window.DICE_CONFIG.supabaseUrl && window.DICE_CONFIG.supabaseKey && window.supabase) {
  g_sb = supabase.createClient(window.DICE_CONFIG.supabaseUrl, window.DICE_CONFIG.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 20 } }
  });
}

// 방장일때 game_logic.js 에서 호출함
function net_hostOut(to, ev, data) {
  net_rawSend('s2c', { to: to, event: ev, payload: data });
}

function net_rawSend(ev, data) {
  if (g_channel == null) return;
  g_channel.send({ type: 'broadcast', event: ev, payload: data }).then(null, function (e) {
    console.warn('send 실패', e);
  });
}

function net_clearJoin() {
  if (g_bJoining == false) return;
  clearInterval(g_joinRetryTimer);
  clearTimeout(g_joinTimeoutTimer);
  g_joinRetryTimer = null;
  g_joinTimeoutTimer = null;
  g_bJoining = false;
}

// 채널 닫기
function net_close() {
  net_clearJoin();
  g_hostRoom = null;
  g_lastState = null;
  if (g_channel == null) return;
  var ch = g_channel;
  g_channel = null;
  g_bClosing = true;
  g_sb.removeChannel(ch).then(function () {
    g_bClosing = false;
  }, function () {
    g_bClosing = false;
  });
}

// 서버(방장)한테서 온 메세지
function net_onS2C(msg) {
  if (!msg) return;
  if (msg.to && msg.to != g_myId) return;
  var ev = msg.event;
  var data = msg.payload;
  if (ev == 'room:state') {
    var bMember = false;
    for (var i = 0; i < data.members.length; i++) {
      if (data.members[i].id == g_myId) bMember = true;
    }
    if (!bMember) return;
    net_clearJoin();
    g_lastState = data;
    ui_onRoomState(data);
  } else if (ev == 'game:events') {
    if (!g_lastState) return;
    ui_onGameEvents(data);
  } else if (ev == 'app:error') {
    if (g_bJoining) {
      // 입장 거절됨
      net_close();
    }
    ui_onError(data.message);
  } else if (ev == 'room:left') {
    ui_onRoomLeft();
  }
}

// 누가 나감
function net_onLeave(goneArr) {
  var i;
  if (!g_lastState) return;
  if (g_hostRoom) {
    for (i = 0; i < goneArr.length; i++) {
      if (goneArr[i] != g_myId) host_removeMember(goneArr[i], false);
    }
    return;
  }
  var oldHost = g_lastState.hostId;
  var bHostGone = false;
  for (i = 0; i < goneArr.length; i++) {
    if (goneArr[i] == oldHost) bHostGone = true;
  }
  if (!bHostGone) return;

  // 방장 나감 -> 남은사람중 첫번째가 방장
  var present = g_channel.presenceState();
  present[g_myId] = true;
  var next = null;
  for (i = 0; i < g_lastState.members.length; i++) {
    var m = g_lastState.members[i];
    var bGone = false;
    for (var j = 0; j < goneArr.length; j++) {
      if (goneArr[j] == m.id) bGone = true;
    }
    if (m.id != oldHost && !bGone && present[m.id]) {
      next = m;
      break;
    }
  }
  if (next == null || next.id != g_myId) return;
  host_takeOver(g_lastState, g_myId);
  for (i = 0; i < goneArr.length; i++) {
    host_removeMember(goneArr[i], true);
  }
  host_sendAll();
}

// 채널 열기
function net_open(code, mode) {
  var ch = g_sb.channel(CHANNEL_PREFIX + code, {
    config: { broadcast: { self: true }, presence: { key: g_myId } }
  });
  g_channel = ch;
  g_seenTbl = {};
  g_bReadyCalled = false;
  g_readyMode = mode;

  ch.on('broadcast', { event: 'c2s' }, function (msg) {
    var p = msg.payload;
    if (g_hostRoom && p && typeof p.from == 'string') {
      host_onMessage(p.from, p.event, p.payload);
    }
  });
  ch.on('broadcast', { event: 's2c' }, function (msg) {
    net_onS2C(msg.payload);
  });
  ch.on('presence', { event: 'sync' }, function () {
    // 한번이라도 봤던 사람이 없어지면 나간걸로 침
    var st = ch.presenceState();
    var k;
    for (k in st) {
      g_seenTbl[k] = true;
    }
    var gone = [];
    for (k in g_seenTbl) {
      if (!st[k]) gone.push(k);
    }
    for (var i = 0; i < gone.length; i++) {
      delete g_seenTbl[gone[i]];
    }
    if (gone.length > 0) net_onLeave(gone);
  });
  ch.subscribe(function (status) {
    if (ch != g_channel) return;
    if (status == 'SUBSCRIBED') {
      ch.track({ id: g_myId, at: new Date().getTime() }).then(function () {
        if (g_bReadyCalled) return;
        g_bReadyCalled = true;
        if (g_readyMode == 'create') {
          net_afterCreate();
        } else {
          net_afterJoin();
        }
      });
    } else if (status == 'CHANNEL_ERROR' || status == 'TIMED_OUT' || (status == 'CLOSED' && !g_bClosing)) {
      var hadRoom = false;
      if (g_lastState) hadRoom = true;
      var wasJoining = g_bJoining;
      net_close();
      if (wasJoining) {
        ui_onError('실시간 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      } else if (hadRoom) {
        ui_onDisconnect();
      }
    }
  });
}

/* 방 만들기 */
function net_createRoom(nick) {
  if (g_sb == null) {
    ui_onError('Supabase 설정(config.js)이 없습니다.');
    return;
  }
  var v = checkNick(nick);
  if (v.error) {
    ui_onError(v.error);
    return;
  }
  net_close();
  g_createNick = v.nickname;
  g_createCode = makeRoomCode();
  net_open(g_createCode, 'create');
}

function net_afterCreate() {
  // 코드 겹치면 다시 (거의 없음)
  var st = g_channel.presenceState();
  for (var k in st) {
    if (k != g_myId) {
      net_createRoom(g_createNick);
      return;
    }
  }
  host_createRoom(g_createCode, g_myId, g_createNick);
  host_sendAll();
}

/* 방 입장 */
function net_joinRoom(nick, code) {
  if (g_sb == null) {
    ui_onError('Supabase 설정(config.js)이 없습니다.');
    return;
  }
  var v = checkNick(nick);
  if (v.error) {
    ui_onError(v.error);
    return;
  }
  var roomCode = '';
  if (typeof code == 'string') roomCode = code.replace(/^\s+|\s+$/g, '').toUpperCase();
  net_close();
  g_joinNick = v.nickname;
  g_joinCode = roomCode;
  net_open(roomCode, 'join');
}

function net_afterJoin() {
  net_rawSend('c2s', { from: g_myId, event: 'room:join', payload: { nickname: g_joinNick, code: g_joinCode } });
  g_bJoining = true;
  // 2초마다 재시도
  g_joinRetryTimer = setInterval(function () {
    net_rawSend('c2s', { from: g_myId, event: 'room:join', payload: { nickname: g_joinNick, code: g_joinCode } });
  }, 2000);
  // 3초 지나면 없는방
  g_joinTimeoutTimer = setTimeout(function () {
    net_close();
    ui_onError('존재하지 않는 방 코드입니다.');
  }, 6000);
}

/* 나가기 */
function net_leaveRoom() {
  if (g_sb == null) {
    ui_onError('Supabase 설정(config.js)이 없습니다.');
    return;
  }
  // 방장이 나가면 남은사람이 알아서 이어받음
  net_close();
  ui_onRoomLeft();
}

/* 게임 메세지 보내기 */
function net_send(ev, data) {
  if (g_sb == null) {
    ui_onError('Supabase 설정(config.js)이 없습니다.');
    return;
  }
  if (g_channel == null || g_lastState == null) {
    ui_onError('방에 참가하고 있지 않습니다.');
    return;
  }
  if (data == undefined) data = {};
  net_rawSend('c2s', { from: g_myId, event: ev, payload: data });
}

// 디버그용
window.__diceNet = {
  presence: function () { return g_channel ? g_channel.presenceState() : null; },
  state: function () { return g_lastState; },
  isHost: function () { return g_hostRoom != null; }
};
