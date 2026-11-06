// 레거시 스크립트(전역 함수 방식)를 Node에서 불러와 예전 테스트가 쓰던 API 모양으로 감싼다.
// 리팩토링하면서 동작이 바뀌지 않았는지 확인하는 안전망 용도.
const vm = require('vm');
const fs = require('fs');
const path = require('path');

global.net_hostOut = () => {};
const file = path.join(__dirname, '..', 'public', 'game_logic.js');
vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: file });

const game = {
  createGame: (members) => global.makeGame(members),
  roll: (g, id, rng) => global.rollDiceProc(g, id, rng),
  useItem: (g, id, type, opt) => global.useItemProc(g, id, type, opt),
  removePlayer: (g, id) => global.killPlayer(g, id),
};

// 방 서버는 전역 변수 하나(g_hostRoom)에 상태를 두므로, 인스턴스별로 바꿔 끼우며 호출한다.
function wrap(send) {
  const inst = { room: null, rate: {} };
  const run = (fn) => {
    global.g_hostRoom = inst.room;
    global.g_rateTbl = inst.rate;
    global.net_hostOut = send;
    try {
      return fn();
    } finally {
      inst.room = global.g_hostRoom;
      inst.rate = global.g_rateTbl;
    }
  };
  inst.run = run;
  inst.handle = (from, ev, data) => run(() => global.host_onMessage(from, ev, data));
  inst.leave = (id, opts = {}) => run(() => global.host_removeMember(id, Boolean(opts.silent)));
  inst.broadcast = () => run(() => global.host_sendAll());
  return inst;
}

const HostRoom = {
  create(code, hostId, nickname, send) {
    const inst = wrap(send);
    inst.run(() => global.host_createRoom(code, hostId, nickname));
    return inst;
  },
  fromState(state, newHostId, send) {
    const inst = wrap(send);
    inst.run(() => global.host_takeOver(state, newHostId));
    return inst;
  },
};

module.exports = { game, HostRoom, publicState: (room) => global.makeRoomPacket(room) };
