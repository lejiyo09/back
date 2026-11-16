# ASSET_MANIFEST

모든 외부 에셋은 **다운로드·라이선스 확인을 마친 것만** 게임에 포함한다. 이 파일은 `node tools/assets/write-manifest.mjs`로 catalog.json에서 자동 생성된다.

## 요약
- 소품 3D 모델: **84개** — 전부 [Poly Haven](https://polyhaven.com) **CC0 1.0** (상업적 사용 가능, 표기 의무 없음 — 그래도 아래에 제작자 표기)
- 최적화: gltf-transform (dedup · prune · weld · simplify: 저사양 ≤3k / 고사양 ≤8k tris · WebP 텍스처 512/1024 · quantize · meshopt)
- 저사양(quality=low/medium) → `_512.glb`, 고사양(high) → `_1k.glb`
- 상호작용/괴물 외부 모델: **3개** (아래 "외부 모델" 표) — 1DesignTool 지게차·밸브, Polyfork The Whisperer
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

> 유료 괴물 팩을 구매해 `client/public/assets/models/monsters/<name>/`에 GLB로 넣고 라이선스 원문을 주면 AssetManager로 바로 연결할 수 있다.

## 외부 모델 (상호작용 파트·괴물)

| 모델 | 제작자 | 출처 | 라이선스 | 저장소 포함 | 폴리곤 (원본 → high / medium / low) | 크기 high / medium / low | 클립 |
|---|---|---|---|---|---|---|---|
| Factory Floor Forklift (`forklift`) | 1DesignTool (StoicSoft) | [link](https://1designtool.com/3d/models/factory-floor-forklift) | [1DesignTool 3D Library License (free commercial use, no attribution; no standalone redistribution)](https://1designtool.com/3d/license) | 아니오 — 빌드 시 다운로드 (단독 재배포 금지 조항) | 1684 → 1684 / 1684 / 1684 | 87 KB / 83 KB / 83 KB | scene-motion |
| Oil Rig Valves (`oil_rig_valves`) | 1DesignTool (StoicSoft) | [link](https://1designtool.com/3d/models/oil-rig-valves) | [1DesignTool 3D Library License (free commercial use, no attribution; no standalone redistribution)](https://1designtool.com/3d/license) | 아니오 — 빌드 시 다운로드 (단독 재배포 금지 조항) | 2988 → 2988 / 2988 / 2988 | 79 KB / 70 KB / 70 KB | - |
| The Whisperer (`whisperer`) | Polyfork | [link](https://polyfork.dev/asset/whisperer-base) | [CC BY 4.0 — "The Whisperer by Polyfork (https://polyfork.dev/asset/whisperer-base), CC BY 4.0" — modified (scaled, recoloured, simplified, head split)](https://creativecommons.org/licenses/by/4.0/) | 예 (CC BY 4.0, 출처 표기) | 4806 → 4806 / 4806 / 2643 | 334 KB / 230 KB / 205 KB | Idle, Walk, Run |

- **The Whisperer**: The Whisperer by Polyfork (https://polyfork.dev/asset/whisperer-base), CC BY 4.0 — 수정: 2.7m로 축소, 색 어둡게, 머리 메시를 좌우로 분리(열리는 머리 연출), 저사양용 단순화. 게임 안 크레딧에도 표기.
- **1DesignTool 지게차·밸브**: 1DesignTool 3D Library License — 개인·상업 프로젝트 사용, 수정, 게임에 포함해 배포 가능, 출처 표기 불필요. 모델 파일만 따로 재배포/다른 사이트 업로드/모델 팩 배포 금지 → **공개 저장소에는 넣지 않고** `npm run build` 때 원본 주소에서 받아 배포 빌드에만 포함 (`.gitignore`: `client/public/assets/models/external/`). 다운로드 실패 시 기존 절차적 지게차/벽 밸브로 동작.
- 세 모델 모두 GLB 안에 라이선스 메타데이터가 없어, 배포 페이지의 라이선스 원문으로 확인함 (2026-11-14).

## 사운드 (녹음 · CC0)

`client/public/assets/audio/` — `tools/audio/build-sfx.mjs`로 생성(원본 78개를 SHA-256으로 고정: `tools/audio/sources.json`), 51개 mp3 · 약 500KB, 오프라인 캐시에 포함.

| 팩 | 제작 | 라이선스 | 쓰인 곳 |
|---|---|---|---|
| RPG Audio 1.0 | Kenney (kenney.nl) | CC0 1.0 (팩의 License.txt) | 문 열림/닫힘·걸쇠·삐걱임, 종이, 옷깃 |
| Impact Sounds | Kenney | CC0 1.0 | 바닥별 발소리(카펫·콘크리트·나무·타일), 피격, 노크, 쾅, 멀리서 쿵, 철제 바닥, 괴물 발소리 |
| Foley Sounds | Kenney | CC0 1.0 | 줍기, 물방울, 엘리베이터 문(끌림), 괴물 발 끌림 |
| Sci-fi Sounds | Kenney | CC0 1.0 | 전력 서지, 멀리서 쿵(저주파), 엘리베이터 문 |

- 원본 출처: Kenney 공식 팩을 그대로 담은 github.com/series-ai/jam-ready-assets (Git LFS) — 각 팩의 License.txt에서 CC0 확인
- 문 경첩의 끼익 소리는 직접 만든 물리 모델(스틱-슬립 마찰 + 문짝 공진) 합성을 녹음과 섞은 것
- 괴물 소리·형광등 웅웅·환경음 루프 등 나머지는 코드로 합성(`client/src/audio/SoundSynth.ts`)

## level-00
| 모델 | 제작자 | 출처 | 라이선스 | 폴리곤(원본 → 512 / 1K) | 512 / 1K |
|---|---|---|---|---|---|
| School Chair 01 (`SchoolChair_01`) | Ethan Place | [link](https://polyhaven.com/a/SchoolChair_01) | CC0 1.0 (Poly Haven) | 5072 → 3000 / 5072 | 83 KB / 219 KB |
| Television 01 (`Television_01`) | Gabriel Radić | [link](https://polyhaven.com/a/Television_01) | CC0 1.0 (Poly Haven) | 1918 → 1918 / 1918 | 91 KB / 217 KB |
| Classic Laptop (`classic_laptop`) | Arrangemonk | [link](https://polyhaven.com/a/classic_laptop) | CC0 1.0 (Poly Haven) | 14450 → 3604 / 7996 | 163 KB / 329 KB |
| Clipboard (`clipboard`) | ProgrammerOnCoffee | [link](https://polyhaven.com/a/clipboard) | CC0 1.0 (Poly Haven) | 6176 → 3000 / 6176 | 84 KB / 187 KB |
| Drawer Cabinet (`drawer_cabinet`) | Ulan Cabanilla | [link](https://polyhaven.com/a/drawer_cabinet) | CC0 1.0 (Poly Haven) | 26406 → 4584 / 7993 | 114 KB / 235 KB |
| Metal Office Desk (`metal_office_desk`) | Ulan Cabanilla | [link](https://polyhaven.com/a/metal_office_desk) | CC0 1.0 (Poly Haven) | 6898 → 2996 / 6898 | 100 KB / 202 KB |
| Office Notepads (`office_notepads`) | Ulan Cabanilla | [link](https://polyhaven.com/a/office_notepads) | CC0 1.0 (Poly Haven) | 666 → 666 / 666 | 35 KB / 84 KB |
| Projector Screen (`projector_screen`) | PeterM | [link](https://polyhaven.com/a/projector_screen) | CC0 1.0 (Poly Haven) | 8727 → 2994 / 7998 | 130 KB / 321 KB |
| Wall Clock (`wall_clock`) | PierreB3D | [link](https://polyhaven.com/a/wall_clock) | CC0 1.0 (Poly Haven) | 3658 → 3000 / 3658 | 98 KB / 183 KB |

## level-01
| 모델 | 제작자 | 출처 | 라이선스 | 폴리곤(원본 → 512 / 1K) | 512 / 1K |
|---|---|---|---|---|---|
| Barrel_01 (`Barrel_01`) | Jorge Camacho | [link](https://polyhaven.com/a/Barrel_01) | CC0 1.0 (Poly Haven) | 2682 → 2682 / 2682 | 130 KB / 349 KB |
| Hand Truck (`hand_truck`) | Mutanzom3D | [link](https://polyhaven.com/a/hand_truck) | CC0 1.0 (Poly Haven) | 13220 → 5500 / 8000 | 235 KB / 611 KB |
| Industrial Storage Cart (`industrial_storage_cart`) | Jule Bielitz | [link](https://polyhaven.com/a/industrial_storage_cart) | CC0 1.0 (Poly Haven) | 18902 → 6363 / 7999 | 153 KB / 322 KB |
| Ladder Sectioned 01 (`ladder_sectioned_01`) | MP | [link](https://polyhaven.com/a/ladder_sectioned_01) | CC0 1.0 (Poly Haven) | 29140 → 3025 / 7986 | 120 KB / 296 KB |
| Metal Tool Chest (`metal_tool_chest`) | Yann Kervran, John Hutcheson | [link](https://polyhaven.com/a/metal_tool_chest) | CC0 1.0 (Poly Haven) | 13360 → 3495 / 7992 | 140 KB / 330 KB |
| Overhead Crane (`overhead_crane`) | Timothy3D | [link](https://polyhaven.com/a/overhead_crane) | CC0 1.0 (Poly Haven) | 89964 → 12718 / 13325 | 426 KB / 905 KB |
| Plastic Crate 03 (`plastic_crate_03`) | Pacific Penguin | [link](https://polyhaven.com/a/plastic_crate_03) | CC0 1.0 (Poly Haven) | 21740 → 10776 / 10774 | 284 KB / 533 KB |
| Steel Frame Shelves 01 (`steel_frame_shelves_01`) | James Ray Cock | [link](https://polyhaven.com/a/steel_frame_shelves_01) | CC0 1.0 (Poly Haven) | 4348 → 2999 / 4348 | 83 KB / 190 KB |
| Steel Frame Shelves 02 (`steel_frame_shelves_02`) | James Ray Cock | [link](https://polyhaven.com/a/steel_frame_shelves_02) | CC0 1.0 (Poly Haven) | 4348 → 3000 / 4348 | 88 KB / 200 KB |
| Wooden Crate 01 (`wooden_crate_01`) | James Ray Cock | [link](https://polyhaven.com/a/wooden_crate_01) | CC0 1.0 (Poly Haven) | 6576 → 3020 / 6576 | 124 KB / 337 KB |

## level-02
| 모델 | 제작자 | 출처 | 라이선스 | 폴리곤(원본 → 512 / 1K) | 512 / 1K |
|---|---|---|---|---|---|
| Industrial Pipe Lamp (`industrial_pipe_lamp`) | Mateusz Sadek | [link](https://polyhaven.com/a/industrial_pipe_lamp) | CC0 1.0 (Poly Haven) | 8626 → 3050 / 7998 | 119 KB / 367 KB |
| Modular Industrial Pipes 01 (`modular_industrial_pipes_01`) | Jorge Camacho | [link](https://polyhaven.com/a/modular_industrial_pipes_01) | CC0 1.0 (Poly Haven) | 12340 → 7251 / 8748 | 305 KB / 703 KB |
| Old Military Compressor (`old_military_compressor`) | Brian Speight | [link](https://polyhaven.com/a/old_military_compressor) | CC0 1.0 (Poly Haven) | 79042 → 6056 / 8200 | 230 KB / 474 KB |
| Pipe Wrench (`pipe_wrench`) | Will Evarts | [link](https://polyhaven.com/a/pipe_wrench) | CC0 1.0 (Poly Haven) | 10746 → 3000 / 8000 | 187 KB / 611 KB |
| Portable Generator (`portable_generator`) | James Ray Cock | [link](https://polyhaven.com/a/portable_generator) | CC0 1.0 (Poly Haven) | 26419 → 5845 / 8061 | 255 KB / 530 KB |
| Power Box 01 (`power_box_01`) | Rico Cilliers, Yann Kervran | [link](https://polyhaven.com/a/power_box_01) | CC0 1.0 (Poly Haven) | 21272 → 3993 / 7999 | 153 KB / 331 KB |
| Propane Tank (`propane_tank`) | Slinc | [link](https://polyhaven.com/a/propane_tank) | CC0 1.0 (Poly Haven) | 5238 → 2999 / 5238 | 110 KB / 280 KB |
| Retro Multimeter (`retro_multimeter`) | elli moeller | [link](https://polyhaven.com/a/retro_multimeter) | CC0 1.0 (Poly Haven) | 8948 → 3102 / 8005 | 96 KB / 207 KB |

## level-03
| 모델 | 제작자 | 출처 | 라이선스 | 폴리곤(원본 → 512 / 1K) | 512 / 1K |
|---|---|---|---|---|---|
| Binder Notebook (`binder_notebook`) | DaDrood | [link](https://polyhaven.com/a/binder_notebook) | CC0 1.0 (Poly Haven) | 18077 → 2998 / 7998 | 97 KB / 235 KB |
| Book Encyclopedia Set 01 (`book_encyclopedia_set_01`) | John Malcolm | [link](https://polyhaven.com/a/book_encyclopedia_set_01) | CC0 1.0 (Poly Haven) | 67306 → 21765 / 25126 | 438 KB / 592 KB |
| Cassette Player (`cassette_player`) | Oday Abuzaeed | [link](https://polyhaven.com/a/cassette_player) | CC0 1.0 (Poly Haven) | 4830 → 2997 / 4830 | 160 KB / 371 KB |
| Desk Lamp Arm 01 (`desk_lamp_arm_01`) | Yann Kervran, Kuutti Siitonen | [link](https://polyhaven.com/a/desk_lamp_arm_01) | CC0 1.0 (Poly Haven) | 24102 → 3148 / 7998 | 159 KB / 439 KB |
| Filmstrip Projector 8mm (`filmstrip_projector_8mm`) | PeterM | [link](https://polyhaven.com/a/filmstrip_projector_8mm) | CC0 1.0 (Poly Haven) | 32697 → 6485 / 8528 | 250 KB / 448 KB |
| Stationery Supplies (`stationery_supplies`) | Mateusz Sadek | [link](https://polyhaven.com/a/stationery_supplies) | CC0 1.0 (Poly Haven) | 4412 → 2992 / 4412 | 115 KB / 273 KB |
| Vintage Cabinet 01 (`vintage_cabinet_01`) | Rico Cilliers | [link](https://polyhaven.com/a/vintage_cabinet_01) | CC0 1.0 (Poly Haven) | 61096 → 3005 / 8006 | 191 KB / 457 KB |
| Vintage Stapler (`vintage_stapler`) | Mateusz Sadek | [link](https://polyhaven.com/a/vintage_stapler) | CC0 1.0 (Poly Haven) | 4370 → 3015 / 4370 | 134 KB / 336 KB |
| Vintage Wooden Drawer 01 (`vintage_wooden_drawer_01`) | James Ray Cock | [link](https://polyhaven.com/a/vintage_wooden_drawer_01) | CC0 1.0 (Poly Haven) | 5184 → 2992 / 5184 | 148 KB / 301 KB |
| Wooden Bookshelf Worn (`wooden_bookshelf_worn`) | Ulan Cabanilla | [link](https://polyhaven.com/a/wooden_bookshelf_worn) | CC0 1.0 (Poly Haven) | 10106 → 3000 / 7999 | 155 KB / 579 KB |

## level-04
| 모델 | 제작자 | 출처 | 라이선스 | 폴리곤(원본 → 512 / 1K) | 512 / 1K |
|---|---|---|---|---|---|
| Arm Chair 01 (`ArmChair_01`) | Kirill Sannikov | [link](https://polyhaven.com/a/ArmChair_01) | CC0 1.0 (Poly Haven) | 5626 → 3000 / 5626 | 127 KB / 430 KB |
| Cash Register 01 (`CashRegister_01`) | Joe Seabuhr | [link](https://polyhaven.com/a/CashRegister_01) | CC0 1.0 (Poly Haven) | 9927 → 3186 / 7999 | 170 KB / 377 KB |
| Chandelier 01 (`Chandelier_01`) | Kirill Sannikov | [link](https://polyhaven.com/a/Chandelier_01) | CC0 1.0 (Poly Haven) | 26860 → 5362 / 7974 | 169 KB / 315 KB |
| Classic Console 01 (`ClassicConsole_01`) | Kirill Sannikov | [link](https://polyhaven.com/a/ClassicConsole_01) | CC0 1.0 (Poly Haven) | 7566 → 2997 / 7566 | 134 KB / 355 KB |
| Classic Nightstand 01 (`ClassicNightstand_01`) | Kirill Sannikov | [link](https://polyhaven.com/a/ClassicNightstand_01) | CC0 1.0 (Poly Haven) | 2002 → 2002 / 2002 | 74 KB / 164 KB |
| Gothic Bed 01 (`GothicBed_01`) | Kirill Sannikov | [link](https://polyhaven.com/a/GothicBed_01) | CC0 1.0 (Poly Haven) | 18745 → 2992 / 8000 | 140 KB / 340 KB |
| Sofa 01 (`Sofa_01`) | Kirill Sannikov | [link](https://polyhaven.com/a/Sofa_01) | CC0 1.0 (Poly Haven) | 4101 → 3000 / 4101 | 91 KB / 213 KB |
| Ornate Mirror 01 (`ornate_mirror_01`) | James Ray Cock | [link](https://polyhaven.com/a/ornate_mirror_01) | CC0 1.0 (Poly Haven) | 14246 → 3000 / 7999 | 82 KB / 210 KB |
| Vintage Grandfather Clock 01 (`vintage_grandfather_clock_01`) | Yann Kervran, James Ray Cock | [link](https://polyhaven.com/a/vintage_grandfather_clock_01) | CC0 1.0 (Poly Haven) | 8582 → 3025 / 7998 | 161 KB / 380 KB |

## level-05
| 모델 | 제작자 | 출처 | 라이선스 | 폴리곤(원본 → 512 / 1K) | 512 / 1K |
|---|---|---|---|---|---|
| Barber Shop Chair 01 (`BarberShopChair_01`) | Fernando Quinn | [link](https://polyhaven.com/a/BarberShopChair_01) | CC0 1.0 (Poly Haven) | 4280 → 3440 / 4280 | 223 KB / 440 KB |
| Bleach Bottle (`bleach_bottle`) | James Ray Cock | [link](https://polyhaven.com/a/bleach_bottle) | CC0 1.0 (Poly Haven) | 4052 → 3000 / 4052 | 66 KB / 130 KB |
| Chemistry Set (`chemistry_set`) | Jiří Ptáček | [link](https://polyhaven.com/a/chemistry_set) | CC0 1.0 (Poly Haven) | 41958 → 11098 / 12940 | 291 KB / 501 KB |
| Industrial Microscope (`industrial_microscope`) | Lukas Walzer | [link](https://polyhaven.com/a/industrial_microscope) | CC0 1.0 (Poly Haven) | 16598 → 4790 / 8036 | 186 KB / 381 KB |
| Medical Box (`medical_box`) | Ulan Cabanilla | [link](https://polyhaven.com/a/medical_box) | CC0 1.0 (Poly Haven) | 3718 → 2995 / 3718 | 125 KB / 288 KB |
| Metal Stool 01 (`metal_stool_01`) | Ulan Cabanilla | [link](https://polyhaven.com/a/metal_stool_01) | CC0 1.0 (Poly Haven) | 8334 → 2999 / 8000 | 117 KB / 357 KB |
| Old Bed Frame (`old_bed_frame`) | Luca B | [link](https://polyhaven.com/a/old_bed_frame) | CC0 1.0 (Poly Haven) | 49990 → 2942 / 7154 | 143 KB / 407 KB |
| Tool Cart (`tool_cart`) | Savva Zakharov | [link](https://polyhaven.com/a/tool_cart) | CC0 1.0 (Poly Haven) | 29394 → 3863 / 7999 | 150 KB / 426 KB |

## level-06
| 모델 | 제작자 | 출처 | 라이선스 | 폴리곤(원본 → 512 / 1K) | 512 / 1K |
|---|---|---|---|---|---|
| Barrel 02 (`Barrel_02`) | Jorge Camacho | [link](https://polyhaven.com/a/Barrel_02) | CC0 1.0 (Poly Haven) | 2688 → 2688 / 2688 | 82 KB / 171 KB |
| Flood Lights (`flood_lights`) | James Ray Cock | [link](https://polyhaven.com/a/flood_lights) | CC0 1.0 (Poly Haven) | 76868 → 10649 / 11098 | 403 KB / 803 KB |
| Lifebuoy (`lifebuoy`) | Hank Kaamura | [link](https://polyhaven.com/a/lifebuoy) | CC0 1.0 (Poly Haven) | 10728 → 3000 / 8000 | 147 KB / 498 KB |
| Metal Jerrycan (`metal_jerrycan`) | Sean Buckley | [link](https://polyhaven.com/a/metal_jerrycan) | CC0 1.0 (Poly Haven) | 20022 → 2999 / 8000 | 146 KB / 489 KB |
| Metal Toolbox (`metal_toolbox`) | Mateusz Sadek | [link](https://polyhaven.com/a/metal_toolbox) | CC0 1.0 (Poly Haven) | 14228 → 3419 / 7996 | 151 KB / 441 KB |
| Security Light (`security_light`) | Maximilian Schuster | [link](https://polyhaven.com/a/security_light) | CC0 1.0 (Poly Haven) | 4668 → 3014 / 4668 | 152 KB / 434 KB |

## level-07
| 모델 | 제작자 | 출처 | 라이선스 | 폴리곤(원본 → 512 / 1K) | 512 / 1K |
|---|---|---|---|---|---|
| Megaphone 01 (`Megaphone_01`) | Ethan Simon-Law | [link](https://polyhaven.com/a/Megaphone_01) | CC0 1.0 (Poly Haven) | 15814 → 2990 / 8000 | 94 KB / 225 KB |
| Concrete Road Barrier (`concrete_road_barrier`) | Amal Kumar | [link](https://polyhaven.com/a/concrete_road_barrier) | CC0 1.0 (Poly Haven) | 60928 → 3000 / 7998 | 122 KB / 456 KB |
| Modular Street Seating (`modular_street_seating`) | Stuart Attenborrow | [link](https://polyhaven.com/a/modular_street_seating) | CC0 1.0 (Poly Haven) | 25156 → 9346 / 11868 | 414 KB / 904 KB |
| Street Lamp 01 (`street_lamp_01`) | Josh Dean | [link](https://polyhaven.com/a/street_lamp_01) | CC0 1.0 (Poly Haven) | 30610 → 3201 / 8163 | 88 KB / 232 KB |
| Vintage Radio Transceiver (`vintage_radio_transceiver`) | Mateusz Sadek | [link](https://polyhaven.com/a/vintage_radio_transceiver) | CC0 1.0 (Poly Haven) | 42350 → 12549 / 13388 | 466 KB / 982 KB |

## level-08
| 모델 | 제작자 | 출처 | 라이선스 | 폴리곤(원본 → 512 / 1K) | 512 / 1K |
|---|---|---|---|---|---|
| Painted Wooden Bench (`painted_wooden_bench`) | Kirill Sannikov | [link](https://polyhaven.com/a/painted_wooden_bench) | CC0 1.0 (Poly Haven) | 630 → 630 / 630 | 66 KB / 254 KB |
| Plastic Crate 01 (`plastic_crate_01`) | PierreB3D | [link](https://polyhaven.com/a/plastic_crate_01) | CC0 1.0 (Poly Haven) | 18320 → 10350 / 10350 | 285 KB / 545 KB |
| Plastic Monobloc Chair 01 (`plastic_monobloc_chair_01`) | Kuutti Siitonen | [link](https://polyhaven.com/a/plastic_monobloc_chair_01) | CC0 1.0 (Poly Haven) | 3356 → 3000 / 3356 | 136 KB / 275 KB |

## level-09
| 모델 | 제작자 | 출처 | 라이선스 | 폴리곤(원본 → 512 / 1K) | 512 / 1K |
|---|---|---|---|---|---|
| Circuit Board (`circuit_board`) | Benny Weimer | [link](https://polyhaven.com/a/circuit_board) | CC0 1.0 (Poly Haven) | 14430 → 5248 / 7999 | 241 KB / 651 KB |
| Exterior Aircon Unit (`exterior_aircon_unit`) | Monsta3D | [link](https://polyhaven.com/a/exterior_aircon_unit) | CC0 1.0 (Poly Haven) | 18986 → 3036 / 8004 | 399 KB / 1228 KB |
| Security Camera 02 (`security_camera_02`) | Garrison Gager, Yann Kervran | [link](https://polyhaven.com/a/security_camera_02) | CC0 1.0 (Poly Haven) | 12477 → 3000 / 7997 | 95 KB / 219 KB |
| Television 02 (`television_02`) | Benny Weimer | [link](https://polyhaven.com/a/television_02) | CC0 1.0 (Poly Haven) | 2310 → 2310 / 2310 | 75 KB / 152 KB |
| Vintage Video Camera (`vintage_video_camera`) | James Ray Cock, Jenelle van Heerden | [link](https://polyhaven.com/a/vintage_video_camera) | CC0 1.0 (Poly Haven) | 18682 → 6041 / 7997 | 197 KB / 382 KB |

## level-10
| 모델 | 제작자 | 출처 | 라이선스 | 폴리곤(원본 → 512 / 1K) | 512 / 1K |
|---|---|---|---|---|---|
| Portable Searchlight (`portable_searchlight`) | Elijah Cragg | [link](https://polyhaven.com/a/portable_searchlight) | CC0 1.0 (Poly Haven) | 18802 → 2998 / 7998 | 101 KB / 240 KB |
| Signal Flashlight (`signal_flashlight`) | Jiří Ptáček | [link](https://polyhaven.com/a/signal_flashlight) | CC0 1.0 (Poly Haven) | 9730 → 3054 / 7991 | 126 KB / 340 KB |
| Vintage Spacecraft Instrument (`vintage_spacecraft_instrument`) | Michał Wiśniewski | [link](https://polyhaven.com/a/vintage_spacecraft_instrument) | CC0 1.0 (Poly Haven) | 13279 → 3393 / 7997 | 163 KB / 388 KB |

## shared
| 모델 | 제작자 | 출처 | 라이선스 | 폴리곤(원본 → 512 / 1K) | 512 / 1K |
|---|---|---|---|---|---|
| Wet Floor Sign 01 (`WetFloorSign_01`) | Fran Calvente | [link](https://polyhaven.com/a/WetFloorSign_01) | CC0 1.0 (Poly Haven) | 228 → 228 / 228 | 46 KB / 104 KB |
| Caged Hanging Light (`caged_hanging_light`) | Ulan Cabanilla | [link](https://polyhaven.com/a/caged_hanging_light) | CC0 1.0 (Poly Haven) | 22893 → 2880 / 7992 | 171 KB / 456 KB |
| Cardboard Box 01 (`cardboard_box_01`) | Rahul Chaudhary | [link](https://polyhaven.com/a/cardboard_box_01) | CC0 1.0 (Poly Haven) | 16952 → 3000 / 8000 | 101 KB / 286 KB |
| Fire Alarm (`fire_alarm`) | Slinc | [link](https://polyhaven.com/a/fire_alarm) | CC0 1.0 (Poly Haven) | 2705 → 2705 / 2705 | 113 KB / 250 KB |
| Korean Fire Extinguisher 01 (`korean_fire_extinguisher_01`) | UM JOORIN | [link](https://polyhaven.com/a/korean_fire_extinguisher_01) | CC0 1.0 (Poly Haven) | 9913 → 3079 / 7996 | 206 KB / 717 KB |
| Metal Trash Can (`metal_trash_can`) | GurJas Studios | [link](https://polyhaven.com/a/metal_trash_can) | CC0 1.0 (Poly Haven) | 13960 → 3498 / 7994 | 289 KB / 833 KB |
| Modular Airduct Rectangular 01 (`modular_airduct_rectangular_01`) | James Ray Cock | [link](https://polyhaven.com/a/modular_airduct_rectangular_01) | CC0 1.0 (Poly Haven) | 45090 → 8900 / 9105 | 342 KB / 572 KB |
| Security Camera 01 (`security_camera_01`) | Alexander Otterbeck, Yann Kervran | [link](https://polyhaven.com/a/security_camera_01) | CC0 1.0 (Poly Haven) | 13571 → 3001 / 8000 | 101 KB / 245 KB |

