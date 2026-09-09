# 🌸 Sakura Launcher

> Современный Minecraft Java Launcher на **Tauri 2 + React + Rust** с собственной системой сборок, интеграцией Mojang и Modrinth и интерфейсом в стиле Sakura.

![Sakura Launcher](https://img.shields.io/badge/Sakura%20Launcher-0.9.0-ff7aa8?style=for-the-badge)
![Tauri](https://img.shields.io/badge/Tauri-2-24c8db?style=flat-square&logo=tauri)
![React](https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react)
![Rust](https://img.shields.io/badge/Rust-backend-000000?style=flat-square&logo=rust)

Sakura Launcher — самостоятельный лаунчер для **Minecraft: Java Edition**. Он создавался не как копия существующих лаунчеров, а как отдельное приложение с собственной архитектурой, интерфейсом и системой экземпляров Minecraft.

## ✨ Возможности

### 🎮 Minecraft

- получение официального списка версий Minecraft Java Edition через Mojang;
- создание отдельных сборок/инстансов;
- установка Vanilla Minecraft;
- установка Fabric через Fabric Meta;
- загрузка client JAR, библиотек, natives и assets;
- отдельная папка игры для каждой сборки;
- запуск Minecraft через Java;
- настройка RAM, разрешения окна, fullscreen и JVM-аргументов;
- автоматический поиск Java;
- установка **Java 21** из настроек;
- просмотр логов Minecraft в реальном времени;
- отображение кода завершения и статуса краша.

### 📦 Сборки

Каждая сборка существует отдельно и хранит собственные файлы, моды и настройки.

Доступны действия:

- создать сборку;
- установить или переустановить Minecraft;
- запустить сборку;
- открыть папку сборки;
- переименовать;
- сделать дубликат;
- экспортировать сборку в ZIP;
- импортировать сборку из ZIP;
- восстановить установку через Repair;
- обновить отслеживаемые моды;
- настроить параметры запуска;
- удалить сборку из лаунчера.

### 🧩 Modrinth

В Sakura Launcher встроен поиск контента Modrinth:

- **Моды**;
- **Ресурспаки**;
- **Шейдеры**;
- **Готовые сборки / Modpacks**.

Моды устанавливаются непосредственно в выбранную сборку, а не глобально.

Для Modrinth-сборок поддерживается импорт `.mrpack` с обработкой:

- `modrinth.index.json`;
- зависимостей;
- версии Minecraft;
- Fabric / Forge / NeoForge / Quilt metadata;
- `overrides`;
- `client-overrides`.

> Поддержка loader'ов в интерфейсе не означает, что для каждого loader уже существует полноценный самостоятельный installer. Реальные install-flow сейчас реализованы не одинаково для всех loader'ов.

### 🖥️ Java

Sakura умеет:

- найти Java автоматически;
- принять путь к `java.exe` / `javaw.exe` или JDK-папке;
- использовать `JAVA_HOME` и доступную Java из PATH;
- установить Java 21 в собственный runtime лаунчера.

Для современных версий Minecraft требуется соответствующая версия Java. Sakura не подменяет требования самой игры.

### 👤 Профили

На первом запуске создаётся локальный профиль с ником.

Можно хранить несколько локальных профилей и переключаться между ними.

**Важно:** локальный профиль не является Microsoft-аккаунтом и не подтверждает владение Minecraft. Microsoft/Xbox OAuth для полноценной авторизованной онлайн-игры пока не реализован.

### 🎨 Интерфейс

- Sakura / Midnight / Rose темы;
- пользовательский accent color;
- свечение интерфейса;
- плавные анимации;
- собственный titlebar для borderless окна;
- полноэкранные частицы сакуры;
- редактор частиц с настройкой количества, скорости, прозрачности и размера;

## 🏗️ Архитектура

```text
Sakura Launcher
├── React UI
│   ├── Главный экран
│   ├── Сборки
│   ├── Modrinth
│   └── Настройки
│
└── Tauri 2 / Rust
    ├── Minecraft metadata
    ├── Download pipeline
    ├── Instance manager
    ├── Mod / Modpack installer
    ├── Java manager
    ├── ZIP import / export
    └── Minecraft process launcher
```

Данные сборок хранятся в app data Sakura Launcher, а игровые файлы каждой сборки изолированы в собственном instance directory.

## 🚀 Запуск проекта

### Требования

- Windows;
- Node.js 20+;
- Rust / Cargo для полноценной сборки Tauri;
- интернет-соединение для загрузки Minecraft, Java и контента Modrinth.

### Установка зависимостей

```powershell
npm install
```

### Запуск dev-версии

```powershell
npm run tauri dev
```

### Сборка production

```powershell
npm run tauri build
```

NSIS installer после успешной сборки находится в:

```text
src-taurin/target/release/bundle/nsis/
```

## 📁 Структура проекта

```text
.
├── src/
│   ├── main.jsx
│   └── styles.css
├── src-taurin/
│   ├── src/
│   │   └── main.rs
│   ├── Cargo.toml
│   ├── build.rs
│   └── tauri.conf.json
├── index.html
├── package.json
└── README.md
```

> Папка backend намеренно называется `src-taurin` и является частью текущей структуры проекта.

## ⚠️ Текущий статус

**v0.8.0 — функциональный development build.**

Основные реальные части Minecraft pipeline и управления сборками уже подключены, но проект ещё не следует считать полностью готовым релизом.

Из известных ограничений:

- Microsoft OAuth ещё не реализован;
- online-mode авторизация не подключена;
- Repair пока восстанавливает основную Minecraft-установку, а не выполняет полную проверку хэшей всех файлов;
- автоматическое обновление модов отслеживает моды, установленные через новую систему metadata;
- старые версии модов при обновлении требуют дополнительной проверки удаления предыдущего JAR;
- Java 21 installer в текущем виде ориентирован на Windows x64;
- полноценные install-flow Forge / NeoForge / Quilt ещё требуют отдельной реализации;
- production-сборку Rust/Tauri необходимо проверять непосредственно в Windows toolchain.

Sakura Launcher не использует фиктивные Minecraft-установки для имитации готового функционала: если конкретная часть ещё не реализована, она не должна выдаваться за готовую.

## 🗺️ План развития

### Следующий большой этап

- Microsoft OAuth + безопасное хранение токенов;
- полноценная авторизованная онлайн-игра;
- более строгая проверка SHA-1 для загружаемых файлов;
- полноценный Repair/Integrity Check;
- корректное обновление и удаление старых версий модов;
- полноценные installers для Forge / NeoForge / Quilt;
- native file dialogs вместо временных prompt-сценариев;
- более глубокая настройка и управление профилями;
- стабильный production updater.

## 🔒 Безопасность

- пути внутри ZIP проверяются перед распаковкой;
- имя устанавливаемого mod-файла нормализуется до безопасного имени файла;
- Minecraft и его официальные metadata берутся из официальных Mojang endpoints;
- Modrinth-контент загружается через Modrinth API;
- локальный профиль не используется как подмена Microsoft authentication.

## 📜 Лицензия

Лицензия проекта пока не определена.

Sakura Launcher — сторонний launcher и не является официальным продуктом Mojang Studios или Microsoft.


## Sakura Launcher 0.11.0 — redesign

- Bottom circular navigation dock with hover labels.
- Skin Studio removed from the interface and source.
- Minecraft installation pipeline now also prepares the Java runtime required by the selected version (Temurin).
- Windows Minecraft process uses `javaw.exe` and `CREATE_NO_WINDOW`, so the separate console window is not intentionally spawned.
- Discord RPC keeps one IPC connection alive instead of connecting/closing on every update.
- Launcher restores/focuses its own window after starting Minecraft.
- Mojang client/libraries/assets/natives remain SHA-1 checked and downloaded in parallel.


## Sakura Launcher 0.12.0 — полноценный instance/cache upgrade

- общий Minecraft cache для libraries/assets/runtime между сборками;
- Vanilla, Fabric, Quilt, Forge и NeoForge в создании сборки;
- автоматическая установка Quilt и Forge/NeoForge installer profiles;
- зависимости Modrinth подтягиваются при установке мода;
- обновление отслеживаемых модов с заменой старого `.jar`;
- `.mrpack` установка и импорт ZIP;
- поиск старых `.minecraft` / Prism / MultiMC инстансов и импорт папки;
- Repair, Backup/Restore и безопасное удаление instance;
- FPS Boost пресет для распространённых оптимизационных модов;
- статистика общего кеша;
- tray: закрытие окна прячет Sakura в системный трей, двойной клик возвращает окно;
- проверка нового релиза Sakura через GitHub Releases;
- проверка обновления выполняется отдельно от Minecraft auth: локальный профиль не является обходом владения игрой.

Автоматическая самоустановка нового EXE пока не включена: для Tauri updater нужен подписанный updater endpoint и ключ приложения.
