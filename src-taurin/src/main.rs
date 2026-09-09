#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::{json, Value};
use std::{collections::HashMap, fs, io::{self, Cursor, Write}, path::{Path, PathBuf}, process::{Command, Stdio}, sync::{Arc, Mutex, atomic::{AtomicUsize, Ordering}}, thread};
use tauri::{Emitter, Manager};

const MANIFEST_URL: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const FABRIC_META: &str = "https://meta.fabricmc.net/v2";

fn emit_progress(app: &tauri::AppHandle, phase: &str, current: &str, completed: usize, total: usize) {
    let percent = if total > 0 { ((completed as f64 / total as f64) * 100.0).round() as u8 } else { 0 };
    let _ = app.emit("download-progress", json!({
        "phase": phase,
        "current": current,
        "completed": completed,
        "total": total,
        "percent": percent
    }));
}

fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("SakuraLauncher");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}
fn instances_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let p = root(app)?.join("instances");
    fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    Ok(p)
}
fn slug(s: &str) -> String { s.chars().map(|c| if c.is_ascii_alphanumeric() || c=='-' || c=='_' { c } else { '_' }).collect() }

fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent("SakuraLauncher/0.5.1")
        .build().map_err(|e| e.to_string())
}
fn http_get(url: &str) -> Result<Vec<u8>, String> {
    client()?.get(url).send().map_err(|e| e.to_string())?
        .error_for_status().map_err(|e| e.to_string())?
        .bytes().map(|b| b.to_vec()).map_err(|e| e.to_string())
}
fn http_json(url: &str) -> Result<Value, String> {
    serde_json::from_slice(&http_get(url)?).map_err(|e| format!("JSON: {e}"))
}
fn download_to(app: &tauri::AppHandle, url: &str, path: &Path, phase: &str, current: &str, completed: &mut usize, total: usize) -> Result<(), String> {
    emit_progress(app, phase, current, *completed, total);
    if path.exists() && fs::metadata(path).map_err(|e| e.to_string())?.len() > 0 {
        *completed += 1;
        emit_progress(app, phase, current, *completed, total);
        return Ok(());
    }
    if let Some(p) = path.parent() { fs::create_dir_all(p).map_err(|e| e.to_string())?; }
    fs::write(path, http_get(url)?).map_err(|e| e.to_string())?;
    *completed += 1;
    emit_progress(app, phase, current, *completed, total);
    Ok(())
}
#[derive(Clone)]
struct DownloadJob { url:String, path:PathBuf, phase:String, current:String }

fn download_jobs_parallel(app:&tauri::AppHandle, jobs:Vec<DownloadJob>, start:usize, total:usize, workers:usize)->Result<usize,String>{
    if jobs.is_empty(){return Ok(start);}
    let queue=Arc::new(Mutex::new(jobs));
    let done=Arc::new(AtomicUsize::new(start));
    let errors=Arc::new(Mutex::new(Vec::<String>::new()));
    let count=workers.clamp(2,16).min(queue.lock().map_err(|e|e.to_string())?.len().max(1));
    let mut handles=Vec::new();
    for _ in 0..count{
        let queue=Arc::clone(&queue); let done=Arc::clone(&done); let errors=Arc::clone(&errors); let app=app.clone();
        handles.push(thread::spawn(move||loop{
            let job=match queue.lock(){Ok(mut q)=>q.pop(),Err(_)=>None};
            let Some(job)=job else{break};
            let n=done.load(Ordering::Relaxed); emit_progress(&app,&job.phase,&job.current,n,total);
            if job.path.exists() && fs::metadata(&job.path).map(|m|m.len()>0).unwrap_or(false){
                let n=done.fetch_add(1,Ordering::SeqCst)+1; emit_progress(&app,&job.phase,&job.current,n,total); continue;
            }
            if let Some(parent)=job.path.parent(){if let Err(e)=fs::create_dir_all(parent){errors.lock().unwrap().push(format!("{}: {}",job.current,e));continue;}}
            let mut ok=false; let mut last=String::new();
            for attempt in 1..=3{
                match http_get(&job.url){
                    Ok(bytes)=>{let tmp=job.path.with_extension(format!("part{}",attempt)); match fs::write(&tmp,bytes).map_err(|e|e.to_string()).and_then(|_|fs::rename(&tmp,&job.path).map_err(|e|e.to_string())){Ok(_)=>{ok=true;break},Err(e)=>last=e}},
                    Err(e)=>last=e,
                }
            }
            if ok{let n=done.fetch_add(1,Ordering::SeqCst)+1;emit_progress(&app,&job.phase,&job.current,n,total)}else{errors.lock().unwrap().push(format!("{}: {}",job.current,last));}
        }));
    }
    for h in handles{h.join().map_err(|_|"Поток загрузки завершился с ошибкой".to_string())?;}
    let errors=errors.lock().map_err(|e|e.to_string())?;
    if !errors.is_empty(){return Err(format!("Не удалось скачать {} файлов:\n{}",errors.len(),errors.join("\n")));}
    Ok(done.load(Ordering::SeqCst))
}

fn allowed(entry: &Value) -> bool {
    let Some(rules) = entry.get("rules").and_then(Value::as_array) else { return true; };
    let mut allow = false;
    for r in rules {
        let matches_os = match r.get("os").and_then(|x| x.get("name")).and_then(Value::as_str) {
            Some("windows") => true,
            Some(_) => false,
            None => true,
        };
        if matches_os {
            allow = r.get("action").and_then(Value::as_str) == Some("allow");
        }
    }
    allow
}
fn artifact_path(lib: &Value, libraries: &Path) -> Option<PathBuf> {
    let p = lib.get("downloads")?.get("artifact")?.get("path")?.as_str()?;
    Some(libraries.join(p))
}
fn replace_vars(s: &str, vars: &HashMap<String,String>) -> String {
    let mut out=s.to_string();
    for (k,v) in vars { out=out.replace(&format!("${{{}}}",k),v); }
    out
}
fn collect_args(v: Option<&Value>, vars: &HashMap<String,String>) -> Vec<String> {
    let mut out=Vec::new();
    if let Some(arr)=v.and_then(Value::as_array) {
        for x in arr {
            if x.is_string() { out.push(replace_vars(x.as_str().unwrap_or_default(),vars)); continue; }
            if !allowed(x) { continue; }
            match x.get("value") {
                Some(Value::String(s)) => out.push(replace_vars(s,vars)),
                Some(Value::Array(a)) => for y in a { if let Some(s)=y.as_str(){ out.push(replace_vars(s,vars)); } },
                _=>{}
            }
        }
    }
    out
}
fn safe_extract(mut zip: zip::read::ZipFile<'_>, root: &Path) -> Result<(), String> {
    let name = zip.name().replace('\\', "/");
    if name.starts_with('/') || name.contains("../") { return Err("Опасный путь внутри natives-архива".into()); }
    let out = root.join(&name);
    if zip.is_dir() { fs::create_dir_all(&out).map_err(|e|e.to_string())?; return Ok(()); }
    if let Some(parent)=out.parent(){fs::create_dir_all(parent).map_err(|e|e.to_string())?;}
    let mut f=fs::File::create(out).map_err(|e|e.to_string())?;
    io::copy(&mut zip,&mut f).map_err(|e|e.to_string())?;
    Ok(())
}
fn download_library_list(app: &tauri::AppHandle, libs: &[Value], libraries: &Path, phase: &str, completed: &mut usize, total: usize) -> Result<(), String> {
    let mut jobs=Vec::new();
    for lib in libs{
        if !allowed(lib){continue;}
        if let Some(p)=artifact_path(lib,libraries){
            if let Some(u)=lib.get("downloads").and_then(|x|x.get("artifact")).and_then(|x|x.get("url")).and_then(Value::as_str){jobs.push(DownloadJob{url:u.to_string(),path:p.clone(),phase:phase.to_string(),current:p.file_name().unwrap_or_default().to_string_lossy().to_string()});}
        }else if let Some(name)=lib.get("name").and_then(Value::as_str){
            if let Some(base)=lib.get("url").and_then(Value::as_str){if let Some(path)=maven_path(name){jobs.push(DownloadJob{url:format!("{}{}",base,path),path:libraries.join(&path),phase:phase.to_string(),current:path});}}
        }
    }
    *completed=download_jobs_parallel(app,jobs,*completed,total,12)?;
    Ok(())
}
fn maven_path(name:&str)->Option<String>{
    let mut it=name.split(':');
    let g=it.next()?; let a=it.next()?; let v=it.next()?;
    Some(format!("{}/{}/{}/{}-{}.jar",g.replace('.', "/"),a,v,a,v))
}
fn java_is_usable(path: &Path) -> bool {
    if !path.exists() || !path.is_file() { return false; }
    Command::new(path).arg("-version").output().map(|o| o.status.success()).unwrap_or(false)
}

fn java_from_path(path: Option<&str>) -> Option<String> {
    let exe_names = if cfg!(windows) { vec!["javaw.exe", "java.exe"] } else { vec!["java"] };

    // 1) Explicit user path. Accept either the executable itself or a JDK/JRE directory.
    if let Some(raw) = path.map(str::trim).filter(|p| !p.is_empty()) {
        let p = Path::new(raw);
        if p.is_file() && java_is_usable(p) { return Some(p.to_string_lossy().into_owned()); }
        if p.is_dir() {
            for name in &exe_names {
                let candidate = p.join("bin").join(name);
                if java_is_usable(&candidate) { return Some(candidate.to_string_lossy().into_owned()); }
            }
        }
    }

    // 2) JAVA_HOME is the most reliable automatic source on Windows.
    if let Ok(home) = std::env::var("JAVA_HOME") {
        let root = PathBuf::from(home);
        for name in &exe_names {
            let candidate = root.join("bin").join(name);
            if java_is_usable(&candidate) { return Some(candidate.to_string_lossy().into_owned()); }
        }
    }

    // 3) PATH lookup.
    for name in &exe_names {
        if let Ok(o)=Command::new(name).arg("-version").output() {
            if o.status.success() { return Some(name.to_string()); }
        }
    }

    // 4) Common Windows Java installation roots. Pick the first working runtime.
    #[cfg(windows)]
    {
        let mut roots = Vec::new();
        if let Ok(p) = std::env::var("ProgramFiles") { roots.push(PathBuf::from(p)); }
        if let Ok(p) = std::env::var("ProgramW6432") { roots.push(PathBuf::from(p)); }
        if let Ok(p) = std::env::var("LOCALAPPDATA") { roots.push(PathBuf::from(p).join("Programs")); }
        roots.extend([
            PathBuf::from(r"C:\Program Files\Java"),
            PathBuf::from(r"C:\Program Files\Eclipse Adoptium"),
            PathBuf::from(r"C:\Program Files\Microsoft"),
            PathBuf::from(r"C:\Program Files\Amazon Corretto"),
            PathBuf::from(r"C:\Program Files\Zulu"),
            PathBuf::from(r"C:\Program Files\BellSoft"),
        ]);

        let mut checked = std::collections::HashSet::new();
        for root in roots {
            if !root.exists() { continue; }
            let entries = match fs::read_dir(&root) { Ok(v) => v, Err(_) => continue };
            for entry in entries.flatten() {
                let dir = entry.path();
                if !dir.is_dir() || !checked.insert(dir.clone()) { continue; }
                for name in &exe_names {
                    let candidate = dir.join("bin").join(name);
                    if java_is_usable(&candidate) { return Some(candidate.to_string_lossy().into_owned()); }
                }
            }
        }
    }
    None
}

#[tauri::command]
fn launcher_info()->Value{json!({"name":"Sakura Launcher","version":"0.9.0","status":"minecraft-core"})}

#[tauri::command]
fn create_instance(app: tauri::AppHandle, name:String, version:String, loader:String)->Result<Value,String>{
    let base=format!("{}-{}",slug(&name).to_lowercase(),slug(&version));
    let mut id=base.clone(); let mut n=2;
    while instances_root(&app)?.join(&id).exists(){id=format!("{}-{}",base,n);n+=1;}
    let dir=instances_root(&app)?.join(&id);
    for sub in ["mods","saves","game","resourcepacks","shaderpacks","logs"] { fs::create_dir_all(dir.join(sub)).map_err(|e|e.to_string())?; }
    Ok(json!({"id":id,"name":name,"version":version,"loader":loader,"dir":dir.to_string_lossy()}))
}

#[tauri::command]
fn list_instance_files(app:tauri::AppHandle,id:String)->Result<Value,String>{
    let dir=instances_root(&app)?.join(&id); if !dir.exists(){return Err("Сборка не найдена".into());}
    let mods=dir.join("mods"); fs::create_dir_all(&mods).map_err(|e|e.to_string())?;
    let mut list=Vec::new();
    for e in fs::read_dir(&mods).map_err(|e|e.to_string())? { let e=e.map_err(|e|e.to_string())?; let p=e.path(); if p.is_file(){list.push(json!({"name":p.file_name().unwrap_or_default().to_string_lossy(),"size":fs::metadata(&p).map_err(|e|e.to_string())?.len()}));} }
    fn count_files(p:&Path)->usize{fs::read_dir(p).ok().map(|it|it.filter_map(Result::ok).map(|e|{let q=e.path();if q.is_dir(){count_files(&q)}else{1}}).sum()).unwrap_or(0)}
    Ok(json!({"mods":list,"total_files":count_files(&dir),"path":dir.to_string_lossy()}))
}

#[tauri::command]
fn open_instance(app:tauri::AppHandle,id:String)->Result<(),String>{
    let dir=instances_root(&app)?.join(&id); if !dir.exists(){return Err("Сборка не найдена".into());}
    Command::new("explorer.exe").arg(dir).spawn().map_err(|e|e.to_string())?; Ok(())
}

#[tauri::command]
fn install_content(app:tauri::AppHandle,id:String,url:String,filename:String,content_type:String)->Result<(),String>{
    let safe=Path::new(&filename).file_name().ok_or("Некорректное имя файла")?.to_string_lossy().to_string();
    let (folder,label,allowed_ext):(&str,&str,&[&str])=match content_type.as_str(){
        "resourcepack"=>("resourcepacks","Ресурспак", &[".zip",".mcpack"]),
        "shader"=>("shaderpacks","Шейдер", &[".zip"]),
        "modpack"=>("modpacks","Готовая сборка", &[".mrpack",".zip"]),
        _=>("mods","Мод", &[".jar"]),
    };
    if !allowed_ext.iter().any(|ext|safe.to_lowercase().ends_with(ext)){return Err(format!("Файл не подходит для типа {}",content_type));}
    let dir=instances_root(&app)?.join(&id).join(folder); fs::create_dir_all(&dir).map_err(|e|e.to_string())?;
    let mut completed=0usize; download_to(&app,&url,&dir.join(safe),label,"Установка контента",&mut completed,1)
}

#[tauri::command]
fn install_mod(app:tauri::AppHandle,id:String,url:String,filename:String)->Result<(),String>{
    install_content(app,id,url,filename,"mod".into())
}

fn safe_join(root:&Path, rel:&str)->Result<PathBuf,String>{
    let rel=rel.replace('\\',"/");
    let p=Path::new(&rel);
    if p.is_absolute() || rel.split('/').any(|x|x=="..") { return Err(format!("Опасный путь в modpack: {}",rel)); }
    Ok(root.join(p))
}

#[tauri::command]
fn install_modpack(app:tauri::AppHandle,id:String,url:String,filename:String)->Result<Value,String>{
    let instance=instances_root(&app)?.join(&id);
    if !instance.exists(){return Err("Сборка не найдена".into());}
    let bytes=http_get(&url)?;
    let mut zip=zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e|format!("Не удалось открыть modpack: {}",e))?;
    let index_file=zip.by_name("modrinth.index.json").map_err(|_|"В .mrpack нет modrinth.index.json".to_string())?;
    let index:Value=serde_json::from_reader(index_file).map_err(|e|format!("Неверный modrinth.index.json: {}",e))?;
    let deps=index.get("dependencies").and_then(Value::as_object).ok_or("В modpack нет dependencies")?;
    let mc=deps.get("minecraft").and_then(Value::as_str).ok_or("Modpack не указал версию Minecraft")?.to_string();
    let loader=if deps.contains_key("fabric-loader") {"Fabric"} else if deps.contains_key("neoforge") {"NeoForge"} else if deps.contains_key("forge") {"Forge"} else if deps.contains_key("quilt-loader") {"Quilt"} else {"Vanilla"}.to_string();

    emit_progress(&app,"Modpack","Устанавливаю Minecraft для сборки…",0,0);
    install_minecraft(app.clone(),id.clone(),mc.clone(),loader.clone())?;
    let instance=instances_root(&app)?.join(&id);

    let files=index.get("files").and_then(Value::as_array).cloned().unwrap_or_default();
    let mut jobs=Vec::new();
    for f in &files {
        let env=f.get("env").and_then(|x|x.get("client")).and_then(Value::as_str).unwrap_or("required");
        if env.eq_ignore_ascii_case("unsupported") { continue; }
        let path=f.get("path").and_then(Value::as_str).ok_or("У modpack-файла нет path")?;
        let downloads=f.get("downloads").and_then(Value::as_array).ok_or(format!("У modpack-файла нет downloads: {}",path))?;
        let dl=downloads.first().and_then(Value::as_str).ok_or(format!("Нет URL для modpack-файла: {}",path))?;
        let out=safe_join(&instance,path)?;
        jobs.push(DownloadJob{url:dl.to_string(),path:out,phase:"Modpack".into(),current:path.to_string()});
    }
    let total=jobs.len();
    download_jobs_parallel(&app,jobs,0,total.max(1),12)?;

    // Apply the standard client overrides shipped inside .mrpack.
    for prefix in ["overrides/", "client-overrides/"] {
        let mut names=Vec::new();
        for i in 0..zip.len(){
            let f=zip.by_index(i).map_err(|e|e.to_string())?;
            let name=f.name().replace('\\',"/");
            if name.starts_with(prefix) && name.len()>prefix.len(){ names.push(name); }
        }
        for name in names {
            let mut f=zip.by_name(&name).map_err(|e|e.to_string())?;
            let rel=name.trim_start_matches(prefix);
            let out=safe_join(&instance,rel)?;
            if f.is_dir(){fs::create_dir_all(&out).map_err(|e|e.to_string())?;continue;}
            if let Some(parent)=out.parent(){fs::create_dir_all(parent).map_err(|e|e.to_string())?;}
            let mut file=fs::File::create(&out).map_err(|e|e.to_string())?;
            io::copy(&mut f,&mut file).map_err(|e|e.to_string())?;
        }
    }
    emit_progress(&app,"Готово","Modpack установлен целиком",total.max(1),total.max(1));
    Ok(json!({"installed":true,"instance":id,"version":mc,"loader":loader,"files":files.len()}))
}

fn count_library_downloads(libs:&[Value])->usize{
    libs.iter().filter(|lib|{
        if !allowed(lib){return false;}
        artifact_path(lib,Path::new(".")).is_some() || (lib.get("name").and_then(Value::as_str).and_then(maven_path).is_some() && lib.get("url").and_then(Value::as_str).is_some())
    }).count()
}

#[tauri::command]
fn install_minecraft(app: tauri::AppHandle,id:String,version:String,loader:String)->Result<Value,String>{
    let instance=instances_root(&app)?.join(&id); if !instance.exists(){return Err("Сборка не найдена".into());}
    let game=instance.join("game"); fs::create_dir_all(&game).map_err(|e|e.to_string())?;
    emit_progress(&app,"Подготовка","Получаю официальный manifest Mojang…",0,0);
    let manifest=http_json(MANIFEST_URL)?;
    let vurl=manifest.get("versions").and_then(Value::as_array).and_then(|a|a.iter().find(|v|v.get("id").and_then(Value::as_str)==Some(version.as_str()))).and_then(|v|v.get("url")).and_then(Value::as_str).ok_or("Версия Minecraft не найдена")?;
    let meta=http_json(vurl)?;
    let vdir=game.join("versions").join(&version); fs::create_dir_all(&vdir).map_err(|e|e.to_string())?;
    let client=meta.get("downloads").and_then(|x|x.get("client")).ok_or("У этой версии нет client.jar")?;
    let libs=game.join("libraries"); fs::create_dir_all(&libs).map_err(|e|e.to_string())?;
    let base_libs=meta.get("libraries").and_then(Value::as_array).cloned().unwrap_or_default();

    let mut fabric_profile=Value::Null;
    let mut fabric_libs=Vec::new();
    if loader.eq_ignore_ascii_case("fabric") {
        emit_progress(&app,"Fabric","Получаю профиль Fabric Loader…",0,0);
        let versions_url=format!("{}/versions/loader/{}",FABRIC_META,urlencoding::encode(&version));
        let arr=http_json(&versions_url)?.as_array().cloned().ok_or("Fabric Meta вернул неверный ответ")?;
        let chosen=arr.iter().find(|x|x.get("loader").and_then(|l|l.get("stable")).and_then(Value::as_bool)==Some(true)).cloned().or_else(||arr.first().cloned()).ok_or("Для этой версии нет Fabric Loader")?;
        let lv=chosen.get("loader").and_then(|x|x.get("version")).and_then(Value::as_str).ok_or("Не найден Fabric Loader version")?;
        let profile_url=format!("{}/versions/loader/{}/{}/profile/json",FABRIC_META,urlencoding::encode(&version),urlencoding::encode(lv));
        fabric_profile=http_json(&profile_url)?;
        fabric_libs=fabric_profile.get("libraries").and_then(Value::as_array).cloned().unwrap_or_default();
        fs::write(vdir.join("fabric.json"),serde_json::to_vec_pretty(&fabric_profile).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    }

    let native_count=meta.get("libraries").and_then(Value::as_array).map(|arr|arr.iter().filter(|lib| allowed(lib) && lib.get("downloads").and_then(|x|x.get("classifiers")).and_then(|x|x.get("natives-windows")).and_then(|x|x.get("url")).is_some()).count()).unwrap_or(0);
    let base_count=count_library_downloads(&base_libs);
    let fabric_count=count_library_downloads(&fabric_libs);
    let mut asset_index_data=Value::Null;
    let mut asset_index_url=None;
    let mut asset_objects_count=0usize;
    if let Some(ai)=meta.get("assetIndex") {
        if let Some(au)=ai.get("url").and_then(Value::as_str) {
            asset_index_url=Some(au.to_string());
            emit_progress(&app,"Подготовка","Читаю список ресурсов Minecraft…",0,0);
            asset_index_data=http_json(au)?;
            asset_objects_count=asset_index_data.get("objects").and_then(Value::as_object).map(|o|o.len()).unwrap_or(0);
        }
    }
    let asset_count=asset_index_url.as_ref().map(|_|1usize).unwrap_or(0);
    let total=1+base_count+native_count+asset_count+asset_objects_count+fabric_count;
    let mut completed=0usize;
    emit_progress(&app,"Minecraft",&format!("Minecraft {}",version),0,total);

    download_to(&app,client.get("url").and_then(Value::as_str).ok_or("Нет URL client.jar")?,&vdir.join(format!("{}.jar",version)),"Minecraft",&format!("{} client.jar",version),&mut completed,total)?;
    fs::write(vdir.join(format!("{}.json",version)),serde_json::to_vec_pretty(&meta).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;

    download_library_list(&app,&base_libs,&libs,"Библиотеки Minecraft",&mut completed,total)?;

    let natives=game.join("natives"); fs::create_dir_all(&natives).map_err(|e|e.to_string())?;
    if let Some(arr)=meta.get("libraries").and_then(Value::as_array){
        for lib in arr {
            if !allowed(lib){continue;}
            if let Some(u)=lib.get("downloads").and_then(|x|x.get("classifiers")).and_then(|x|x.get("natives-windows")).and_then(|x|x.get("url")).and_then(Value::as_str){
                emit_progress(&app,"Нативные библиотеки","Распаковываю natives…",completed,total);
                let bytes=http_get(u)?;
                let mut z=zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e|e.to_string())?;
                for i in 0..z.len(){let f=z.by_index(i).map_err(|e|e.to_string())?;if f.name().starts_with("META-INF/"){continue;}safe_extract(f,&natives)?;}
                completed+=1;emit_progress(&app,"Нативные библиотеки","Natives готовы",completed,total);
            }
        }
    }

    if let Some(ai)=meta.get("assetIndex"){
        let aid=ai.get("id").and_then(Value::as_str).unwrap_or("legacy");
        let au=asset_index_url.as_deref().ok_or("Нет URL asset index")?;
        let idx=game.join("assets").join("indexes"); fs::create_dir_all(&idx).map_err(|e|e.to_string())?;
        let ip=idx.join(format!("{}.json",aid));
        if !ip.exists() || fs::metadata(&ip).map_err(|e|e.to_string())?.len()==0 {
            fs::write(&ip,serde_json::to_vec(&asset_index_data).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
        }
        download_to(&app,au,&ip,"Ресурсы",&format!("Asset index {}",aid),&mut completed,total)?;
        if let Some(objects)=asset_index_data.get("objects").and_then(Value::as_object){
            let mut jobs=Vec::with_capacity(objects.len());
            for (_,o) in objects {if let Some(h)=o.get("hash").and_then(Value::as_str){if h.len()<2{continue;}let p=game.join("assets").join("objects").join(&h[0..2]).join(h);let u=format!("https://resources.download.minecraft.net/{}/{}",&h[0..2],h);jobs.push(DownloadJob{url:u,path:p,phase:"Ресурсы".into(),current:"Asset object".into()});}}
            completed=download_jobs_parallel(&app,jobs,completed,total,16)?;
        }
    }

    if loader.eq_ignore_ascii_case("fabric") {
        download_library_list(&app,&fabric_libs,&libs,"Fabric",&mut completed,total)?;
    }
    emit_progress(&app,"Готово","Все файлы Minecraft готовы",total,total);
    Ok(json!({"installed":true,"instance":id,"version":version,"loader":loader,"loaderInfo":if loader.eq_ignore_ascii_case("fabric"){json!({"name":"Fabric","version":fabric_profile.get("loader").and_then(|x|x.get("version")).and_then(Value::as_str).unwrap_or("")})}else{Value::Null},"game_dir":game.to_string_lossy()}))
}
#[tauri::command]
fn find_java()->Option<String>{ java_from_path(None) }


#[derive(Debug, serde::Deserialize, Default)]
struct LaunchOptions { min_ram: Option<u32>, max_ram: Option<u32>, jvm_args: Option<String>, width: Option<u32>, height: Option<u32>, fullscreen: Option<bool> }

#[tauri::command]
fn install_java(app: tauri::AppHandle) -> Result<String,String> {
    let dir=root(&app)?.join("runtime").join("java-21");
    let bytes=http_get("https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse")?;
    emit_progress(&app,"Java","Скачиваю Java 21…",0,1);
    let archive=dir.join("java21.zip"); fs::create_dir_all(&dir).map_err(|e|e.to_string())?; fs::write(&archive,bytes).map_err(|e|e.to_string())?;
    let data=fs::read(&archive).map_err(|e|e.to_string())?; let mut z=zip::ZipArchive::new(Cursor::new(data)).map_err(|e|e.to_string())?;
    for i in 0..z.len(){let mut f=z.by_index(i).map_err(|e|e.to_string())?;let name=f.name().replace('\\','/');if name.starts_with('/')||name.contains("../"){return Err("Некорректный путь в Java archive".into());}let out=dir.join(&name);if f.is_dir(){fs::create_dir_all(&out).map_err(|e|e.to_string())?;}else{if let Some(pa)=out.parent(){fs::create_dir_all(pa).map_err(|e|e.to_string())?;}let mut w=fs::File::create(&out).map_err(|e|e.to_string())?;io::copy(&mut f,&mut w).map_err(|e|e.to_string())?;}}
    fs::remove_file(&archive).ok(); let found=find_java_under(&dir).ok_or("Java скачана, но executable не найден")?; emit_progress(&app,"Java","Java 21 готова",1,1); Ok(found)
}
fn find_java_under(root:&Path)->Option<String>{let mut stack=vec![root.to_path_buf()];while let Some(d)=stack.pop(){if let Ok(rd)=fs::read_dir(d){for e in rd.flatten(){let p=e.path();if p.is_dir(){stack.push(p)}else if p.file_name().and_then(|x|x.to_str()).map(|x|x.eq_ignore_ascii_case("javaw.exe")||x.eq_ignore_ascii_case("java.exe")).unwrap_or(false)&&java_is_usable(&p){return Some(p.to_string_lossy().into_owned())}}}}None}
#[tauri::command]
fn duplicate_instance(app:tauri::AppHandle,id:String,new_id:String)->Result<(),String>{let src=instances_root(&app)?.join(&id);let dst=instances_root(&app)?.join(slug(&new_id));if !src.exists(){return Err("Сборка не найдена".into())}if dst.exists(){return Err("Такая сборка уже существует".into())}copy_dir(&src,&dst)}
fn copy_dir(src:&Path,dst:&Path)->Result<(),String>{fs::create_dir_all(dst).map_err(|e|e.to_string())?;for e in fs::read_dir(src).map_err(|e|e.to_string())?{let e=e.map_err(|e|e.to_string())?;let a=e.path();let b=dst.join(e.file_name());if a.is_dir(){copy_dir(&a,&b)?}else{fs::copy(a,b).map_err(|e|e.to_string())?;}}Ok(())}
#[tauri::command]
fn rename_instance(app:tauri::AppHandle,id:String,new_id:String)->Result<String,String>{let src=instances_root(&app)?.join(&id);let clean=slug(&new_id);let dst=instances_root(&app)?.join(&clean);if !src.exists(){return Err("Сборка не найдена".into())}if dst.exists(){return Err("Такая сборка уже существует".into())}fs::rename(src,dst).map_err(|e|e.to_string())?;Ok(clean)}
#[tauri::command]
fn export_instance(app:tauri::AppHandle,id:String,path:String)->Result<(),String>{let src=instances_root(&app)?.join(&id);if !src.exists(){return Err("Сборка не найдена".into())}let file=fs::File::create(path).map_err(|e|e.to_string())?;let mut z=zip::ZipWriter::new(file);let opts=zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);fn add(z:&mut zip::ZipWriter<fs::File>,base:&Path,p:&Path,opts:zip::write::SimpleFileOptions)->Result<(),String>{for e in fs::read_dir(p).map_err(|e|e.to_string())?{let e=e.map_err(|e|e.to_string())?;let q=e.path();let rel=q.strip_prefix(base).map_err(|e|e.to_string())?.to_string_lossy().replace('\\','/');if q.is_dir(){z.add_directory(format!("{}/",rel),opts).map_err(|e|e.to_string())?;add(z,base,&q,opts)?}else{z.start_file(rel,opts).map_err(|e|e.to_string())?;z.write_all(&fs::read(q).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?}}Ok(())}add(&mut z,&src,&src,opts)?;z.finish().map_err(|e|e.to_string())?;Ok(())}
#[tauri::command]
fn repair_instance(app:tauri::AppHandle,id:String,version:String,loader:String)->Result<Value,String>{let vdir=instances_root(&app)?.join(&id).join("game").join("versions").join(&version);if vdir.exists(){for e in fs::read_dir(vdir).map_err(|e|e.to_string())?.flatten(){let n=e.file_name().to_string_lossy().to_string();if n.ends_with(".jar"){let _=fs::remove_file(e.path());}}}install_minecraft(app,id,version,loader)}
fn launch_java_path(path: Option<&str>) -> Option<String> {
    let found = java_from_path(path)?;
    let p = PathBuf::from(&found);

    #[cfg(windows)]
    {
        if p.file_name()
            .and_then(|x| x.to_str())
            .map(|x| x.eq_ignore_ascii_case("javaw.exe"))
            .unwrap_or(false)
        {
            let console = p.with_file_name("java.exe");
            if java_is_usable(&console) {
                return Some(console.to_string_lossy().into_owned());
            }
        }
    }

    Some(found)
}

#[tauri::command]
fn launch_instance(app:tauri::AppHandle,id:String,version:String,username:String,loader:String,java_path:Option<String>,options:Option<LaunchOptions>)->Result<(),String>{
    let instance=instances_root(&app)?.join(&id); if !instance.exists(){return Err("Сборка не найдена".into());}
    let game=instance.join("game"); let vdir=game.join("versions").join(&version);
    let meta_path=vdir.join(format!("{}.json",version));
    if !meta_path.exists(){return Err("Сначала нажми «Скачать Minecraft» для этой сборки".into());}
    let meta:Value=serde_json::from_slice(&fs::read(&meta_path).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    let java=launch_java_path(java_path.as_deref()).ok_or("Java не найдена. Укажи путь к Java в настройках или установи Java 21.")?;
    let assets=meta.get("assetIndex").and_then(|x|x.get("id")).and_then(Value::as_str).unwrap_or("legacy");
    let mut vars=HashMap::new();
    vars.insert("auth_player_name".into(),username.clone());
    vars.insert("version_name".into(),version.clone());
    vars.insert("game_directory".into(),game.to_string_lossy().into());
    vars.insert("assets_root".into(),game.join("assets").to_string_lossy().into());
    vars.insert("assets_index_name".into(),assets.into());
    vars.insert("auth_uuid".into(),"00000000-0000-0000-0000-000000000000".into());
    vars.insert("auth_access_token".into(),"0".into());
    vars.insert("user_type".into(),"legacy".into());
    vars.insert("version_type".into(),meta.get("type").and_then(Value::as_str).unwrap_or("release").into());
    vars.insert("natives_directory".into(),game.join("natives").to_string_lossy().into());
    vars.insert("library_directory".into(),game.join("libraries").to_string_lossy().into());
    vars.insert("classpath_separator".into(),";".into());
    vars.insert("launcher_name".into(),"SakuraLauncher".into());
    vars.insert("launcher_version".into(),"0.9.0".into());
    let mut cp=Vec::new();
    if let Some(arr)=meta.get("libraries").and_then(Value::as_array){ for lib in arr { if !allowed(lib){continue;} if let Some(p)=artifact_path(lib,&game.join("libraries")){if p.exists(){cp.push(p.to_string_lossy().to_string());}} } }
    let mut main_class=meta.get("mainClass").and_then(Value::as_str).unwrap_or("").to_string();
    let mut jvm_args=collect_args(meta.get("arguments").and_then(|x|x.get("jvm")),&vars);
    let mut game_args=collect_args(meta.get("arguments").and_then(|x|x.get("game")),&vars);
    if game_args.is_empty(){if let Some(old)=meta.get("minecraftArguments").and_then(Value::as_str){game_args.extend(old.split_whitespace().map(|s|replace_vars(s,&vars)));}}
    if loader.eq_ignore_ascii_case("fabric") {
        let fp=vdir.join("fabric.json"); if !fp.exists(){return Err("Fabric не установлен. Нажми «Скачать Minecraft» ещё раз.".into());}
        let fm:Value=serde_json::from_slice(&fs::read(fp).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
        if let Some(arr)=fm.get("libraries").and_then(Value::as_array){for lib in arr{if !allowed(lib){continue;} if let Some(p)=artifact_path(lib,&game.join("libraries")){if p.exists(){cp.push(p.to_string_lossy().to_string());}}}}
        main_class=fm.get("mainClass").and_then(Value::as_str).unwrap_or(&main_class).to_string();
        let fj=collect_args(fm.get("arguments").and_then(|x|x.get("jvm")),&vars); let fg=collect_args(fm.get("arguments").and_then(|x|x.get("game")),&vars);
        jvm_args.extend(fj); if !fg.is_empty(){game_args=fg;}
    }
    cp.push(vdir.join(format!("{}.jar",version)).to_string_lossy().to_string());
    if main_class.is_empty(){return Err("mainClass отсутствует в Minecraft metadata".into());}
    let opts=options.unwrap_or_default(); let min_ram=opts.min_ram.unwrap_or(1024).clamp(512,32768); let max_ram=opts.max_ram.unwrap_or(4096).max(min_ram).clamp(512,32768); jvm_args.insert(0,format!("-Xms{}M",min_ram)); jvm_args.insert(1,format!("-Xmx{}M",max_ram)); if let Some(extra)=opts.jvm_args{jvm_args.extend(extra.split_whitespace().map(str::to_string));} if let (Some(w),Some(h))=(opts.width,opts.height){game_args.extend(["--width".into(),w.clamp(640,7680).to_string(),"--height".into(),h.clamp(480,4320).to_string()]);} if opts.fullscreen.unwrap_or(false){game_args.push("--fullscreen".into());} let mut args=Vec::new(); args.extend(jvm_args); args.push("-Djava.library.path=${natives_directory}".replace("${natives_directory}",&vars["natives_directory"])); args.push("-cp".into()); args.push(cp.join(";")); args.push(main_class); args.extend(game_args);
    let _ = app.emit("minecraft-log", json!({"line":format!("[Sakura] Запуск Minecraft {} / {}",version,loader),"stream":"launcher"}));
    let _ = app.emit("minecraft-log", json!({"line":format!("[Sakura] Java: {}",java),"stream":"launcher"}));
    let mut child=Command::new(java).args(args).current_dir(&game).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e|format!("Не удалось запустить Minecraft через Java: {e}"))?; let out=child.stdout.take(); let err=child.stderr.take(); let a=app.clone(); thread::spawn(move||{use std::io::BufRead;if let Some(o)=out{for l in io::BufReader::new(o).lines().flatten(){let _=a.emit("minecraft-log",json!({"line":l,"stream":"stdout"}));}}}); let a=app.clone(); thread::spawn(move||{use std::io::BufRead;if let Some(o)=err{for l in io::BufReader::new(o).lines().flatten(){let _=a.emit("minecraft-log",json!({"line":l,"stream":"stderr"}));}}}); let a=app.clone(); thread::spawn(move||{let code=child.wait().ok().and_then(|s|s.code()).unwrap_or(-1);let _=a.emit("minecraft-exit",json!({"code":code,"crashed":code!=0}));}); Ok(())
}

fn main(){
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![launcher_info,create_instance,list_instance_files,open_instance,install_content,install_mod,install_modpack,install_minecraft,find_java,install_java,duplicate_instance,rename_instance,export_instance,repair_instance,launch_instance])
        .run(tauri::generate_context!()).expect("error while running Sakura Launcher");
}
