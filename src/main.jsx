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
const saveBuilds=(b)=>localStorage.setItem('sakura.builds',JSON.stringify(b));
const defaultSettings={accent:'#f4a0bd',theme:'sakura',particles:true,particleCount:42,particleSpeed:1,particleOpacity:.34,particleSize:1,glow:true,animations:true,javaPath:'',minRam:1024,maxRam:4096,jvmArgs:'',width:1280,height:720,fullscreen:false};
const getSettings=()=>({...defaultSettings,...JSON.parse(localStorage.getItem('sakura.settings')||'{}')});
const appWindow=getCurrentWindow();

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
 const [skin,setSkin]=useState(null);
 const [skinColor,setSkinColor]=useState('#f4a0bd');
 const [skinTool,setSkinTool]=useState('pencil');
 const [skinBrush,setSkinBrush]=useState(1);
 const [skinZoom,setSkinZoom]=useState(7);
 const [skinHistory,setSkinHistory]=useState([]);
 const [skinHistoryIndex,setSkinHistoryIndex]=useState(-1);
 const [settings,setSettings]=useState(getSettings);
 const [download,setDownload]=useState(null);
 const [logs,setLogs]=useState([]); const [logOpen,setLogOpen]=useState(false); const [javaInstalling,setJavaInstalling]=useState(false); const [accounts,setAccounts]=useState(()=>JSON.parse(localStorage.getItem('sakura.accounts')||'[]'));
 const canvasRef=useRef(null);

 useEffect(()=>{if(!profile)return;localStorage.setItem('sakura.profile',JSON.stringify(profile));},[profile]);
 useEffect(()=>saveBuilds(builds),[builds]);
 useEffect(()=>localStorage.setItem('sakura.settings',JSON.stringify(settings)),[settings]); useEffect(()=>localStorage.setItem('sakura.accounts',JSON.stringify(accounts)),[accounts]);
 useEffect(()=>{if(tab==='versions'&&!versions.length)loadVersions();},[tab]);
 useEffect(()=>{
   let unlisten;
   listen('download-progress',e=>setDownload(e.payload)).then(fn=>{unlisten=fn}).catch(()=>{}); let ulog,uexit; listen('minecraft-log',e=>setLogs(x=>[...x,String(e.payload?.line||'')].slice(-5000))).then(fn=>ulog=fn).catch(()=>{}); listen('minecraft-exit',e=>{if(e.payload?.crashed)setStatus('Minecraft завершилась с ошибкой — проверь логи.');}).then(fn=>uexit=fn).catch(()=>{});
   return()=>{if(unlisten)unlisten();if(ulog)ulog();if(uexit)uexit()};
 },[]);

 async function loadVersions(){
   setLoadingVersions(true);setStatus('Получаю реальные версии Minecraft…');
   try{const r=await fetch(MANIFEST);const j=await r.json();setVersions(j.versions||[]);setStatus('')}
   catch(e){setStatus('Не удалось получить список версий Minecraft.')}
   finally{setLoadingVersions(false)}
 }
 async function createBuild(data){
   if(!data.name||!data.version)return;
   setStatus('Создаю сборку…');
   try{
     const loader=normalizeLoader(data.version,data.loader||'Vanilla');
     const created=await invoke('create_instance',{name:data.name,version:data.version,loader});
     const build={...created,loader,mods:[],createdAt:Date.now(),installed:false};
     setBuilds(x=>[...x,build]);setSelected(build);setModal(null);setTab('builds');setStatus('Сборка создана.');
   }catch(e){setStatus(String(e))}
 }
 function normalizeLoader(version,loader){
   if(String(loader||'Vanilla').toLowerCase()!=='fabric')return loader||'Vanilla';
   const parts=String(version||'').split('.').map(Number);
   const major=parts[0]||0;
   const minor=parts[1]||0;
   return major===1&&minor<14?'Vanilla':(loader||'Vanilla');
 }
 async function install(build){
   const effectiveLoader=normalizeLoader(build.version,build.loader);
   const workingBuild=effectiveLoader===build.loader?build:{...build,loader:effectiveLoader};
   if(effectiveLoader!==build.loader){
     setBuilds(xs=>xs.map(x=>x.id===build.id?workingBuild:x));
     setSelected(workingBuild);
   }
   setDownload({phase:'Подготовка',current:`Minecraft ${workingBuild.version} · ${effectiveLoader}`,completed:0,total:0,percent:0});
   setStatus('Подготавливаю загрузку…');
   try{
     await invoke('install_minecraft',{id:workingBuild.id,version:workingBuild.version,loader:effectiveLoader});
     const ready={...workingBuild,installed:true};
     setBuilds(xs=>xs.map(x=>x.id===ready.id?ready:x));
     setSelected(x=>x?.id===ready.id?ready:x);
     setStatus('Minecraft установлена. Теперь можно запускать.');
     return ready;
   }catch(e){
     const message=String(e);
     setStatus(`Ошибка установки: ${message}`);
     throw new Error(message);
   }finally{
     setTimeout(()=>setDownload(null),700);
   }
 }
 async function launch(build){
   if(!profile?.name){setModal('profile');return}
   try{
     let workingBuild=build;
     if(!workingBuild.installed) workingBuild=await install(workingBuild);
     setLogs([]);
     setLogOpen(true);
     setStatus('Запускаю Minecraft…');
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
   }catch(e){
     setLogOpen(true);
     setStatus(`Не удалось запустить Minecraft: ${String(e)}`);
   }
 }
 async function installJava(){try{setJavaInstalling(true);const p=await invoke('install_java');setSettings(x=>({...x,javaPath:p}));setStatus('Java 21 установлена.')}catch(e){setStatus(String(e))}finally{setJavaInstalling(false)}}
 async function repair(build){try{const loader=normalizeLoader(build.version,build.loader||'Vanilla');setDownload({phase:'Проверка',current:'Восстанавливаю файлы Minecraft…',completed:0,total:0,percent:0});await invoke('repair_instance',{id:build.id,version:build.version,loader});const ready={...build,loader,installed:true};setBuilds(xs=>xs.map(x=>x.id===build.id?ready:x));setSelected(x=>x?.id===build.id?ready:x);setStatus('Сборка восстановлена.')}catch(e){setStatus(`Ошибка восстановления: ${String(e)}`)}finally{setTimeout(()=>setDownload(null),700)}}
 async function duplicateBuild(build){const name=prompt('Название копии',build.name+' Copy');if(!name)return;try{const id=await invoke('duplicate_instance',{id:build.id,newId:String(Date.now())+'-'+name});const b={...build,id,name,createdAt:Date.now()};setBuilds(x=>[...x,b]);setSelected(b);setStatus('Сборка скопирована.')}catch(e){setStatus(String(e))}}
 async function renameBuild(build){const name=prompt('Новое название',build.name);if(!name)return;try{const id=await invoke('rename_instance',{id:build.id,newId:String(Date.now())+'-'+name});const b={...build,id,name};setBuilds(x=>x.map(v=>v.id===build.id?b:v));setSelected(b)}catch(e){setStatus(String(e))}}
 async function exportBuild(build){const path=prompt('Путь для ZIP',build.name.replace(/[^A-Za-z0-9_-]/g,'_')+'.zip');if(path)try{await invoke('export_instance',{id:build.id,path});setStatus('Экспорт готов.')}catch(e){setStatus(String(e))}}
 async function configureBuild(build){const ls={...build.launchSettings}; const min=prompt('Минимальная RAM (MB)',ls.minRam??settings.minRam);if(min===null)return;const max=prompt('Максимальная RAM (MB)',ls.maxRam??settings.maxRam);if(max===null)return;const w=prompt('Ширина окна',ls.width??settings.width);if(w===null)return;const h=prompt('Высота окна',ls.height??settings.height);if(h===null)return;const j=prompt('JVM аргументы',ls.jvmArgs??settings.jvmArgs);if(j===null)return;const fs=confirm('Включить полноэкранный режим?');const b={...build,launchSettings:{minRam:Number(min),maxRam:Number(max),width:Number(w),height:Number(h),jvmArgs:j,fullscreen:fs}};setBuilds(x=>x.map(v=>v.id===build.id?b:v));setSelected(b);setStatus('Настройки запуска сохранены для этой сборки.')}
 async function checkUpdates(build){if(!build?.modsMeta?.length){setStatus('Новые установки модов будут отслеживаться для обновлений.');return}let n=0;const meta=[];for(const m of build.modsMeta){try{const u=`${MODRINTH}/project/${m.projectId}/version?loaders=${encodeURIComponent(JSON.stringify([m.loader||'fabric']))}&game_versions=${encodeURIComponent(JSON.stringify([build.version]))}&featured=true`;const vs=await fetch(u).then(r=>r.json());const v=vs?.[0];const file=v?.files?.find(x=>x.primary)||v?.files?.[0];if(v&&file&&v.id!==m.versionId){await invoke('install_content',{id:build.id,url:file.url,filename:file.filename,contentType:'mod'});n++;meta.push({...m,filename:file.filename,versionId:v.id,update:null});}else meta.push({...m,update:null})}catch{meta.push(m)}}const b={...build,modsMeta:meta,mods:meta.map(x=>x.filename)};setBuilds(x=>x.map(v=>v.id===build.id?b:v));setSelected(b);setStatus(n?`Обновлено модов: ${n}`:'Все отслеживаемые моды актуальны.')}
 async function searchMods(){
   if(!modQuery.trim())return;
   setStatus(`Ищу ${modType==='mod'?'моды':modType==='resourcepack'?'ресурспаки':modType==='shader'?'шейдеры':'готовые сборки'} на Modrinth…`);
   try{
     const type=modType==='modpack'?'modpack':modType==='resourcepack'?'resourcepack':modType==='shader'?'shader':'mod'; const facets=JSON.stringify([[`project_type:${type}`],...(type==='mod'?[`categories:${modLoader}`]:[]).map(x=>[x]),...(modVersion?[[`versions:${modVersion}`]]:[])]);
     const u=`${MODRINTH}/search?query=${encodeURIComponent(modQuery)}&facets=${encodeURIComponent(facets)}&limit=24`;
     const r=await fetch(u);const j=await r.json();setMods(j.hits||[]);setStatus('');
   }catch(e){setStatus('Modrinth недоступен.')}
 }
 async function addMod(project){if(!selected)return;try{const target=selected.version;const loader=normalizeLoader(target,selected.loader||modLoader).toLowerCase();const isPack=modType==='modpack';const u=`${MODRINTH}/project/${project.project_id}/version?${isPack?'':`loaders=${encodeURIComponent(JSON.stringify([loader]))}&`}game_versions=${encodeURIComponent(JSON.stringify([target]))}&featured=true`;const vs=await fetch(u).then(r=>r.json());const v=vs?.[0];const file=v?.files?.find(x=>x.primary)||v?.files?.[0];if(!file)throw new Error(`Нет версии ${target} для ${selected.loader||'этого загрузчика'}`);setStatus(`Устанавливаю ${project.title}…`);if(isPack){const result=await invoke('install_modpack',{id:selected.id,url:file.url,filename:file.filename});const b={...selected,version:result.version,loader:result.loader,installed:true};setSelected(b);setBuilds(xs=>xs.map(x=>x.id===selected.id?b:x));setStatus(`${project.title} установлен.`);return}await invoke('install_content',{id:selected.id,url:file.url,filename:file.filename,contentType:modType});const next={...selected,mods:[...new Set([...(selected.mods||[]),file.filename])],modsMeta:[...(selected.modsMeta||[]),{projectId:project.project_id,filename:file.filename,versionId:v.id,loader,gameVersion:target}]};setSelected(next);setBuilds(xs=>xs.map(x=>x.id===selected.id?next:x));setStatus(`${project.title} установлен.`)}catch(e){setStatus(String(e))}}
 function deleteBuild(id){
   if(!confirm('Удалить эту сборку из списка? Файлы Minecraft останутся на диске.'))return;
   setBuilds(x=>x.filter(b=>b.id!==id));if(selected?.id===id)setSelected(null);setStatus('Сборка удалена из списка.');
 }
 function canvasSnapshot(){
   const c=canvasRef.current;
   if(!c)return null;
   return c.getContext('2d').getImageData(0,0,64,64);
 }
 function pushSkinHistory(){
   const snap=canvasSnapshot();
   if(!snap)return;
   setSkinHistory(prev=>[...prev.slice(0,skinHistoryIndex+1),snap].slice(-40));
   setSkinHistoryIndex(i=>Math.min(i+1,39));
 }
 function restoreSkin(index){
   const snap=skinHistory[index];
   const c=canvasRef.current;
   if(!snap||!c)return;
   c.getContext('2d').putImageData(snap,0,0);
   setSkinHistoryIndex(index);
 }
 function undoSkin(){if(skinHistoryIndex>0)restoreSkin(skinHistoryIndex-1)}
 function redoSkin(){if(skinHistoryIndex<skinHistory.length-1)restoreSkin(skinHistoryIndex+1)}
 function drawSkinAt(clientX,clientY){
   const c=canvasRef.current;if(!c)return;
   const rect=c.getBoundingClientRect();
   const x=Math.floor((clientX-rect.left)/rect.width*64);
   const y=Math.floor((clientY-rect.top)/rect.height*64);
   if(x<0||x>63||y<0||y>63)return;
   const ctx=c.getContext('2d');
   if(skinTool==='picker'){
     const p=ctx.getImageData(x,y,1,1).data;
     setSkinColor('#'+[p[0],p[1],p[2]].map(v=>v.toString(16).padStart(2,'0')).join(''));
     setSkinTool('pencil');
     return;
   }
   if(skinTool==='fill'){
     const image=ctx.getImageData(0,0,64,64);
     const data=image.data;
     const idx=(y*64+x)*4;
     const target=[data[idx],data[idx+1],data[idx+2],data[idx+3]];
     const hex=skinColor.replace('#','');
     const fill=[parseInt(hex.slice(0,2),16),parseInt(hex.slice(2,4),16),parseInt(hex.slice(4,6),16),255];
     if(target.every((v,i)=>v===fill[i]))return;
     const stack=[[x,y]];
     const seen=new Uint8Array(4096);
     while(stack.length){
       const [cx,cy]=stack.pop();
       if(cx<0||cy<0||cx>=64||cy>=64)continue;
       const pos=cy*64+cx;if(seen[pos])continue;seen[pos]=1;
       const p=pos*4;if(data[p]!==target[0]||data[p+1]!==target[1]||data[p+2]!==target[2]||data[p+3]!==target[3])continue;
       data[p]=fill[0];data[p+1]=fill[1];data[p+2]=fill[2];data[p+3]=fill[3];
       stack.push([cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]);
     }
     ctx.putImageData(image,0,0);
     pushSkinHistory();
     return;
   }
   const radius=Math.max(1,Number(skinBrush)||1);
   ctx.fillStyle=skinTool==='eraser'?'rgba(0,0,0,0)':skinColor;
   const r=Math.floor(radius/2);
   for(let yy=-r;yy<=r;yy++)for(let xx=-r;xx<=r;xx++){const px=x+xx,py=y+yy;if(px>=0&&py>=0&&px<64&&py<64)ctx.fillRect(px,py,1,1)}
 }
 function paint(e){pushSkinHistory();drawSkinAt(e.clientX,e.clientY)}
 function paintMove(e){if(e.buttons===1)drawSkinAt(e.clientX,e.clientY)}
 function clearSkin(){const c=canvasRef.current;if(!c)return;pushSkinHistory();c.getContext('2d').clearRect(0,0,64,64);setSkin('cleared')}
 function saveSkin(){const c=canvasRef.current;if(!c)return;const a=document.createElement('a');a.href=c.toDataURL('image/png');a.download='sakura-skin.png';a.click()}
 function openSkin(file){const r=new FileReader();r.onload=()=>{const img=new Image();img.onload=()=>{const c=canvasRef.current;if(!c)return;c.width=64;c.height=64;const ctx=c.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.clearRect(0,0,64,64);ctx.drawImage(img,0,0,64,64);setSkin('loaded');setTimeout(()=>{const snap=canvasSnapshot();if(snap){setSkinHistory([snap]);setSkinHistoryIndex(0)}},0)};img.src=r.result};r.readAsDataURL(file)}
 useEffect(()=>{if(tab==='skins'&&canvasRef.current&&!skin){const c=canvasRef.current;c.width=64;c.height=64;const ctx=c.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.clearRect(0,0,64,64);ctx.fillStyle='#c9859d';ctx.fillRect(8,0,8,8);ctx.fillRect(40,0,8,8);ctx.fillStyle='#e9b6c7';ctx.fillRect(8,8,8,8);ctx.fillRect(40,8,8,8);ctx.fillStyle='#8b536a';ctx.fillRect(20,20,8,12);ctx.fillRect(36,20,8,12);setTimeout(()=>{const snap=canvasSnapshot();if(snap){setSkinHistory([snap]);setSkinHistoryIndex(0)}},0)}},[tab,skin]);
 if(!profile)return <Onboarding onDone={setProfile}/>;
 const nav=[['home','⌂','Главная'],['builds','▦','Сборки'],['versions','◈','Версии'],['mods','✦','Моды'],['skins','◇','Скины']];
 const petals=Array.from({length:settings.particles?settings.particleCount:0},(_,i)=>({x:(i*47+13)%100,y:(i*73+7)%100,d:(9+(i%9))/settings.particleSpeed,delay:-i*.61,s:((i%4)+1)*settings.particleSize,r:(i*67)%360}));
 const appStyle={'--accent':settings.accent,'--particle-opacity':settings.particleOpacity,'--particle-size':settings.particleSize};
 return <div className={`app theme-${settings.theme} ${settings.glow?'glow-on':''} ${settings.animations?'animations-on':''}`} style={appStyle}>
   <div className="titlebar" data-tauri-drag-region><div className="titlebarBrand" data-tauri-drag-region>SAKURA</div><div className="windowControls"><button title="Свернуть" onClick={()=>appWindow.minimize()}>−</button><button title="Развернуть" onClick={()=>appWindow.toggleMaximize()}>□</button><button className="closeWin" title="Закрыть" onClick={()=>appWindow.close()}>×</button></div></div>
   <div className="ambient a1"/><div className="ambient a2"/><div className="petals">{petals.map((p,i)=><i key={i} style={{'--x':`${p.x}%`,'--y':`${p.y}%`,'--d':`${p.d}s`,'--delay':`${p.delay}s`,'--s':`${p.s}px`,'--r':`${p.r}deg`}}/>)}</div>
   <aside><div className="brand"><img src={logo} alt="Sakura"/><div><b>SAKURA</b><span>CRAFT LAUNCHER</span></div></div>
    <nav>{nav.map(x=><button key={x[0]} className={tab===x[0]?'active':''} onClick={()=>setTab(x[0])}><em>{x[1]}</em>{x[2]}</button>)}</nav>
    <div className="sidebottom"><button onClick={()=>setModal('settings')}>⚙ Настройки</button><small>v0.9.0 • minecraft core</small></div>
   </aside>
   <main><header><div className="crumb">{nav.find(x=>x[0]===tab)?.[2]||'Сборка'}</div><div className="account" onClick={()=>setModal('profile')}><span className="dot online"/> {profile.name} <b>⌄</b></div></header>
    {tab==='home'&&<Home builds={builds} selected={selected} setSelected={setSelected} launch={launch} setModal={setModal} setTab={setTab} deleteBuild={deleteBuild}/>} 
    {tab==='builds'&&<BuildsPage builds={builds} selected={selected} setSelected={setSelected} setModal={setModal} deleteBuild={deleteBuild} duplicateBuild={duplicateBuild} renameBuild={renameBuild} exportBuild={exportBuild}/>} 
    {tab==='versions'&&<Versions versions={versions} loading={loadingVersions} onCreate={v=>setModal({type:'create',version:v.id})}/>} 
    {tab==='mods'&&<Mods query={modQuery} setQuery={setModQuery} loader={modLoader} setLoader={setModLoader} version={modVersion} setVersion={setModVersion} modType={modType} setModType={setModType} search={searchMods} mods={mods} add={addMod} selected={selected} setTab={setTab}/>} 
    {tab==='skins'&&<SkinEditor canvasRef={canvasRef} paint={paint} paintMove={paintMove} color={skinColor} setColor={setSkinColor} save={saveSkin} open={openSkin} clear={clearSkin} skinTool={skinTool} setSkinTool={setSkinTool} skinBrush={skinBrush} setSkinBrush={setSkinBrush} skinZoom={skinZoom} setSkinZoom={setSkinZoom} undoSkin={undoSkin} redoSkin={redoSkin} canUndo={skinHistoryIndex>0} canRedo={skinHistoryIndex>=0&&skinHistoryIndex<skinHistory.length-1}/>} 
   </main>
   {selected&&<BuildPanel build={selected} close={()=>setSelected(null)} launch={launch} install={install} repair={repair} checkUpdates={checkUpdates} configureBuild={configureBuild} duplicateBuild={duplicateBuild} renameBuild={renameBuild} exportBuild={exportBuild} deleteBuild={deleteBuild} setBuild={b=>{setSelected(b);setBuilds(xs=>xs.map(x=>x.id===b.id?b:x))}}/>} 
   {modal==='settings'&&<SettingsModal settings={settings} setSettings={setSettings} close={()=>setModal(null)} reset={()=>setSettings(defaultSettings)} installJava={installJava} javaInstalling={javaInstalling}/>} 
   {modal==='profile'&&<ProfileModal profile={profile} accounts={accounts} close={()=>setModal(null)} save={p=>{setProfile(p);setAccounts(a=>[...new Set([...a,p.name])]);setModal(null)}} select={n=>{setProfile({name:n});setModal(null)}}/>} 
   {modal?.type==='create'&&<CreateModal initialVersion={modal.version} versions={versions} close={()=>setModal(null)} create={createBuild}/>} 
   {download&&<DownloadOverlay progress={download}/>} {logOpen&&<LogPanel logs={logs} close={()=>setLogOpen(false)}/>} 
   {status&&<div className="toast" onClick={()=>setStatus('')}>{status}</div>}
 </div>
}

function Onboarding({onDone}){const [name,setName]=useState('');return <div className="onboarding"><div className="onboardCard"><img src={logo} alt="Sakura"/><span>SAKURA LAUNCHER</span><h1>Добро пожаловать</h1><p>Придумай локальный ник. Он сохранится на этом компьютере.</p><input autoFocus value={name} onChange={e=>setName(e.target.value.replace(/[^A-Za-z0-9_]/g,'').slice(0,16))} placeholder="Твой ник"/><button disabled={name.length<3} onClick={()=>onDone({name})}>Продолжить</button><small>Автономный профиль не заменяет Microsoft-авторизацию для официальных онлайн-серверов.</small></div></div>}
function Home({builds,selected,setSelected,launch,setModal,setTab,deleteBuild}){return <><section className="hero"><div className="heroCopy"><span className="eyebrow">MINECRAFT JAVA EDITION</span><h1>Твой Minecraft.<br/><strong>Твой мир.</strong></h1><p>Реальные версии, отдельные сборки и моды — в одном месте.</p><div className="heroActions">{selected?<button className="play" onClick={()=>launch(selected)}>▶ ИГРАТЬ</button>:<button className="play" onClick={()=>setModal({type:'create'})}>＋ СОЗДАТЬ СБОРКУ</button>}<button className="ghost" onClick={()=>setTab('builds')}>▦ Все сборки</button></div></div><div className="world blossomWorld"><div className="skyGlow"/><div className="moon"/><span className="star s1"/><span className="star s2"/><span className="star s3"/><div className="hill h1"/><div className="hill h2"/><div className="blossomTree"><div className="trunk"/><div className="branch b1"/><div className="branch b2"/><div className="bloom bloom1"/><div className="bloom bloom2"/><div className="bloom bloom3"/><div className="bloom bloom4"/><div className="bloom bloom5"/></div><div className="groundGlow"/><div className="ground"/></div></section><section className="buildHead"><div><h2>Мои сборки</h2><p>{builds.length?'Все твои независимые Minecraft-инстансы':'Здесь появятся твои сборки'}</p></div><div className="pageTopActions"><button onClick={()=>{const input=document.createElement('input');input.type='file';input.accept='.zip';input.onchange=async()=>{const f=input.files?.[0];if(!f||!f.path)return;const name=prompt('Название',f.name.replace(/\.zip$/i,''));if(!name)return;try{const id=await invoke('import_instance',{path:f.path,newId:String(Date.now())+'-'+name});const b={id,name,version:'Импорт',loader:'Vanilla',mods:[],createdAt:Date.now(),installed:false};setSelected(b);setBuilds(x=>[...x,b]);setStatus('Импортировано.')}catch(e){setStatus(String(e))}};input.click()}}>Импорт ZIP</button><button className="new" onClick={()=>setModal({type:'create'})}>＋ Новая сборка</button></div></section>{builds.length?<div className="builds">{builds.slice(0,6).map(b=><BuildCard key={b.id} build={b} selected={selected} setSelected={setSelected} deleteBuild={deleteBuild}/>)}</div>:<EmptyBuilds onCreate={()=>setModal({type:'create'})}/>}</>}
function BuildsPage({builds,selected,setSelected,setModal,deleteBuild,duplicateBuild,renameBuild,exportBuild}){return <section className="page buildsPage"><div className="pageTop"><div><span className="eyebrow">INSTANCE MANAGER</span><h1>Все сборки</h1><p>Каждая сборка имеет свою папку, моды, конфиги и сохранения.</p></div><div className="pageTopActions"><button onClick={()=>{const input=document.createElement('input');input.type='file';input.accept='.zip';input.onchange=async()=>{const f=input.files?.[0];if(!f||!f.path)return;const name=prompt('Название',f.name.replace(/\.zip$/i,''));if(!name)return;try{const id=await invoke('import_instance',{path:f.path,newId:String(Date.now())+'-'+name});const b={id,name,version:'Импорт',loader:'Vanilla',mods:[],createdAt:Date.now(),installed:false};setSelected(b);setBuilds(x=>[...x,b]);setStatus('Импортировано.')}catch(e){setStatus(String(e))}};input.click()}}>Импорт ZIP</button><button className="new" onClick={()=>setModal({type:'create'})}>＋ Новая сборка</button></div></div>{builds.length?<div className="buildGrid">{builds.map(b=><BuildCard key={b.id} build={b} selected={selected} setSelected={setSelected} deleteBuild={deleteBuild} large/>)}</div>:<EmptyBuilds onCreate={()=>setModal({type:'create'})}/>}</section>}
function BuildCard({build,selected,setSelected,deleteBuild,large=false}){return <article className={`build ${large?'buildLarge':''} ${selected?.id===build.id?'selected':''}`} onClick={()=>setSelected(build)}><div className="cover"><span>{build.loader==='Fabric'?'F':build.loader==='Forge'?'F':'◇'}</span><i/></div><div className="binfo"><div className="buildTitle"><h3>{build.name}</h3><button className="more" onClick={e=>{e.stopPropagation();deleteBuild(build.id)}}>×</button></div><p>{build.version} · {build.loader}</p><div className="meta"><span>{(build.mods||[]).length} модов</span><span className={build.installed?'ok':''}>{build.installed?'установлена':'не установлена'}</span></div></div></article>}
function EmptyBuilds({onCreate}){return <div className="emptyState"><div className="emptyIcon">▦</div><h3>Сборок пока нет</h3><p>Создай первую сборку — она появится здесь и будет жить отдельно от остальных.</p><button className="play small" onClick={onCreate}>＋ Создать сборку</button></div>}
function Versions({versions,loading,onCreate}){const [filter,setFilter]=useState('release');const list=versions.filter(v=>filter==='all'||v.type===filter);return <section className="page"><div className="pageTop"><div><h1>Версии Minecraft</h1><p>Официальный список Mojang.</p></div><button className="reload" onClick={()=>location.reload()}>↻</button></div><div className="filters">{['release','snapshot','old_beta','old_alpha','all'].map(f=><button className={filter===f?'active':''} onClick={()=>setFilter(f)} key={f}>{f==='release'?'Релизы':f==='snapshot'?'Снапшоты':f==='old_beta'?'Beta':f==='old_alpha'?'Alpha':'Все'}</button>)}</div>{loading?<div className="loading">Загружаю версии…</div>:<div className="versionGrid">{list.slice(0,120).map(v=><article className="versionCard" key={v.id}><div><b>{v.id}</b><span>{v.type}</span></div><button onClick={()=>onCreate(v)}>＋ Сборка</button></article>)}</div>}</section>}
function Mods({query,setQuery,loader,setLoader,version,setVersion,modType,setModType,search,mods,add,selected,setTab}){return <section className="page"><div className="pageTop"><div><h1>{modType==='mod'?'Моды':modType==='resourcepack'?'Ресурспаки':modType==='shader'?'Шейдеры':'Готовые сборки'}</h1><p>{modType==='mod'?'Моды':modType==='resourcepack'?'Ресурспаки':modType==='shader'?'Шейдерпаки':'Modrinth-сборки'} — всё ставится только в выбранную сборку.</p></div>{selected&&<span className="targetBuild">Сборка: <b>{selected.name}</b></span>}</div><div className="modTabs">{[['mod','Моды'],['resourcepack','Ресурспаки'],['shader','Шейдеры'],['modpack','Готовые сборки']].map(([id,label])=><button key={id} className={modType===id?'chosen':''} onClick={()=>{setModType(id);setMods([])}}>{label}</button>)}</div><div className="modSearch"><input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==='Enter'&&search()} placeholder="Например: Sodium, Iris, AppleSkin…"/>{modType==='mod'&&<select value={loader} onChange={e=>setLoader(e.target.value)}><option value="fabric">Fabric</option><option value="forge">Forge</option><option value="neoforge">NeoForge</option><option value="quilt">Quilt</option></select>}<input value={version} onChange={e=>setVersion(e.target.value)} placeholder="Версия, напр. 1.21.11"/><button onClick={search}>Искать</button></div>{!selected&&<div className="hint">Сначала выбери сборку. Моды никогда не копируются в другие сборки. <button onClick={()=>setTab('builds')}>Открыть сборки →</button></div>}<div className="modGrid">{mods.map(m=><article className="modCard" key={m.project_id}>{m.icon_url&&<img src={m.icon_url} alt=""/>}<div><h3>{m.title}</h3><p>{m.description}</p><small>↓ {m.downloads.toLocaleString()}</small></div><button disabled={!selected} onClick={()=>add(m)}>{modType==='modpack'?'Добавить сборку':'Установить'}</button></article>)}</div></section>}
function SkinEditor({canvasRef,paint,paintMove,color,setColor,save,open,clear,skinTool,setSkinTool,skinBrush,setSkinBrush,skinZoom,setSkinZoom,undoSkin,redoSkin,canUndo,canRedo}){
 const colors=['#f4a0bd','#ffffff','#16161d','#8d5a6c','#e8b49f','#5b7cfa','#67c58a','#f0d36b','#a66cff','#4b3038','#6f4b36','#d9a066'];
 const tools=[['pencil','Карандаш','✎'],['eraser','Ластик','⌫'],['fill','Заливка','▧'],['picker','Пипетка','◉']];
 return <section className="skinPage"><div className="skinHead"><div><span className="eyebrow">CUSTOMIZATION</span><h1>Skin Studio</h1><p>Полноценный 64×64 редактор: карандаш, ластик, заливка, пипетка, история и масштаб.</p></div><div className="skinActions"><label className="upload">Импорт PNG<input type="file" accept="image/png" onChange={e=>e.target.files[0]&&open(e.target.files[0])}/></label><button onClick={clear}>Новый skin</button><button className="play small" onClick={save}>Экспорт PNG</button></div></div><div className="skinStudio"><div className="skinEditorCard"><div className="skinToolbar"><div className="toolGroup">{tools.map(([id,label,icon])=><button key={id} title={label} className={skinTool===id?'toolActive':''} onClick={()=>setSkinTool(id)}>{icon}<span>{label}</span></button>)}</div><div className="toolGroup compact"><button disabled={!canUndo} onClick={undoSkin}>↶</button><button disabled={!canRedo} onClick={redoSkin}>↷</button></div></div><div className="skinCanvasStage"><div className="skinGrid"><canvas ref={canvasRef} onPointerDown={paint} onPointerMove={paintMove} width="64" height="64" style={{width:`${64*skinZoom}px`,height:`${64*skinZoom}px`}}/></div></div><div className="skinBottom"><label>Размер кисти <select value={skinBrush} onChange={e=>setSkinBrush(Number(e.target.value))}><option value="1">1 px</option><option value="2">2 px</option><option value="3">3 px</option><option value="4">4 px</option></select></label><label>Масштаб <input type="range" min="4" max="12" value={skinZoom} onChange={e=>setSkinZoom(Number(e.target.value))}/><b>{skinZoom}×</b></label></div></div><aside className="skinInspector"><div className="inspectorBlock"><h3>Цвет</h3><div className="palette">{colors.map(c=><button key={c} style={{background:c}} className={color===c?'sel':''} onClick={()=>setColor(c)}/>)}</div><label className="colorPicker"><span>Свой цвет</span><input type="color" value={color} onChange={e=>setColor(e.target.value)}/></label></div><div className="inspectorBlock"><h3>Текстура</h3><div className="skinLayout"><span>Голова</span><span>Тело</span><span>Руки</span><span>Ноги</span></div><p>Импортированный PNG сохраняется без изменения размера и может быть отредактирован по каждому пикселю.</p></div><div className="inspectorBlock"><h3>Слой</h3><div className="layerRow"><button className="chosen">Основной слой</button><button disabled>Верхний слой</button></div></div></aside></div></section>
}
function BuildPanel({build,close,launch,install,repair,checkUpdates,configureBuild,duplicateBuild,renameBuild,exportBuild,deleteBuild,setBuild}){const [files,setFiles]=useState({mods:[]});async function refresh(){try{const d=await invoke('list_instance_files',{id:build.id});setFiles(d);setBuild({...build,mods:(d.mods||[]).map(m=>m.name)})}catch{}}useEffect(()=>{refresh()},[build.id]);return <div className="drawer"><button className="close" onClick={close}>×</button><span className="eyebrow">СБОРКА</span><h1>{build.name}</h1><p className="drawerSub">{build.version} · {build.loader}</p><div className="drawerBadge"><span className={build.installed?'okDot':''}/>{build.installed?'Minecraft установлена':'Minecraft ещё не установлена'}</div><div className="drawerActions"><button className="play small" onClick={()=>launch(build)}>▶ Играть</button><button onClick={()=>install(build)}>{build.installed?'Переустановить':'Скачать Minecraft'}</button><button onClick={()=>repair(build)}>🛠 Repair</button><button onClick={()=>invoke('open_instance',{id:build.id})}>Открыть папку</button></div><div className="drawerActions"><button onClick={()=>duplicateBuild(build)}>Дубликат</button><button onClick={()=>renameBuild(build)}>Переименовать</button><button onClick={()=>exportBuild(build)}>Экспорт</button><button onClick={()=>checkUpdates(build)}>Обновить моды</button><button onClick={()=>configureBuild(build)}>Параметры запуска</button></div><div className="drawerStats"><span><b>{files.mods?.length||0}</b> модов</span><span><b>{files.total_files||0}</b> файлов</span><span><b>{build.installed?'Готово':'—'}</b> состояние</span></div><div className="drawerSectionHead"><h3>Моды этой сборки</h3><button onClick={refresh}>↻</button></div><div className="fileList">{(files.mods||[]).length?files.mods.map(m=><div key={m.name}><span>◆ {m.name}</span><small>{formatBytes(m.size)}</small></div>):<p>Папка mods пока пуста.</p>}</div><h3>Структура</h3><div className="folderChips"><span>mods</span><span>config</span><span>saves</span><span>resourcepacks</span><span>shaderpacks</span><span>logs</span></div><h3>Папка сборки</h3><code>{files.path||build.dir}</code><button className="danger" onClick={()=>deleteBuild(build.id)}>Удалить из лаунчера</button></div>}
function formatBytes(n){if(!n)return '0 KB';if(n<1024*1024)return `${Math.max(1,Math.round(n/1024))} KB`;return `${(n/1024/1024).toFixed(1)} MB`}
function LogPanel({logs,close}){const ref=useRef(null);useEffect(()=>ref.current?.scrollTo(0,ref.current.scrollHeight),[logs]);return <div className="modalShade"><div className="logModal"><button className="close" onClick={close}>×</button><span className="eyebrow">MINECRAFT CONSOLE</span><h2>Логи запуска</h2><pre ref={ref}>{logs.length?logs.map((x,i)=><div key={i}>{x}</div>):'Ожидание вывода Minecraft…'}</pre><div className="settingsBottom"><button onClick={()=>navigator.clipboard?.writeText(logs.join('\n'))}>Скопировать лог</button><button onClick={close}>Закрыть</button></div></div></div>}
function DownloadOverlay({progress}){const pct=Math.max(0,Math.min(100,Number(progress.percent)||0));const determinate=Number(progress.total)>0;return <div className="downloadShade"><div className="downloadCard"><div className="downloadLogo"><img src={logo} alt="Sakura"/></div><span className="eyebrow">SAKURA INSTALLER</span><h2>Устанавливаем Minecraft</h2><p>{progress.phase||'Загрузка'} · {progress.current||'Подготовка файлов…'}</p><div className="progressTrack"><div className="progressBar" style={{width:determinate?`${pct}%`:'35%'}}/></div><div className="progressInfo"><b>{determinate?`${Math.round(pct)}%`:'Подготовка…'}</b><span>{progress.completed||0}{progress.total?` / ${progress.total}`:''} файлов</span></div><small>Окно не зависло — Sakura загружает Minecraft и показывает текущий файл.</small></div></div>}
function CreateModal({initialVersion,versions,close,create}){const [name,setName]=useState('Моя сборка');const [version,setVersion]=useState(initialVersion||versions.find(v=>v.type==='release')?.id||'');const [loader,setLoader]=useState('Vanilla');return <div className="modalShade"><div className="modal"><button className="close" onClick={close}>×</button><span className="eyebrow">НОВАЯ СБОРКА</span><h2>Создать Minecraft instance</h2><p className="modalHint">Это отдельный инстанс: его моды и настройки не смешиваются с другими сборками.</p><input value={name} onChange={e=>setName(e.target.value)} placeholder="Название"/><select value={version} onChange={e=>setVersion(e.target.value)}>{versions.filter(v=>v.type==='release').slice(0,80).map(v=><option key={v.id}>{v.id}</option>)}</select><select value={loader} onChange={e=>setLoader(e.target.value)}><option>Vanilla</option><option>Fabric</option></select><button className="play full" onClick={()=>create({name,version,loader})}>Создать сборку</button></div></div>}
function SettingsModal({settings,setSettings,close,reset,installJava,javaInstalling}){const set=(key,value)=>setSettings(s=>({...s,[key]:value}));return <div className="modalShade"><div className="settingsModal"><button className="close" onClick={close}>×</button><div className="settingsTitle"><div><span className="eyebrow">КАСТОМИЗАЦИЯ</span><h2>Настройки Sakura</h2><p>Меняй внешний вид, частицы и эффекты — всё сохраняется автоматически.</p></div></div><div className="settingsGrid"><section className="settingSection"><h3>Оформление</h3><label>Тема</label><div className="themeChoices">{[['sakura','Sakura'],['midnight','Midnight'],['rose','Rose']].map(([id,label])=><button key={id} className={settings.theme===id?'chosen':''} onClick={()=>set('theme',id)}>{label}</button>)}</div><label>Акцент</label><div className="accentRow"><input type="color" value={settings.accent} onChange={e=>set('accent',e.target.value)}/><input className="accentText" value={settings.accent} onChange={e=>set('accent',e.target.value)}/></div><Toggle label="Свечение интерфейса" value={settings.glow} onChange={v=>set('glow',v)}/><Toggle label="Плавные анимации" value={settings.animations} onChange={v=>set('animations',v)}/></section><section className="settingSection javaSettings"><div className="sectionTitle"><div><h3>Java</h3><p>Версия Java, которую Sakura использует для запуска Minecraft.</p></div><span className="javaBadge">JVM</span></div><label>Путь к Java</label><div className="javaRow"><input className="accentText" value={settings.javaPath} onChange={e=>set('javaPath',e.target.value)} placeholder="Автоопределение"/><button onClick={async()=>{const p=await invoke('find_java');if(p)set('javaPath',p)}}>Автонайти</button><button onClick={installJava} disabled={javaInstalling}>{javaInstalling?'Установка…':'Установить Java 21'}</button></div><p className="javaHint">Можно указать сам javaw.exe или папку JDK. Если оставить пустым, Sakura сама найдёт установленную Java.</p></section><section className="settingSection"><h3>Запуск</h3><div className="twoCols"><label>RAM min<input type="number" min="512" value={settings.minRam} onChange={e=>set("minRam",Number(e.target.value))}/></label><label>RAM max<input type="number" min="1024" value={settings.maxRam} onChange={e=>set("maxRam",Number(e.target.value))}/></label><label>Ширина<input type="number" value={settings.width} onChange={e=>set("width",Number(e.target.value))}/></label><label>Высота<input type="number" value={settings.height} onChange={e=>set("height",Number(e.target.value))}/></label></div><label>JVM аргументы<input className="accentText" value={settings.jvmArgs} onChange={e=>set("jvmArgs",e.target.value)} placeholder="-XX:+UseG1GC"/></label><Toggle label="Полный экран" value={settings.fullscreen} onChange={v=>set("fullscreen",v)}/></section><section className="settingSection particleEditor"><div className="sectionTitle"><div><h3>Редактор частиц</h3><p>Настрой поток лепестков в реальном времени.</p></div><span className="particlePreview">✦</span></div><Toggle label="Включить частицы" value={settings.particles} onChange={v=>set('particles',v)}/><Range label="Количество" value={settings.particleCount} min={8} max={100} step={1} onChange={v=>set('particleCount',v)}/><Range label="Скорость" value={settings.particleSpeed} min={0.3} max={2.5} step={0.1} suffix="×" onChange={v=>set('particleSpeed',v)}/><Range label="Прозрачность" value={settings.particleOpacity} min={0.08} max={0.75} step={0.01} onChange={v=>set('particleOpacity',v)}/><Range label="Размер" value={settings.particleSize} min={0.5} max={2.5} step={0.1} suffix="×" onChange={v=>set('particleSize',v)}/></section></div><div className="settingsBottom"><span>Настройки сохраняются на этом компьютере.</span><div><button className="resetBtn" onClick={reset}>Сбросить</button><button className="play small" onClick={close}>Готово</button></div></div></div></div>}
function Toggle({label,value,onChange}){return <button className={'toggle '+(value?'on':'')} onClick={()=>onChange(!value)}><span>{label}</span><i/></button>}
function Range({label,value,min,max,step,onChange,suffix=''}){return <label className="range"><span><b>{label}</b><em>{value}{suffix}</em></span><input type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(Number(e.target.value))}/></label>}
function ProfileModal({profile,accounts,close,save,select}){const [name,setName]=useState(profile.name);return <div className="modalShade"><div className="modal"><button className="close" onClick={close}>×</button><span className="eyebrow">ПРОФИЛЬ</span><h2>Профили Minecraft</h2><p className="modalHint">Локальные профили. Для серверов с online-mode потребуется Microsoft-авторизация.</p>{accounts.filter(Boolean).map(a=><button key={a} className={a===profile.name?'chosen':''} onClick={()=>select(a)}>{a}</button>)}<input value={name} onChange={e=>setName(e.target.value.replace(/[^A-Za-z0-9_]/g,'').slice(0,16))} placeholder="Новый ник"/><button className="play full" disabled={name.length<3} onClick={()=>save({name})}>Добавить / сохранить</button></div></div>}

createRoot(document.getElementById('root')).render(<App/>);
