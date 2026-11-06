# 🎲 다이스 대시

방 코드로 모인 2~8명이 브라우저로 접속해 즐기는 턴제 주사위 보드 레이스입니다.
자세한 기획은 [PRD.md](PRD.md)를 참고하세요.

## 구조

Vercel에 정적 페이지로 배포하고, 실시간 통신은 Supabase Realtime(Broadcast + Presence)을 씁니다.
별도 게임 서버가 없고 **방장 브라우저가 방 서버 역할**을 합니다. 방장이 나가면 남은 사람 중 한 명이 마지막 상태로 이어받습니다.

## 배포 (Vercel)

Vercel 프로젝트 환경변수에 아래 두 값을 넣고 배포합니다.

| 이름 | 값 |
|---|---|
| `SUPABASE_URL` | Supabase Project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Publishable(또는 anon) 키 — 브라우저에 공개되는 키 |

```bash
vercel --prod
```

## 로컬 실행

```bash
npm install
vercel env pull .env.local   # 또는 .env.local에 위 두 값을 직접 작성
npm run dev                  # http://localhost:3000
```

## 플레이 방법

1. 닉네임을 입력하고 **방 만들기** → 4자리 방 코드가 나옵니다.
2. 다른 사람들은 같은 사이트 주소로 접속해 닉네임과 방 코드를 입력하고 **입장하기**를 누릅니다.
3. 2명 이상 모이면 방장이 **게임 시작**을 누릅니다.
4. 내 차례에 **🎲 주사위 굴리기**를 누르고, 먼저 🏁 결승(30번 칸)에 도착하면 승리!

| 칸 | 효과 |
|---|---|
| 🚀 부스터 | 3칸 추가 전진 |
| 🕳 함정 | 3칸 후퇴 |
| 💤 휴식 | 다음 턴 1회 쉼 |
| 🔁 다시 굴리기 | 한 번 더 굴림 |
| 🎁 아이템 | 아이템 1장 획득 (최대 2장) |
| 🔀 자리 바꾸기 | 바로 앞 플레이어와 위치 교환 |

| 아이템 (굴리기 전 사용, 턴당 1장) | 효과 |
|---|---|
| 🎲 더블 주사위 | 주사위 2개 합만큼 이동 |
| 🛡 보호막 | 이번 턴 함정·휴식 무효 |
| 🎯 조정 | 주사위 결과 +1 또는 -1 |

게임 중에 브라우저를 닫거나 나가면 탈락 처리되고, 남은 사람끼리 계속 진행합니다.

## 개발

```bash
npm test   # 게임 규칙 단위 테스트
```

```
public/
  index.html      # 화면 (버튼 이벤트는 onclick 속성)
  main.js         # 화면 그리기, 애니메이션
  network.js      # Supabase Realtime 통신, 방장 승계
  game_logic.js   # 게임 규칙 + 방장 브라우저용 방 관리
scripts/build.js  # 환경변수 → public/config.js 생성, supabase-js 복사
test/             # 규칙·방 관리 테스트 (legacy_loader.js가 전역 함수를 불러옴)
```
