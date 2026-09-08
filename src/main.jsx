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
const defaultSettings={accent:'#f4a0bd',theme:'sakura',particles:true,particleCount:42,particleSpeed:1,particleOpacity:.34,particleSize:1,glow:true,animations:true,javaPath:''};
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
 const [skin,setSkin]=useState(null);
 const [skinColor,setSkinColor]=useState('#f4a0bd');
 const [settings,setSettings]=useState(getSettings);
 const [download,setDownload]=useState(null);
 const canvasRef=useRef(null);

 useEffect(()=>{if(!profile)return;localStorage.setItem('sakura.profile',JSON.stringify(profile));},[profile]);
 useEffect(()=>saveBuilds(builds),[builds]);
 useEffect(()=>localStorage.setItem('sakura.settings',JSON.stringify(settings)),[settings]);
 useEffect(()=>{if(tab==='versions'&&!versions.length)loadVersions();},[tab]);
 useEffect(()=>{
   let unlisten;
   listen('download-progress',e=>setDownload(e.payload)).then(fn=>{unlisten=fn}).catch(()=>{});
   return()=>{if(unlisten)unlisten()};
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
     const created=await invoke('create_instance',{name:data.name,version:data.version,loader:data.loader||'Vanilla'});
     const build={...created,mods:[],createdAt:Date.now(),installed:false};
     setBuilds(x=>[...x,build]);setSelected(build);setModal(null);setTab('builds');setStatus('Сборка создана.');
   }catch(e){setStatus(String(e))}
 }
 async function install(build){
   setDownload({phase:'Подготовка',current:'Проверяю файлы Minecraft…',completed:0,total:0,percent:0});
   setStatus('Подготавливаю загрузку…');
   try{
     await invoke('install_minecraft',{id:build.id,version:build.version,loader:build.loader||'Vanilla'});
     setBuilds(xs=>xs.map(x=>x.id===build.id?{...x,installed:true}:x));
     setStatus('Minecraft установлена. Теперь можно запускать.');
   }catch(e){setStatus(String(e))}
   finally{setTimeout(()=>setDownload(null),700)}
 }
 async function launch(build){
   if(!profile?.name){setModal('profile');return}
   try{
     if(!build.installed){await install(build)}
     setStatus('Запускаю Minecraft…');
     await invoke('launch_instance',{id:build.id,version:build.version,username:profile.name,loader:build.loader||'Vanilla',javaPath:settings.javaPath||null});
     setStatus('Minecraft запущена.');
   }catch(e){setStatus(String(e))}
 }
 async function searchMods(){
   if(!modQuery.trim())return;
   setStatus('Ищу моды на Modrinth…');
   try{
     const facets=JSON.stringify([[`project_type:mod`],[`categories:${modLoader}`],...(modVersion?[[`versions:${modVersion}`]]:[])]);
     const u=`${MODRINTH}/search?query=${encodeURIComponent(modQuery)}&facets=${encodeURIComponent(facets)}&limit=24`;
     const r=await fetch(u);const j=await r.json();setMods(j.hits||[]);setStatus('');
   }catch(e){setStatus('Modrinth недоступен.')}
 }
 async function addMod(project){
   if(!selected)return;
   try{
     const u=`${MODRINTH}/project/${project.project_id}/version?loaders=${encodeURIComponent(JSON.stringify([modLoader]))}${modVersion?`&game_versions=${encodeURIComponent(JSON.stringify([modVersion]))}`:''}&featured=true`;
     const r=await fetch(u);const vs=await r.json();const v=vs[0];const file=v?.files?.find(x=>x.primary)||v?.files?.[0];
     if(!file)throw new Error('У мода нет подходящего .jar');
     setStatus(`Устанавливаю ${project.title}…`);await invoke('install_mod',{id:selected.id,url:file.url,filename:file.filename});
     const nextMods=[...(selected.mods||[]),file.filename];
     const next={...selected,mods:[...new Set(nextMods)]};setSelected(next);setBuilds(xs=>xs.map(x=>x.id===selected.id?next:x));setStatus(`${project.title} установлен.`);
   }catch(e){setStatus(String(e))}
 }
 function deleteBuild(id){
   if(!confirm('Удалить эту сборку из списка? Файлы Minecraft останутся на диске.'))return;
   setBuilds(x=>x.filter(b=>b.id!==id));if(selected?.id===id)setSelected(null);setStatus('Сборка удалена из списка.');
 }
 function saveSkin(){const c=canvasRef.current;if(!c)return;const a=document.createElement('a');a.href=c.toDataURL('image/png');a.download='sakura-skin.png';a.click()}
 function openSkin(file){const r=new FileReader();r.onload=()=>{const img=new Image();img.onload=()=>{const c=canvasRef.current;c.width=64;c.height=64;const ctx=c.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.clearRect(0,0,64,64);ctx.drawImage(img,0,0,64,64);setSkin('loaded')};img.src=r.result};r.readAsDataURL(file)}
 function paint(e){const c=canvasRef.current;if(!c)return;const rect=c.getBoundingClientRect();const x=Math.floor((e.clientX-rect.left)/rect.width*64),y=Math.floor((e.clientY-rect.top)/rect.height*64);if(x<0||x>63||y<0||y>63)return;const ctx=c.getContext('2d');ctx.fillStyle=skinColor;ctx.fillRect(x,y,1,1)}
 function clearSkin(){const c=canvasRef.current;if(!c)return;const ctx=c.getContext('2d');ctx.clearRect(0,0,64,64);setSkin('cleared')}
 useEffect(()=>{if(tab==='skins'&&canvasRef.current&&!skin){const c=canvasRef.current;c.width=64;c.height=64;const ctx=c.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.clearRect(0,0,64,64);ctx.fillStyle='#c9859d';ctx.fillRect(8,0,8,8);ctx.fillRect(40,0,8,8);ctx.fillStyle='#e9b6c7';ctx.fillRect(8,8,8,8);ctx.fillRect(40,8,8,8);ctx.fillStyle='#8b536a';ctx.fillRect(20,20,8,12);ctx.fillRect(36,20,8,12)}},[tab,skin]);
 if(!profile)return <Onboarding onDone={setProfile}/>;
 const nav=[['home','⌂','Главная'],['builds','▦','Сборки'],['versions','◈','Версии'],['mods','✦','Моды'],['skins','◇','Скины']];
 const petals=Array.from({length:settings.particles?settings.particleCount:0},(_,i)=>({x:(i*47+13)%100,y:(i*73+7)%100,d:(9+(i%9))/settings.particleSpeed,delay:-i*.61,s:((i%4)+1)*settings.particleSize,r:(i*67)%360}));
 const appStyle={'--accent':settings.accent,'--particle-opacity':settings.particleOpacity,'--particle-size':settings.particleSize};
 return <div className={`app theme-${settings.theme} ${settings.glow?'glow-on':''} ${settings.animations?'animations-on':''}`} style={appStyle}>
   <div className="titlebar" data-tauri-drag-region><div className="titlebarBrand" data-tauri-drag-region>SAKURA</div><div className="windowControls"><button title="Свернуть" onClick={()=>appWindow.minimize()}>−</button><button title="Развернуть" onClick={()=>appWindow.toggleMaximize()}>□</button><button className="closeWin" title="Закрыть" onClick={()=>appWindow.close()}>×</button></div></div>
   <div className="ambient a1"/><div className="ambient a2"/><div className="petals">{petals.map((p,i)=><i key={i} style={{'--x':`${p.x}%`,'--y':`${p.y}%`,'--d':`${p.d}s`,'--delay':`${p.delay}s`,'--s':`${p.s}px`,'--r':`${p.r}deg`}}/>)}</div>
   <aside><div className="brand"><img src={logo} alt="Sakura"/><div><b>SAKURA</b><span>CRAFT LAUNCHER</span></div></div>
    <nav>{nav.map(x=><button key={x[0]} className={tab===x[0]?'active':''} onClick={()=>setTab(x[0])}><em>{x[1]}</em>{x[2]}</button>)}</nav>
    <div className="sidebottom"><button onClick={()=>setModal('settings')}>⚙ Настройки</button><small>v0.5.0 • minecraft core</small></div>
   </aside>
   <main><header><div className="crumb">{nav.find(x=>x[0]===tab)?.[2]||'Сборка'}</div><div className="account" onClick={()=>setModal('profile')}><span className="dot online"/> {profile.name} <b>⌄</b></div></header>
    {tab==='home'&&<Home builds={builds} selected={selected} setSelected={setSelected} launch={launch} setModal={setModal} setTab={setTab} deleteBuild={deleteBuild}/>} 
    {tab==='builds'&&<BuildsPage builds={builds} selected={selected} setSelected={setSelected} setModal={setModal} deleteBuild={deleteBuild}/>} 
    {tab==='versions'&&<Versions versions={versions} loading={loadingVersions} onCreate={v=>setModal({type:'create',version:v.id})}/>} 
    {tab==='mods'&&<Mods query={modQuery} setQuery={setModQuery} loader={modLoader} setLoader={setModLoader} version={modVersion} setVersion={setModVersion} search={searchMods} mods={mods} add={addMod} selected={selected} setTab={setTab}/>} 
    {tab==='skins'&&<SkinEditor canvasRef={canvasRef} paint={paint} color={skinColor} setColor={setSkinColor} save={saveSkin} open={openSkin} clear={clearSkin}/>} 
   </main>
   {selected&&<BuildPanel build={selected} close={()=>setSelected(null)} launch={launch} install={install} deleteBuild={deleteBuild} setBuild={setSelected}/>} 
   {modal==='settings'&&<SettingsModal settings={settings} setSettings={setSettings} close={()=>setModal(null)} reset={()=>setSettings(defaultSettings)}/>} 
   {modal==='profile'&&<ProfileModal profile={profile} close={()=>setModal(null)} save={p=>{setProfile(p);setModal(null)}}/>} 
   {modal?.type==='create'&&<CreateModal initialVersion={modal.version} versions={versions} close={()=>setModal(null)} create={createBuild}/>} 
   {download&&<DownloadOverlay progress={download}/>} 
   {status&&<div className="toast" onClick={()=>setStatus('')}>{status}</div>}
 </div>
}

function Onboarding({onDone}){const [name,setName]=useState('');return <div className="onboarding"><div className="onboardCard"><img src={logo} alt="Sakura"/><span>SAKURA LAUNCHER</span><h1>Добро пожаловать</h1><p>Придумай локальный ник. Он сохранится на этом компьютере.</p><input autoFocus value={name} onChange={e=>setName(e.target.value.replace(/[^A-Za-z0-9_]/g,'').slice(0,16))} placeholder="Твой ник"/><button disabled={name.length<3} onClick={()=>onDone({name})}>Продолжить</button><small>Автономный профиль не заменяет Microsoft-авторизацию для официальных онлайн-серверов.</small></div></div>}
function Home({builds,selected,setSelected,launch,setModal,setTab,deleteBuild}){return <><section className="hero"><div className="heroCopy"><span className="eyebrow">MINECRAFT JAVA EDITION</span><h1>Твой Minecraft.<br/><strong>Твой мир.</strong></h1><p>Реальные версии, отдельные сборки и моды — в одном месте.</p><div className="heroActions">{selected?<button className="play" onClick={()=>launch(selected)}>▶ ИГРАТЬ</button>:<button className="play" onClick={()=>setModal({type:'create'})}>＋ СОЗДАТЬ СБОРКУ</button>}<button className="ghost" onClick={()=>setTab('builds')}>▦ Все сборки</button></div></div><div className="world"><div className="skyGlow"/><div className="moon"/><div className="star s1"/><div className="star s2"/><div className="star s3"/><div className="hill h1"/><div className="hill h2"/><div className="blossomTree"><div className="trunk"/><div className="branch b1"/><div className="branch b2"/><div className="bloom bloom1"/><div className="bloom bloom2"/><div className="bloom bloom3"/><div className="bloom bloom4"/><div className="bloom bloom5"/></div><div className="groundGlow"/><div className="ground"/></div></section><section className="buildHead"><div><h2>Мои сборки</h2><p>{builds.length?'Все твои независимые Minecraft-инстансы':'Здесь появятся твои сборки'}</p></div><button className="new" onClick={()=>setModal({type:'create'})}>＋ Новая сборка</button></section>{builds.length?<div className="builds">{builds.slice(0,6).map(b=><BuildCard key={b.id} build={b} selected={selected} setSelected={setSelected} deleteBuild={deleteBuild}/>)}</div>:<EmptyBuilds onCreate={()=>setModal({type:'create'})}/>}</>}
function BuildsPage({builds,selected,setSelected,setModal,deleteBuild}){return <section className="page buildsPage"><div className="pageTop"><div><span className="eyebrow">INSTANCE MANAGER</span><h1>Все сборки</h1><p>Каждая сборка имеет свою папку, моды, конфиги и сохранения.</p></div><button className="new" onClick={()=>setModal({type:'create'})}>＋ Новая сборка</button></div>{builds.length?<div className="buildGrid">{builds.map(b=><BuildCard key={b.id} build={b} selected={selected} setSelected={setSelected} deleteBuild={deleteBuild} large/>)}</div>:<EmptyBuilds onCreate={()=>setModal({type:'create'})}/>}</section>}
function BuildCard({build,selected,setSelected,deleteBuild,large=false}){return <article className={`build ${large?'buildLarge':''} ${selected?.id===build.id?'selected':''}`} onClick={()=>setSelected(build)}><div className="cover"><span>{build.loader==='Fabric'?'F':build.loader==='Forge'?'F':'◇'}</span><i/></div><div className="binfo"><div className="buildTitle"><h3>{build.name}</h3><button className="more" onClick={e=>{e.stopPropagation();deleteBuild(build.id)}}>×</button></div><p>{build.version} · {build.loader}</p><div className="meta"><span>{(build.mods||[]).length} модов</span><span className={build.installed?'ok':''}>{build.installed?'установлена':'не установлена'}</span></div></div></article>}
function EmptyBuilds({onCreate}){return <div className="emptyState"><div className="emptyIcon">▦</div><h3>Сборок пока нет</h3><p>Создай первую сборку — она появится здесь и будет жить отдельно от остальных.</p><button className="play small" onClick={onCreate}>＋ Создать сборку</button></div>}
function Versions({versions,loading,onCreate}){const [filter,setFilter]=useState('release');const list=versions.filter(v=>filter==='all'||v.type===filter);return <section className="page"><div className="pageTop"><div><h1>Версии Minecraft</h1><p>Официальный список Mojang.</p></div><button className="reload" onClick={()=>location.reload()}>↻</button></div><div className="filters">{['release','snapshot','old_beta','old_alpha','all'].map(f=><button className={filter===f?'active':''} onClick={()=>setFilter(f)} key={f}>{f==='release'?'Релизы':f==='snapshot'?'Снапшоты':f==='old_beta'?'Beta':f==='old_alpha'?'Alpha':'Все'}</button>)}</div>{loading?<div className="loading">Загружаю версии…</div>:<div className="versionGrid">{list.slice(0,120).map(v=><article className="versionCard" key={v.id}><div><b>{v.id}</b><span>{v.type}</span></div><button onClick={()=>onCreate(v)}>＋ Сборка</button></article>)}</div>}</section>}
function Mods({query,setQuery,loader,setLoader,version,setVersion,search,mods,add,selected,setTab}){return <section className="page"><div className="pageTop"><div><h1>Моды</h1><p>Поиск и установка .jar напрямую в выбранную сборку.</p></div>{selected&&<span className="targetBuild">Сборка: <b>{selected.name}</b></span>}</div><div className="modSearch"><input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==='Enter'&&search()} placeholder="Например: Sodium, Iris, AppleSkin…"/><select value={loader} onChange={e=>setLoader(e.target.value)}><option value="fabric">Fabric</option><option value="forge">Forge</option><option value="neoforge">NeoForge</option><option value="quilt">Quilt</option></select><input value={version} onChange={e=>setVersion(e.target.value)} placeholder="Версия, напр. 1.21.11"/><button onClick={search}>Искать</button></div>{!selected&&<div className="hint">Сначала выбери сборку. Моды никогда не копируются в другие сборки. <button onClick={()=>setTab('builds')}>Открыть сборки →</button></div>}<div className="modGrid">{mods.map(m=><article className="modCard" key={m.project_id}>{m.icon_url&&<img src={m.icon_url} alt=""/>}<div><h3>{m.title}</h3><p>{m.description}</p><small>↓ {m.downloads.toLocaleString()}</small></div><button disabled={!selected} onClick={()=>add(m)}>Установить</button></article>)}</div></section>}
function SkinEditor({canvasRef,paint,color,setColor,save,open,clear}){const colors=['#f4a0bd','#ffffff','#16161d','#8d5a6c','#e8b49f','#5b7cfa','#67c58a','#f0d36b','#a66cff','#4b3038'];return <section className="skinPage"><div className="skinHead"><div><span className="eyebrow">CUSTOMIZATION</span><h1>Skin Studio</h1><p>Простой пиксельный редактор Minecraft skin с импортом PNG.</p></div><div className="skinActions"><label className="upload">Загрузить PNG<input type="file" accept="image/png" onChange={e=>e.target.files[0]&&open(e.target.files[0])}/></label><button onClick={clear}>Очистить</button><button className="play small" onClick={save}>Скачать skin</button></div></div><div className="skinWorkspace"><div className="skinCanvasWrap"><div className="canvasGlow"/><canvas ref={canvasRef} onPointerDown={paint} width="64" height="64"/></div><div className="skinTools"><h3>Палитра</h3><div className="palette">{colors.map(c=><button key={c} style={{background:c}} className={color===c?'sel':''} onClick={()=>setColor(c)}/>)}</div><label className="colorPicker"><span>Свой цвет</span><input type="color" value={color} onChange={e=>setColor(e.target.value)}/></label><div className="skinTip"><b>64 × 64</b><span>PNG остаётся стандартного размера Minecraft.</span></div></div></div></section>}
function BuildPanel({build,close,launch,install,deleteBuild,setBuild}){const [files,setFiles]=useState({mods:[]});const [refreshing,setRefreshing]=useState(false);async function refresh(){setRefreshing(true);try{const data=await invoke('list_instance_files',{id:build.id});setFiles(data);setBuild({...build,mods:(data.mods||[]).map(m=>m.name)})}catch{}finally{setRefreshing(false)}}useEffect(()=>{refresh()},[build.id]);return <div className="drawer"><button className="close" onClick={close}>×</button><span className="eyebrow">СБОРКА</span><h1>{build.name}</h1><p className="drawerSub">{build.version} · {build.loader}</p><div className="drawerBadge"><span className={build.installed?'okDot':''}/>{build.installed?'Minecraft установлена':'Minecraft ещё не установлена'}</div><div className="drawerActions"><button className="play small" onClick={()=>launch(build)}>▶ Играть</button><button onClick={()=>install(build)}>{build.installed?'Переустановить':'Скачать Minecraft'}</button><button onClick={()=>invoke('open_instance',{id:build.id})}>Открыть папку</button></div><div className="drawerStats"><span><b>{files.mods?.length||0}</b> модов</span><span><b>{files.total_files||0}</b> файлов</span><span><b>{build.installed?'Готово':'—'}</b> состояние</span></div><div className="drawerSectionHead"><h3>Моды этой сборки</h3><button onClick={refresh}>{refreshing?'…':'↻'}</button></div><div className="fileList">{(files.mods||[]).length?files.mods.map(m=><div key={m.name}><span>◆ {m.name}</span><small>{formatBytes(m.size)}</small></div>):<p>Папка mods пока пуста.</p>}</div><h3>Структура</h3><div className="folderChips"><span>mods</span><span>config</span><span>saves</span><span>resourcepacks</span><span>shaderpacks</span><span>logs</span></div><h3>Папка сборки</h3><code>{files.path||build.dir}</code><button className="danger" onClick={()=>deleteBuild(build.id)}>Удалить из лаунчера</button></div>}
function formatBytes(n){if(!n)return '0 KB';if(n<1024*1024)return `${Math.max(1,Math.round(n/1024))} KB`;return `${(n/1024/1024).toFixed(1)} MB`}
function DownloadOverlay({progress}){const pct=Math.max(0,Math.min(100,Number(progress.percent)||0));const determinate=Number(progress.total)>0;return <div className="downloadShade"><div className="downloadCard"><div className="downloadLogo"><img src={logo} alt="Sakura"/></div><span className="eyebrow">SAKURA INSTALLER</span><h2>Устанавливаем Minecraft</h2><p>{progress.phase||'Загрузка'} · {progress.current||'Подготовка файлов…'}</p><div className="progressTrack"><div className="progressBar" style={{width:determinate?`${pct}%`:'35%'}}/></div><div className="progressInfo"><b>{determinate?`${Math.round(pct)}%`:'Подготовка…'}</b><span>{progress.completed||0}{progress.total?` / ${progress.total}`:''} файлов</span></div><small>Окно не зависло — Sakura загружает Minecraft и показывает текущий файл.</small></div></div>}
function CreateModal({initialVersion,versions,close,create}){const [name,setName]=useState('Моя сборка');const [version,setVersion]=useState(initialVersion||versions.find(v=>v.type==='release')?.id||'');const [loader,setLoader]=useState('Vanilla');return <div className="modalShade"><div className="modal"><button className="close" onClick={close}>×</button><span className="eyebrow">НОВАЯ СБОРКА</span><h2>Создать Minecraft instance</h2><p className="modalHint">Это отдельный инстанс: его моды и настройки не смешиваются с другими сборками.</p><input value={name} onChange={e=>setName(e.target.value)} placeholder="Название"/><select value={version} onChange={e=>setVersion(e.target.value)}>{versions.filter(v=>v.type==='release').slice(0,80).map(v=><option key={v.id}>{v.id}</option>)}</select><select value={loader} onChange={e=>setLoader(e.target.value)}><option>Vanilla</option><option>Fabric</option></select><button className="play full" onClick={()=>create({name,version,loader})}>Создать сборку</button></div></div>}
function SettingsModal({settings,setSettings,close,reset}){const set=(key,value)=>setSettings(s=>({...s,[key]:value}));return <div className="modalShade"><div className="settingsModal"><button className="close" onClick={close}>×</button><div className="settingsTitle"><div><span className="eyebrow">КАСТОМИЗАЦИЯ</span><h2>Настройки Sakura</h2><p>Меняй внешний вид, частицы и эффекты — всё сохраняется автоматически.</p></div></div><div className="settingsGrid"><section className="settingSection"><h3>Оформление</h3><label>Тема</label><div className="themeChoices">{[['sakura','Sakura'],['midnight','Midnight'],['rose','Rose']].map(([id,label])=><button key={id} className={settings.theme===id?'chosen':''} onClick={()=>set('theme',id)}>{label}</button>)}</div><label>Акцент</label><div className="accentRow"><input type="color" value={settings.accent} onChange={e=>set('accent',e.target.value)}/><input className="accentText" value={settings.accent} onChange={e=>set('accent',e.target.value)}/></div><Toggle label="Свечение интерфейса" value={settings.glow} onChange={v=>set('glow',v)}/><Toggle label="Плавные анимации" value={settings.animations} onChange={v=>set('animations',v)}/><label>Java для запуска</label><div className="javaRow"><input className="accentText" value={settings.javaPath} onChange={e=>set('javaPath',e.target.value)} placeholder="Автоопределение: javaw.exe"/><button onClick={async()=>{const p=await invoke('find_java');if(p)set('javaPath',p)}}>Найти</button></div></section><section className="settingSection particleEditor"><div className="sectionTitle"><div><h3>Редактор частиц</h3><p>Настрой поток лепестков в реальном времени.</p></div><span className="particlePreview">✦</span></div><Toggle label="Включить частицы" value={settings.particles} onChange={v=>set('particles',v)}/><Range label="Количество" value={settings.particleCount} min={8} max={100} step={1} onChange={v=>set('particleCount',v)}/><Range label="Скорость" value={settings.particleSpeed} min={0.3} max={2.5} step={0.1} suffix="×" onChange={v=>set('particleSpeed',v)}/><Range label="Прозрачность" value={settings.particleOpacity} min={0.08} max={0.75} step={0.01} onChange={v=>set('particleOpacity',v)}/><Range label="Размер" value={settings.particleSize} min={0.5} max={2.5} step={0.1} suffix="×" onChange={v=>set('particleSize',v)}/></section></div><div className="settingsBottom"><span>Настройки сохраняются на этом компьютере.</span><div><button className="resetBtn" onClick={reset}>Сбросить</button><button className="play small" onClick={close}>Готово</button></div></div></div></div>}
function Toggle({label,value,onChange}){return <button className={'toggle '+(value?'on':'')} onClick={()=>onChange(!value)}><span>{label}</span><i/></button>}
function Range({label,value,min,max,step,onChange,suffix=''}){return <label className="range"><span><b>{label}</b><em>{value}{suffix}</em></span><input type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(Number(e.target.value))}/></label>}
function ProfileModal({profile,close,save}){const [name,setName]=useState(profile.name);return <div className="modalShade"><div className="modal"><button className="close" onClick={close}>×</button><span className="eyebrow">ПРОФИЛЬ</span><h2>Автономный профиль</h2><input value={name} onChange={e=>setName(e.target.value.replace(/[^A-Za-z0-9_]/g,'').slice(0,16))}/><button className="play full" disabled={name.length<3} onClick={()=>save({name})}>Сохранить</button></div></div>}
createRoot(document.getElementById('root')).render(<App/>);
