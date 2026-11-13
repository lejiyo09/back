/**
 * In-world documents. Descriptions of Level 0 follow the Backrooms Wiki canon
 * (mono-yellow wallpaper, moist carpet, constant fluorescent hum, endless
 * segmented rooms); the signal thread is LOST SIGNAL's own story hook.
 */
export interface NoteText {
  title: string;
  body: string;
}

export const NOTES: NoteText[] = [
  {
    title: '구겨진 메모 — 첫 번째',
    body:
      '여기가 어딘지 모르겠다.\n\n' +
      '벽지는 전부 같은 노란색이고, 카펫은 축축하게 젖어 있다.\n' +
      '형광등 소리가 단 한 순간도 멈추지 않는다.\n\n' +
      '아무리 걸어도 같은 방이 나온다. 문은 있는데, 그 너머도 똑같다.\n\n' +
      '이걸 남기는 건 누군가 읽을 거라고 믿기 때문이다.',
  },
  {
    title: '찢어진 공책 한 장',
    body:
      '방의 배치가 바뀐다.\n' +
      '분명 지나온 길인데, 돌아가 보니 벽이 있었다.\n\n' +
      '바닥에 표시를 해 둬도 소용없다. 다시 오면 표시가 없다.\n\n' +
      '혼자가 아니라는 느낌이 들면 — 뛰지 마라.\n' +
      '소리를 내지 마라. 소리는 멀리 간다.',
  },
  {
    title: '물에 번진 쪽지',
    body:
      '불이 꺼진 구역에서 무전기가 혼자 켜졌다.\n\n' +
      '지직거리는 잡음 사이로 내 목소리가 들렸다.\n' +
      '나는 아무 말도 하지 않았는데.\n\n' +
      '그 목소리는 내가 다음에 어디로 갈지 말하고 있었다.\n\n' +
      '신호를 따라가면 나갈 수 있을까.\n' +
      '아니면 신호가 나를 따라오는 걸까.',
  },
  {
    title: '분필로 쓴 글씨 — 콘크리트 기둥',
    body:
      '물이 고인 곳은 피해라.\n\n' +
      '첨벙거리는 소리는 생각보다 멀리 간다.\n' +
      '그리고 그것은 귀가 좋다.\n\n' +
      '상자는 열어 봐라. 대부분은 쓰레기지만,\n' +
      '가끔 아몬드 워터가 들어 있다.',
  },
  {
    title: '젖은 메모',
    body:
      '불이 나가면 움직이지 마라.\n\n' +
      '상자 뒤에 웅크리고, 손전등을 끄고, 숨소리를 세라.\n' +
      '불은 돌아온다. 항상 돌아온다.\n\n' +
      '돌아왔을 때 그것이 어디 있는지만 확인하면 된다.',
  },
  {
    title: '배관에 긁어 새긴 글씨',
    body:
      '기계 옆은 지옥처럼 덥다. 오래 있으면 쓰러진다.\n\n' +
      '그래도 기계 소리가 내 발소리를 덮어 준다.\n\n' +
      '쇠 격자 위는 걷지 마라. 걸어야 한다면, 기어라.',
  },
  {
    title: '그을린 정비 일지 한 장',
    body:
      'B4 무전실. 송신기가 아직 살아 있다.\n\n' +
      '누가 켜 둔 건지 모른다. 끌 수 있는 건지도.\n\n' +
      '벽 안에서 무언가 기어 다닌다. 배관을 따라. 계속.',
  },
];

// Levels 3–10: each theme's documents are appended after the original seven.
import { THEMES } from './levels/Themes';
const THEME_NOTE_BASE = NOTES.length;
for (let i = 3; i <= 10; i++) for (const n of THEMES[i]?.notes ?? []) NOTES.push(n);
/** global NOTES index of the k-th document of a themed level */
export function themeNoteIndex(level: number, k: number): number {
  let idx = THEME_NOTE_BASE;
  for (let i = 3; i < level; i++) idx += THEMES[i]?.notes.length ?? 0;
  return idx + k;
}
