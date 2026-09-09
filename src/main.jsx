import React, {useEffect, useMemo, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {getCurrentWindow} from '@tauri-apps/api/window';
import logo from './assets/icon.png';
import './styles.css';

const MANIFEST='https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const MODRINTH='https://api.modrinth.com/v2';
const defaultProfile=()=>JSON.parse(localStorage.getItem('sakura.profile')||'null');
const getBuilds=()=>JSON.parse(localStorage.getItem('sakura.builds')||'[]');
const saveBuilds=(builds)=>localStorage.setItem('sakura.builds',JSON.stringify(builds));
const defaultSettings={
 accent:'#f4a0bd',
 theme:'sakura',
 particles:true,
 particleCount:28,
 particleSpeed:1,
 particleOpacity:.24,
 particleSize:1,
 glow:true,
 animations:true,
 javaPath:'',
 minRam:1024,
 maxRam:4096,
 jvmArgs:'',
 width:1280,
 height:720,
 fullscreen:false,
 rpc:true,
 rpcClientId:''
};
const getSettings=()=>({...defaultSettings,...JSON.parse(localStorage.getItem('sakura.settings')||'{}')});
const appWindow=getCurrentWindow();
const navItems=[
 ['home','⌂','Главная'],
 ['builds','▦','Сборки'],
 ['versions','◈','Версии'],
 ['mods','✦','Контент']
];
const themeOptions=[['sakura','Sakura'],['midnight','Midnight'],['rose','Rose']];
const modTypeLabels={
 mod:'Моды',
 resourcepack:'Ресурспаки',
 shader:'Шейдеры',
 modpack:'Готовые сборки'
};

function App(){
 const [tab,setTab]=useState('home');
 const [profile,setProfile]=useState(defaultProfile());
 const [builds,setBuilds]=useState(getBuilds());
 const [selected,setSelected]=useState(null);
 const [versions,setVersions]=useState([]);
 const [loadingVersions,setLoadingVersions]=useState(false);
 const [modal,setModal]=useState(null);
 const [status,setStatus]=useState('');
 const [mods,setMods]=useState([]);
 const [modQuery,setModQuery]=useState('');
 const [modLoader,setModLoader]=useState('fabric');
 const [modVersion,setModVersion]=useState('');
 const [modType,setModType]=useState('mod');
 const [settings,setSettings]=useState(getSettings);
 const [download,setDownload]=useState(null);
 const [logs,setLogs]=useState([]);
 const [logOpen,setLogOpen]=useState(false);
 const [javaInstalling,setJavaInstalling]=useState(false);
 const [accounts,setAccounts]=useState(()=>JSON.parse(localStorage.getItem('sakura.accounts')||'[]'));

 useEffect(()=>{if(profile)localStorage.setItem('sakura.profile',JSON.stringify(profile));},[profile]);
 useEffect(()=>saveBuilds(builds),[builds]);
 useEffect(()=>localStorage.setItem('sakura.settings',JSON.stringify(settings)),[settings]);
 useEffect(()=>localStorage.setItem('sakura.accounts',JSON.stringify(accounts)),[accounts]);
 useEffect(()=>{
  if(!settings.rpc||!settings.rpcClientId)return;
  invoke('rpc_update',{
   clientId:settings.rpcClientId,
   details:'Sakura Launcher',
   state:profile?.name?`Профиль: ${profile.name}`:'В лаунчере',
   clear:false
  }).catch(()=>{});
 },[settings.rpc,settings.rpcClientId,profile?.name]);
 useEffect(()=>{
  if(tab==='versions'&&!versions.length)loadVersions();
 },[tab,versions.length]);
 useEffect(()=>{
  if(modal?.type==='create'&&!versions.length)loadVersions();
 },[modal,versions.length]);
 useEffect(()=>{
  if(selected&&!builds.some((build)=>build.id===selected.id))setSelected(null);
 },[builds,selected]);
 useEffect(()=>{
  let offProgress;
  let offLog;
  let offExit;
  listen('download-progress',event=>setDownload(event.payload)).then((fn)=>{offProgress=fn}).catch(()=>{});
  listen('minecraft-log',event=>setLogs((prev)=>[...prev,String(event.payload?.line||'')].slice(-5000))).then((fn)=>{offLog=fn}).catch(()=>{});
  listen('minecraft-exit',event=>{
   if(event.payload?.crashed){
    setStatus('Minecraft завершилась с ошибкой — открой логи.');
    setLogOpen(true);
    return;
   }
   setStatus('Minecraft завершена.');
   if(settings.rpc&&settings.rpcClientId){
    invoke('rpc_update',{
     clientId:settings.rpcClientId,
     details:'Sakura Launcher',
     state:profile?.name?`Профиль: ${profile.name}`:'В лаунчере',
     clear:false
    }).catch(()=>{});
   }
  }).then((fn)=>{offExit=fn}).catch(()=>{});
  return()=>{offProgress?.();offLog?.();offExit?.();};
 },[profile?.name,settings.rpc,settings.rpcClientId]);

 const featuredBuild=selected||builds[0]||null;
 const totalMods=useMemo(()=>builds.reduce((sum,build)=>sum+(build.mods?.length||0),0),[builds]);
 const installedCount=useMemo(()=>builds.filter((build)=>build.installed).length,[builds]);
 const petals=useMemo(()=>Array.from({length:settings.particles?settings.particleCount:0},(_,index)=>({
  x:(index*19+7)%100,
  y:(index*29+11)%100,
  d:(10+(index%7))/settings.particleSpeed,
  delay:-index*.85,
  s:(10+(index%4)*4)*settings.particleSize,
  r:(index*57)%360
 })),[settings.particles,settings.particleCount,settings.particleSpeed,settings.particleSize]);

 async function loadVersions(){
  setLoadingVersions(true);
  setStatus('Получаю версии Minecraft…');
  try{
   const response=await fetch(MANIFEST);
   const json=await response.json();
   setVersions(json.versions||[]);
   setStatus('');
  }catch{
   setStatus('Не удалось получить список версий Minecraft.');
  }finally{
   setLoadingVersions(false);
  }
 }

 function normalizeLoader(version,loader){
  if(String(loader||'Vanilla').toLowerCase()!=='fabric')return loader||'Vanilla';
  const [,minor=0]=String(version||'').split('.').map(Number);
  return minor<14?'Vanilla':loader||'Vanilla';
 }

 function syncBuild(nextBuild){
  setSelected(nextBuild);
  setBuilds((current)=>current.map((build)=>build.id===nextBuild.id?nextBuild:build));
 }

 async function createBuild(data){
  if(!data.name||!data.version)return;
  setStatus('Создаю сборку…');
  try{
   const loader=normalizeLoader(data.version,data.loader||'Vanilla');
   const created=await invoke('create_instance',{name:data.name,version:data.version,loader});
   const build={...created,loader,mods:[],createdAt:Date.now(),installed:false};
   setBuilds((current)=>[...current,build]);
   setSelected(build);
   setModal(null);
   setTab('builds');
   setStatus('Сборка создана.');
  }catch(error){
   setStatus(String(error));
  }
 }

 async function install(build){
  const effectiveLoader=normalizeLoader(build.version,build.loader);
  const workingBuild=effectiveLoader===build.loader?build:{...build,loader:effectiveLoader};
  if(effectiveLoader!==build.loader)syncBuild(workingBuild);
  setDownload({
   phase:'Подготовка',
   current:`Minecraft ${workingBuild.version} · ${effectiveLoader}`,
   completed:0,
   total:0,
   percent:0
  });
  setStatus('Подготавливаю загрузку…');
  if(settings.rpc&&settings.rpcClientId){
   invoke('rpc_update',{
    clientId:settings.rpcClientId,
    details:`Скачивает Minecraft ${workingBuild.version}`,
    state:`${workingBuild.loader} · подготовка`,
    clear:false
   }).catch(()=>{});
  }
  try{
   await invoke('install_minecraft',{id:workingBuild.id,version:workingBuild.version,loader:effectiveLoader});
   const ready={...workingBuild,installed:true};
   syncBuild(ready);
   setStatus('Minecraft установлена. Теперь можно запускать.');
   if(settings.rpc&&settings.rpcClientId){
    invoke('rpc_update',{
     clientId:settings.rpcClientId,
     details:`Готовится ${ready.version}`,
     state:`${ready.loader} · готово`,
     clear:false
    }).catch(()=>{});
   }
   return ready;
  }catch(error){
   const message=String(error);
   setStatus(`Ошибка установки: ${message}`);
   throw new Error(message);
  }finally{
   setTimeout(()=>setDownload(null),700);
  }
 }

 async function launch(build){
  if(!profile?.name){
   setModal('profile');
   return;
  }
  try{
   let workingBuild=build;
   if(!workingBuild.installed)workingBuild=await install(workingBuild);
   setLogs([]);
   setLogOpen(true);
   setStatus('Запускаю Minecraft…');
   if(settings.rpc&&settings.rpcClientId){
    invoke('rpc_update',{
     clientId:settings.rpcClientId,
     details:`Minecraft ${workingBuild.version}`,
     state:`Запуск · ${workingBuild.name}`,
     clear:false
    }).catch(()=>{});
   }
   await invoke('launch_instance',{
    id:workingBuild.id,
    version:workingBuild.version,
    username:profile.name,
    loader:normalizeLoader(workingBuild.version,workingBuild.loader),
    javaPath:settings.javaPath||null,
    options:{
     minRam:Number(workingBuild.launchSettings?.minRam??settings.minRam)||1024,
     maxRam:Number(workingBuild.launchSettings?.maxRam??settings.maxRam)||4096,
     jvmArgs:(workingBuild.launchSettings?.jvmArgs??settings.jvmArgs)||'',
     width:Number(workingBuild.launchSettings?.width??settings.width)||1280,
     height:Number(workingBuild.launchSettings?.height??settings.height)||720,
     fullscreen:!!(workingBuild.launchSettings?.fullscreen??settings.fullscreen)
    }
   });
   setStatus('Minecraft запущена.');
  }catch(error){
   setLogOpen(true);
   setStatus(`Не удалось запустить Minecraft: ${String(error)}`);
  }
 }

 async function installJava(){
  try{
   setJavaInstalling(true);
   const javaPath=await invoke('install_java');
   setSettings((current)=>({...current,javaPath}));
   setStatus('Java 21 установлена.');
  }catch(error){
   setStatus(String(error));
  }finally{
   setJavaInstalling(false);
  }
 }

 async function repair(build){
  try{
   await invoke('backup_instance',{id:build.id}).catch(()=>{});
   const loader=normalizeLoader(build.version,build.loader||'Vanilla');
   setDownload({phase:'Проверка',current:'Восстанавливаю файлы Minecraft…',completed:0,total:0,percent:0});
   await invoke('repair_instance',{id:build.id,version:build.version,loader});
   const ready={...build,loader,installed:true};
   syncBuild(ready);
   setStatus('Сборка восстановлена.');
  }catch(error){
   setStatus(`Ошибка восстановления: ${String(error)}`);
  }finally{
   setTimeout(()=>setDownload(null),700);
  }
 }

 async function duplicateBuild(build){
  const name=prompt('Название копии',`${build.name} Copy`);
  if(!name)return;
  try{
   const id=await invoke('duplicate_instance',{id:build.id,newId:`${Date.now()}-${name}`});
   const copy={...build,id,name,createdAt:Date.now()};
   setBuilds((current)=>[...current,copy]);
   setSelected(copy);
   setStatus('Сборка скопирована.');
  }catch(error){
   setStatus(String(error));
  }
 }

 async function renameBuild(build){
  const name=prompt('Новое название',build.name);
  if(!name)return;
  try{
   const id=await invoke('rename_instance',{id:build.id,newId:`${Date.now()}-${name}`});
   const renamed={...build,id,name};
   syncBuild(renamed);
   setStatus('Название обновлено.');
  }catch(error){
   setStatus(String(error));
  }
 }

 async function exportBuild(build){
  const path=prompt('Путь для ZIP',`${build.name.replace(/[^A-Za-z0-9_-]/g,'_')}.zip`);
  if(!path)return;
  try{
   await invoke('export_instance',{id:build.id,path});
   setStatus('Экспорт готов.');
  }catch(error){
   setStatus(String(error));
  }
 }

 async function configureBuild(build){
  const launchSettings={...build.launchSettings};
  const min=prompt('Минимальная RAM (MB)',launchSettings.minRam??settings.minRam);
  if(min===null)return;
  const max=prompt('Максимальная RAM (MB)',launchSettings.maxRam??settings.maxRam);
  if(max===null)return;
  const width=prompt('Ширина окна',launchSettings.width??settings.width);
  if(width===null)return;
  const height=prompt('Высота окна',launchSettings.height??settings.height);
  if(height===null)return;
  const jvmArgs=prompt('JVM аргументы',launchSettings.jvmArgs??settings.jvmArgs);
  if(jvmArgs===null)return;
  const fullscreen=confirm('Включить полноэкранный режим?');
  syncBuild({
   ...build,
   launchSettings:{
    minRam:Number(min),
    maxRam:Number(max),
    width:Number(width),
    height:Number(height),
    jvmArgs,
    fullscreen
   }
  });
  setStatus('Настройки запуска сохранены для этой сборки.');
 }

 async function checkUpdates(build){
  await invoke('backup_instance',{id:build.id}).catch(()=>{});
  if(!build?.modsMeta?.length){
   setStatus('В этой сборке пока нет отслеживаемых модов.');
   return;
  }
  let updatedCount=0;
  const meta=[];
  for(const mod of build.modsMeta){
   try{
    const url=`${MODRINTH}/project/${mod.projectId}/version?loaders=${encodeURIComponent(JSON.stringify([mod.loader||'fabric']))}&game_versions=${encodeURIComponent(JSON.stringify([build.version]))}&featured=true`;
    const versionsList=await fetch(url).then((response)=>response.json());
    const version=versionsList?.[0];
    const file=version?.files?.find((item)=>item.primary)||version?.files?.[0];
    if(version&&file&&version.id!==mod.versionId){
      if(mod.filename)await invoke('remove_content',{id:build.id,filename:mod.filename,contentType:'mod'}).catch(()=>{});
      await invoke('install_content',{id:build.id,url:file.url,filename:file.filename,contentType:'mod'});
      updatedCount++;
      meta.push({...mod,filename:file.filename,versionId:version.id,update:true});
      continue;
    }
    meta.push({...mod,update:false});
   }catch{
    meta.push({...mod,update:false});
   }
  }
  const nextBuild={...build,modsMeta:meta,mods:meta.map((item)=>item.filename)};
  syncBuild(nextBuild);
  setStatus(updatedCount?`Обновлено модов: ${updatedCount}`:'Все отслеживаемые моды актуальны.');
 }

 async function searchMods(){
  if(!modQuery.trim())return;
  setStatus(`Ищу ${modTypeLabels[modType].toLowerCase()} на Modrinth…`);
  try{
   const type=modType==='modpack'?'modpack':modType==='resourcepack'?'resourcepack':modType==='shader'?'shader':'mod';
   const facets=JSON.stringify([
    [`project_type:${type}`],
    ...(type==='mod'?[`categories:${modLoader}`]:[]).map((item)=>[item]),
    ...(modVersion?[[`versions:${modVersion}`]]:[])
   ]);
   const url=`${MODRINTH}/search?query=${encodeURIComponent(modQuery)}&facets=${encodeURIComponent(facets)}&limit=24`;
   const response=await fetch(url);
   const json=await response.json();
   setMods(json.hits||[]);
   setStatus('');
  }catch{
   setStatus('Modrinth недоступен.');
  }
 }

 async function addMod(project){
  if(!selected)return;
  let showDownload=false;
  try{
   const targetVersion=selected.version;
   const loader=normalizeLoader(targetVersion,selected.loader||modLoader).toLowerCase();
   const isPack=modType==='modpack';
   const url=`${MODRINTH}/project/${project.project_id}/version?${isPack?'':`loaders=${encodeURIComponent(JSON.stringify([loader]))}&`}game_versions=${encodeURIComponent(JSON.stringify([targetVersion]))}&featured=true`;
   const versionsList=await fetch(url).then((response)=>response.json());
   const version=versionsList?.[0];
   const file=version?.files?.find((item)=>item.primary)||version?.files?.[0];
   if(!file)throw new Error(`Нет версии ${targetVersion} для ${selected.loader||'этого загрузчика'}`);
   setStatus(`Устанавливаю ${project.title}…`);
   setDownload({phase:isPack?'Modpack':'Контент',current:file.filename,completed:0,total:1,percent:0});
   showDownload=true;
   if(isPack){
    const result=await invoke('install_modpack',{id:selected.id,url:file.url,filename:file.filename});
    const nextBuild={...selected,version:result.version,loader:result.loader,installed:true};
    syncBuild(nextBuild);
    setStatus(`${project.title} установлен.`);
    return;
   }
   await invoke('install_content',{id:selected.id,url:file.url,filename:file.filename,contentType:modType});
   const required=(version.dependencies||[]).filter((dependency)=>dependency.dependency_type==='required');
   for(const dependency of required){
    try{
     const resolved=dependency.version_id?await fetch(`${MODRINTH}/version/${dependency.version_id}`).then((response)=>response.json()):null;
     const depFile=resolved?.files?.find((item)=>item.primary)||resolved?.files?.[0];
     if(depFile)await invoke('install_content',{id:selected.id,url:depFile.url,filename:depFile.filename,contentType:'mod'});
    }catch{}
   }
   const nextBuild={
    ...selected,
    mods:[...new Set([...(selected.mods||[]),file.filename])],
    modsMeta:[...(selected.modsMeta||[]),{projectId:project.project_id,filename:file.filename,versionId:version.id,loader,gameVersion:targetVersion}]
   };
   syncBuild(nextBuild);
   setStatus(`${project.title}${required.length?' и зависимости':''} установлены.`);
  }catch(error){
   setStatus(`Ошибка установки: ${String(error)}`);
  }finally{
   if(showDownload)setTimeout(()=>setDownload(null),350);
  }
 }

 async function backupBuild(build){
  try{
   const path=await invoke('backup_instance',{id:build.id});
   setStatus(`Backup создан: ${path}`);
  }catch(error){
   setStatus(`Backup: ${String(error)}`);
  }
 }

 async function restoreBackup(build){
  const input=document.createElement('input');
  input.type='file';
  input.accept='.zip';
  input.onchange=async()=>{
   const file=input.files?.[0];
   if(!file?.path)return;
   try{
    await invoke('restore_backup',{id:build.id,path:file.path});
    setStatus('Backup восстановлен.');
   }catch(error){
    setStatus(`Восстановление: ${String(error)}`);
   }
  };
  input.click();
 }

 async function discoverInstances(){
  try{
   const result=await invoke('discover_instances');
   if(!result?.length){
    setStatus('Других Minecraft-инстансов не найдено.');
    return;
   }
   setStatus(`Найдено ${result.length} внешних расположений.\n${result.map((item,index)=>`${index+1}. ${item.name} — ${item.path}`).join('\n')}`);
  }catch(error){
   setStatus(String(error));
  }
 }

 async function importFolder(){
  const path=prompt('Полный путь к папке сборки');
  if(!path)return;
  const name=prompt('Название сборки','Импорт');
  if(!name)return;
  try{
   const result=await invoke('import_folder_instance',{path,newId:`${Date.now()}-${name}`});
   const build={id:result.id,name,version:'Импорт',loader:'Vanilla',mods:[],createdAt:Date.now(),installed:false};
   setBuilds((current)=>[...current,build]);
   setSelected(build);
   setTab('builds');
   setStatus('Папка импортирована.');
  }catch(error){
   setStatus(`Импорт: ${String(error)}`);
  }
 }

 async function importZipBuild(){
  const input=document.createElement('input');
  input.type='file';
  input.accept='.zip';
  input.onchange=async()=>{
   const file=input.files?.[0];
   if(!file?.path)return;
   const name=prompt('Название',file.name.replace(/\.zip$/i,''));
   if(!name)return;
   try{
    const id=await invoke('import_instance',{path:file.path,newId:`${Date.now()}-${name}`});
    const build={id,name,version:'Импорт',loader:'Vanilla',mods:[],createdAt:Date.now(),installed:false};
    setBuilds((current)=>[...current,build]);
    setSelected(build);
    setTab('builds');
    setStatus('Импортировано.');
   }catch(error){
    setStatus(String(error));
   }
  };
  input.click();
 }

 async function checkLauncherUpdate(){
  try{
   const result=await invoke('check_launcher_update');
   if(result?.tag&&result.tag!=='v0.12.0'){
    setStatus(`Доступен релиз ${result.tag}.`);
    if(result.url&&confirm(`Доступен ${result.tag}. Открыть страницу релиза?`))await invoke('open_url',{url:result.url});
    return;
   }
   setStatus('Sakura уже актуальна.');
  }catch(error){
   setStatus(`Проверка обновления: ${String(error)}`);
  }
 }

 async function cacheStats(){
  try{
   const result=await invoke('cache_stats');
   setStatus(`Общий кеш: ${formatBytes(result.total)} · библиотеки ${formatBytes(result.libraries)} · ресурсы ${formatBytes(result.assets)} · runtime ${formatBytes(result.runtime)}`);
  }catch(error){
   setStatus(String(error));
  }
 }

 async function fpsBoost(build){
  const loader=String(build.loader||'fabric').toLowerCase();
  const projects=loader==='fabric'||loader==='quilt'?['sodium','lithium','ferritecore','immediatelyfast','entityculling']:['embeddium','modernfix','ferritecore','immediatelyfast','entityculling'];
  let installed=0;
  for(const slug of projects){
   try{
    const url=`${MODRINTH}/project/${slug}/version?loaders=${encodeURIComponent(JSON.stringify([loader]))}&game_versions=${encodeURIComponent(JSON.stringify([build.version]))}&featured=true`;
    const versionsList=await fetch(url).then((response)=>response.json());
    const version=versionsList?.[0];
    const file=version?.files?.find((item)=>item.primary)||version?.files?.[0];
    if(!file)continue;
    await invoke('install_content',{id:build.id,url:file.url,filename:file.filename,contentType:'mod'});
    installed++;
   }catch{}
  }
  setStatus(installed?`FPS Boost: установлено ${installed} оптимизационных модов.`:'Не удалось подобрать оптимизационные моды для этой версии.');
 }

 function deleteBuild(id){
  if(!confirm('Удалить сборку и её файлы? Перед удалением лучше создать backup.'))return;
  invoke('delete_instance',{id}).catch(()=>{});
  setBuilds((current)=>current.filter((build)=>build.id!==id));
  if(selected?.id===id)setSelected(null);
  setStatus('Сборка удалена.');
 }

 if(!profile)return <Onboarding onDone={setProfile}/>;

 return <div
  className={`app theme-${settings.theme} ${settings.glow?'glow-on':''} ${settings.animations?'animations-on':'animations-off'}`}
  style={{'--accent':settings.accent,'--particle-opacity':settings.particleOpacity}}
 >
  <div className="titlebar" data-tauri-drag-region>
   <div className="titlebarBrand" data-tauri-drag-region>SAKURA LAUNCHER</div>
   <div className="windowControls">
    <button title="Свернуть" onClick={()=>appWindow.minimize()}>−</button>
    <button title="Развернуть" onClick={()=>appWindow.toggleMaximize()}>□</button>
    <button className="closeWin" title="Закрыть" onClick={()=>appWindow.close()}>×</button>
   </div>
  </div>
  <div className="backdropGlow glowA"/>
  <div className="backdropGlow glowB"/>
  <div className="petals">
   {petals.map((petal,index)=><i
    key={index}
    style={{'--x':`${petal.x}%`,'--y':`${petal.y}%`,'--d':`${petal.d}s`,'--delay':`${petal.delay}s`,'--s':`${petal.s}px`,'--r':`${petal.r}deg`}}
   />)}
  </div>
  <div className="shell">
   <aside className="sidebar">
    <button className="brand" onClick={()=>setTab('home')}>
     <img src={logo} alt="Sakura"/>
     <div className="brandCopy">
      <strong>Sakura</strong>
      <span>Premium Minecraft launcher</span>
     </div>
    </button>
    <button className="profileCard" onClick={()=>setModal('profile')}>
     <span className="profileAvatar">{profile.name.slice(0,2).toUpperCase()}</span>
     <div>
      <strong>{profile.name}</strong>
      <span>Локальный профиль</span>
     </div>
    </button>
    <nav className="sidebarNav" aria-label="Навигация">
     {navItems.map(([id,icon,label])=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}><em>{icon}</em><span>{label}</span></button>)}
    </nav>
    <section className="sidebarSection">
     <p>Быстрые действия</p>
     <button className="sidebarAction accent" onClick={()=>setModal({type:'create'})}>＋ Новая сборка</button>
     <button className="sidebarAction" onClick={()=>setModal('settings')}>⚙ Настройки</button>
     <button className="sidebarAction" onClick={()=>setLogOpen(true)}>⌁ Логи Minecraft</button>
    </section>
    <div className="sidebarFooter">
     <span>v0.12.0</span>
     <small>{builds.length} сборок · {installedCount} готовы к запуску</small>
    </div>
   </aside>
   <main className="content">
    <header className="topbar">
     <div>
      <span className="eyebrow">{navItems.find(([id])=>id===tab)?.[2]||'Sakura'}</span>
      <h1>{tab==='home'?'Уютный лаунчер без хаоса':tab==='builds'?'Управление инстансами':tab==='versions'?'Официальные версии Minecraft':'Modrinth контент'}</h1>
     </div>
     <div className="topbarActions">
      {featuredBuild&&<button className="chipButton" onClick={()=>setSelected(featuredBuild)}>{featuredBuild.name}</button>}
      <button className="iconButton" title="Профили" onClick={()=>setModal('profile')}>☻</button>
      <button className="iconButton" title="Настройки" onClick={()=>setModal('settings')}>⚙</button>
     </div>
    </header>
    {tab==='home'&&<Home
     builds={builds}
     featuredBuild={featuredBuild}
     totalMods={totalMods}
     installedCount={installedCount}
     selectBuild={(build)=>setSelected(build)}
     launch={launch}
     openCreate={()=>setModal({type:'create'})}
     openSettings={()=>setModal('settings')}
     openBuilds={()=>setTab('builds')}
     discoverInstances={discoverInstances}
     importFolder={importFolder}
     importZipBuild={importZipBuild}
     cacheStats={cacheStats}
    />}
    {tab==='builds'&&<BuildsPage
     builds={builds}
     selected={selected}
     setSelected={setSelected}
     setModal={setModal}
     importZipBuild={importZipBuild}
     deleteBuild={deleteBuild}
     launch={launch}
    />}
    {tab==='versions'&&<Versions versions={versions} loading={loadingVersions} onCreate={(version)=>setModal({type:'create',version:version.id})}/>}
    {tab==='mods'&&<Mods
     query={modQuery}
     setQuery={setModQuery}
     loader={modLoader}
     setLoader={setModLoader}
     version={modVersion}
     setVersion={setModVersion}
     modType={modType}
     setModType={setModType}
     search={searchMods}
     mods={mods}
     setMods={setMods}
     add={addMod}
     selected={selected}
     openBuilds={()=>setTab('builds')}
    />}
   </main>
  </div>
  {selected&&<BuildPanel
   build={selected}
   close={()=>setSelected(null)}
   launch={launch}
   install={install}
   repair={repair}
   checkUpdates={checkUpdates}
   configureBuild={configureBuild}
   duplicateBuild={duplicateBuild}
   renameBuild={renameBuild}
   exportBuild={exportBuild}
   backupBuild={backupBuild}
   restoreBackup={restoreBackup}
   fpsBoost={fpsBoost}
   deleteBuild={deleteBuild}
   setBuild={syncBuild}
  />}
  {modal==='settings'&&<SettingsModal
   profile={profile}
   setStatus={setStatus}
   settings={settings}
   cacheStats={cacheStats}
   discoverInstances={discoverInstances}
   checkLauncherUpdate={checkLauncherUpdate}
   setSettings={setSettings}
   close={()=>setModal(null)}
   reset={()=>setSettings(defaultSettings)}
   installJava={installJava}
   javaInstalling={javaInstalling}
  />}
  {modal==='profile'&&<ProfileModal
   profile={profile}
   accounts={accounts}
   close={()=>setModal(null)}
   save={(nextProfile)=>{
    setProfile(nextProfile);
    setAccounts((current)=>[...new Set([...current,nextProfile.name])]);
    setModal(null);
   }}
   select={(name)=>{
    setProfile({name});
    setModal(null);
   }}
  />}
  {modal?.type==='create'&&<CreateModal initialVersion={modal.version} versions={versions} close={()=>setModal(null)} create={createBuild}/>}
  {download&&<DownloadOverlay progress={download}/>}
  {logOpen&&<LogPanel logs={logs} close={()=>setLogOpen(false)}/>}
  {status&&<div className="toast" onClick={()=>setStatus('')}>{status}</div>}
 </div>;
}

function Onboarding({onDone}){
 const [name,setName]=useState('');
 return <div className="onboarding">
  <div className="onboardCard">
   <img src={logo} alt="Sakura"/>
   <span className="eyebrow">SAKURA LAUNCHER</span>
   <h1>Добро пожаловать в Sakura</h1>
   <p>Создай локальный игровой профиль и начни собирать свои инстансы Minecraft в одном красивом месте.</p>
   <input autoFocus value={name} onChange={(event)=>setName(event.target.value.replace(/[^A-Za-z0-9_]/g,'').slice(0,16))} placeholder="Твой ник"/>
   <button className="primaryButton" disabled={name.length<3} onClick={()=>onDone({name})}>Продолжить</button>
   <small>Локальный профиль не заменяет Microsoft-авторизацию для официальных online-mode серверов.</small>
  </div>
 </div>;
}

function Home({builds,featuredBuild,totalMods,installedCount,selectBuild,launch,openCreate,openSettings,openBuilds,discoverInstances,importFolder,importZipBuild,cacheStats}){
 const latestBuilds=[...builds].sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).slice(0,4);
 return <>
  <section className="heroCard">
   <div className="heroCopy">
    <span className="eyebrow">MINECRAFT JAVA EDITION</span>
    <h2>Приведи лаунчер в порядок и запускай любимые миры без боли.</h2>
    <p>Изолированные сборки, Modrinth, realtime-логи и аккуратный интерфейс, в котором всё лежит по местам.</p>
    <div className="heroActions">
     <button className="primaryButton" onClick={()=>featuredBuild?launch(featuredBuild):openCreate()}>{featuredBuild?'▶ Играть сейчас':'＋ Создать первую сборку'}</button>
     <button className="secondaryButton" onClick={openBuilds}>Открыть менеджер сборок</button>
    </div>
   </div>
   <div className="heroVisual">
    <div className="sceneGlow"/>
    <div className="sceneMoon"/>
    <div className="sceneFog"/>
    <div className="sceneMountain far"/>
    <div className="sceneMountain near"/>
    <div className="sceneLake"/>
    <div className="sceneTower"/>
    <div className="sceneGrass">
     <i/><i/><i/><i/><i/>
    </div>
    <div className="heroSpotlight">
     <span className="statusPill">{featuredBuild?featuredBuild.installed?'Готова к запуску':'Нужна установка':'Новый старт'}</span>
     <strong>{featuredBuild?.name||'Собери идеальный инстанс'}</strong>
     <small>{featuredBuild?`${featuredBuild.version} · ${featuredBuild.loader}`:'Создай отдельную сборку под ванилу, моды или приключение с друзьями.'}</small>
    </div>
   </div>
  </section>
  <section className="statGrid">
   <StatCard label="Сборки" value={builds.length} note="Каждая живёт в своей папке"/>
   <StatCard label="Готовы к игре" value={installedCount} note="Установленные инстансы"/>
   <StatCard label="Моды" value={totalMods} note="Суммарно по всем сборкам"/>
  </section>
  <section className="sectionCard">
   <div className="sectionHead">
    <div>
     <span className="eyebrow">QUICK TOOLS</span>
     <h3>Что хочешь сделать дальше?</h3>
    </div>
   </div>
   <div className="actionGrid">
    <button className="actionTile" onClick={openCreate}><strong>Новая сборка</strong><span>Создай чистый инстанс под нужную версию и загрузчик.</span></button>
    <button className="actionTile" onClick={importZipBuild}><strong>Импорт ZIP</strong><span>Подними архив готовой сборки без ручной возни.</span></button>
    <button className="actionTile" onClick={importFolder}><strong>Импорт папки</strong><span>Подключи существующий Prism, MultiMC или .minecraft профиль.</span></button>
    <button className="actionTile" onClick={discoverInstances}><strong>Поиск инстансов</strong><span>Найди старые расположения Minecraft на компьютере.</span></button>
    <button className="actionTile" onClick={cacheStats}><strong>Кеш Minecraft</strong><span>Проверь, сколько места занимает общий кеш библиотек и runtime.</span></button>
    <button className="actionTile" onClick={openSettings}><strong>Настройки</strong><span>Поменяй тему, Java, RAM, анимации и Discord RPC.</span></button>
   </div>
  </section>
  <section className="sectionCard">
   <div className="sectionHead">
    <div>
     <span className="eyebrow">MY BUILDS</span>
     <h3>Последние инстансы</h3>
    </div>
    <button className="textButton" onClick={openBuilds}>Все сборки →</button>
   </div>
   {latestBuilds.length?<div className="buildGrid">
    {latestBuilds.map((build)=><BuildCard key={build.id} build={build} selected={featuredBuild} setSelected={selectBuild} launch={launch} compact/>)}
   </div>:<EmptyBuilds onCreate={openCreate}/>}
  </section>
 </>;
}

function StatCard({label,value,note}){
 return <article className="statCard">
  <span>{label}</span>
  <strong>{value}</strong>
  <small>{note}</small>
 </article>;
}

function BuildsPage({builds,selected,setSelected,setModal,importZipBuild,deleteBuild,launch}){
 return <section className="sectionCard">
  <div className="sectionHead">
   <div>
    <span className="eyebrow">INSTANCE MANAGER</span>
    <h3>Все сборки</h3>
    <p className="sectionLead">Изолированные инстансы с собственными модами, конфигами, сохранениями и параметрами запуска.</p>
   </div>
   <div className="toolbar">
    <button className="secondaryButton" onClick={importZipBuild}>Импорт ZIP</button>
    <button className="primaryButton" onClick={()=>setModal({type:'create'})}>＋ Новая сборка</button>
   </div>
  </div>
  {builds.length?<div className="buildGrid">
   {builds.map((build)=><BuildCard
    key={build.id}
    build={build}
    selected={selected}
    setSelected={setSelected}
    deleteBuild={deleteBuild}
    launch={launch}
   />)}
  </div>:<EmptyBuilds onCreate={()=>setModal({type:'create'})}/>}
 </section>;
}

function BuildCard({build,selected,setSelected,deleteBuild,launch,compact=false}){
 return <article className={`buildCard ${selected?.id===build.id?'selected':''} ${compact?'compact':''}`} onClick={()=>setSelected(build)}>
  <div className="buildCardTop">
   <div className={`loaderBadge loader-${String(build.loader||'vanilla').toLowerCase()}`}>{loaderShort(build.loader)}</div>
   <button className="iconButton subtle" title="Удалить" onClick={(event)=>{event.stopPropagation();deleteBuild?.(build.id);}}>×</button>
  </div>
  <div className="buildCardBody">
   <strong>{build.name}</strong>
   <p>{build.version} · {build.loader}</p>
  </div>
  <div className="metaRow">
   <span>{(build.mods||[]).length} модов</span>
   <span className={`statusDot ${build.installed?'ready':''}`}>{build.installed?'готова':'не установлена'}</span>
  </div>
  {!compact&&<div className="inlineActions">
   <button className="textButton" onClick={(event)=>{event.stopPropagation();setSelected(build);}}>Открыть</button>
   <button className="textButton accentText" onClick={(event)=>{event.stopPropagation();launch?.(build);}}>Играть</button>
  </div>}
 </article>;
}

function EmptyBuilds({onCreate}){
 return <div className="emptyState">
  <div className="emptyIcon">▦</div>
  <h3>Сборок пока нет</h3>
  <p>Создай первую сборку — и Sakura сразу превратит её в аккуратный отдельный инстанс.</p>
  <button className="primaryButton" onClick={onCreate}>＋ Создать сборку</button>
 </div>;
}

function Versions({versions,loading,onCreate}){
 const [filter,setFilter]=useState('release');
 const list=versions.filter((version)=>filter==='all'||version.type===filter);
 return <section className="sectionCard">
  <div className="sectionHead">
   <div>
    <span className="eyebrow">MOJANG MANIFEST</span>
    <h3>Официальные версии Minecraft</h3>
    <p className="sectionLead">Выбирай чистую базу для новой сборки: релизы, снапшоты и старые ветки.</p>
   </div>
   <button className="secondaryButton" onClick={()=>location.reload()}>↻ Обновить</button>
  </div>
  <div className="filterRow">
   {['release','snapshot','old_beta','old_alpha','all'].map((value)=><button key={value} className={filter===value?'active':''} onClick={()=>setFilter(value)}>{value==='release'?'Релизы':value==='snapshot'?'Снапшоты':value==='old_beta'?'Beta':value==='old_alpha'?'Alpha':'Все'}</button>)}
  </div>
  {loading?<div className="loadingState">Загружаю версии…</div>:<div className="versionGrid">
   {list.slice(0,120).map((version)=><article className="versionCard" key={version.id}>
    <div>
     <strong>{version.id}</strong>
     <span>{version.type}</span>
    </div>
    <button className="primaryButton small" onClick={()=>onCreate(version)}>＋ Сборка</button>
   </article>)}
  </div>}
 </section>;
}

function Mods({query,setQuery,loader,setLoader,version,setVersion,modType,setModType,search,mods,setMods,add,selected,openBuilds}){
 return <section className="sectionCard">
  <div className="sectionHead">
   <div>
    <span className="eyebrow">MODRINTH</span>
    <h3>{modTypeLabels[modType]}</h3>
    <p className="sectionLead">Всё ставится только в выбранную сборку и не размазывается по остальным инстансам.</p>
   </div>
   {selected?<span className="targetPill">Сборка: <b>{selected.name}</b></span>:<button className="secondaryButton" onClick={openBuilds}>Выбрать сборку</button>}
  </div>
  <div className="filterRow">
   {Object.entries(modTypeLabels).map(([id,label])=><button key={id} className={modType===id?'active':''} onClick={()=>{setModType(id);setMods([]);}}>{label}</button>)}
  </div>
  <div className="searchPanel">
   <input value={query} onChange={(event)=>setQuery(event.target.value)} onKeyDown={(event)=>event.key==='Enter'&&search()} placeholder="Например: Sodium, Iris, AppleSkin…"/>
   {modType==='mod'&&<select value={loader} onChange={(event)=>setLoader(event.target.value)}>
    <option value="fabric">Fabric</option>
    <option value="forge">Forge</option>
    <option value="neoforge">NeoForge</option>
    <option value="quilt">Quilt</option>
   </select>}
   <input value={version} onChange={(event)=>setVersion(event.target.value)} placeholder="Версия, напр. 1.21.1"/>
   <button className="primaryButton" onClick={search}>Искать</button>
  </div>
  {!selected&&<div className="hintBanner">Сначала выбери сборку — тогда Sakura будет точно знать, куда ставить контент. <button onClick={openBuilds}>Открыть сборки</button></div>}
  <div className="modGrid">
   {mods.map((mod)=><article className="modCard" key={mod.project_id}>
    {mod.icon_url&&<img src={mod.icon_url} alt=""/>}
    <div className="modCopy">
     <strong>{mod.title}</strong>
     <p>{mod.description}</p>
     <small>↓ {mod.downloads.toLocaleString()}</small>
    </div>
    <button className="primaryButton small" disabled={!selected} onClick={()=>add(mod)}>{modType==='modpack'?'Добавить сборку':'Установить'}</button>
   </article>)}
  </div>
 </section>;
}

function BuildPanel({build,close,launch,install,repair,checkUpdates,configureBuild,duplicateBuild,renameBuild,exportBuild,backupBuild,restoreBackup,fpsBoost,deleteBuild,setBuild}){
 const [files,setFiles]=useState({mods:[]});
 async function refresh(){
  try{
   const data=await invoke('list_instance_files',{id:build.id});
   setFiles(data);
   setBuild({...build,mods:(data.mods||[]).map((mod)=>mod.name)});
  }catch{}
 }
 useEffect(()=>{refresh();},[build.id]);
 return <div className="sheetShade" onClick={close}>
  <aside className="sheet" onClick={(event)=>event.stopPropagation()}>
   <button className="close" onClick={close}>×</button>
   <span className="eyebrow">SELECTED INSTANCE</span>
   <h2>{build.name}</h2>
   <p className="sheetLead">{build.version} · {build.loader}</p>
   <div className="sheetStatus">
    <span className={`statusDot ${build.installed?'ready':''}`}>{build.installed?'Готова к запуску':'Требует установку'}</span>
    <span>{(files.mods||[]).length} модов · {files.total_files||0} файлов</span>
   </div>
   <div className="sheetActions">
    <button className="primaryButton" onClick={()=>launch(build)}>▶ Играть</button>
    <button className="secondaryButton" onClick={()=>install(build)}>{build.installed?'Переустановить':'Скачать Minecraft'}</button>
    <button className="secondaryButton" onClick={()=>invoke('open_instance',{id:build.id})}>Открыть папку</button>
    <button className="secondaryButton" onClick={()=>configureBuild(build)}>Параметры запуска</button>
   </div>
   <div className="panelGrid">
    <section className="panelCard">
     <h3>Обслуживание</h3>
     <div className="listButtons">
      <button onClick={()=>repair(build)}>🛠 Repair</button>
      <button onClick={()=>fpsBoost(build)}>⚡ FPS Boost</button>
      <button onClick={()=>checkUpdates(build)}>Обновить моды</button>
      <button onClick={()=>backupBuild(build)}>Backup</button>
      <button onClick={()=>restoreBackup(build)}>Восстановить</button>
     </div>
    </section>
    <section className="panelCard">
     <h3>Управление</h3>
     <div className="listButtons">
      <button onClick={()=>duplicateBuild(build)}>Дубликат</button>
      <button onClick={()=>renameBuild(build)}>Переименовать</button>
      <button onClick={()=>exportBuild(build)}>Экспорт</button>
      <button className="dangerText" onClick={()=>deleteBuild(build.id)}>Удалить сборку</button>
     </div>
    </section>
   </div>
   <section className="panelCard">
    <div className="sectionHead compact">
     <div>
      <h3>Моды этой сборки</h3>
      <p className="sectionLead">Актуальный список jar-файлов в папке mods.</p>
     </div>
     <button className="iconButton subtle" onClick={refresh}>↻</button>
    </div>
    <div className="fileList">
     {(files.mods||[]).length?(files.mods||[]).map((mod)=><div key={mod.name}><span>{mod.name}</span><small>{formatBytes(mod.size)}</small></div>):<p>Папка mods пока пуста.</p>}
    </div>
   </section>
   <section className="panelCard">
    <h3>Папка инстанса</h3>
    <code>{files.path||build.dir}</code>
   </section>
  </aside>
 </div>;
}

function formatBytes(value){
 if(!value)return '0 KB';
 if(value<1024*1024)return `${Math.max(1,Math.round(value/1024))} KB`;
 return `${(value/1024/1024).toFixed(1)} MB`;
}

function LogPanel({logs,close}){
 const ref=useRef(null);
 useEffect(()=>ref.current?.scrollTo(0,ref.current.scrollHeight),[logs]);
 const safeClose=(event)=>{event?.preventDefault();event?.stopPropagation();close();};
 return <div className="modalShade" onMouseDown={(event)=>event.stopPropagation()}>
  <div className="logModal" onMouseDown={(event)=>event.stopPropagation()}>
   <button type="button" className="close" onClick={safeClose}>×</button>
   <span className="eyebrow">MINECRAFT CONSOLE</span>
   <h2>Логи запуска</h2>
   <pre ref={ref}>{logs.length?logs.map((line,index)=><div key={index}>{line}</div>):'Ожидание вывода Minecraft…'}</pre>
   <div className="modalFooter">
    <button type="button" className="secondaryButton" onClick={()=>navigator.clipboard?.writeText(logs.join('\n'))}>Скопировать лог</button>
    <button type="button" className="primaryButton" onClick={safeClose}>Закрыть</button>
   </div>
  </div>
 </div>;
}

function DownloadOverlay({progress}){
 const percent=Math.max(0,Math.min(100,Number(progress.percent)||0));
 const determinate=Number(progress.total)>0;
 return <div className="downloadShade">
  <div className="downloadCard">
   <div className="downloadLogo"><img src={logo} alt="Sakura"/></div>
   <span className="eyebrow">SAKURA INSTALLER</span>
   <h2>Устанавливаем Minecraft</h2>
   <p>{progress.phase||'Загрузка'} · {progress.current||'Подготовка файлов…'}</p>
   <div className="progressTrack"><div className="progressBar" style={{width:determinate?`${percent}%`:'35%'}}/></div>
   <div className="progressInfo">
    <b>{determinate?`${Math.round(percent)}%`:'Подготовка…'}</b>
    <span>{progress.completed||0}{progress.total?` / ${progress.total}`:''} файлов</span>
   </div>
   <small>Окно не зависло — Sakura продолжает скачивать Minecraft в фоне.</small>
  </div>
 </div>;
}

function CreateModal({initialVersion,versions,close,create}){
 const [name,setName]=useState('Моя сборка');
 const [version,setVersion]=useState(initialVersion||versions.find((item)=>item.type==='release')?.id||'');
 const [loader,setLoader]=useState('Vanilla');
 return <div className="modalShade">
  <div className="modal">
   <button className="close" onClick={close}>×</button>
   <span className="eyebrow">НОВАЯ СБОРКА</span>
   <h2>Создать Minecraft instance</h2>
   <p className="modalHint">Это отдельный инстанс: моды, конфиги и миры не смешиваются с другими сборками.</p>
   <input value={name} onChange={(event)=>setName(event.target.value)} placeholder="Название"/>
   <select value={version} onChange={(event)=>setVersion(event.target.value)}>
    {versions.filter((item)=>item.type==='release').slice(0,80).map((item)=><option key={item.id}>{item.id}</option>)}
   </select>
   <select value={loader} onChange={(event)=>setLoader(event.target.value)}>
    <option>Vanilla</option>
    <option>Fabric</option>
    <option>Quilt</option>
    <option>Forge</option>
    <option>NeoForge</option>
   </select>
   <div className="modalFooter">
    <button className="secondaryButton" onClick={close}>Отмена</button>
    <button className="primaryButton" onClick={()=>create({name,version,loader})}>Создать сборку</button>
   </div>
  </div>
 </div>;
}

function SettingsModal({profile,setStatus,settings,setSettings,close,reset,installJava,javaInstalling,cacheStats,discoverInstances,checkLauncherUpdate}){
 const set=(key,value)=>setSettings((current)=>({...current,[key]:value}));
 return <div className="modalShade">
  <div className="settingsModal">
   <button className="close" onClick={close}>×</button>
   <div className="settingsTitle">
    <span className="eyebrow">CUSTOMIZATION</span>
    <h2>Настройки Sakura</h2>
    <p>Акцент, анимации, Java, память и системные функции — всё в одном месте.</p>
   </div>
   <div className="settingsGrid">
    <section className="panelCard">
     <h3>Оформление</h3>
     <label>Тема</label>
     <div className="themeChoices">
      {themeOptions.map(([id,label])=><button key={id} className={settings.theme===id?'chosen':''} onClick={()=>set('theme',id)}>{label}</button>)}
     </div>
     <label>Акцент</label>
     <div className="accentRow">
      <input type="color" value={settings.accent} onChange={(event)=>set('accent',event.target.value)}/>
      <input className="accentText" value={settings.accent} onChange={(event)=>set('accent',event.target.value)}/>
     </div>
     <Toggle label="Свечение интерфейса" value={settings.glow} onChange={(value)=>set('glow',value)}/>
     <Toggle label="Плавные анимации" value={settings.animations} onChange={(value)=>set('animations',value)}/>
    </section>
    <section className="panelCard">
     <h3>Java</h3>
     <label>Путь к Java</label>
     <div className="javaRow">
      <input className="accentText" value={settings.javaPath} onChange={(event)=>set('javaPath',event.target.value)} placeholder="Автоопределение"/>
      <button className="secondaryButton small" onClick={async()=>{const javaPath=await invoke('find_java');if(javaPath)set('javaPath',javaPath);}}>Автонайти</button>
      <button className="primaryButton small" onClick={installJava} disabled={javaInstalling}>{javaInstalling?'Установка…':'Установить Java 21'}</button>
     </div>
     <p className="sectionLead">Можно указать javaw.exe или папку JDK. Если оставить пустым, Sakura сама найдёт подходящую Java.</p>
    </section>
    <section className="panelCard">
     <h3>Запуск</h3>
     <div className="twoCols">
      <label>RAM min<input type="number" min="512" value={settings.minRam} onChange={(event)=>set('minRam',Number(event.target.value))}/></label>
      <label>RAM max<input type="number" min="1024" value={settings.maxRam} onChange={(event)=>set('maxRam',Number(event.target.value))}/></label>
      <label>Ширина<input type="number" value={settings.width} onChange={(event)=>set('width',Number(event.target.value))}/></label>
      <label>Высота<input type="number" value={settings.height} onChange={(event)=>set('height',Number(event.target.value))}/></label>
     </div>
     <label>JVM аргументы</label>
     <input className="accentText" value={settings.jvmArgs} onChange={(event)=>set('jvmArgs',event.target.value)} placeholder="-XX:+UseG1GC"/>
     <Toggle label="Полный экран" value={settings.fullscreen} onChange={(value)=>set('fullscreen',value)}/>
    </section>
    <section className="panelCard">
     <h3>Discord RPC</h3>
     <Toggle label="Включить Rich Presence" value={settings.rpc} onChange={(value)=>set('rpc',value)}/>
     <label>Discord Application ID</label>
     <input className="accentText" value={settings.rpcClientId} onChange={(event)=>set('rpcClientId',event.target.value.trim())} placeholder="Вставь Client ID приложения Discord"/>
     <button className="secondaryButton" onClick={()=>{
      if(!settings.rpcClientId)return;
      invoke('rpc_update',{
       clientId:settings.rpcClientId,
       details:'Sakura Launcher',
       state:profile?.name?`Профиль: ${profile.name}`:'В лаунчере',
       clear:false
      }).then(()=>setStatus('Discord RPC подключён.')).catch((error)=>setStatus(String(error)));
     }}>Проверить RPC</button>
    </section>
    <section className="panelCard">
     <h3>Частицы</h3>
     <Toggle label="Включить частицы" value={settings.particles} onChange={(value)=>set('particles',value)}/>
     <Range label="Количество" value={settings.particleCount} min={8} max={80} step={1} onChange={(value)=>set('particleCount',value)}/>
     <Range label="Скорость" value={settings.particleSpeed} min={0.3} max={2.5} step={0.1} suffix="×" onChange={(value)=>set('particleSpeed',value)}/>
     <Range label="Прозрачность" value={settings.particleOpacity} min={0.08} max={0.6} step={0.01} onChange={(value)=>set('particleOpacity',value)}/>
     <Range label="Размер" value={settings.particleSize} min={0.5} max={2.5} step={0.1} suffix="×" onChange={(value)=>set('particleSize',value)}/>
    </section>
    <section className="panelCard wide">
     <h3>Система лаунчера</h3>
     <div className="actionGrid compact">
      <button className="actionTile" onClick={cacheStats}><strong>Размер кеша</strong><span>Посмотреть общий объём libraries, assets и runtime.</span></button>
      <button className="actionTile" onClick={discoverInstances}><strong>Найти внешние инстансы</strong><span>Поиск старых .minecraft, Prism и MultiMC профилей.</span></button>
      <button className="actionTile" onClick={checkLauncherUpdate}><strong>Проверить обновление</strong><span>Узнать, доступен ли новый релиз Sakura Launcher.</span></button>
     </div>
    </section>
   </div>
   <div className="modalFooter">
    <button className="secondaryButton" onClick={reset}>Сбросить</button>
    <button className="primaryButton" onClick={close}>Готово</button>
   </div>
  </div>
 </div>;
}

function Toggle({label,value,onChange}){
 return <button className={`toggle ${value?'on':''}`} onClick={()=>onChange(!value)}>
  <span>{label}</span>
  <i/>
 </button>;
}

function Range({label,value,min,max,step,onChange,suffix=''}){return <label className="range"><span><b>{label}</b><em>{value}{suffix}</em></span><input type="range" min={min} max={max} step={step} value={value} onChange={(event)=>onChange(Number(event.target.value))}/></label>;}

function ProfileModal({profile,accounts,close,save,select}){
 const [name,setName]=useState(profile.name);
 return <div className="modalShade">
  <div className="modal">
   <button className="close" onClick={close}>×</button>
   <span className="eyebrow">ПРОФИЛЬ</span>
   <h2>Профили Minecraft</h2>
   <p className="modalHint">Локальные профили. Для серверов с online-mode потребуется Microsoft-авторизация.</p>
   <div className="profileList">
    {accounts.filter(Boolean).map((account)=><button key={account} className={account===profile.name?'chosen':''} onClick={()=>select(account)}>{account}</button>)}
   </div>
   <input value={name} onChange={(event)=>setName(event.target.value.replace(/[^A-Za-z0-9_]/g,'').slice(0,16))} placeholder="Новый ник"/>
   <div className="modalFooter">
    <button className="secondaryButton" onClick={close}>Отмена</button>
    <button className="primaryButton" disabled={name.length<3} onClick={()=>save({name})}>Добавить / сохранить</button>
   </div>
  </div>
 </div>;
}

function loaderShort(loader){
 const value=String(loader||'Vanilla').toLowerCase();
 if(value==='fabric')return 'FB';
 if(value==='forge')return 'FG';
 if(value==='neoforge')return 'NF';
 if(value==='quilt')return 'QL';
 return 'VN';
}

createRoot(document.getElementById('root')).render(<App/>);
