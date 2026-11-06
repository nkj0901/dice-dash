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

// 내 아이디. 탭마다 sessionStorage에 저장해서 새로고침해도 같은 사람으로 다시 들어올 수 있게 함
var ID_KEY = 'diceDash.myId';
var ROOM_KEY = 'diceDash.room';       // 마지막으로 들어가 있던 방 {code, nick} - 새로고침 시 자동 재입장
var LEAVE_GRACE_MS = 8000;            // presence가 빠져도 이만큼은 기다렸다가 탈락 처리 (새로고침·잠깐 끊김)
var JOIN_TIMEOUT_MS = 6000;
var RESUME_TIMEOUT_MS = 12000;        // 자동 재입장은 방장 승계를 기다릴 수 있게 더 길게

function net_storeGet(key) {
  try { return window.sessionStorage.getItem(key); } catch (e) { return null; }
}
function net_storeSet(key, val) {
  try {
    if (val == null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, val);
  } catch (e) { /* 저장 못 해도 게임은 됨 */ }
}

var g_myId = net_storeGet(ID_KEY) || '';
if (g_myId == '') {
  if (window.crypto && window.crypto.randomUUID) {
    g_myId = window.crypto.randomUUID();
  } else {
    g_myId = 'p-' + new Date().getTime().toString(36) + Math.random().toString(36).slice(2);
  }
  net_storeSet(ID_KEY, g_myId);
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
var g_leaveTimers = {};   // id -> 탈락 처리 예약 타이머 (유예 중)
var g_bResuming = false;  // 새로고침 후 자동 재입장 중

// 초기화
if (window.DICE_CONFIG && window.DICE_CONFIG.supabaseUrl && window.DICE_CONFIG.supabaseKey && window.supabase) {
  g_sb = supabase.createClient(window.DICE_CONFIG.supabaseUrl, window.DICE_CONFIG.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 20 } }
  });
}

// 방장일때 game_logic.js 에서 호출함
function net_hostOut(to, ev, data) {
  net_rawSend('s2c', { from: g_myId, to: to, event: ev, payload: data });
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
  for (var id in g_leaveTimers) clearTimeout(g_leaveTimers[id]);
  g_leaveTimers = {};
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
// 방장이 보낸 메세지인지 확인 (이슈 #1-2: 방장 아닌 사람이 가짜 방 상태를 보내는 것 막기)
// - 평소엔 지금 방장(g_lastState.hostId)이 보낸 것만 받음
// - 방장이 바뀌는 건, 기존 방장이 presence에서 빠졌고 새 상태의 hostId가 보낸 사람일 때만 인정
// ※ from 값 자체는 보내는 쪽이 적는 것이라 완전한 인증은 아님 (Supabase 인증 + 비공개 채널 필요)
function net_isFromHost(msg) {
  if (typeof msg.from != 'string' || msg.from == '') return false;
  if (g_lastState == null) {
    // 처음 입장할 때: 상태에 적힌 방장이 직접 보낸 것만
    return msg.event != 'room:state' || (msg.payload && msg.payload.hostId == msg.from);
  }
  if (msg.from == g_lastState.hostId) return true;
  if (msg.event != 'room:state' || !msg.payload || msg.payload.hostId != msg.from) return false;
  var present = g_channel ? g_channel.presenceState() : {};
  return !present[g_lastState.hostId];
}

function net_onS2C(msg) {
  if (!msg) return;
  if (msg.to && msg.to != g_myId) return;
  if (!net_isFromHost(msg)) return;
  var ev = msg.event;
  var data = msg.payload;
  if (ev == 'room:state') {
    if (!data || !data.members) return;
    var bMember = false;
    for (var i = 0; i < data.members.length; i++) {
      if (data.members[i].id == g_myId) bMember = true;
    }
    if (!bMember) return;
    net_clearJoin();
    g_bResuming = false;
    g_lastState = data;
    net_storeSet(ROOM_KEY, JSON.stringify({ code: data.code, nick: net_myNick(data) }));
    ui_onRoomState(data);
  } else if (ev == 'game:events') {
    if (!g_lastState) return;
    ui_onGameEvents(data);
  } else if (ev == 'app:error') {
    if (g_bJoining) {
      // 입장 거절됨
      net_close();
      net_storeSet(ROOM_KEY, null);
      g_bResuming = false;
    }
    ui_onError(data.message);
  } else if (ev == 'room:left') {
    net_storeSet(ROOM_KEY, null);
    ui_onRoomLeft();
  }
}

function net_myNick(state) {
  for (var i = 0; i < state.members.length; i++) {
    if (state.members[i].id == g_myId) return state.members[i].nickname;
  }
  return '';
}

// 방장일 때: presence에서 빠진 사람을 바로 탈락시키지 않고 LEAVE_GRACE_MS 기다림.
// 그 사이 같은 id로 돌아오면(새로고침·잠깐 끊김) 취소된다 (presence sync 핸들러 참고).
function net_scheduleRemove(id) {
  if (id == g_myId || g_leaveTimers[id]) return;
  g_leaveTimers[id] = setTimeout(function () {
    delete g_leaveTimers[id];
    if (!g_hostRoom || !g_channel) return;
    if (g_channel.presenceState()[id]) return; // 돌아옴
    host_removeMember(id, false);
  }, LEAVE_GRACE_MS);
}

// 누가 나감
function net_onLeave(goneArr) {
  var i;
  if (!g_lastState) return;
  if (g_hostRoom) {
    for (i = 0; i < goneArr.length; i++) net_scheduleRemove(goneArr[i]);
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
  // 방은 바로 이어받되, 나간 사람(이전 방장 포함)은 유예 후에 탈락 처리
  host_takeOver(g_lastState, g_myId);
  host_sendAll();
  for (i = 0; i < goneArr.length; i++) net_scheduleRemove(goneArr[i]);
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
      // 유예 중에 돌아왔으면 탈락 예약 취소
      if (g_leaveTimers[k]) {
        clearTimeout(g_leaveTimers[k]);
        delete g_leaveTimers[k];
      }
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
        g_bResuming = false;
        ui_onError('실시간 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      } else if (hadRoom) {
        ui_onDisconnect();
        // 한 번 자동으로 다시 들어가 봄 (유예 시간 안이면 그대로 이어서 플레이)
        setTimeout(net_resume, 1500);
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
  // 방장 응답이 없으면 포기 (일반 입장 6초, 자동 재입장은 방장 승계를 기다려 12초)
  // 방 코드가 틀렸는지 방장 연결이 느린지는 구분할 수 없어서 메세지를 둘 다 열어둠
  var bResume = g_bResuming;
  g_joinTimeoutTimer = setTimeout(function () {
    net_close();
    g_bResuming = false;
    net_storeSet(ROOM_KEY, null);
    if (bResume) ui_onError('이전 방에 다시 연결하지 못했습니다. 방이 끝났을 수 있어요.');
    else ui_onError('방을 찾지 못했습니다. 방 코드를 확인하거나 잠시 후 다시 시도해 주세요.');
  }, bResume ? RESUME_TIMEOUT_MS : JOIN_TIMEOUT_MS);
}

/* 새로고침·연결 끊김 뒤 마지막 방에 자동으로 다시 들어가기. 시도했으면 true */
function net_resume() {
  if (g_sb == null || g_channel != null) return false;
  var saved = null;
  try { saved = JSON.parse(net_storeGet(ROOM_KEY) || 'null'); } catch (e) { saved = null; }
  if (!saved || typeof saved.code != 'string' || typeof saved.nick != 'string') return false;
  g_bResuming = true;
  net_joinRoom(saved.nick, saved.code);
  return g_channel != null;
}

/* 나가기 */
function net_leaveRoom() {
  if (g_sb == null) {
    ui_onError('Supabase 설정(config.js)이 없습니다.');
    return;
  }
  // 직접 나가면 자동 재입장 정보는 지움
  net_storeSet(ROOM_KEY, null);
  // 방장이 아니면 바로 탈락 처리되도록 알림 (안 그러면 유예 시간만큼 기다림)
  // 방장이 나가면 남은사람이 알아서 이어받음
  if (g_lastState && !g_hostRoom) net_rawSend('c2s', { from: g_myId, event: 'room:leave', payload: {} });
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
