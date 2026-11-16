import { ENDINGS, Progress, type EndingId } from '../core/Progress';
import { THEMES } from '../world/levels/Themes';
import { MAX_LEVEL } from '@shared/Levels';

const LEVEL_NAMES: Record<number, string> = { 0: 'THE LOBBY', 1: 'HABITABLE ZONE', 2: 'PIPE DREAMS' };

/** Endings collected (A–F) and a level select for every level reached in this browser. */
export function buildRecordsPanel(onPlay: (level: number) => void, onClose: () => void): HTMLElement {
  const p = Progress.get();
  const el = document.createElement('div');
  el.className = 'settings overlay records';
  const endings = (Object.keys(ENDINGS) as EndingId[]).map((id) => {
    const got = p.endings.includes(id);
    return `<li class="${got ? 'got' : ''}"><b>${id}</b> ${got ? ENDINGS[id].title : '???'}<small>${got ? ENDINGS[id].how : '아직 보지 못한 결말'}</small></li>`;
  }).join('');
  const levels = Array.from({ length: MAX_LEVEL + 1 }, (_, lv) => {
    const reached = p.levels.includes(lv);
    const name = THEMES[lv]?.code ?? LEVEL_NAMES[lv];
    return `<button data-level="${lv}" ${reached ? '' : 'disabled'}>Level ${lv}<small>${reached ? name : '???'}</small></button>`;
  }).join('');
  el.innerHTML = `
    <div class="panel wide">
      <h2>기록</h2>
      <p class="sub">결말 ${p.endings.length} / 6 · 도달한 레벨 ${p.levels.length} / ${MAX_LEVEL + 1}</p>
      <ul class="endings">${endings}</ul>
      <h3>레벨 선택 <small>(도달한 레벨부터 싱글로 시작 — 녹음기는 들고 시작)</small></h3>
      <div class="levels">${levels}</div>
      <button class="primary" data-act="close">닫기</button>
    </div>`;
  el.querySelectorAll<HTMLButtonElement>('[data-level]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); onPlay(Number(b.dataset.level)); }));
  el.querySelector('[data-act="close"]')!.addEventListener('click', (e) => { e.stopPropagation(); onClose(); });
  el.addEventListener('click', (e) => e.stopPropagation());
  return el;
}
