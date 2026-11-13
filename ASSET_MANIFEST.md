# ASSET_MANIFEST

모든 외부 에셋은 **다운로드·라이선스 확인을 마친 것만** 게임에 포함한다. 이 파일은 `node tools/assets/write-manifest.mjs`로 catalog.json에서 자동 생성된다.

## 요약
- 외부 3D 모델: **84개** — 전부 [Poly Haven](https://polyhaven.com) **CC0 1.0** (상업적 사용 가능, 표기 의무 없음 — 그래도 아래에 제작자 표기)
- 최적화: gltf-transform (dedup · prune · weld · simplify ≤12k tris · WebP 텍스처 512/1024 · quantize · meshopt)
- 저사양(quality=low/medium) → `_512.glb`, 고사양(high) → `_1k.glb`
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

> 유료 괴물 팩을 구매해 `client/public/assets/models/monsters/<name>/`에 GLB로 넣고 라이선스 원문을 주면 AssetManager로 바로 연결할 수 있다.

## level-00
| 모델 | 제작자 | 출처 | 라이선스 | 폴리곤(원본→적용) | 512 / 1K |
|---|---|---|---|---|---|
| School Chair 01 (`SchoolChair_01`) | Ethan Place | [link](https://polyhaven.com/a/SchoolChair_01) | CC0 1.0 (Poly Haven) | 5072 → 5072 | 99 KB / 219 KB |
| Television 01 (`Television_01`) | Gabriel Radić | [link](https://polyhaven.com/a/Television_01) | CC0 1.0 (Poly Haven) | 1918 → 1918 | 91 KB / 217 KB |
| Classic Laptop (`classic_laptop`) | Arrangemonk | [link](https://polyhaven.com/a/classic_laptop) | CC0 1.0 (Poly Haven) | 14450 → 11995 | 239 KB / 362 KB |
| Clipboard (`clipboard`) | ProgrammerOnCoffee | [link](https://polyhaven.com/a/clipboard) | CC0 1.0 (Poly Haven) | 6176 → 6176 | 104 KB / 187 KB |
| Drawer Cabinet (`drawer_cabinet`) | Ulan Cabanilla | [link](https://polyhaven.com/a/drawer_cabinet) | CC0 1.0 (Poly Haven) | 26406 → 11997 | 182 KB / 270 KB |
| Metal Office Desk (`metal_office_desk`) | Ulan Cabanilla | [link](https://polyhaven.com/a/metal_office_desk) | CC0 1.0 (Poly Haven) | 6898 → 6898 | 120 KB / 202 KB |
| Office Notepads (`office_notepads`) | Ulan Cabanilla | [link](https://polyhaven.com/a/office_notepads) | CC0 1.0 (Poly Haven) | 666 → 666 | 35 KB / 84 KB |
| Projector Screen (`projector_screen`) | PeterM | [link](https://polyhaven.com/a/projector_screen) | CC0 1.0 (Poly Haven) | 8727 → 8727 | 179 KB / 326 KB |
| Wall Clock (`wall_clock`) | PierreB3D | [link](https://polyhaven.com/a/wall_clock) | CC0 1.0 (Poly Haven) | 3658 → 3658 | 105 KB / 183 KB |

## level-01
| 모델 | 제작자 | 출처 | 라이선스 | 폴리곤(원본→적용) | 512 / 1K |
|---|---|---|---|---|---|
| Barrel_01 (`Barrel_01`) | Jorge Camacho | [link](https://polyhaven.com/a/Barrel_01) | CC0 1.0 (Poly Haven) | 2682 → 2682 | 130 KB / 349 KB |
| Hand Truck (`hand_truck`) | Mutanzom3D | [link](https://polyhaven.com/a/hand_truck) | CC0 1.0 (Poly Haven) | 13220 → 12000 | 291 KB / 641 KB |
| Industrial Storage Cart (`industrial_storage_cart`) | Jule Bielitz | [link](https://polyhaven.com/a/industrial_storage_cart) | CC0 1.0 (Poly Haven) | 18902 → 11991 | 221 KB / 369 KB |
| Ladder Sectioned 01 (`ladder_sectioned_01`) | MP | [link](https://polyhaven.com/a/ladder_sectioned_01) | CC0 1.0 (Poly Haven) | 29140 → 12049 | 211 KB / 331 KB |
| Metal Tool Chest (`metal_tool_chest`) | Yann Kervran, John Hutcheson | [link](https://polyhaven.com/a/metal_tool_chest) | CC0 1.0 (Poly Haven) | 13360 → 11994 | 208 KB / 358 KB |
| Overhead Crane (`overhead_crane`) | Timothy3D | [link](https://polyhaven.com/a/overhead_crane) | CC0 1.0 (Poly Haven) | 89964 → 21316 | 550 KB / 1020 KB |
| Plastic Crate 03 (`plastic_crate_03`) | Pacific Penguin | [link](https://polyhaven.com/a/plastic_crate_03) | CC0 1.0 (Poly Haven) | 21740 → 12718 | 309 KB / 558 KB |
| Steel Frame Shelves 01 (`steel_frame_shelves_01`) | James Ray Cock | [link](https://polyhaven.com/a/steel_frame_shelves_01) | CC0 1.0 (Poly Haven) | 4348 → 4348 | 94 KB / 190 KB |
| Steel Frame Shelves 02 (`steel_frame_shelves_02`) | James Ray Cock | [link](https://polyhaven.com/a/steel_frame_shelves_02) | CC0 1.0 (Poly Haven) | 4348 → 4348 | 99 KB / 200 KB |
| Wooden Crate 01 (`wooden_crate_01`) | James Ray Cock | [link](https://polyhaven.com/a/wooden_crate_01) | CC0 1.0 (Poly Haven) | 6576 → 6576 | 156 KB / 337 KB |

## level-02
| 모델 | 제작자 | 출처 | 라이선스 | 폴리곤(원본→적용) | 512 / 1K |
|---|---|---|---|---|---|
| Industrial Pipe Lamp (`industrial_pipe_lamp`) | Mateusz Sadek | [link](https://polyhaven.com/a/industrial_pipe_lamp) | CC0 1.0 (Poly Haven) | 8626 → 8626 | 174 KB / 371 KB |
| Modular Industrial Pipes 01 (`modular_industrial_pipes_01`) | Jorge Camacho | [link](https://polyhaven.com/a/modular_industrial_pipes_01) | CC0 1.0 (Poly Haven) | 12340 → 11994 | 352 KB / 734 KB |
| Old Military Compressor (`old_military_compressor`) | Brian Speight | [link](https://polyhaven.com/a/old_military_compressor) | CC0 1.0 (Poly Haven) | 79042 → 12191 | 306 KB / 520 KB |
| Pipe Wrench (`pipe_wrench`) | Will Evarts | [link](https://polyhaven.com/a/pipe_wrench) | CC0 1.0 (Poly Haven) | 10746 → 10746 | 246 KB / 628 KB |
| Portable Generator (`portable_generator`) | James Ray Cock | [link](https://polyhaven.com/a/portable_generator) | CC0 1.0 (Poly Haven) | 26419 → 13873 | 339 KB / 588 KB |
| Power Box 01 (`power_box_01`) | Rico Cilliers, Yann Kervran | [link](https://polyhaven.com/a/power_box_01) | CC0 1.0 (Poly Haven) | 21272 → 11998 | 235 KB / 367 KB |
| Propane Tank (`propane_tank`) | Slinc | [link](https://polyhaven.com/a/propane_tank) | CC0 1.0 (Poly Haven) | 5238 → 5238 | 129 KB / 280 KB |
| Retro Multimeter (`retro_multimeter`) | elli moeller | [link](https://polyhaven.com/a/retro_multimeter) | CC0 1.0 (Poly Haven) | 8948 → 8948 | 153 KB / 214 KB |

## level-03
| 모델 | 제작자 | 출처 | 라이선스 | 폴리곤(원본→적용) | 512 / 1K |
|---|---|---|---|---|---|
| Binder Notebook (`binder_notebook`) | DaDrood | [link](https://polyhaven.com/a/binder_notebook) | CC0 1.0 (Poly Haven) | 18077 → 11999 | 181 KB / 270 KB |
| Book Encyclopedia Set 01 (`book_encyclopedia_set_01`) | John Malcolm | [link](https://polyhaven.com/a/book_encyclopedia_set_01) | CC0 1.0 (Poly Haven) | 67306 → 28308 | 498 KB / 620 KB |
| Cassette Player (`cassette_player`) | Oday Abuzaeed | [link](https://polyhaven.com/a/cassette_player) | CC0 1.0 (Poly Haven) | 4830 → 4830 | 176 KB / 371 KB |
| Desk Lamp Arm 01 (`desk_lamp_arm_01`) | Yann Kervran, Kuutti Siitonen | [link](https://polyhaven.com/a/desk_lamp_arm_01) | CC0 1.0 (Poly Haven) | 24102 → 12410 | 252 KB / 479 KB |
| Filmstrip Projector 8mm (`filmstrip_projector_8mm`) | PeterM | [link](https://polyhaven.com/a/filmstrip_projector_8mm) | CC0 1.0 (Poly Haven) | 32697 → 14644 | 336 KB / 510 KB |
| Stationery Supplies (`stationery_supplies`) | Mateusz Sadek | [link](https://polyhaven.com/a/stationery_supplies) | CC0 1.0 (Poly Haven) | 4412 → 4412 | 126 KB / 273 KB |
| Vintage Cabinet 01 (`vintage_cabinet_01`) | Rico Cilliers | [link](https://polyhaven.com/a/vintage_cabinet_01) | CC0 1.0 (Poly Haven) | 61096 → 12000 | 288 KB / 497 KB |
| Vintage Stapler (`vintage_stapler`) | Mateusz Sadek | [link](https://polyhaven.com/a/vintage_stapler) | CC0 1.0 (Poly Haven) | 4370 → 4370 | 145 KB / 336 KB |
| Vintage Wooden Drawer 01 (`vintage_wooden_drawer_01`) | James Ray Cock | [link](https://polyhaven.com/a/vintage_wooden_drawer_01) | CC0 1.0 (Poly Haven) | 5184 → 5184 | 150 KB / 301 KB |
| Wooden Bookshelf Worn (`wooden_bookshelf_worn`) | Ulan Cabanilla | [link](https://polyhaven.com/a/wooden_bookshelf_worn) | CC0 1.0 (Poly Haven) | 10106 → 10106 | 203 KB / 591 KB |

## level-04
| 모델 | 제작자 | 출처 | 라이선스 | 폴리곤(원본→적용) | 512 / 1K |
|---|---|---|---|---|---|
| Arm Chair 01 (`ArmChair_01`) | Kirill Sannikov | [link](https://polyhaven.com/a/ArmChair_01) | CC0 1.0 (Poly Haven) | 5626 → 5626 | 154 KB / 430 KB |
| Cash Register 01 (`CashRegister_01`) | Joe Seabuhr | [link](https://polyhaven.com/a/CashRegister_01) | CC0 1.0 (Poly Haven) | 9927 → 9927 | 245 KB / 396 KB |
| Chandelier 01 (`Chandelier_01`) | Kirill Sannikov | [link](https://polyhaven.com/a/Chandelier_01) | CC0 1.0 (Poly Haven) | 26860 → 13139 | 246 KB / 363 KB |
| Classic Console 01 (`ClassicConsole_01`) | Kirill Sannikov | [link](https://polyhaven.com/a/ClassicConsole_01) | CC0 1.0 (Poly Haven) | 7566 → 7566 | 185 KB / 355 KB |
| Classic Nightstand 01 (`ClassicNightstand_01`) | Kirill Sannikov | [link](https://polyhaven.com/a/ClassicNightstand_01) | CC0 1.0 (Poly Haven) | 2002 → 2002 | 74 KB / 164 KB |
| Gothic Bed 01 (`GothicBed_01`) | Kirill Sannikov | [link](https://polyhaven.com/a/GothicBed_01) | CC0 1.0 (Poly Haven) | 18745 → 11999 | 237 KB / 381 KB |
| Sofa 01 (`Sofa_01`) | Kirill Sannikov | [link](https://polyhaven.com/a/Sofa_01) | CC0 1.0 (Poly Haven) | 4101 → 4101 | 102 KB / 213 KB |
| Ornate Mirror 01 (`ornate_mirror_01`) | James Ray Cock | [link](https://polyhaven.com/a/ornate_mirror_01) | CC0 1.0 (Poly Haven) | 14246 → 11999 | 153 KB / 240 KB |
| Vintage Grandfather Clock 01 (`vintage_grandfather_clock_01`) | Yann Kervran, James Ray Cock | [link](https://polyhaven.com/a/vintage_grandfather_clock_01) | CC0 1.0 (Poly Haven) | 8582 → 8582 | 213 KB / 384 KB |

## level-05
| 모델 | 제작자 | 출처 | 라이선스 | 폴리곤(원본→적용) | 512 / 1K |
|---|---|---|---|---|---|
| Barber Shop Chair 01 (`BarberShopChair_01`) | Fernando Quinn | [link](https://polyhaven.com/a/BarberShopChair_01) | CC0 1.0 (Poly Haven) | 4280 → 4280 | 232 KB / 440 KB |
| Bleach Bottle (`bleach_bottle`) | James Ray Cock | [link](https://polyhaven.com/a/bleach_bottle) | CC0 1.0 (Poly Haven) | 4052 → 4052 | 73 KB / 130 KB |
| Chemistry Set (`chemistry_set`) | Jiří Ptáček | [link](https://polyhaven.com/a/chemistry_set) | CC0 1.0 (Poly Haven) | 41958 → 23008 | 384 KB / 572 KB |
| Industrial Microscope (`industrial_microscope`) | Lukas Walzer | [link](https://polyhaven.com/a/industrial_microscope) | CC0 1.0 (Poly Haven) | 16598 → 12239 | 265 KB / 424 KB |
| Medical Box (`medical_box`) | Ulan Cabanilla | [link](https://polyhaven.com/a/medical_box) | CC0 1.0 (Poly Haven) | 3718 → 3718 | 130 KB / 288 KB |
| Metal Stool 01 (`metal_stool_01`) | Ulan Cabanilla | [link](https://polyhaven.com/a/metal_stool_01) | CC0 1.0 (Poly Haven) | 8334 → 8334 | 158 KB / 359 KB |
| Old Bed Frame (`old_bed_frame`) | Luca B | [link](https://polyhaven.com/a/old_bed_frame) | CC0 1.0 (Poly Haven) | 49990 → 11905 | 234 KB / 448 KB |
| Tool Cart (`tool_cart`) | Savva Zakharov | [link](https://polyhaven.com/a/tool_cart) | CC0 1.0 (Poly Haven) | 29394 → 12000 | 233 KB / 464 KB |

## level-06
| 모델 | 제작자 | 출처 | 라이선스 | 폴리곤(원본→적용) | 512 / 1K |
|---|---|---|---|---|---|
| Barrel 02 (`Barrel_02`) | Jorge Camacho | [link](https://polyhaven.com/a/Barrel_02) | CC0 1.0 (Poly Haven) | 2688 → 2688 | 82 KB / 171 KB |
| Flood Lights (`flood_lights`) | James Ray Cock | [link](https://polyhaven.com/a/flood_lights) | CC0 1.0 (Poly Haven) | 76868 → 26560 | 595 KB / 985 KB |
| Lifebuoy (`lifebuoy`) | Hank Kaamura | [link](https://polyhaven.com/a/lifebuoy) | CC0 1.0 (Poly Haven) | 10728 → 10728 | 204 KB / 517 KB |
| Metal Jerrycan (`metal_jerrycan`) | Sean Buckley | [link](https://polyhaven.com/a/metal_jerrycan) | CC0 1.0 (Poly Haven) | 20022 → 11999 | 221 KB / 520 KB |
| Metal Toolbox (`metal_toolbox`) | Mateusz Sadek | [link](https://polyhaven.com/a/metal_toolbox) | CC0 1.0 (Poly Haven) | 14228 → 12003 | 225 KB / 474 KB |
| Security Light (`security_light`) | Maximilian Schuster | [link](https://polyhaven.com/a/security_light) | CC0 1.0 (Poly Haven) | 4668 → 4668 | 166 KB / 434 KB |

## level-07
| 모델 | 제작자 | 출처 | 라이선스 | 폴리곤(원본→적용) | 512 / 1K |
|---|---|---|---|---|---|
| Megaphone 01 (`Megaphone_01`) | Ethan Simon-Law | [link](https://polyhaven.com/a/Megaphone_01) | CC0 1.0 (Poly Haven) | 15814 → 11999 | 186 KB / 267 KB |
| Concrete Road Barrier (`concrete_road_barrier`) | Amal Kumar | [link](https://polyhaven.com/a/concrete_road_barrier) | CC0 1.0 (Poly Haven) | 60928 → 12000 | 193 KB / 487 KB |
| Modular Street Seating (`modular_street_seating`) | Stuart Attenborrow | [link](https://polyhaven.com/a/modular_street_seating) | CC0 1.0 (Poly Haven) | 25156 → 15065 | 476 KB / 936 KB |
| Street Lamp 01 (`street_lamp_01`) | Josh Dean | [link](https://polyhaven.com/a/street_lamp_01) | CC0 1.0 (Poly Haven) | 30610 → 12133 | 160 KB / 263 KB |
| Vintage Radio Transceiver (`vintage_radio_transceiver`) | Mateusz Sadek | [link](https://polyhaven.com/a/vintage_radio_transceiver) | CC0 1.0 (Poly Haven) | 42350 → 23676 | 600 KB / 1105 KB |

## level-08
| 모델 | 제작자 | 출처 | 라이선스 | 폴리곤(원본→적용) | 512 / 1K |
|---|---|---|---|---|---|
| Painted Wooden Bench (`painted_wooden_bench`) | Kirill Sannikov | [link](https://polyhaven.com/a/painted_wooden_bench) | CC0 1.0 (Poly Haven) | 630 → 630 | 66 KB / 254 KB |
| Plastic Crate 01 (`plastic_crate_01`) | PierreB3D | [link](https://polyhaven.com/a/plastic_crate_01) | CC0 1.0 (Poly Haven) | 18320 → 12000 | 302 KB / 561 KB |
| Plastic Monobloc Chair 01 (`plastic_monobloc_chair_01`) | Kuutti Siitonen | [link](https://polyhaven.com/a/plastic_monobloc_chair_01) | CC0 1.0 (Poly Haven) | 3356 → 3356 | 139 KB / 275 KB |

## level-09
| 모델 | 제작자 | 출처 | 라이선스 | 폴리곤(원본→적용) | 512 / 1K |
|---|---|---|---|---|---|
| Circuit Board (`circuit_board`) | Benny Weimer | [link](https://polyhaven.com/a/circuit_board) | CC0 1.0 (Poly Haven) | 14430 → 12109 | 323 KB / 692 KB |
| Exterior Aircon Unit (`exterior_aircon_unit`) | Monsta3D | [link](https://polyhaven.com/a/exterior_aircon_unit) | CC0 1.0 (Poly Haven) | 18986 → 12036 | 443 KB / 1246 KB |
| Security Camera 02 (`security_camera_02`) | Garrison Gager, Yann Kervran | [link](https://polyhaven.com/a/security_camera_02) | CC0 1.0 (Poly Haven) | 12477 → 11997 | 179 KB / 252 KB |
| Television 02 (`television_02`) | Benny Weimer | [link](https://polyhaven.com/a/television_02) | CC0 1.0 (Poly Haven) | 2310 → 2310 | 75 KB / 152 KB |
| Vintage Video Camera (`vintage_video_camera`) | James Ray Cock, Jenelle van Heerden | [link](https://polyhaven.com/a/vintage_video_camera) | CC0 1.0 (Poly Haven) | 18682 → 11998 | 259 KB / 423 KB |

## level-10
| 모델 | 제작자 | 출처 | 라이선스 | 폴리곤(원본→적용) | 512 / 1K |
|---|---|---|---|---|---|
| Portable Searchlight (`portable_searchlight`) | Elijah Cragg | [link](https://polyhaven.com/a/portable_searchlight) | CC0 1.0 (Poly Haven) | 18802 → 11999 | 177 KB / 271 KB |
| Signal Flashlight (`signal_flashlight`) | Jiří Ptáček | [link](https://polyhaven.com/a/signal_flashlight) | CC0 1.0 (Poly Haven) | 9730 → 9730 | 178 KB / 352 KB |
| Vintage Spacecraft Instrument (`vintage_spacecraft_instrument`) | Michał Wiśniewski | [link](https://polyhaven.com/a/vintage_spacecraft_instrument) | CC0 1.0 (Poly Haven) | 13279 → 11998 | 250 KB / 424 KB |

## shared
| 모델 | 제작자 | 출처 | 라이선스 | 폴리곤(원본→적용) | 512 / 1K |
|---|---|---|---|---|---|
| Wet Floor Sign 01 (`WetFloorSign_01`) | Fran Calvente | [link](https://polyhaven.com/a/WetFloorSign_01) | CC0 1.0 (Poly Haven) | 228 → 228 | 46 KB / 104 KB |
| Caged Hanging Light (`caged_hanging_light`) | Ulan Cabanilla | [link](https://polyhaven.com/a/caged_hanging_light) | CC0 1.0 (Poly Haven) | 22893 → 11999 | 261 KB / 493 KB |
| Cardboard Box 01 (`cardboard_box_01`) | Rahul Chaudhary | [link](https://polyhaven.com/a/cardboard_box_01) | CC0 1.0 (Poly Haven) | 16952 → 12000 | 168 KB / 315 KB |
| Fire Alarm (`fire_alarm`) | Slinc | [link](https://polyhaven.com/a/fire_alarm) | CC0 1.0 (Poly Haven) | 2705 → 2705 | 113 KB / 250 KB |
| Korean Fire Extinguisher 01 (`korean_fire_extinguisher_01`) | UM JOORIN | [link](https://polyhaven.com/a/korean_fire_extinguisher_01) | CC0 1.0 (Poly Haven) | 9913 → 9913 | 261 KB / 731 KB |
| Metal Trash Can (`metal_trash_can`) | GurJas Studios | [link](https://polyhaven.com/a/metal_trash_can) | CC0 1.0 (Poly Haven) | 13960 → 12214 | 365 KB / 867 KB |
| Modular Airduct Rectangular 01 (`modular_airduct_rectangular_01`) | James Ray Cock | [link](https://polyhaven.com/a/modular_airduct_rectangular_01) | CC0 1.0 (Poly Haven) | 45090 → 18305 | 451 KB / 678 KB |
| Security Camera 01 (`security_camera_01`) | Alexander Otterbeck, Yann Kervran | [link](https://polyhaven.com/a/security_camera_01) | CC0 1.0 (Poly Haven) | 13571 → 11999 | 176 KB / 275 KB |

