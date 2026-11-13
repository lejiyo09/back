// Generates ASSET_MANIFEST.md from client/public/assets/models/catalog.json
import fs from 'node:fs';
const cat = JSON.parse(fs.readFileSync('client/public/assets/models/catalog.json', 'utf8'));
const groups = {};
for (const [id, e] of Object.entries(cat)) (groups[e.group] ??= []).push([id, e]);
const kb = (b) => `${Math.round(b / 1024)} KB`;
let md = `# ASSET_MANIFEST

모든 외부 에셋은 **다운로드·라이선스 확인을 마친 것만** 게임에 포함한다. 이 파일은 \`node tools/assets/write-manifest.mjs\`로 catalog.json에서 자동 생성된다.

## 요약
- 외부 3D 모델: **${Object.keys(cat).length}개** — 전부 [Poly Haven](https://polyhaven.com) **CC0 1.0** (상업적 사용 가능, 표기 의무 없음 — 그래도 아래에 제작자 표기)
- 최적화: gltf-transform (dedup · prune · weld · simplify: 저사양 ≤3k / 고사양 ≤8k tris · WebP 텍스처 512/1024 · quantize · meshopt)
- 저사양(quality=low/medium) → \`_512.glb\`, 고사양(high) → \`_1k.glb\`
- 괴물 모델: 외부 모델 **미사용** — 원본 절차적 모델(코드로 생성, 프로젝트 자체 제작)

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
for (const g of Object.keys(groups).sort()) {
  md += `## ${g}\n| 모델 | 제작자 | 출처 | 라이선스 | 폴리곤(원본 → 512 / 1K) | 512 / 1K |\n|---|---|---|---|---|---|\n`;
  for (const [id, e] of groups[g].sort()) {
    md += `| ${e.name} (\`${id}\`) | ${e.authors.join(', ')} | [link](${e.source}) | ${e.license} | ${e.trisOriginal ?? '?'} → ${typeof e.tris === 'object' ? `${e.tris['512']} / ${e.tris['1k']}` : e.tris} | ${kb(e.bytes['512'])} / ${kb(e.bytes['1k'])} |\n`;
  }
  md += '\n';
}
fs.writeFileSync('ASSET_MANIFEST.md', md);
console.log('ASSET_MANIFEST.md written', Object.keys(cat).length);
