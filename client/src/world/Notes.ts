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
];
