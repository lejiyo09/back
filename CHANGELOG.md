# CHANGELOG

## 확장 1차 — Level 0~10 캠페인 (2026-11-13)

### 레벨 전환
- 레벨 사이 중간 화면 삭제: Ending B → Level 1, Level 1 → Level 2, Level 2(확장) → Level 3 … Level 9 → Level 10이 **화면 없이 바로 이어짐**
- Level 1부터는 "화면을 클릭하여 시작" 페이지도 없음 — 바로 이동 가능, 비차단 타이틀 카드(LEVEL n — 이름)만 잠깐 표시
- 진짜 엔딩(A, C/D-클래식, E/F)만 엔딩 화면을 보여줌

### 캠페인
- **확장 캠페인 (기본)**: Level 0~10 연속. Level 2 무전실 선택(녹음 C / 송신 차단 D)이 저장되어 Level 10 엔딩 문구에 반영
- **클래식 캠페인**: 설정 → 캠페인에서 선택. Level 0~2 + 엔딩 A~D 그대로
- 새 엔딩 **E TRANSMISSION**, **F FINAL SILENCE**
- 세이브 호환: 기존 `lost-signal.save.v1` 그대로 읽음 (chapter가 1~10으로 확장, carry.choice 추가)

### Level 3~10 (신규)
| Level | 이름 | 구조 | 고유 기믹 | 괴물 (전략) |
|---|---|---|---|---|
| 3 | THE ARCHIVE | 방 블록 | 장치 작동 시 모든 문이 바뀜, 문서를 읽으면 소리 남, G: 낡은 녹음기 미끼 | Indexer — 시야 짧고 종이 소리를 멀리서 들음 |
| 4 | THE INN | 작은 객실 블록 | 다른 곳으로 이어지는 문 3개(순간이동), G: 호텔 벨을 던져 유인 | Bellman — 벨 소리에 80m 밖에서도 반응 |
| 5 | WARD 13 | 병실 블록 | 정전 주기, 의료 스캐너(거리 표시), 수술용 손전등(밝기 ↑) | Curtain Walker — 누군가 보고 있으면 정지, 안 보면 빠름 |
| 6 | THE FLOOD | 넓은 홀 + 침수 | 감전된 물(절연 장갑 필요), 정전, 펌프 3개로 물 빼기 | Drowned — 물속 1.5배 / 마른 땅 0.65배 |
| 7 | THE TERMINAL | 홀 + 선로 | 실제 열차 통과(치이면 큰 피해), 거짓 안내 방송, G: 신호탄 | Conductor — 선로 위에서 1.5배, 시야 좁고 멀다 |
| 8 | THE DEEP | 수영장 홀 | 대부분 물, 방수 녹음기를 켜면 물속 괴물이 보임 | Undertow — 물속에서는 보이지 않음 |
| 9 | THE OBSERVER | 미로 + 서버실 | C(길게): CCTV 시점, 정전 | Observer — 맨눈에 안 보이고 CCTV에만 보임 |
| 10 | THE LAST SIGNAL | 높은 홀 | 공명 장치 3개를 40초 안에 모두(아니면 초기화), 무전실 최종 선택 | Receiver Prime — 크고 빠름, 장치 소리에 몰려옴 |

- 레벨마다 아이템 3~4개(팀 공유), 장치 3개(각각 필요한 아이템), 문서 2개, 보급 상자, 배터리
- 괴물: 같은 리그/애니메이션에 레벨별 실루엣(종이·벨과 제복·커튼·부패·랜턴과 코트·지느러미·눈 무더기·안테나), 크기, 피부색, AI 수치(시야·청각·속도·추격·탐색·공격) + 고유 능력

### 맵 디테일 (Level 0~10)
- Poly Haven CC0 실제 모델 84개를 방 용도별 "레시피"로 배치 (사무 책상+의자+노트북, 창고 랙, 펌프 코너, 서가, 객실 침대, 병상, 승강장 벤치, 모니터 데스크 …)
- Level 0은 원작 설정(가구 없음)을 존중해 드물게 버려진 흔적만, Level 1/2는 창고·배관 설비
- 새 표면 텍스처: 타일, 목재 (절차적 PBR)

### 에셋 파이프라인
- `tools/assets/fetch-polyhaven.mjs`: 다운로드 → dedup/prune/weld → simplify(저사양 ≤3k, 고사양 ≤8k tris) → WebP 512/1K → quantize → meshopt
- `client/src/core/AssetManager.ts`: catalog 기반 로딩, 캐시, 인스턴싱, 언로드, 진행률, 실패 시 건너뜀
- `ASSET_MANIFEST.md`: 출처·제작자·라이선스·폴리곤

### 성능
- 소품은 4×4셀 청크별 InstancedMesh + 거리 컬링(큰 소품/작은 소품 별도 거리), 그림자는 큰 소품만
- 측정 (headless SwiftShader, quality=low, 480×270 — 소프트웨어 렌더러라 실제 GPU보다 훨씬 느림):

| | 소품 없음 | 소품 있음 |
|---|---|---|
| Level 0 | 22 fps · 24 draw · 8k tris | 22 fps · 77 draw · 55k tris |
| Level 2 | 39 fps · 6 draw · 64k tris | ~22 fps · 10~90 draw · 110~240k tris |
| Level 3~10 | — | 16~51 fps · 7~27 draw · 7~32k tris (스폰 지점) |

  최적화 전 Level 0은 2.8M tris / 10 fps였음 (원인: 전체 맵 소품을 컬링 없이 렌더) → 청크 컬링 + LOD로 해결

### 멀티플레이
- `game:level` 0~10 허용 (서버 검증), 같은 시드, 아이템/장치/문/미끼/열차 이벤트 모두 호스트 경유 `mech:*` 이벤트로 동기화

### 테스트 결과 (Playwright, headless Chromium)
- ✅ 싱글 Level 2(녹음) → 3 → … → 10 → 엔딩 F: 장치는 아이템 없이 잠김 확인, Level 2 선택 C가 Level 10까지 전달, 세이브 `chapter 10 / ending F / choice C`
- ✅ 레벨 3~10 각각 로드 오류 0, 키 4(10은 3)·장치 3·괴물·목표 문구 정상
- ✅ 멀티 Level 3: 같은 맵/시드, 아이템 없는 장치 거부(양쪽), 클라이언트가 주운 열쇠를 호스트가 사용, 문 상태 동일, 클라이언트 미끼 → 호스트 AI, 전원 동기화, 함께 Level 4로 이동
- ✅ 회귀: Ending B → Level 1 바로 진입, Level 1 → 2 중간 화면 없음, 멀티 L0→L1 + 늦은 참가자 + 차단기/정전 동기화
- ⚠️ 멀티 Level 3→4 전환이 한 번 120초 타임아웃(재실행 2회 통과) — 소프트웨어 렌더러 2개 동시 로딩 지연으로 추정

### 아직 남은 것 (정직하게)
- Room Mutation(벽/문/조명이 안 볼 때 바뀌는 시스템)은 Level 3의 문 전환, Level 4의 순간이동 문만 구현 — Level 0 전용 변이 시스템은 다음 단계
- 외부 괴물 모델 미사용 (라이선스 확인 불가 — ASSET_MANIFEST.md 참고)
- Level 1 Pallet Maw / Level 2 Pipe Crawler(추가 괴물), 지게차·밀 수 있는 물체, 밸브 순서 퍼즐은 아직
