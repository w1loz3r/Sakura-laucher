# Sakura Launcher 0.4.0

Sakura Launcher — desktop Minecraft Java launcher built with Tauri 2 + React + Rust.

## What works

- Real Mojang Java Edition version manifest.
- Persistent local profiles and real user-created instances.
- Per-instance folders for mods, saves, resourcepacks and shaderpacks.
- Real Vanilla installation: client jar, libraries, Windows natives and assets.
- Fabric installation using Fabric Meta and its launcher profile/libraries.
- Modrinth project search and `.jar` installation into the selected instance.
- Instance drawer with installed mods, sizes and instance path.
- Open instance folder in Explorer.
- Skin Studio with 64×64 PNG import, pixel editing and PNG export.
- Sakura/Midnight/Rose themes, accent color, glow and animation settings.
- Full-screen particle editor with count, speed, opacity and size controls.
- Custom Tauri titlebar with minimize, maximize/restore and close.

## Important authentication note

The local profile is intended for local/offline play. It does not bypass Minecraft ownership or Microsoft authentication and is not an authenticated online account. Microsoft/Xbox authentication should be added with a properly registered application before distributing an online-login build.

## Build on Windows

```powershell
npm install
npm run tauri build
```

The NSIS installer is produced under `src-taurin/target/release/bundle/nsis/`.

## Java

Sakura Launcher uses an existing `javaw.exe`/`java.exe` when launching. The Settings page includes Java path detection. For modern Minecraft versions, use a compatible Java runtime (for example Java 21 where required by the selected game version).

## Loader scope

Vanilla and Fabric are implemented as real installation paths in this release. Forge/NeoForge/Quilt are intentionally not presented as installable build types until their official installer/metadata flows are implemented; the launcher does not create fake loader installations.
