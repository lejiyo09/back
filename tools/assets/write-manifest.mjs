// Generates ASSET_MANIFEST.md from client/public/assets/models/catalog.json
import fs from 'node:fs';
const cat = JSON.parse(fs.readFileSync('client/public/assets/models/catalog.json', 'utf8'));
const groups = {};
const scenes = Object.entries(cat).filter(([, e]) => e.scene);
for (const [id, e] of Object.entries(cat)) if (!e.scene) (groups[e.group] ??= []).push([id, e]);
const kb = (b) => `${Math.round(b / 1024)} KB`;
let md = `# ASSET_MANIFEST

모든 외부 에셋은 **다운로드·라이선스 확인을 마친 것만** 게임에 포함한다. 이 파일은 \`node tools/assets/write-manifest.mjs\`로 catalog.json에서 자동 생성된다.

## 요약
- 소품 3D 모델: **${Object.keys(cat).length - scenes.length}개** — 전부 [Poly Haven](https://polyhaven.com) **CC0 1.0** (상업적 사용 가능, 표기 의무 없음 — 그래도 아래에 제작자 표기)
- 최적화: gltf-transform (dedup · prune · weld · simplify: 저사양 ≤3k / 고사양 ≤8k tris · WebP 텍스처 512/1024 · quantize · meshopt)
- 저사양(quality=low/medium) → \`_512.glb\`, 고사양(high) → \`_1k.glb\`
- 상호작용/괴물 외부 모델: **${scenes.length}개** (아래 "외부 모델" 표) — 1DesignTool 지게차·밸브, Polyfork The Whisperer
- Level 3~10 괴물 변종, Pallet Maw, Pipe Crawler: 원본 절차적 모델 (프로젝트 자체 제작)

## 조사했지만 넣지 않은 에셋 (사유)
| 후보 | 결과 | 사유 |
|---|---|---|
| liminalprops — Backroom Entity pack (itch.io) | 미적용 | 유료/계정 필요, 이 환경에서 itch.io 접근 차단 → 다운로드·라이선스 원문 확인 불가 |
| Scissorman / Hollow Watcher / Long-Limbed Stalker | 미적용 | Sketchfab/itch 계정 로그인·구매 필요, 접근 차단 |
| Grab3D | 미적용 | 접근 차단, 라이선스 확인 불가 |
| Sketchfab (CC-BY 괴물 모델) | 미적용 | 다운로드에 로그인 필요, API 차단 |
| Poly Haven 휴머노이드/괴물 | 해당 없음 | Poly Haven에 괴물·인체 모델이 없음 (522개 중 동물은 쥐뿐) |
| ambientCG | 접근 가능 | 현재 PBR 텍스처는 절차적 셰이더 사용, 추후 바닥/벽 재질용 후보 |

> 유료 괴물 팩을 구매해 \`client/public/assets/models/monsters/<name>/\`에 GLB로 넣고 라이선스 원문을 주면 AssetManager로 바로 연결할 수 있다.

`;
md += `## 외부 모델 (상호작용 파트·괴물)

| 모델 | 제작자 | 출처 | 라이선스 | 저장소 포함 | 폴리곤 (원본 → high / medium / low) | 크기 high / medium / low | 클립 |
|---|---|---|---|---|---|---|---|
${scenes.map(([id, e]) => `| ${e.name} (\`${id}\`) | ${e.authors.join(', ')} | [link](${e.source}) | [${e.license}](${e.licenseUrl}) | ${e.redistribute ? '예 (CC BY 4.0, 출처 표기)' : '아니오 — 빌드 시 다운로드 (단독 재배포 금지 조항)'} | ${e.trisOriginal} → ${e.tris.high} / ${e.tris.medium} / ${e.tris.low} | ${['high', 'medium', 'low'].map((t) => kb(e.bytes[t])).join(' / ')} | ${e.clips?.length ? e.clips.join(', ') : '-'} |`).join('\n')}

- **The Whisperer**: The Whisperer by Polyfork (https://polyfork.dev/asset/whisperer-base), CC BY 4.0 — 수정: 2.7m로 축소, 색 어둡게, 머리 메시를 좌우로 분리(열리는 머리 연출), 저사양용 단순화. 게임 안 크레딧에도 표기.
- **1DesignTool 지게차·밸브**: 1DesignTool 3D Library License — 개인·상업 프로젝트 사용, 수정, 게임에 포함해 배포 가능, 출처 표기 불필요. 모델 파일만 따로 재배포/다른 사이트 업로드/모델 팩 배포 금지 → **공개 저장소에는 넣지 않고** \`npm run build\` 때 원본 주소에서 받아 배포 빌드에만 포함 (\`.gitignore\`: \`client/public/assets/models/external/\`). 다운로드 실패 시 기존 절차적 지게차/벽 밸브로 동작.
- 세 모델 모두 GLB 안에 라이선스 메타데이터가 없어, 배포 페이지의 라이선스 원문으로 확인함 (2026-11-14).

`;
for (const g of Object.keys(groups).sort()) {
  md += `## ${g}\n| 모델 | 제작자 | 출처 | 라이선스 | 폴리곤(원본 → 512 / 1K) | 512 / 1K |\n|---|---|---|---|---|---|\n`;
  for (const [id, e] of groups[g].sort()) {
    md += `| ${e.name} (\`${id}\`) | ${e.authors.join(', ')} | [link](${e.source}) | ${e.license} | ${e.trisOriginal ?? '?'} → ${typeof e.tris === 'object' ? `${e.tris['512']} / ${e.tris['1k']}` : e.tris} | ${kb(e.bytes['512'])} / ${kb(e.bytes['1k'])} |\n`;
  }
  md += '\n';
}
fs.writeFileSync('ASSET_MANIFEST.md', md);
console.log('ASSET_MANIFEST.md written', Object.keys(cat).length);
