#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::{json, Value};
use std::{collections::HashMap, fs, io::{self, Cursor}, path::{Path, PathBuf}, process::{Command, Stdio}};
use tauri::{Emitter, Manager};

const MANIFEST_URL: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const FABRIC_META: &str = "https://meta.fabricmc.net/v2";

fn emit_progress(app: &tauri::AppHandle, phase: &str, current: &str, completed: usize, total: usize) {
    let percent = if total > 0 {
        ((completed as f64 / total as f64) * 100.0).round() as u8
    } else {
        0
    };

    let _ = app.emit("download-progress", json!({
        "phase": phase,
        "current": current,
        "completed": completed,
        "total": total,
        "percent": percent
    }));
}

fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("SakuraLauncher");

    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn instances_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let p = root(app)?.join("instances");
    fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    Ok(p)
}

fn slug(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent("SakuraLauncher/0.5.0")
        .build()
        .map_err(|e| e.to_string())
}

fn http_get(url: &str) -> Result<Vec<u8>, String> {
    client()?
        .get(url)
        .send()
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .bytes()
        .map(|b| b.to_vec())
        .map_err(|e| e.to_string())
}

fn http_json(url: &str) -> Result<Value, String> {
    serde_json::from_slice(&http_get(url)?).map_err(|e| format!("JSON: {e}"))
}

fn download_to(
    app: &tauri::AppHandle,
    url: &str,
    path: &Path,
    phase: &str,
    current: &str,
    completed: &mut usize,
    total: usize,
) -> Result<(), String> {
    emit_progress(app, phase, current, *completed, total);

    if path.exists()
        && fs::metadata(path)
            .map_err(|e| e.to_string())?
            .len()
            > 0
    {
        *completed += 1;
        emit_progress(app, phase, current, *completed, total);
        return Ok(());
    }

    if let Some(p) = path.parent() {
        fs::create_dir_all(p).map_err(|e| e.to_string())?;
    }

    fs::write(path, http_get(url)?).map_err(|e| e.to_string())?;

    *completed += 1;
    emit_progress(app, phase, current, *completed, total);

    Ok(())
}

fn allowed(entry: &Value) -> bool {
    let Some(rules) = entry.get("rules").and_then(Value::as_array) else {
        return true;
    };

    let mut allow = false;

    for r in rules {
        let matches_os = match r
            .get("os")
            .and_then(|x| x.get("name"))
            .and_then(Value::as_str)
        {
            Some("windows") => true,
            Some(_) => false,
            None => true,
        };

        if matches_os {
            allow = r
                .get("action")
                .and_then(Value::as_str)
                == Some("allow");
        }
    }

    allow
}

fn artifact_path(lib: &Value, libraries: &Path) -> Option<PathBuf> {
    let p = lib
        .get("downloads")?
        .get("artifact")?
        .get("path")?
        .as_str()?;

    Some(libraries.join(p))
}

fn replace_vars(s: &str, vars: &HashMap<String, String>) -> String {
    let mut out = s.to_string();

    for (k, v) in vars {
        out = out.replace(&format!("${{{}}}", k), v);
    }

    out
}

fn collect_args(
    v: Option<&Value>,
    vars: &HashMap<String, String>,
) -> Vec<String> {
    let mut out = Vec::new();

    if let Some(arr) = v.and_then(Value::as_array) {
        for x in arr {
            if x.is_string() {
                out.push(replace_vars(
                    x.as_str().unwrap_or_default(),
                    vars,
                ));
                continue;
            }

            if !allowed(x) {
                continue;
            }

            match x.get("value") {
                Some(Value::String(s)) => {
                    out.push(replace_vars(s, vars));
                }

                Some(Value::Array(a)) => {
                    for y in a {
                        if let Some(s) = y.as_str() {
                            out.push(replace_vars(s, vars));
                        }
                    }
                }

                _ => {}
            }
        }
    }

    out
}

fn safe_extract(
    mut zip: zip::read::ZipFile<'_>,
    root: &Path,
) -> Result<(), String> {
    let name = zip.name().replace('\\', "/");

    if name.starts_with('/') || name.contains("../") {
        return Err("Опасный путь внутри natives-архива".into());
    }

    let out = root.join(&name);

    if zip.is_dir() {
        fs::create_dir_all(&out)
            .map_err(|e| e.to_string())?;

        return Ok(());
    }

    if let Some(parent) = out.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| e.to_string())?;
    }

    let mut f = fs::File::create(out)
        .map_err(|e| e.to_string())?;

    io::copy(&mut zip, &mut f)
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn download_library_list(
    app: &tauri::AppHandle,
    libs: &[Value],
    libraries: &Path,
    phase: &str,
    completed: &mut usize,
    total: usize,
) -> Result<(), String> {
    for lib in libs {
        if !allowed(lib) {
            continue;
        }

        if let Some(p) = artifact_path(lib, libraries) {
            if let Some(u) = lib
                .get("downloads")
                .and_then(|x| x.get("artifact"))
                .and_then(|x| x.get("url"))
                .and_then(Value::as_str)
            {
                download_to(
                    app,
                    u,
                    &p,
                    phase,
                    &format!(
                        "{}",
                        p.file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                    ),
                    completed,
                    total,
                )?;
            }
        } else if let Some(name) =
            lib.get("name").and_then(Value::as_str)
        {
            if let Some(base) =
                lib.get("url").and_then(Value::as_str)
            {
                if let Some(path) = maven_path(name) {
                    download_to(
                        app,
                        &format!("{}{}", base, path),
                        &libraries.join(&path),
                        phase,
                        &path,
                        completed,
                        total,
                    )?;
                }
            }
        }
    }

    Ok(())
}

fn maven_path(name: &str) -> Option<String> {
    let mut it = name.split(':');

    let g = it.next()?;
    let a = it.next()?;
    let v = it.next()?;

    Some(format!(
        "{}/{}/{}/{}-{}.jar",
        g.replace('.', "/"),
        a,
        v,
        a,
        v
    ))
}

fn java_from_path(path: Option<&str>) -> Option<String> {
    if let Some(p) = path {
        if !p.trim().is_empty() && Path::new(p).exists() {
            return Some(p.to_string());
        }
    }

    for name in ["javaw.exe", "java.exe", "java"] {
        if let Ok(o) = Command::new(name)
            .arg("-version")
            .output()
        {
            if o.status.success() {
                return Some(name.to_string());
            }
        }
    }

    None
}

#[tauri::command]
fn launcher_info() -> Value {
    json!({
        "name": "Sakura Launcher",
        "version": "0.5.0",
        "status": "minecraft-core"
    })
}

#[tauri::command]
fn create_instance(
    app: tauri::AppHandle,
    name: String,
    version: String,
    loader: String,
) -> Result<Value, String> {
    let base = format!(
        "{}-{}",
        slug(&name).to_lowercase(),
        slug(&version)
    );

    let mut id = base.clone();
    let mut n = 2;

    while instances_root(&app)?.join(&id).exists() {
        id = format!("{}-{}", base, n);
        n += 1;
    }

    let dir = instances_root(&app)?.join(&id);

    for sub in [
        "mods",
        "saves",
        "game",
        "resourcepacks",
        "shaderpacks",
        "logs",
    ] {
        fs::create_dir_all(dir.join(sub))
            .map_err(|e| e.to_string())?;
    }

    Ok(json!({
        "id": id,
        "name": name,
        "version": version,
        "loader": loader,
        "dir": dir.to_string_lossy()
    }))
}

#[tauri::command]
fn list_instance_files(
    app: tauri::AppHandle,
    id: String,
) -> Result<Value, String> {
    let dir = instances_root(&app)?.join(&id);

    if !dir.exists() {
        return Err("Сборка не найдена".into());
    }

    let mods = dir.join("mods");

    fs::create_dir_all(&mods)
        .map_err(|e| e.to_string())?;

    let mut list = Vec::new();

    for e in fs::read_dir(&mods)
        .map_err(|e| e.to_string())?
    {
        let e = e.map_err(|e| e.to_string())?;
        let p = e.path();

        if p.is_file() {
            list.push(json!({
                "name": p.file_name()
                    .unwrap_or_default()
                    .to_string_lossy(),
                "size": fs::metadata(&p)
                    .map_err(|e| e.to_string())?
                    .len()
            }));
        }
    }

    fn count_files(p: &Path) -> usize {
        fs::read_dir(p)
            .ok()
            .map(|it| {
                it.filter_map(Result::ok)
                    .map(|e| {
                        let q = e.path();

                        if q.is_dir() {
                            count_files(&q)
                        } else {
                            1
                        }
                    })
                    .sum()
            })
            .unwrap_or(0)
    }

    Ok(json!({
        "mods": list,
        "total_files": count_files(&dir),
        "path": dir.to_string_lossy()
    }))
}

#[tauri::command]
fn open_instance(
    app: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    let dir = instances_root(&app)?.join(&id);

    if !dir.exists() {
        return Err("Сборка не найдена".into());
    }

    Command::new("explorer.exe")
        .arg(dir)
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn install_mod(
    app: tauri::AppHandle,
    id: String,
    url: String,
    filename: String,
) -> Result<(), String> {
    let safe = Path::new(&filename)
        .file_name()
        .ok_or("Некорректное имя файла")?
        .to_string_lossy()
        .to_string();

    if !safe.to_lowercase().ends_with(".jar") {
        return Err("Modrinth-файл не является .jar".into());
    }

    let dir = instances_root(&app)?
        .join(&id)
        .join("mods");

    fs::create_dir_all(&dir)
        .map_err(|e| e.to_string())?;

    let mut completed = 0usize;

    download_to(
        &app,
        &url,
        &dir.join(safe),
        "Мод",
        "Установка мода",
        &mut completed,
        1,
    )
}

fn count_library_downloads(libs: &[Value]) -> usize {
    libs.iter()
        .filter(|lib| {
            if !allowed(lib) {
                return false;
            }

            artifact_path(lib, Path::new(".")).is_some()
                || (
                    lib.get("name")
                        .and_then(Value::as_str)
                        .and_then(maven_path)
                        .is_some()
                        && lib
                            .get("url")
                            .and_then(Value::as_str)
                            .is_some()
                )
        })
        .count()
}

#[tauri::command]
fn install_minecraft(
    app: tauri::AppHandle,
    id: String,
    version: String,
    loader: String,
) -> Result<Value, String> {
    let instance = instances_root(&app)?.join(&id);

    if !instance.exists() {
        return Err("Сборка не найдена".into());
    }

    let game = instance.join("game");

    fs::create_dir_all(&game)
        .map_err(|e| e.to_string())?;

    emit_progress(
        &app,
        "Подготовка",
        "Получаю официальный manifest Mojang…",
        0,
        0,
    );

    let manifest = http_json(MANIFEST_URL)?;

    let vurl = manifest
        .get("versions")
        .and_then(Value::as_array)
        .and_then(|a| {
            a.iter().find(|v| {
                v.get("id")
                    .and_then(Value::as_str)
                    == Some(version.as_str())
            })
        })
        .and_then(|v| v.get("url"))
        .and_then(Value::as_str)
        .ok_or("Версия Minecraft не найдена")?;

    let meta = http_json(vurl)?;

    let vdir = game
        .join("versions")
        .join(&version);

    fs::create_dir_all(&vdir)
        .map_err(|e| e.to_string())?;

    let client = meta
        .get("downloads")
        .and_then(|x| x.get("client"))
        .ok_or("У этой версии нет client.jar")?;

    let libs = game.join("libraries");

    fs::create_dir_all(&libs)
        .map_err(|e| e.to_string())?;

    let base_libs = meta
        .get("libraries")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut fabric_profile = Value::Null;
    let mut fabric_libs = Vec::new();

    if loader.eq_ignore_ascii_case("fabric") {
        emit_progress(
            &app,
            "Fabric",
            "Получаю профиль Fabric Loader…",
            0,
            0,
        );

        let versions_url = format!(
            "{}/versions/loader/{}",
            FABRIC_META,
            urlencoding::encode(&version)
        );

        let arr = http_json(&versions_url)?
            .as_array()
            .cloned()
            .ok_or("Fabric Meta вернул неверный ответ")?;

        let chosen = arr
            .iter()
            .find(|x| {
                x.get("loader")
                    .and_then(|l| l.get("stable"))
                    .and_then(Value::as_bool)
                    == Some(true)
            })
            .cloned()
            .or_else(|| arr.first().cloned())
            .ok_or("Для этой версии нет Fabric Loader")?;

        let lv = chosen
            .get("loader")
            .and_then(|x| x.get("version"))
            .and_then(Value::as_str)
            .ok_or("Не найден Fabric Loader version")?;

        let profile_url = format!(
            "{}/versions/loader/{}/{}/profile/json",
            FABRIC_META,
            urlencoding::encode(&version),
            urlencoding::encode(lv)
        );

        fabric_profile = http_json(&profile_url)?;

        fabric_libs = fabric_profile
            .get("libraries")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();

        fs::write(
            vdir.join("fabric.json"),
            serde_json::to_vec_pretty(&fabric_profile)
                .map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    }

    let native_count = meta
        .get("libraries")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter(|lib| {
                    allowed(lib)
                        && lib
                            .get("downloads")
                            .and_then(|x| x.get("classifiers"))
                            .and_then(|x| x.get("natives-windows"))
                            .and_then(|x| x.get("url"))
                            .is_some()
                })
                .count()
        })
        .unwrap_or(0);

    let base_count = count_library_downloads(&base_libs);
    let fabric_count = count_library_downloads(&fabric_libs);

    let mut asset_index_data = Value::Null;
    let mut asset_index_url = None;
    let mut asset_objects_count = 0usize;

    if let Some(ai) = meta.get("assetIndex") {
        if let Some(au) =
            ai.get("url").and_then(Value::as_str)
        {
            asset_index_url = Some(au.to_string());

            emit_progress(
                &app,
                "Подготовка",
                "Читаю список ресурсов Minecraft…",
                0,
                0,
            );

            asset_index_data = http_json(au)?;

            asset_objects_count = asset_index_data
                .get("objects")
                .and_then(Value::as_object)
                .map(|o| o.len())
                .unwrap_or(0);
        }
    }

    let asset_count = asset_index_url
        .as_ref()
        .map(|_| 1usize)
        .unwrap_or(0);

    let total =
        1
        + base_count
        + native_count
        + asset_count
        + asset_objects_count
        + fabric_count;

    let mut completed = 0usize;

    emit_progress(
        &app,
        "Minecraft",
        &format!("Minecraft {}", version),
        0,
        total,
    );

    download_to(
        &app,
        client
            .get("url")
            .and_then(Value::as_str)
            .ok_or("Нет URL client.jar")?,
        &vdir.join(format!("{}.jar", version)),
        "Minecraft",
        &format!("{} client.jar", version),
        &mut completed,
        total,
    )?;

    fs::write(
        vdir.join(format!("{}.json", version)),
        serde_json::to_vec_pretty(&meta)
            .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    download_library_list(
        &app,
        &base_libs,
        &libs,
        "Библиотеки Minecraft",
        &mut completed,
        total,
    )?;

    let natives = game.join("natives");

    fs::create_dir_all(&natives)
        .map_err(|e| e.to_string())?;

    if let Some(arr) =
        meta.get("libraries").and_then(Value::as_array)
    {
        for lib in arr {
            if !allowed(lib) {
                continue;
            }

            if let Some(u) = lib
                .get("downloads")
                .and_then(|x| x.get("classifiers"))
                .and_then(|x| x.get("natives-windows"))
                .and_then(|x| x.get("url"))
                .and_then(Value::as_str)
            {
                emit_progress(
                    &app,
                    "Нативные библиотеки",
                    "Распаковываю natives…",
                    completed,
                    total,
                );

                let bytes = http_get(u)?;

                let mut z =
                    zip::ZipArchive::new(Cursor::new(bytes))
                        .map_err(|e| e.to_string())?;

                for i in 0..z.len() {
                    let f = z
                        .by_index(i)
                        .map_err(|e| e.to_string())?;

                    if f.name().starts_with("META-INF/") {
                        continue;
                    }

                    safe_extract(f, &natives)?;
                }

                completed += 1;

                emit_progress(
                    &app,
                    "Нативные библиотеки",
                    "Natives готовы",
                    completed,
                    total,
                );
            }
        }
    }

    if let Some(ai) = meta.get("assetIndex") {
        let aid = ai
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("legacy");

        let au = asset_index_url
            .as_deref()
            .ok_or("Нет URL asset index")?;

        let idx = game
            .join("assets")
            .join("indexes");

        fs::create_dir_all(&idx)
            .map_err(|e| e.to_string())?;

        let ip = idx.join(format!("{}.json", aid));

        if !ip.exists()
            || fs::metadata(&ip)
                .map_err(|e| e.to_string())?
                .len()
                == 0
        {
            fs::write(
                &ip,
                serde_json::to_vec(&asset_index_data)
                    .map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
        }

        download_to(
            &app,
            au,
            &ip,
            "Ресурсы",
            &format!("Asset index {}", aid),
            &mut completed,
            total,
        )?;

        if let Some(objects) = asset_index_data
            .get("objects")
            .and_then(Value::as_object)
        {
            for (_, o) in objects {
                if let Some(h) =
                    o.get("hash").and_then(Value::as_str)
                {
                    if h.len() < 2 {
                        continue;
                    }

                    let p = game
                        .join("assets")
                        .join("objects")
                        .join(&h[0..2])
                        .join(h);

                    let u = format!(
                        "https://resources.download.minecraft.net/{}/{}",
                        &h[0..2],
                        h
                    );

                    download_to(
                        &app,
                        &u,
                        &p,
                        "Ресурсы",
                        "Asset object",
                        &mut completed,
                        total,
                    )?;
                }
            }
        }
    }

    if loader.eq_ignore_ascii_case("fabric") {
        download_library_list(
            &app,
            &fabric_libs,
            &libs,
            "Fabric",
            &mut completed,
            total,
        )?;
    }

    emit_progress(
        &app,
        "Готово",
        "Все файлы Minecraft готовы",
        total,
        total,
    );

    Ok(json!({
        "installed": true,
        "instance": id,
        "version": version,
        "loader": loader,
        "loaderInfo":
            if loader.eq_ignore_ascii_case("fabric") {
                json!({
                    "name": "Fabric",
                    "version":
                        fabric_profile
                            .get("loader")
                            .and_then(|x| x.get("version"))
                            .and_then(Value::as_str)
                            .unwrap_or("")
                })
            } else {
                Value::Null
            },
        "game_dir": game.to_string_lossy()
    }))
}

#[tauri::command]
fn find_java() -> Option<String> {
    java_from_path(None)
}

#[tauri::command]
fn launch_instance(
    app: tauri::AppHandle,
    id: String,
    version: String,
    username: String,
    loader: String,
    java_path: Option<String>,
) -> Result<(), String> {
    let instance = instances_root(&app)?.join(&id);

    if !instance.exists() {
        return Err("Сборка не найдена".into());
    }

    let game = instance.join("game");

    let vdir = game
        .join("versions")
        .join(&version);

    let meta_path =
        vdir.join(format!("{}.json", version));

    if !meta_path.exists() {
        return Err(
            "Сначала нажми «Скачать Minecraft» для этой сборки"
                .into(),
        );
    }

    let meta: Value = serde_json::from_slice(
        &fs::read(&meta_path)
            .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    let java = java_from_path(java_path.as_deref())
        .ok_or(
            "Java не найдена. Укажи путь к javaw.exe в настройках или установи Java."
        )?;

    let assets = meta
        .get("assetIndex")
        .and_then(|x| x.get("id"))
        .and_then(Value::as_str)
        .unwrap_or("legacy");

    let mut vars = HashMap::new();

    vars.insert(
        "auth_player_name".into(),
        username.clone(),
    );

    vars.insert(
        "version_name".into(),
        version.clone(),
    );

    vars.insert(
        "game_directory".into(),
        game.to_string_lossy().into(),
    );

    vars.insert(
        "assets_root".into(),
        game.join("assets")
            .to_string_lossy()
            .into(),
    );

    vars.insert(
        "assets_index_name".into(),
        assets.into(),
    );

    vars.insert(
        "auth_uuid".into(),
        "00000000-0000-0000-0000-000000000000".into(),
    );

    vars.insert(
        "auth_access_token".into(),
        "0".into(),
    );

    vars.insert(
        "user_type".into(),
        "legacy".into(),
    );

    vars.insert(
        "version_type".into(),
        meta.get("type")
            .and_then(Value::as_str)
            .unwrap_or("release")
            .into(),
    );

    vars.insert(
        "natives_directory".into(),
        game.join("natives")
            .to_string_lossy()
            .into(),
    );

    vars.insert(
        "library_directory".into(),
        game.join("libraries")
            .to_string_lossy()
            .into(),
    );

    vars.insert(
        "classpath_separator".into(),
        ";".into(),
    );

    vars.insert(
        "launcher_name".into(),
        "SakuraLauncher".into(),
    );

    vars.insert(
        "launcher_version".into(),
        "0.5.0".into(),
    );

    let mut cp = Vec::new();

    if let Some(arr) =
        meta.get("libraries").and_then(Value::as_array)
    {
        for lib in arr {
            if !allowed(lib) {
                continue;
            }

            if let Some(p) =
                artifact_path(lib, &game.join("libraries"))
            {
                if p.exists() {
                    cp.push(
                        p.to_string_lossy().to_string()
                    );
                }
            }
        }
    }

    let mut main_class = meta
        .get("mainClass")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    let mut jvm_args = collect_args(
        meta.get("arguments")
            .and_then(|x| x.get("jvm")),
        &vars,
    );

    let mut game_args = collect_args(
        meta.get("arguments")
            .and_then(|x| x.get("game")),
        &vars,
    );

    if game_args.is_empty() {
        if let Some(old) = meta
            .get("minecraftArguments")
            .and_then(Value::as_str)
        {
            game_args.extend(
                old.split_whitespace()
                    .map(|s| replace_vars(s, &vars)),
            );
        }
    }

    if loader.eq_ignore_ascii_case("fabric") {
        let fp = vdir.join("fabric.json");

        if !fp.exists() {
            return Err(
                "Fabric не установлен. Нажми «Скачать Minecraft» ещё раз."
                    .into(),
            );
        }

        let fm: Value = serde_json::from_slice(
            &fs::read(fp)
                .map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;

        if let Some(arr) =
            fm.get("libraries").and_then(Value::as_array)
        {
            for lib in arr {
                if !allowed(lib) {
                    continue;
                }

                if let Some(p) = artifact_path(
                    lib,
                    &game.join("libraries"),
                ) {
                    if p.exists() {
                        cp.push(
                            p.to_string_lossy()
                                .to_string(),
                        );
                    }
                }
            }
        }

        main_class = fm
            .get("mainClass")
            .and_then(Value::as_str)
            .unwrap_or(&main_class)
            .to_string();

        let fj = collect_args(
            fm.get("arguments")
                .and_then(|x| x.get("jvm")),
            &vars,
        );

        let fg = collect_args(
            fm.get("arguments")
                .and_then(|x| x.get("game")),
            &vars,
        );

        jvm_args.extend(fj);

        if !fg.is_empty() {
            game_args = fg;
        }
    }

    cp.push(
        vdir.join(format!("{}.jar", version))
            .to_string_lossy()
            .to_string(),
    );

    if main_class.is_empty() {
        return Err(
            "mainClass отсутствует в Minecraft metadata"
                .into(),
        );
    }

    let mut args = Vec::new();

    args.extend(jvm_args);

    args.push(
        "-Djava.library.path=${natives_directory}"
            .replace(
                "${natives_directory}",
                &vars["natives_directory"],
            ),
    );

    args.push("-cp".into());

    args.push(cp.join(";"));

    args.push(main_class);

    args.extend(game_args);

    Command::new(java)
        .args(args)
        .current_dir(&game)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| {
            format!("Не удалось запустить Java: {e}")
        })?;

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(
            tauri::generate_handler![
                launcher_info,
                create_instance,
                list_instance_files,
                open_instance,
                install_mod,
                install_minecraft,
                find_java,
                launch_instance
            ],
        )
        .run(tauri::generate_context!())
        .expect("error while running Sakura Launcher");
}
