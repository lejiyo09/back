import { QUALITY_PRESETS, type QualityLevel, type Settings } from '../core/GameConfig';

const QUALITY_LABEL: Record<QualityLevel, string> = { low: 'Low (저사양)', medium: 'Medium', high: 'High', ultra: 'Ultra' };

/** Settings panel (graphics + accessibility, design doc 16). Changes apply live where possible. */
export function buildSettingsPanel(settings: Settings, onChange: (s: Settings, key: keyof Settings) => void, onClose: () => void): HTMLElement {
  const el = document.createElement('div');
  el.className = 'settings overlay';
  el.innerHTML = `
    <div class="panel wide">
      <h2>설정</h2>
      <label>그래픽 품질
        <select data-k="quality">${(Object.keys(QUALITY_PRESETS) as QualityLevel[]).map((q) =>
          `<option value="${q}" ${q === settings.quality ? 'selected' : ''}>${QUALITY_LABEL[q]}</option>`).join('')}</select>
        <small>텍스처·그림자 변경은 다음 게임 시작 시 적용됩니다.</small>
      </label>
      <label>밝기 <input type="range" data-k="brightness" min="0.6" max="1.6" step="0.05" value="${settings.brightness}"></label>
      <label>마우스 감도 <input type="range" data-k="mouseSensitivity" min="0.2" max="2" step="0.05" value="${settings.mouseSensitivity}"></label>
      <label>전체 음량 <input type="range" data-k="masterVolume" min="0" max="1" step="0.05" value="${settings.masterVolume}"></label>
      <label>조명 깜빡임 강도 <input type="range" data-k="flickerIntensity" min="0" max="1" step="0.05" value="${settings.flickerIntensity}">
        <small>광과민성이 있다면 낮추세요.</small></label>
      <label>공포 연출 강도 <input type="range" data-k="scareIntensity" min="0.3" max="1" step="0.05" value="${settings.scareIntensity}">
        <small>갑작스러운 비명·화면 왜곡·목소리 흉내의 세기.</small></label>
      <label class="row"><input type="checkbox" data-k="headBob" ${settings.headBob ? 'checked' : ''}> 카메라 흔들림 (헤드 밥)</label>
      <label class="row"><input type="checkbox" data-k="subtitles" ${settings.subtitles ? 'checked' : ''}> 자막</label>
      <label>캠페인 <select data-k="campaign">
        <option value="expanded" ${settings.campaign !== 'classic' ? 'selected' : ''}>확장 캠페인 — Level 0~10 (엔딩 E/F)</option>
        <option value="classic" ${settings.campaign === 'classic' ? 'selected' : ''}>클래식 — Level 0~2 (엔딩 A~D)</option>
      </select><small>Level 2의 선택은 확장 캠페인에서 Level 10의 결말로 이어집니다.</small></label>
      <button class="primary" data-act="close">닫기</button>
    </div>`;
  el.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-k]').forEach((input) => {
    input.addEventListener('input', () => {
      const k = input.dataset.k as keyof Settings;
      const s = settings as unknown as Record<string, unknown>;
      if (input instanceof HTMLInputElement && input.type === 'checkbox') s[k] = input.checked;
      else if (input instanceof HTMLInputElement && input.type === 'range') s[k] = Number(input.value);
      else s[k] = input.value;
      onChange(settings, k);
    });
  });
  el.querySelector('[data-act="close"]')!.addEventListener('click', (e) => { e.stopPropagation(); onClose(); });
  el.addEventListener('click', (e) => e.stopPropagation());
  return el;
}
