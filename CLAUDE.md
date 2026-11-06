# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 개요

다이스 대시: 4자리 방 코드로 모인 2~8명이 브라우저에서 즐기는 턴제 주사위 보드 레이스(36칸, 화면 테두리를 두르는 트랙)예요. Vercel에 정적 페이지로 배포하고, 실시간 통신은 Supabase Realtime(Broadcast + Presence)으로 해요. **게임 서버가 따로 없고, 방장 브라우저가 방 서버 역할을 해요.** 게임 규칙과 요구사항의 기준 문서는 `PRD.md`예요.

## 명령어

```bash
npm install
npm run build   # 환경변수 → public/config.js 생성, supabase-js UMD를 public/vendor/로 복사
npm run dev     # build 후 http://localhost:3000 에서 public/ 정적 서빙
npm test        # test/game.test.js + test/host.test.js (외부 의존성 없음, Supabase 불필요)
node test/game.test.js   # 게임 규칙 테스트만
node test/host.test.js   # 방 관리(HostRoom) 테스트만
vercel --prod   # 배포
```

- 테스트 러너는 직접 만든 것이라 테스트 하나만 골라 실행하는 기능이 없어요. 하나만 돌리려면 그 파일의 `tests` 배열을 임시로 걸러서 실행하세요.
- build/dev에는 `SUPABASE_URL`과 `SUPABASE_PUBLISHABLE_KEY`(또는 `SUPABASE_ANON_KEY`, `NEXT_PUBLIC_*` 변형)가 필요해요. `scripts/build.js`가 `.env.local`을 직접 읽어요(`vercel env pull .env.local`로 받을 수 있음). 테스트에는 필요 없어요.
- `public/config.js`와 `public/vendor/`는 빌드 결과물이고 git에서 제외돼 있어요. 직접 고치지 마세요.

## 아키텍처

번들러나 모듈 시스템 없이, `public/index.html`이 일반 `<script>` 태그로 파일을 순서대로 불러와요. 모든 함수와 상태가 **전역**이에요.

```
vendor/supabase.js → config.js (window.DICE_CONFIG) → game_logic.js → network.js → main.js
```

이 순서를 바꾸면 안 돼요. 파일끼리 서로의 전역 함수를 이름으로 호출해요.

- **`game_logic.js`**: 순수 게임 규칙(`makeGame`, `rollDiceProc`, `useItemProc`, `killPlayer`)과 방장용 방 서버(`host_*` 함수, 전역 `g_hostRoom` 하나에 상태 저장)를 함께 담고 있어요. 방 서버는 메시지 검증, 닉네임 중복 확인, 초당 요청 제한(`RATE_LIMIT`)을 맡아요. 밖으로 보낼 때는 `net_hostOut(to, event, payload)`를 호출하는데, 이 함수는 `network.js`에 정의돼 있어요.
- **`network.js`**: Supabase 채널 `dice-dash:<방코드>` 하나를 써요. 모든 메시지는 broadcast 이벤트 두 가지로 감싸요.
  - `c2s` `{from, event, payload}`: 모든 참가자 → 방장. `broadcast.self: true`라서 방장 자신의 요청도 같은 경로로 돌아와요. 방장 브라우저만(`g_hostRoom != null`) `host_onMessage`로 처리해요.
  - `s2c` `{to, event, payload}`: 방장 → 참가자. `to`가 null이면 전체에게 보내요. 앱 이벤트는 `room:state`, `game:events`, `app:error`, `room:left`예요.
  - 나간 사람은 Presence로 감지해요. 방장이 나가면 `g_lastState.members` 순서상 첫 번째로 남아 있는 사람이 `host_takeOver`로 마지막 상태를 받아 방 서버가 돼요. 그래서 방 상태는 JSON으로 직렬화할 수 있어야 해요.
  - Presence에서 빠져도 바로 탈락시키지 않고 `LEAVE_GRACE_MS`(8초) 기다려요(`net_scheduleRemove`). 플레이어 id와 마지막 방은 탭별 `sessionStorage`에 저장돼서, 새로고침하면 `net_resume`이 같은 id로 자동 재입장해요. 직접 나가기는 `room:leave`를 보내 바로 탈락 처리돼요.
  - `s2c`는 현재 방장(`hostId`)이 보낸 것만 받아요(`net_isFromHost`). 단 `from`은 보내는 쪽이 적는 값이라 인증은 아니에요.
- **`main.js`**: 화면을 그리고 애니메이션 큐를 관리해요. `network.js`가 `ui_onRoomState`, `ui_onGameEvents`, `ui_onError`, `ui_onRoomLeft`, `ui_onDisconnect`를 호출해요. 버튼 이벤트는 `index.html`의 `onclick` 속성으로 연결돼 있어요.
- 클라이언트가 보내는 게임 요청 이벤트는 `room:join`, `game:start`, `game:roll`, `game:useItem`, `game:restart`, `room:leave`예요. 새 이벤트를 추가하면 `host_onMessage`(방장 처리)와 `net_onS2C`/`main.js`(화면 처리)를 함께 고쳐야 해요.

## 테스트 구조

`test/legacy_loader.js`가 `vm.runInThisContext`로 `public/game_logic.js`를 Node 전역에 불러온 뒤, 테스트용 API로 감싸요(`game.createGame/roll/useItem/removePlayer`, `HostRoom.create/fromState`). 방 서버 상태가 전역 하나뿐이라서, 로더가 호출할 때마다 `g_hostRoom`과 `g_rateTbl`을 인스턴스별로 바꿔 끼워요. `game_logic.js`의 전역 함수 이름이나 시그니처를 바꾸면 이 로더도 같이 고쳐야 해요. 주사위와 아이템은 `rng` 객체(`{die(), item()}`)를 넘겨서 결과를 정해 두고 테스트해요.

## 변경 반영 규칙 (사용자 지시)

사용자가 코드 수정을 요청하면, 따로 묻지 않고 끝까지 반영해요. Vercel이 GitHub `main`에 연결돼 있어서 push하면 바로 배포돼요.

1. 수정한 뒤 `npm test`를 실행해요. 실패하면 커밋하지 말고 결과를 사용자에게 먼저 알려요.
2. 통과하면 `main`에 커밋하고 `git push`해요. 이 작업은 사용자가 미리 허락했어요.
3. 배포가 끝났는지 확인하고(`vercel ls`로 최신 배포가 Ready인지), 배포 주소를 알려 줘요.

저장소(github.com/nkj0901/dice-dash)는 공개예요. `.env.local`, `.vercel/` 같은 비밀 정보는 절대 커밋하지 마세요.

## 주의할 점

- 코드는 ES5 스타일(`var`, 전역 함수, `==`)이에요. 수정할 때도 같은 스타일을 유지하고, `import`/`export`나 모듈 문법은 쓰지 마세요. 브라우저가 스크립트 태그로 그대로 불러와요.
- 오래된 주석 중에 코드와 맞지 않는 게 있어요. 예를 들어 `BOOST_CNT = 3`인데 주석은 "부스터는 2칸"이라고 돼 있어요. 주석보다 코드와 테스트, `PRD.md`를 믿으세요.
- `game_logic.js`의 `g_tmp`에는 "지우지 마세요"라는 주석이 있어요. 용도를 확인하기 전에는 지우지 마세요.
- `.env.local`과 `.vercel/`은 로컬 비밀 정보와 배포 연결 정보예요(git·Vercel 업로드 제외). 브라우저에 공개되는 값은 Supabase publishable/anon 키뿐이에요.
