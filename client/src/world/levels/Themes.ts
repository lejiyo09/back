import type { MonsterTuning } from '../../entities/ReceiverAI';
import type { DressingPlan } from '../Dressing';

/**
 * Levels 3–10 of the Expanded Campaign (expansion spec §3).
 *
 * Every level is data on the shared grid engine plus one mechanic module
 * (core/mechanics). Names, items and monsters follow the expansion design
 * document; surfaces, sounds and behaviour are LOST SIGNAL's own.
 */

export type LayoutStyle = 'rooms' | 'hall' | 'maze';
export type SurfaceKind = 'wallpaper' | 'concrete' | 'tile' | 'wood';
export type MonsterAccessory = 'pages' | 'bell' | 'curtain' | 'drowned' | 'lantern' | 'fins' | 'eyes' | 'antenna';

export interface KeyDef { key: string; name: string; /** shown when picked up */ hint: string; model?: string; color: number }
export interface DeviceDef { needs: string; lines: [string, string, string] }

export interface LevelTheme {
  index: number;
  code: string;
  title: string;
  intro: string;
  layout: { style: LayoutStyle; room?: number; partitions?: number; doors: number; pillars: boolean; ceiling: number; water: number; darkPatches: number; faulty: number; dead: number; crates: number; supplies: number };
  surface: { wall: SurfaceKind; floor: SurfaceKind; ceil: SurfaceKind; wallColor: number; floorColor: number; ceilColor: number; fog: number };
  /** periodic power failures like Level 1 */
  blackouts?: [number, number, number, number];
  keys: KeyDef[];
  devices: DeviceDef[];
  /** what the devices power, as an objective line */
  objective: string;
  exitKind: 'stairs' | 'radio';
  monster: { name: string; tuning: Partial<MonsterTuning>; scale: number; skin: number; accessory: MonsterAccessory; spawnDelay: number; ability: string };
  dressing: DressingPlan;
  notes: { title: string; body: string }[];
}

const card = (c: number): KeyDef['color'] => c;

export const THEMES: Record<number, LevelTheme> = {
  3: {
    index: 3, code: 'THE ARCHIVE', title: '기록 보관소',
    intro: '끝없는 서가. 종이 냄새와 먼지. 어디선가 누군가 페이지를 넘긴다.',
    layout: { style: 'rooms', room: 4, doors: 10, pillars: false, ceiling: 3.2, water: 0, darkPatches: 2, faulty: 0.25, dead: 0.1, crates: 0, supplies: 6 },
    surface: { wall: 'wood', floor: 'wood', ceil: 'wallpaper', wallColor: 0x8a6e4e, floorColor: 0x6b5238, ceilColor: 0xb8ab90, fog: 0x3b3022 },
    keys: [
      { key: 'archive-key', name: '보관소 열쇠', hint: '녹슨 열쇠. 꼬리표에 “A-13”.', color: card(0xb08d3c) },
      { key: 'index-card', name: '색인 카드', hint: '문서 번호가 적힌 카드. 0413-77.', color: card(0xe8e0c8) },
      { key: 'magnetic-tape', name: '자기 테이프', hint: '라벨이 지워진 테이프. 무언가 녹음돼 있다.', model: 'cassette_player', color: card(0x333333) },
      { key: 'old-recorder', name: '낡은 녹음기', hint: '테이프를 재생하면 그것이 반응한다. (G: 소리 미끼)', color: card(0x6a5a40) },
    ],
    devices: [
      { needs: 'archive-key', lines: ['INDEX', '열람실 잠금장치', 'A-13'] },
      { needs: 'index-card', lines: ['INDEX', '색인 단말기', '0413-77'] },
      { needs: 'magnetic-tape', lines: ['INDEX', '테이프 판독기', 'MAG-B'] },
    ],
    objective: '진짜 기록을 찾아 열람실 장치 세 개를 작동시켜라',
    exitKind: 'stairs',
    monster: { name: 'THE INDEXER', scale: 1.0, skin: 0x2a2520, accessory: 'pages', spawnDelay: 35,
      tuning: { VISION_RANGE: 14, PATROL_SPEED: 1.3, CHASE_SPEED: 5.0, SEARCH_DURATION: 22 },
      ability: '종이 소리(문서 읽기·가짜 기록)를 멀리서 듣는다. 눈은 나쁘다.' },
    dressing: {
      groups: ['shared', 'level-03', 'level-00'], density: 0.3, view: [16, 9],
      wall: [
        { name: 'stacks', weight: 6, pieces: [{ id: 'wooden_bookshelf_worn', u: -0.55, d: 0.03, collide: true }, { id: 'wooden_bookshelf_worn', u: 0.62, d: 0.03, collide: true }] },
        { name: 'cabinet', weight: 3, pieces: [{ id: 'vintage_cabinet_01', d: 0.03, collide: true }] },
        { name: 'reading', weight: 3, pieces: [{ id: 'vintage_wooden_drawer_01', d: 0.04, collide: true }, { id: 'desk_lamp_arm_01', u: -0.5, d: 0.15, on: 0 }, { id: 'binder_notebook', u: 0.2, d: 0.3, on: 0, yaw: 0.3 }, { id: 'vintage_stapler', u: 0.5, d: 0.25, on: 0 }, { id: 'SchoolChair_01', d: 1.45, anchor: 'center', yaw: Math.PI + 0.2, collide: true }] },
        { name: 'projector', weight: 1, pieces: [{ id: 'metal_office_desk', d: 0.05, collide: true }, { id: 'filmstrip_projector_8mm', u: 0.2, d: 0.2, on: 0, yaw: 0.4 }, { id: 'book_encyclopedia_set_01', u: -0.6, d: 0.1, on: 0 }] },
        { name: 'boxes', weight: 2, pieces: [{ id: 'cardboard_box_01', u: -0.3, d: 0.05, collide: true }, { id: 'cardboard_box_01', u: -0.3, d: 0.05, on: 0, yaw: 0.4 }, { id: 'stationery_supplies', u: 0.4, d: 0.1 }] },
      ],
      mounted: [{ id: 'wall_clock', y: 2.3, chance: 0.04 }, { id: 'fire_alarm', y: 1.5, chance: 0.03 }],
      ceiling: [],
    },
    notes: [
      { title: '열람 기록 — 진본', body: '문서 번호 0413-77.\n\n색인 단말기는 진짜 기록에만 반응한다. 가짜 기록에는 붉은 도장이 찍혀 있다.\n\n읽지 마라. 가짜를 읽으면 서가가 움직이고, 그것이 고개를 든다.' },
      { title: '사서의 메모', body: '그것은 눈이 없다. 대신 종이가 넘어가는 소리를 듣는다.\n\n테이프를 틀면 그쪽으로 간다. 그 틈에 지나가라.' },
    ],
  },
  4: {
    index: 4, code: 'THE INN', title: '여관',
    intro: '붉은 카펫, 금빛 손잡이. 복도 끝에서 종이 한 번 울린다.',
    layout: { style: 'rooms', room: 3, doors: 18, pillars: false, ceiling: 3.0, water: 0, darkPatches: 2, faulty: 0.2, dead: 0.06, crates: 0, supplies: 5 },
    surface: { wall: 'wallpaper', floor: 'tile', ceil: 'wallpaper', wallColor: 0x8a3a30, floorColor: 0x6a2420, ceilColor: 0xb59a7a, fog: 0x3a1a14 },
    keys: [
      { key: 'master-key', name: '마스터 키', hint: '모든 객실 문을 연다고 적혀 있다.', color: card(0xd4af37) },
      { key: 'room-key', name: '객실 열쇠 1313', hint: '번호판이 계속 바뀐다. 지금은 1313.', color: card(0xc0a060) },
      { key: 'guest-book', name: '숙박부', hint: '모든 페이지에 네 이름이 적혀 있다.', model: 'binder_notebook', color: card(0x5a1a14) },
      { key: 'hotel-bell', name: '호텔 벨', hint: '울리면 벨보이가 온다. (G: 벨을 던져 유인)', color: card(0xc8a040) },
    ],
    devices: [
      { needs: 'master-key', lines: ['LOBBY', '프런트 금고', 'MASTER'] },
      { needs: 'room-key', lines: ['ROOM', '1313호 잠금', 'ROOM 1313'] },
      { needs: 'guest-book', lines: ['LOBBY', '체크아웃 단말', 'GUEST'] },
    ],
    objective: '체크아웃하라 — 프런트 장치 세 개',
    exitKind: 'stairs',
    monster: { name: 'THE BELLMAN', scale: 1.08, skin: 0x2b1814, accessory: 'bell', spawnDelay: 30,
      tuning: { VISION_RANGE: 20, PATROL_SPEED: 1.8, CHASE_SPEED: 5.2, LOSE_TARGET_AFTER: 3.5 },
      ability: '벨 소리에 반드시 반응한다. 문을 통과할 때마다 다른 방으로 이어지는 복도.' },
    dressing: {
      groups: ['shared', 'level-04'], density: 0.34, view: [16, 9],
      wall: [
        { name: 'bed', weight: 4, pieces: [{ id: 'GothicBed_01', d: 0.03, collide: true }, { id: 'ClassicNightstand_01', u: 1.0, d: 0.03, scale: 0.85, collide: true }] },
        { name: 'lounge', weight: 3, pieces: [{ id: 'Sofa_01', d: 0.05, collide: true }, { id: 'ArmChair_01', u: 0.9, d: 0.9, anchor: 'center', yaw: -0.9, scale: 0.85, collide: true }] },
        { name: 'console', weight: 3, pieces: [{ id: 'ClassicConsole_01', d: 0.04, collide: true }, { id: 'ornate_mirror_01', d: 0.0, y: 1.75 }] },
        { name: 'clock', weight: 1, pieces: [{ id: 'vintage_grandfather_clock_01', d: 0.04, collide: true }] },
        { name: 'desk', weight: 1, pieces: [{ id: 'ClassicConsole_01', d: 0.04, collide: true }, { id: 'CashRegister_01', u: 0.3, d: 0.05, on: 0, scale: 0.8 }] },
      ],
      mounted: [{ id: 'ornate_mirror_01', y: 1.75, chance: 0.05 }, { id: 'fire_alarm', y: 1.5, chance: 0.02 }],
      ceiling: [{ id: 'Chandelier_01', chance: 0.04 }],
    },
    notes: [
      { title: '투숙객 안내문', body: '1. 벨이 울리면 문을 열지 마십시오.\n2. 객실 번호가 바뀌어도 놀라지 마십시오. 원래 그렇습니다.\n3. 같은 방을 세 번 지나쳤다면, 그 문은 다른 곳으로 이어져 있습니다.\n4. 체크아웃은 언제나 가능합니다. 프런트를 찾을 수 있다면.' },
      { title: '벨보이의 근무표', body: '근무 시간: 항상.\n담당 구역: 전 층.\n\n벨 소리가 나면 그쪽으로. 어떤 일이 있어도.' },
    ],
  },
  5: {
    index: 5, code: 'WARD 13', title: '13 병동',
    intro: '소독약 냄새. 커튼이 흔들린다. 바람은 불지 않는다.',
    layout: { style: 'rooms', room: 3, doors: 14, pillars: false, ceiling: 2.9, water: 0, darkPatches: 3, faulty: 0.35, dead: 0.12, crates: 0, supplies: 7 },
    surface: { wall: 'tile', floor: 'tile', ceil: 'wallpaper', wallColor: 0xb8c2bc, floorColor: 0x7d8a86, ceilColor: 0xc8ccc4, fog: 0x2a3330 },
    blackouts: [40, 70, 10, 15],
    keys: [
      { key: 'fuse', name: '퓨즈', hint: '30A 퓨즈. 아직 따뜻하다.', color: card(0xd0d0c0) },
      { key: 'id-card', name: '직원 ID 카드', hint: '사진 속 얼굴이 긁혀 있다.', color: card(0x4a90c0) },
      { key: 'surgical-flashlight', name: '수술용 손전등', hint: '손전등이 더 멀리 비춘다.', model: 'signal_flashlight', color: card(0xe0e0e0) },
      { key: 'medical-scanner', name: '의료 스캐너', hint: '가까이 있는 생체 신호를 잡는다. (화면 왼쪽 위)', model: 'medical_box', color: card(0x80c0a0) },
    ],
    devices: [
      { needs: 'fuse', lines: ['POWER', '병동 배전반', 'FUSE 30A'] },
      { needs: 'id-card', lines: ['LOCK', '전자 잠금장치', 'STAFF ONLY'] },
      { needs: 'surgical-flashlight', lines: ['OR', '수술실 비상전원', 'OR-13'] },
    ],
    objective: '전력을 복구하라 — 병동 장치 세 개',
    exitKind: 'stairs',
    monster: { name: 'CURTAIN WALKER', scale: 1.12, skin: 0xb9b4a8, accessory: 'curtain', spawnDelay: 25,
      tuning: { VISION_RANGE: 26, PATROL_SPEED: 1.6, STALK_SPEED: 3.2, CHASE_SPEED: 6.4, ATTACK_DAMAGE: 40 },
      ability: '누군가 보고 있으면 움직이지 못한다. 눈을 떼는 순간 빠르게 다가온다.' },
    dressing: {
      groups: ['shared', 'level-05'], density: 0.3, view: [16, 9],
      wall: [
        { name: 'bed', weight: 5, pieces: [{ id: 'old_bed_frame', d: 0.05, collide: true }, { id: 'metal_stool_01', u: 0.85, d: 0.9, anchor: 'center', collide: true }] },
        { name: 'lab', weight: 2, pieces: [{ id: 'tool_cart', d: 0.06, collide: true }, { id: 'chemistry_set', d: 0.1, on: 0, scale: 0.7 }, { id: 'industrial_microscope', u: 0.4, d: 0.12, on: 0 }] },
        { name: 'chair', weight: 2, pieces: [{ id: 'BarberShopChair_01', d: 0.1, collide: true }, { id: 'bleach_bottle', u: 0.7, d: 0.1 }] },
        { name: 'supply', weight: 2, pieces: [{ id: 'tool_cart', d: 0.06, yaw: 0.15, collide: true }, { id: 'medical_box', d: 0.15, on: 0 }, { id: 'bleach_bottle', u: 0.4, d: 0.2, on: 0 }] },
        { name: 'wet', weight: 1, pieces: [{ id: 'WetFloorSign_01', u: 0.2, d: 0.6, yaw: 0.4, collide: true }] },
      ],
      mounted: [{ id: 'fire_alarm', y: 1.5, chance: 0.04 }, { id: 'korean_fire_extinguisher_01', y: 0, chance: 0.03 }, { id: 'security_camera_01', y: 2.5, chance: 0.02 }],
      ceiling: [],
    },
    notes: [
      { title: '야간 근무 수칙', body: '커튼 너머를 볼 때는 눈을 떼지 마세요.\n\n그것은 보이는 동안 움직이지 못합니다. 둘이라면 한 명은 항상 보고 있으세요.\n\n모니터에 맥박이 잡히면, 이미 가까이 있는 겁니다.' },
      { title: '13 병동 환자 기록', body: '환자 번호 없음. 병상 없음. 담당의 없음.\n\n그러나 매일 밤 커튼이 하나씩 늘어난다.' },
    ],
  },
  6: {
    index: 6, code: 'THE FLOOD', title: '침수 구역',
    intro: '발목까지 차오른 검은 물. 어딘가에서 전선이 물에 닿아 지직거린다.',
    layout: { style: 'hall', partitions: 0.06, doors: 4, pillars: true, ceiling: 4.0, water: 7, darkPatches: 2, faulty: 0.3, dead: 0.1, crates: 30, supplies: 8 },
    surface: { wall: 'concrete', floor: 'concrete', ceil: 'concrete', wallColor: 0x6f7470, floorColor: 0x55605c, ceilColor: 0x50524e, fog: 0x1c2624 },
    blackouts: [45, 75, 12, 18],
    keys: [
      { key: 'pump-key', name: '펌프 열쇠', hint: '배수 펌프 제어반 열쇠.', color: card(0x909090) },
      { key: 'drainage-hose', name: '배수 호스', hint: '무겁고 미끄럽다.', color: card(0x2a2a2a) },
      { key: 'emergency-battery', name: '비상 배터리', hint: '펌프를 돌릴 만큼은 남아 있다.', model: 'metal_jerrycan', color: card(0xc0a020) },
      { key: 'insulated-gloves', name: '절연 장갑', hint: '감전된 물에서도 버틸 수 있다.', color: card(0xd0a020) },
    ],
    devices: [
      { needs: 'pump-key', lines: ['PUMP', '1번 배수 펌프', 'P-01'] },
      { needs: 'drainage-hose', lines: ['PUMP', '2번 배수 펌프', 'P-02'] },
      { needs: 'emergency-battery', lines: ['PUMP', '비상 발전 연결', 'GEN'] },
    ],
    objective: '물을 빼라 — 배수 펌프 세 개',
    exitKind: 'stairs',
    monster: { name: 'THE DROWNED', scale: 0.96, skin: 0x3a4a48, accessory: 'drowned', spawnDelay: 30,
      tuning: { PATROL_SPEED: 1.2, CHASE_SPEED: 4.4, VISION_RANGE: 18 },
      ability: '물속에서는 훨씬 빠르고, 마른 바닥에서는 느리다. 물소리를 따라온다.' },
    dressing: {
      groups: ['shared', 'level-06', 'level-01', 'level-02'], density: 0.24, view: [22, 11],
      wall: [
        { name: 'barrels', weight: 4, pieces: [{ id: 'Barrel_02', u: -0.4, d: 0.05, collide: true }, { id: 'Barrel_01', u: 0.25, d: 0.08, yaw: 1, collide: true }, { id: 'metal_jerrycan', u: 0.7, d: 0.1, yaw: 0.4 }] },
        { name: 'gen', weight: 3, pieces: [{ id: 'portable_generator', u: -0.3, d: 0.1, collide: true }, { id: 'metal_toolbox', u: 0.5, d: 0.1, collide: true }] },
        { name: 'racking', weight: 3, pieces: [{ id: 'steel_frame_shelves_02', u: -0.31, d: 0.04, collide: true }, { id: 'steel_frame_shelves_02', u: 0.31, d: 0.04, collide: true }, { id: 'metal_toolbox', u: 0.31, d: 0.1, y: 0.75 }] },
        { name: 'wet', weight: 2, pieces: [{ id: 'WetFloorSign_01', u: 0.2, d: 0.5, yaw: -0.4, collide: true }, { id: 'Barrel_02', u: -0.5, d: 0.05, collide: true }] },
      ],
      mounted: [{ id: 'lifebuoy', y: 1.6, chance: 0.04 }, { id: 'security_light', y: 3.2, chance: 0.05 }, { id: 'power_box_01', y: 1.4, chance: 0.04 }],
      ceiling: [{ id: 'caged_hanging_light', chance: 0.04 }],
    },
    notes: [
      { title: '배수 관리 일지', body: '수위가 또 올랐다. 펌프 세 대가 모두 멈췄다.\n\n물에 들어갈 때는 절연 장갑. 전선이 끊긴 곳이 있다. 불꽃이 튀는 물은 피할 것.\n\n물속에서 무언가가 다리를 스친다. 물고기는 없다.' },
      { title: '젖은 쪽지', body: '물소리를 내지 마. 그건 물소리를 들어.\n마른 곳으로. 마른 곳에선 그것도 느려.' },
    ],
  },
  7: {
    index: 7, code: 'THE TERMINAL', title: '종착역',
    intro: '텅 빈 승강장. 전광판에는 도착 예정 없음. 그런데 선로가 울린다.',
    layout: { style: 'hall', partitions: 0.05, doors: 4, pillars: true, ceiling: 5.0, water: 0, darkPatches: 2, faulty: 0.25, dead: 0.08, crates: 10, supplies: 6 },
    surface: { wall: 'tile', floor: 'concrete', ceil: 'concrete', wallColor: 0xa8a49a, floorColor: 0x5a5a56, ceilColor: 0x4a4a46, fog: 0x24221e },
    keys: [
      { key: 'train-key', name: '열차 키', hint: '운전실 열쇠.', color: card(0xa0a0a0) },
      { key: 'transit-card', name: '교통 카드', hint: '잔액: 0원. 그래도 개찰구는 열린다.', color: card(0x3070c0) },
      { key: 'signal-controller', name: '신호 제어기', hint: '선로 신호를 바꿀 수 있다.', model: 'vintage_radio_transceiver', color: card(0x606050) },
      { key: 'emergency-flare', name: '비상 신호탄', hint: '불빛을 따라 그것이 간다. (G: 신호탄 던지기)', model: 'signal_flashlight', color: card(0xd03020) },
    ],
    devices: [
      { needs: 'transit-card', lines: ['GATE', '개찰구', 'TRANSIT'] },
      { needs: 'signal-controller', lines: ['SIGNAL', '선로 신호기', 'SIG-7'] },
      { needs: 'train-key', lines: ['TRAIN', '운전실 제어반', 'LINE 0'] },
    ],
    objective: '마지막 열차를 세워라 — 역 장치 세 개',
    exitKind: 'stairs',
    monster: { name: 'THE CONDUCTOR', scale: 1.15, skin: 0x1e1e22, accessory: 'lantern', spawnDelay: 30,
      tuning: { PATROL_SPEED: 1.6, CHASE_SPEED: 5.6, VISION_RANGE: 28, VISION_FOV_DEG: 80 },
      ability: '선로를 따라 순찰한다. 열차가 지나가면 소리가 묻힌다. 시야는 좁고 멀다.' },
    dressing: {
      groups: ['shared', 'level-07', 'level-01'], density: 0.2, view: [24, 11],
      wall: [
        { name: 'bench', weight: 4, pieces: [{ id: 'modular_street_seating', d: 0.05, scale: 0.5, collide: true }] },
        { name: 'barrier', weight: 2, pieces: [{ id: 'concrete_road_barrier', d: 0.05, collide: true }, { id: 'WetFloorSign_01', u: 0.9, d: 0.4, collide: true }] },
        { name: 'lamp', weight: 2, pieces: [{ id: 'street_lamp_01', d: 0.1, collide: true }] },
        { name: 'kiosk', weight: 2, pieces: [{ id: 'industrial_storage_cart', d: 0.1, collide: true }, { id: 'vintage_radio_transceiver', d: 0.15, on: 0 }, { id: 'Megaphone_01', u: 0.4, d: 0.2, on: 0 }] },
        { name: 'bins', weight: 1, pieces: [{ id: 'metal_trash_can', d: 0.03, scale: 0.8, collide: true }] },
      ],
      mounted: [{ id: 'security_camera_01', y: 3.8, chance: 0.04 }, { id: 'fire_alarm', y: 1.5, chance: 0.03 }],
      ceiling: [],
    },
    notes: [
      { title: '운행 시간표', body: '00:00 도착 — 종착역\n00:00 출발 — 종착역\n\n안내 방송을 믿지 마십시오. 열차는 방송과 다른 선로로 들어옵니다.\n선로 위에 서 있지 마십시오.' },
      { title: '역무원 수첩', body: '차장은 선로만 걷는다. 승강장 안쪽은 잘 보지 않는다.\n\n신호탄을 던지면 그 불빛을 따라간다. 꼭 필요할 때만.' },
    ],
  },
  8: {
    index: 8, code: 'THE DEEP', title: '심층 수영장',
    intro: '타일과 물. 끝이 보이지 않는 수영장. 수면에 비친 것이 너와 다르게 움직인다.',
    layout: { style: 'hall', partitions: 0.04, doors: 2, pillars: true, ceiling: 4.2, water: 14, darkPatches: 1, faulty: 0.15, dead: 0.05, crates: 0, supplies: 6 },
    surface: { wall: 'tile', floor: 'tile', ceil: 'tile', wallColor: 0xd4e0e0, floorColor: 0x9cbcc0, ceilColor: 0xc8d4d4, fog: 0x30484c },
    keys: [
      { key: 'pool-key', name: '수영장 열쇠', hint: '물에 젖어 있다. 늘.', color: card(0x80a0a0) },
      { key: 'water-filter', name: '정수 필터', hint: '여과기에 끼울 수 있다.', model: 'metal_jerrycan', color: card(0xa0c0c0) },
      { key: 'waterproof-recorder', name: '방수 녹음기', hint: '물속 신호를 듣는다 — 녹음기 스캔이 그것을 잡는다.', color: card(0x305060) },
      { key: 'diving-light', name: '잠수용 라이트', hint: '손전등이 물속까지 비춘다.', model: 'portable_searchlight', color: card(0xe0e080) },
    ],
    devices: [
      { needs: 'pool-key', lines: ['POOL', '기계실 문', 'POOL-B'] },
      { needs: 'water-filter', lines: ['FILTER', '여과기', 'FLT-2'] },
      { needs: 'waterproof-recorder', lines: ['SIGNAL', '수중 신호기', 'SONAR'] },
    ],
    objective: '수중 신호를 잡아라 — 장치 세 개',
    exitKind: 'stairs',
    monster: { name: 'THE UNDERTOW', scale: 0.92, skin: 0x22343a, accessory: 'fins', spawnDelay: 30,
      tuning: { PATROL_SPEED: 1.4, CHASE_SPEED: 5.0, VISION_RANGE: 16, PERIPHERAL_RANGE: 5 },
      ability: '물속에 있을 때는 보이지 않는다. 가까이 오면 수면이 갈라진다.' },
    dressing: {
      groups: ['shared', 'level-08', 'level-06'], density: 0.2, view: [22, 11],
      wall: [
        { name: 'bench', weight: 4, pieces: [{ id: 'painted_wooden_bench', d: 0.05, collide: true }, { id: 'plastic_crate_01', u: 0.85, d: 0.1, collide: true }] },
        { name: 'chairs', weight: 3, pieces: [{ id: 'plastic_monobloc_chair_01', u: -0.5, d: 0.2, yaw: 0.3, collide: true }, { id: 'plastic_monobloc_chair_01', u: 0.4, d: 0.25, yaw: -0.2, collide: true }] },
        { name: 'crates', weight: 2, pieces: [{ id: 'plastic_crate_01', u: -0.3, d: 0.05, collide: true }, { id: 'plastic_crate_01', u: -0.3, d: 0.05, on: 0, yaw: 0.3 }, { id: 'WetFloorSign_01', u: 0.5, d: 0.3, collide: true }] },
      ],
      mounted: [{ id: 'lifebuoy', y: 1.6, chance: 0.06 }, { id: 'security_light', y: 3.4, chance: 0.04 }],
      ceiling: [],
    },
    notes: [
      { title: '안전 요원 공지', body: '수면에 비친 모습이 당신과 다르게 움직이면, 그것은 반사가 아닙니다.\n\n물에 들어가지 마십시오. 들어가야 한다면 천천히. 물결을 일으키지 마십시오.' },
      { title: '방수 녹음기 메모', body: '물속 신호는 녹음기로만 들린다.\n스캔을 켜면 물속의 그것이 잠깐 보인다.' },
    ],
  },
  9: {
    index: 9, code: 'THE OBSERVER', title: '감시실',
    intro: '서버 팬 소리. 수백 개의 모니터. 화면 속에만 보이는 것이 있다.',
    layout: { style: 'maze', doors: 8, pillars: false, ceiling: 2.9, water: 0, darkPatches: 3, faulty: 0.3, dead: 0.1, crates: 0, supplies: 6 },
    surface: { wall: 'concrete', floor: 'tile', ceil: 'tile', wallColor: 0x5a6068, floorColor: 0x3a3e44, ceilColor: 0x4a4e54, fog: 0x14181e },
    blackouts: [50, 80, 10, 14],
    keys: [
      { key: 'camera-remote', name: '카메라 리모컨', hint: 'C: 가장 가까운 CCTV로 본다. 그것은 화면에만 보인다.', color: card(0x303030) },
      { key: 'surveillance-tape', name: '감시 테이프', hint: '테이프 속 복도에 네가 서 있다.', model: 'vintage_video_camera', color: card(0x202020) },
      { key: 'server-key', name: '서버 키', hint: '서버실 랙을 연다.', model: 'circuit_board', color: card(0x208040) },
      { key: 'signal-decoder', name: '신호 해독기', hint: '마지막 신호를 해독할 수 있다.', model: 'retro_multimeter', color: card(0xc06020) },
    ],
    devices: [
      { needs: 'surveillance-tape', lines: ['CCTV', '녹화 장치', 'REC-09'] },
      { needs: 'server-key', lines: ['SERVER', '서버 랙', 'RACK-9'] },
      { needs: 'signal-decoder', lines: ['SIGNAL', '송신 해독기', 'DECODE'] },
    ],
    objective: '감시를 끊어라 — 장치 세 개 (C: CCTV)',
    exitKind: 'stairs',
    monster: { name: 'THE OBSERVER', scale: 1.05, skin: 0x101418, accessory: 'eyes', spawnDelay: 25,
      tuning: { PATROL_SPEED: 1.5, CHASE_SPEED: 5.0, VISION_RANGE: 30, ATTACK_DAMAGE: 30 },
      ability: '맨눈에는 보이지 않는다. CCTV 화면에만 비친다. 발소리는 들린다.' },
    dressing: {
      groups: ['shared', 'level-09', 'level-00', 'level-02'], density: 0.3, view: [15, 8],
      wall: [
        { name: 'monitors', weight: 5, pieces: [{ id: 'metal_office_desk', d: 0.05, collide: true }, { id: 'television_02', u: -0.5, d: 0.08, on: 0, yaw: 0.1 }, { id: 'television_02', u: 0.1, d: 0.06, on: 0 }, { id: 'Television_01', u: 0.65, d: 0.05, on: 0, yaw: -0.15, scale: 0.8 }, { id: 'SchoolChair_01', d: 1.25, anchor: 'center', yaw: Math.PI + 0.2, collide: true }] },
        { name: 'rack', weight: 3, pieces: [{ id: 'drawer_cabinet', u: -0.6, d: 0.04, collide: true }, { id: 'drawer_cabinet', u: 0.6, d: 0.04, collide: true }, { id: 'circuit_board', d: 0.2, y: 1.9 }] },
        { name: 'aircon', weight: 2, pieces: [{ id: 'exterior_aircon_unit', d: 0.05, y: 0.35, collide: true }] },
        { name: 'boxes', weight: 1, pieces: [{ id: 'cardboard_box_01', d: 0.05, collide: true }, { id: 'vintage_video_camera', d: 0.1, on: 0 }] },
      ],
      mounted: [{ id: 'security_camera_02', y: 2.5, chance: 0.08 }, { id: 'power_box_01', y: 1.4, chance: 0.04 }],
      ceiling: [],
    },
    notes: [
      { title: '감시 요원 교대 일지', body: '모니터 7번에 사람이 서 있다. 복도에는 아무도 없다.\n\n그것은 카메라에만 찍힌다. 카메라가 보고 있는 동안에는 그것도 나를 본다.\n\n사각지대를 찾아라.' },
      { title: '해독된 송신 조각', body: '…수신 중… 수신 중…\n\n마지막 층에서 신호를 끝낼 수 있다. 송신하거나, 끊거나.' },
    ],
  },
  10: {
    index: 10, code: 'THE LAST SIGNAL', title: '마지막 신호',
    intro: '모든 녹음기가 동시에 켜진다. 모든 목소리가, 네 목소리다.',
    layout: { style: 'hall', partitions: 0.06, doors: 4, pillars: true, ceiling: 6.0, water: 0, darkPatches: 3, faulty: 0.4, dead: 0.15, crates: 20, supplies: 8 },
    surface: { wall: 'concrete', floor: 'concrete', ceil: 'concrete', wallColor: 0x4a4440, floorColor: 0x38332e, ceilColor: 0x2a2622, fog: 0x200c08 },
    keys: [
      { key: 'signal-resonator', name: '신호 공명기', hint: '손에 쥐면 떨린다.', model: 'vintage_spacecraft_instrument', color: card(0xc08040) },
      { key: 'frequency-key', name: '주파수 키', hint: '88.1과 104.6 사이 어딘가.', color: card(0xd0d0d0) },
      { key: 'transmission-core', name: '송신 코어', hint: '뜨겁다. 심장처럼 뛴다.', color: card(0xff4020) },
    ],
    devices: [
      { needs: 'signal-resonator', lines: ['RES', '공명 장치 α', 'α'] },
      { needs: 'frequency-key', lines: ['RES', '공명 장치 β', 'β'] },
      { needs: 'transmission-core', lines: ['RES', '공명 장치 γ', 'γ'] },
    ],
    objective: '공명 장치 세 개를 동시에 — 40초 안에 모두',
    exitKind: 'radio',
    monster: { name: 'RECEIVER PRIME', scale: 1.25, skin: 0x1a1210, accessory: 'antenna', spawnDelay: 20,
      tuning: { PATROL_SPEED: 1.8, STALK_SPEED: 2.8, CHASE_SPEED: 5.8, VISION_RANGE: 28, ATTACK_DAMAGE: 38, VANISH_MIN: 10, VANISH_MAX: 20 },
      ability: '모든 수신기의 근원. 장치가 켜질 때마다 그쪽으로 온다.' },
    dressing: {
      groups: ['shared', 'level-10', 'level-09', 'level-07', 'level-02'], density: 0.22, view: [22, 11],
      wall: [
        { name: 'console', weight: 4, pieces: [{ id: 'metal_tool_chest', d: 0.05, collide: true }, { id: 'vintage_spacecraft_instrument', d: 0.1, on: 0 }, { id: 'television_02', u: 0.5, d: 0.08, y: 0.65 }] },
        { name: 'radio', weight: 3, pieces: [{ id: 'industrial_storage_cart', d: 0.1, collide: true }, { id: 'vintage_radio_transceiver', d: 0.15, on: 0 }, { id: 'portable_searchlight', u: 0.5, d: 0.2, on: 0, yaw: 0.6 }] },
        { name: 'gen', weight: 2, pieces: [{ id: 'portable_generator', u: -0.3, d: 0.1, collide: true }, { id: 'propane_tank', u: 0.5, d: 0.15, collide: true }] },
        { name: 'pipes', weight: 1, pieces: [{ id: 'modular_industrial_pipes_01', d: 0.14, y: 1.0 }] },
      ],
      mounted: [{ id: 'power_box_01', y: 1.4, chance: 0.06 }, { id: 'security_light', y: 4.5, chance: 0.04 }],
      ceiling: [{ id: 'caged_hanging_light', chance: 0.03 }],
    },
    notes: [
      { title: '첫 번째 녹음 — 전사본', body: '…녹음 중인가? …됐다.\n\n이걸 듣고 있다면, 넌 여기까지 왔다. 나도 왔었다. 몇 번이나.\n\n공명 장치 세 개를 동시에 켜면 무전실이 열린다. 거기서 정해라. 신호를 보낼지, 끝낼지.' },
      { title: '수신 기록 — 마지막', body: '모든 수신기는 하나에서 시작됐다.\n\n그것은 듣는다. 그리고 들은 것을 다시 말한다.\n네가 보내면, 그것은 네 목소리로 계속 말할 것이다.\n네가 끊으면, 아무도 다시는 듣지 못할 것이다.' },
    ],
  },
};

export function themeOf(level: number): LevelTheme | undefined {
  return THEMES[level];
}
