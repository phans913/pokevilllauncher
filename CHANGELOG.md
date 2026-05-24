# Changelog

## 1.0.15 - 2026-05-24
- Replaced the bundled `pokemonquest` mod with `pokemonquest-1.0.25.jar`.
- Updated the launcher bundle freshness check and release bundle URL for `v1.0.15`.

## 1.0.14 - 2026-05-24
- Changed the launcher autoconnect address, default server list address, and default last server value to `reade.p-e.kr`.
- Reworked the existing-user server list migration so `servers.dat` can be updated even when the replacement address length changes.
- Published a fresh GitHub Release asset set under `v1.0.14`.

## 1.0.13 - 2026-05-23
- Added a one-way migration that updates existing `options.txt` and `servers.dat` entries from `pokevill.mcv.kr` to `pokevill.r-e.kr`.
- Kept the launcher autoconnect address, default server list address, and default last server value on `pokevill.r-e.kr`.
- Published a fresh GitHub Release asset set under `v1.0.13`.

## 1.0.12 - 2026-05-23
- Restored the launcher autoconnect address, default server list address, and default last server value to `pokevill.r-e.kr`.
- Published a fresh GitHub Release asset set under `v1.0.12`.

## 1.0.11 - 2026-05-23
- Added `ComplementaryUnbound_r5.5.1.zip` to the managed shaderpacks.
- Added the default Iris config so fresh Pokevill instances start with shaders enabled and `ComplementaryUnbound_r5.5.1.zip` selected.
- Published a fresh GitHub Release asset set under `v1.0.11`.

## 1.0.10 - 2026-05-23
- Changed the launcher server address, default multiplayer server list, and default last server value to `pokevill.mcv.kr`.
- Published a fresh GitHub Release asset set under `v1.0.10`.

## 1.0.9 - 2026-05-23
- Corrected the GitHub Release asset URL mapping for `pokevillgacha-1.0.0 (2).jar`.
- Published a fresh GitHub Release asset set under `v1.0.9`.

## 1.0.8 - 2026-05-23
- Replaced the launcher mod and resource pack source with `포켓빌 프록시 docker/포켓빌 최종 모드팩`.
- Set the default selected resource packs to `build.zip` and `pokevill.zip`.
- Published a fresh GitHub Release asset set under `v1.0.8`.

## 1.0.7 - 2026-05-20
- Added `build.zip` to the default selected resource packs as the lowest custom pack under `BetterHangulFont.zip`.
- Published a fresh GitHub Release asset set under `v1.0.7`.

## 1.0.6 - 2026-05-20
- Corrected the default resource pack priority so the in-game selected pack order is `MenuResourcePack-v1.0.4.zip`, `apinametag-name-display-arclight-1.21.1.zip`, `pokevill.zip`, then `BetterHangulFont.zip`.
- Published a fresh GitHub Release asset set under `v1.0.6`.

## 1.0.5 - 2026-05-20
- Updated the default resource pack selection to load `MenuResourcePack-v1.0.4.zip`, `apinametag-name-display-arclight-1.21.1.zip`, `pokevill.zip`, and `BetterHangulFont.zip` in that order.
- Published a fresh GitHub Release asset set under `v1.0.5`.

## 1.0.4 - 2026-05-20
- Fixed NeoForge 1.21.1 launch handling so downloaded mods are copied into the instance `mods` folder instead of launching through an incompatible Forge mod list.
- Published a fresh GitHub Release asset set under `v1.0.4`.

## 1.0.3 - 2026-05-20
- Updated the Pokevill launcher mod and resource pack bundle from `포켓빌 프록시 런처 모드팩`.
- Changed the launcher server address and default multiplayer server list to `pokevill.r-e.kr`.
- Preserved the launcher default Minecraft options and initialized `options.txt` and `servers.dat` only once per instance.
