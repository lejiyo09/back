# LOST SIGNAL — Prototype 0.1

브라우저에서 실행되는 1인칭 백룸(Backrooms) 생존 공포 게임.
**Prototype 0.1 — Player & World Foundation** 마일스톤 구현체입니다.

> You were never alone. You were only never listening.

## 실행

```bash
npm install
npm run dev          # 게임 서버(:3001) + Vite 클라이언트(:5173) 동시 실행
```

브라우저에서 http://localhost:5173 을 엽니다. 싱글플레이는 서버 없이도 동작합니다.

멀티플레이 테스트: 브라우저 창 두 개 → 한쪽에서 **방 만들기** → 표시된 방 코드를 다른 창에서 입력 후 **참가** → 호스트가 **게임 시작**.

프로덕션(단일 서버가 빌드된 클라이언트까지 서빙):

```bash
npm run build && npm start      # http://localhost:3001
```

Render에는 `render.yaml` 블루프린트로 Web Service 하나만 배포하면 됩니다.

### 조작

| 키 | 기능 | 키 | 기능 |
|---|---|---|---|
| WASD | 이동 | E | 상호작용 (문 / 아이템 / 문서) |
| Mouse | 시점 | F | 손전등 |
| Shift | 달리기 (스태미나 소모) | Tab (누르고 있기) | 소지품 |
| Ctrl / C | 웅크리기 | Esc | 일시정지 메뉴 |
| Space | 점프 | F3 | 디버그 정보 |

### 테스트용 URL 플래그

`?debug=1` 포인터 락 없이 조작 + 디버그 표시 · `?seed=1234` 맵 고정 · `?quality=low|medium|high|ultra` · `?autostart=single`
`?ai=now` 단계적 공개를 압축(4초 후 시작) · `?ai=hunt` 공개 생략하고 바로 사냥 · `?ai=off` 괴물 비활성
디버그 모드에서는 콘솔의 `window.__LS`로 게임 객체에 접근할 수 있습니다 (`__LS.debugTeleport(22, 22)` → 정전 구역).

## Prototype 0.1 체크리스트

| 항목 | 상태 | 구현 |
|---|---|---|
| Vite + TypeScript 프로젝트 | ✅ | npm workspaces (`client`, `server`, `shared`) |
| Three.js 렌더러 및 카메라 | ✅ | `three@0.187.0` WebGLRenderer(WebGL 2), ACES 톤매핑, FOV 75 |
| Rapier 물리 월드 | ✅ | `@dimforge/rapier3d-compat@0.21.0`, 60Hz 고정 스텝 |
| 1인칭 이동 및 충돌 | ✅ | Kinematic Character Controller + 캡슐(r=0.32m), 걷기 4.2 / 달리기 6.0 / 웅크리기 2.2 m/s, 시점 1.65m |
| 손전등 시스템 | ✅ | SpotLight(유일한 실시간 그림자) + 배터리 소모/저전력 깜빡임 + 바운스 광 |
| 노란 벽지와 카펫 환경 | ✅ | 절차적 PBR 텍스처(Albedo/Normal/Roughness), 얇은 석고벽 · 기둥 · 문 |
| 형광등 및 기본 조명 | ✅ | 인스턴스 조명기구 + 베이크된 간접광 + 플레이어 근처 실시간 조명 풀, 고장 등 깜빡임 |
| 공간 음향 및 발소리 | ✅ | Web Audio 절차적 합성: 안정기 험, 젖은 카펫 발소리, 문 삐걱임, 벽 차폐(로우패스) |
| 기본 메인 메뉴 | ✅ | 메뉴 · 대기실 · 설정(품질/밝기/감도/음량/깜빡임 강도/헤드밥) · 일시정지 |
| Socket.IO 로비 연결 | ✅ | 방 코드 생성/참가, 최대 4인, 입력 검증 + 레이트 리밋 |
| 2개 브라우저 플레이어 동기화 | ✅ | 20Hz 상태 전송 + 110ms 보간, 호스트 권한 문/아이템 동기화, 중간 참가 시 월드 스냅샷 |

## The Receiver (괴물 AI)

플레이어보다 큰(직립 약 2.7m) 얼굴 없는 인간형. 굽은 채로 걷고 문을 지날 때는 몸을 접어 통과한다.
오른팔은 관절이 하나 더 있고 손가락이 바닥에 끌릴 만큼 길며, 왼팔은 팔꿈치가 비정상적으로 접혀 가슴 앞에서 경련한다.
얼굴 자리는 움푹 꺼진 평면이고, 머리는 마지막 순간에만 세로로 갈라져 열린다. 움직일 때는 스톱모션처럼 끊기고, 멈춰 있을 때는 머리만 아주 천천히 돈다.

**단계적 공개 (`horror/RevealDirector.ts`)** — 모든 등장/이동은 어떤 플레이어도 그 지점을 보고 있지 않을 때만 일어난다.

1. 먼 거리(12–24m)의 검은 형체 — 보는 동안 움직이지 않고, 시선을 돌리면 사라진다.
2. 더 가까이(7–11m), 벽 모서리 옆 — 시선을 돌렸다 돌아보면 더 가까이 와 있다. 다시 돌리면 사라진다.
3. 바로 뒤(2.1m) — 머리 위 조명이 떨리고 숨소리가 들린다. 돌아보면 잠깐의 정적 → 비명(1.1초, 공격 불가) → 추격 시작.

**AI 상태 머신 (`entities/ReceiverAI.ts`)** — Idle · Patrol · Observe · Investigate · Stalk · Chase · Attack · Search · Retreat + Hidden · Apparition · Lurk

| 감지 | 규칙 |
|---|---|
| 시각 | 시야각 115°, 거리 24m, Rapier 레이 가림, 플레이어 위치의 밝기, 손전등(항상 노출), 웅크리기 ×0.55 → 의심도 누적 |
| 청각 | 플레이어 소음 반경(걷기 6 / 달리기 16 / 착지 9m), 벽 너머는 55%로 감쇠, 문 소리 — 위치 오차는 거리에 비례 |
| 시선 | 모든 플레이어의 시선 방향을 알고 있어, Stalk 중에는 아무도 보지 않을 때만 다가온다 |

공정성: 순간이동 없이 Rapier 캐릭터 컨트롤러로 같은 벽·문을 통과(A* + 문 직접 열기), 추격 5.4m/s(걷기 4.2 < 추격 < 달리기 6.0),
공격 0.5초 예비 동작, 타격 후 후퇴 → 시야 밖에서 사라졌다가 20–40초 뒤 먼 곳(보이지 않는 지점)에 다시 나타남.
완전한 어둠에서 손전등을 끄고 웅크리면 발각되지 않지만, 손전등을 켜면 약 1초 만에 발견된다.

멀티플레이: 호스트가 AI를 시뮬레이션하고 12Hz 스냅샷(신뢰 전송)으로 공유, 피격은 해당 플레이어에게만 전달. 가장 고립된 플레이어가 먼저 표적이 된다.

## 구조

```
shared/        Constants · GameTypes · Protocol(Socket.IO 이벤트 계약) · Random(시드 RNG)
server/src/    index(HTTP+정적 서빙) · RoomManager · NetworkHandler · ProtocolValidator
client/src/
  core/        Game(조립 루트) · GameLoop(60Hz 고정 스텝) · GameSession · GameConfig · Input
  rendering/   Renderer · PostProcessing · Lighting · BakedLighting · Textures
  physics/     PhysicsWorld
  player/      PlayerController · SurvivalStatus · Flashlight
  world/       World · Level0Layout · Notes
  interaction/ InteractionManager · Interactable · Door · Item
  entities/    EntityManager · ReceiverAI · Receiver(모델·애니메이션) · NavGrid(A*)
  horror/      RevealDirector(단계적 공개)
  audio/       AudioManager · SoundSynth
  multiplayer/ GameAuthority · LocalAuthority · HostAuthority · RemoteAuthority · NetworkManager · RemotePlayers
  ui/          MainMenu · HUD · SettingsUI
```

### 핵심 설계

- **싱글/멀티 단일 코드 경로** — 모든 시스템은 공통이고 `GameAuthority`만 교체됩니다.
  `LocalAuthority`(즉시 적용) · `HostAuthority`(검증 후 확정·브로드캐스트) · `RemoteAuthority`(요청 후 확정 반영).
- **Seed 기반 월드** — 맵 전체를 전송하지 않고 Seed만 공유, 모든 클라이언트가 같은 Level 0을 생성합니다.
  상태 변경(문 −1/0/+1, 아이템)만 이벤트 ID와 함께 전송해 중복 적용을 막습니다.
- **조명** — 수백 개의 형광등을 실시간 광원으로 둘 수 없으므로, 확산광을 평면 조도 텍스처(4 texel/m, 벽 가시성 검사)로
  베이크해 셰이더에서 간접광으로 더하고, 플레이어 주변 2~8개만 실시간 PointLight로 처리합니다(그림자 없음).
- **Level 0 고증** — Backrooms Wiki의 Level 0 서술(단색 노란 벽지, 축축한 카펫, 최대 출력으로 웅웅거리는 형광등,
  무작위로 분할된 빈 사무실 공간, 가구 없음)을 기준으로 했습니다. 남동쪽 8×8 정전 구역은 LOST SIGNAL ACT 4 대비용 랜드마크입니다.

## 품질 프리셋

| | Low | Medium | High | Ultra |
|---|---|---|---|---|
| 렌더 스케일 / 최대 DPR | 0.7 / 1 | 1 / 1 | 1 / 1.5 | 1 / 2 |
| 텍스처 | 256 | 512 | 1024 | 2048 |
| 손전등 그림자 | 끔 | 512 | 1024 | 2048 |
| 실시간 형광등 | 2 | 4 | 6 | 8 |
| 후처리 | 없음 | 그레인·비네팅 | + 블룸 | + 색수차 |

4GB 이하 메모리 또는 4코어 이하 기기는 첫 실행 시 Low가 기본값입니다.

## 다음 마일스톤에서 할 일

- 실제 CC0 스캔 텍스처(ambientCG / Poly Haven)와 AssetManager, `assets/manifest.json` 등록
- 그래프 기반 모듈 생성기(설계서 4장)로 `Level0Layout`의 분할 단계 교체 + 경로 검증
- Scare Director(주변 시야 · 소리 · 정전 이벤트) 및 은신 장소, 다운/구조(멀티)
- Signal Recorder(R), 체력/사망·다운/구조, 호스트 이탈 처리 고도화
- 번들 분할(현재 단일 ~5MB, gzip ~1.8MB — 대부분 Rapier WASM 인라인)
