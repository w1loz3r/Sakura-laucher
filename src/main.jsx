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
 const [settings,setSettings]=useState(getSettings);
 const [download,setDownload]=useState(null);
 const [logs,setLogs]=useState([]);
 const [logOpen,setLogOpen]=useState(false);
 const [javaInstalling,setJavaInstalling]=useState(false);
 const [accounts,setAccounts]=useState(()=>JSON.parse(localStorage.getItem('sakura.accounts')||'[]'));
 const canvasRef=useRef(null);

 useEffect(()=>{
   if(!profile)return;
   localStorage.setItem('sakura.profile',JSON.stringify(profile));
 },[profile]);

 useEffect(()=>saveBuilds(builds),[builds]);

 useEffect(()=>{
   localStorage.setItem('sakura.settings',JSON.stringify(settings))
 },[settings]);

 useEffect(()=>{
   localStorage.setItem('sakura.accounts',JSON.stringify(accounts))
 },[accounts]);

 useEffect(()=>{
   if(tab==='versions'&&!versions.length)loadVersions();
 },[tab]);

 useEffect(()=>{
   let unlisten;

   listen('download-progress',e=>setDownload(e.payload))
     .then(fn=>{unlisten=fn})
     .catch(()=>{});

   let ulog,uexit;

   listen('minecraft-log',e=>{
     setLogs(x=>[
       ...x,
       String(e.payload?.line||'')
     ].slice(-5000))
   }).then(fn=>ulog=fn).catch(()=>{});

   listen('minecraft-exit',e=>{
     if(e.payload?.crashed)
       setStatus('Minecraft завершилась с ошибкой — проверь логи.');
   }).then(fn=>uexit=fn).catch(()=>{});

   return()=>{
     if(unlisten)unlisten();
     if(ulog)ulog();
     if(uexit)uexit();
   };
 },[]);

 async function loadVersions(){
   setLoadingVersions(true);
   setStatus('Получаю реальные версии Minecraft…');

   try{
     const r=await fetch(MANIFEST);
     const j=await r.json();

     setVersions(j.versions||[]);
     setStatus('');
   }catch(e){
     setStatus('Не удалось получить список версий Minecraft.');
   }finally{
     setLoadingVersions(false)
   }
 }

 async function createBuild(data){
   if(!data.name||!data.version)return;

   setStatus('Создаю сборку…');

   try{
     const created=await invoke('create_instance',{
       name:data.name,
       version:data.version,
       loader:data.loader||'Vanilla'
     });

     const build={
       ...created,
       mods:[],
       createdAt:Date.now(),
       installed:false
     };

     setBuilds(x=>[...x,build]);
     setSelected(build);
     setModal(null);
     setTab('builds');
     setStatus('Сборка создана.');
   }catch(e){
     setStatus(String(e))
   }
 }

 async function install(build){
   setDownload({
     phase:'Подготовка',
     current:'Проверяю файлы Minecraft…',
     completed:0,
     total:0,
     percent:0
   });

   setStatus('Подготавливаю загрузку…');

   try{
     await invoke('install_minecraft',{
       id:build.id,
       version:build.version,
       loader:build.loader||'Vanilla'
     });

     setBuilds(xs=>xs.map(x=>
       x.id===build.id
         ? {...x,installed:true}
         : x
     ));

     setStatus('Minecraft установлена. Теперь можно запускать.');
   }catch(e){
     setStatus(String(e))
   }finally{
     setTimeout(()=>setDownload(null),700)
   }
 }

 async function launch(build){
   if(!profile?.name){
     setModal('profile');
     return
   }

   try{
     if(!build.installed)
       await install(build);

     setLogs([]);
     setLogOpen(true);
     setStatus('Запускаю Minecraft…');

     await invoke('launch_instance',{
       id:build.id,
       version:build.version,
       username:profile.name,
       loader:build.loader||'Vanilla',
       javaPath:settings.javaPath||null,
       options:{
         minRam:Number(build.launchSettings?.minRam??settings.minRam)||1024,
         maxRam:Number(build.launchSettings?.maxRam??settings.maxRam)||4096,
         jvmArgs:(build.launchSettings?.jvmArgs??settings.jvmArgs)||'',
         width:Number(build.launchSettings?.width??settings.width)||1280,
         height:Number(build.launchSettings?.height??settings.height)||720,
         fullscreen:!!(build.launchSettings?.fullscreen??settings.fullscreen)
       }
     });

     setStatus('Minecraft запущена.')
   }catch(e){
     setStatus(String(e))
   }
 }

 async function installJava(){
   try{
     setJavaInstalling(true);

     const p=await invoke('install_java');

     setSettings(x=>({
       ...x,
       javaPath:p
     }));

     setStatus('Java 21 установлена.')
   }catch(e){
     setStatus(String(e))
   }finally{
     setJavaInstalling(false)
   }
 }

 async function repair(build){
   try{
     setDownload({
       phase:'Проверка',
       current:'Восстанавливаю файлы…',
       completed:0,
       total:0,
       percent:0
     });

     await invoke('repair_instance',{
       id:build.id,
       version:build.version,
       loader:build.loader||'Vanilla'
     });

     setBuilds(xs=>xs.map(x=>
       x.id===build.id
         ? {...x,installed:true}
         : x
     ));

     setStatus('Сборка восстановлена.')
   }catch(e){
     setStatus(String(e))
   }finally{
     setTimeout(()=>setDownload(null),700)
   }
 }

 async function duplicateBuild(build){
   const name=prompt(
     'Название копии',
     build.name+' Copy'
   );

   if(!name)return;

   try{
     const id=await invoke('duplicate_instance',{
       id:build.id,
       newId:String(Date.now())+'-'+name
     });

     const b={
       ...build,
       id,
       name,
       createdAt:Date.now()
     };

     setBuilds(x=>[...x,b]);
     setSelected(b);
     setStatus('Сборка скопирована.')
   }catch(e){
     setStatus(String(e))
   }
 }

 async function renameBuild(build){
   const name=prompt(
     'Новое название',
     build.name
   );

   if(!name)return;

   try{
     const id=await invoke('rename_instance',{
       id:build.id,
       newId:String(Date.now())+'-'+name
     });

     const b={
       ...build,
       id,
       name
     };

     setBuilds(x=>x.map(v=>
       v.id===build.id
         ? b
         : v
     ));

     setSelected(b)
   }catch(e){
     setStatus(String(e))
   }
 }

 async function exportBuild(build){
   const path=prompt(
     'Путь для ZIP',
     build.name.replace(/[^A-Za-z0-9_-]/g,'_')+'.zip'
   );

   if(path)
     try{
       await invoke('export_instance',{
         id:build.id,
         path
       });

       setStatus('Экспорт готов.')
     }catch(e){
       setStatus(String(e))
     }
 }

 async function configureBuild(build){
   const ls={...build.launchSettings};

   const min=prompt(
     'Минимальная RAM (MB)',
     ls.minRam??settings.minRam
   );

   if(min===null)return;

   const max=prompt(
     'Максимальная RAM (MB)',
     ls.maxRam??settings.maxRam
   );

   if(max===null)return;

   const w=prompt(
     'Ширина окна',
     ls.width??settings.width
   );

   if(w===null)return;

   const h=prompt(
     'Высота окна',
     ls.height??settings.height
   );

   if(h===null)return;

   const j=prompt(
     'JVM аргументы',
     ls.jvmArgs??settings.jvmArgs
   );

   if(j===null)return;

   const fs=confirm(
     'Включить полноэкранный режим?'
   );

   const b={
     ...build,
     launchSettings:{
       minRam:Number(min),
       maxRam:Number(max),
       width:Number(w),
       height:Number(h),
       jvmArgs:j,
       fullscreen:fs
     }
   };

   setBuilds(x=>x.map(v=>
     v.id===build.id
       ? b
       : v
   ));

   setSelected(b);

   setStatus(
     'Настройки запуска сохранены для этой сборки.'
   )
 }

 async function checkUpdates(build){
   if(!build?.modsMeta?.length){
     setStatus(
       'Новые установки модов будут отслеживаться для обновлений.'
     );
     return
   }

   let n=0;
   const meta=[];

   for(const m of build.modsMeta){
     try{
       const u=
         `${MODRINTH}/project/${m.projectId}/version?loaders=${encodeURIComponent(JSON.stringify([m.loader||'fabric']))}&game_versions=${encodeURIComponent(JSON.stringify([build.version]))}&featured=true`;

       const vs=await fetch(u).then(r=>r.json());
       const v=vs?.[0];
       const file=v?.files?.find(x=>x.primary)||v?.files?.[0];

       if(v&&file&&v.id!==m.versionId){
         await invoke('install_content',{
           id:build.id,
           url:file.url,
           filename:file.filename,
           contentType:'mod'
         });

         n++;

         meta.push({
           ...m,
           filename:file.filename,
           versionId:v.id,
           update:null
         });
       }else{
         meta.push({
           ...m,
           update:null
         })
       }
     }catch{
       meta.push(m)
     }
   }

   const b={
     ...build,
     modsMeta:meta,
     mods:meta.map(x=>x.filename)
   };

   setBuilds(x=>x.map(v=>
     v.id===build.id
       ? b
       : v
   ));

   setSelected(b);

   setStatus(
     n
       ? `Обновлено модов: ${n}`
       : 'Все отслеживаемые моды актуальны.'
   )
 }

 async function searchMods(){
   if(!modQuery.trim())return;

   setStatus(
     `Ищу ${
       modType==='mod'
         ? 'моды'
         : modType==='resourcepack'
           ? 'ресурспаки'
           : modType==='shader'
             ? 'шейдеры'
             : 'готовые сборки'
     } на Modrinth…`
   );

   try{
     const type=
       modType==='modpack'
         ? 'modpack'
         : modType==='resourcepack'
           ? 'resourcepack'
           : modType==='shader'
             ? 'shader'
             : 'mod';

     const facets=JSON.stringify([
       [`project_type:${type}`],
       ...(type==='mod'
         ? [`categories:${modLoader}`]
         : []
       ).map(x=>[x]),
       ...(modVersion
         ? [[`versions:${modVersion}`]]
         : []
       )
     ]);

     const u=
       `${MODRINTH}/search?query=${encodeURIComponent(modQuery)}&facets=${encodeURIComponent(facets)}&limit=24`;

     const r=await fetch(u);
     const j=await r.json();

     setMods(j.hits||[]);
     setStatus('');
   }catch(e){
     setStatus('Modrinth недоступен.')
   }
 }

 async function addMod(project){
   if(!selected)return;

   try{
     const target=selected.version;
     const loader=selected.loader?.toLowerCase()||modLoader;
     const isPack=modType==='modpack';

     const u=
       `${MODRINTH}/project/${project.project_id}/version?${isPack?'':`loaders=${encodeURIComponent(JSON.stringify([loader]))}&`}game_versions=${encodeURIComponent(JSON.stringify([target]))}&featured=true`;

     const vs=await fetch(u).then(r=>r.json());
     const v=vs?.[0];
     const file=v?.files?.find(x=>x.primary)||v?.files?.[0];

     if(!file)
       throw new Error(
         `Нет версии ${target} для ${selected.loader||'этого загрузчика'}`
       );

     setStatus(
       `Устанавливаю ${project.title}…`
     );

     if(isPack){
       const result=await invoke('install_modpack',{
         id:selected.id,
         url:file.url,
         filename:file.filename
       });

       const b={
         ...selected,
         version:result.version||selected.version,
         loader:result.loader||selected.loader,
         installed:true
       };

       setBuilds(x=>x.map(v=>
         v.id===selected.id
           ? b
           : v
       ));

       setSelected(b);
     }else{
       const contentType=
         modType==='resourcepack'
           ? 'resourcepack'
           : modType==='shader'
             ? 'shader'
             : 'mod';

       await invoke('install_content',{
         id:selected.id,
         url:file.url,
         filename:file.filename,
         contentType
       });

       const nextMeta=
         contentType==='mod'
           ? [
               ...(selected.modsMeta||[]).filter(
                 m=>m.projectId!==project.project_id
               ),
               {
                 projectId:project.project_id,
                 filename:file.filename,
                 versionId:v.id,
                 loader,
                 gameVersion:target
               }
             ]
           : selected.modsMeta||[];

       const b={
         ...selected,
         mods:[
           ...(selected.mods||[]),
           file.filename
         ],
         modsMeta:nextMeta
       };

       setBuilds(x=>x.map(v=>
         v.id===selected.id
           ? b
           : v
       ));

       setSelected(b);
     }

     setStatus(
       `${project.title} установлен.`
     );
   }catch(e){
     setStatus(String(e))
   }
 }

 function deleteBuild(id){
   if(!confirm('Удалить эту сборку из лаунчера?'))return;

   setBuilds(x=>x.filter(v=>v.id!==id));
   setSelected(null);
   setStatus('Сборка удалена из списка.')
 }

 function saveProfile(p){
   const clean={
     name:p.name
   };

   setProfile(clean);

   setAccounts(x=>
     Array.from(
       new Set([
         ...x,
         clean.name
       ])
     )
   );

   setModal(null)
 }

 function selectAccount(name){
   const p={
     name
   };

   setProfile(p);
   setModal(null)
 }

 function resetSettings(){
   setSettings(defaultSettings)
 }

 function openCreate(){
   setModal('create')
 }

 function openProfile(){
   setModal('profile')
 }

 function openSettings(){
   setModal('settings')
 }

 function selectBuild(build){
   setSelected(build)
 }

 const particleItems=useMemo(()=>{
   if(!settings.particles)return [];

   return Array.from(
     {length:settings.particleCount},
     (_,i)=>({
       id:i,
       left:Math.random()*100,
       delay:Math.random()*8,
       duration:(7+Math.random()*9)/settings.particleSpeed,
       size:(7+Math.random()*8)*settings.particleSize,
       rotate:Math.random()*360
     })
   )
 },[
   settings.particles,
   settings.particleCount,
   settings.particleSpeed,
   settings.particleSize
 ]);

 return <div
   className={`app theme-${settings.theme} ${
     settings.animations?'animated':'noAnimations'
   } ${settings.glow?'glowOn':'glowOff'}`}
   style={{
     '--accent':settings.accent,
     '--particle-opacity':settings.particleOpacity
   }}
 >
   {settings.particles&&
     <div className="particles">
       {particleItems.map(p=>
         <i
           key={p.id}
           style={{
             left:`${p.left}%`,
             animationDelay:`-${p.delay}s`,
             animationDuration:`${p.duration}s`,
             width:p.size,
             height:p.size,
             transform:`rotate(${p.rotate}deg)`
           }}
         />
       )}
     </div>
   }

   <header
     className="titlebar"
     data-tauri-drag-region
   >
     <div className="brand">
       <img src={logo} alt="Sakura"/>
       <span>Sakura Launcher</span>
     </div>

     <div className="windowControls">
       <button onClick={()=>appWindow.minimize()}>−</button>
       <button onClick={()=>appWindow.toggleMaximize()}>□</button>
       <button
         className="closeWindow"
         onClick={()=>appWindow.close()}
       >
         ×
       </button>
     </div>
   </header>

   <aside className="sidebar">
     <nav>
       <button
         className={tab==='home'?'active':''}
         onClick={()=>setTab('home')}
       >
         <span>⌂</span>
         Главная
       </button>

       <button
         className={tab==='builds'?'active':''}
         onClick={()=>setTab('builds')}
       >
         <span>◆</span>
         Мои сборки
       </button>

       <button
         className={tab==='versions'?'active':''}
         onClick={()=>setTab('versions')}
       >
         <span>▣</span>
         Версии
       </button>

       <button
         className={tab==='mods'?'active':''}
         onClick={()=>setTab('mods')}
       >
         <span>✦</span>
         Моды
       </button>

       <button
         className={tab==='skins'?'active':''}
         onClick={()=>setTab('skins')}
       >
         <span>◇</span>
         Скины
       </button>
     </nav>

     <div className="sidebarBottom">
       <button onClick={openProfile}>
         <span>◎</span>
         {profile?.name||'Профиль'}
       </button>

       <button onClick={openSettings}>
         <span>⚙</span>
         Настройки
       </button>
     </div>
   </aside>

   <main className="content">
     {tab==='home'&&
       <HomePage
         profile={profile}
         builds={builds}
         openCreate={openCreate}
         selectBuild={selectBuild}
         setTab={setTab}
         openProfile={openProfile}
       />
     }

     {tab==='builds'&&
       <BuildsPage
         builds={builds}
         selectBuild={selectBuild}
         openCreate={openCreate}
         importBuild={async file=>{
           if(!file)return;

           try{
             const id=String(Date.now());
             await invoke('import_instance',{
               id,
               path:file.path
             });

             const b={
               id,
               name:file.name.replace(/\.[^.]+$/,''),
               version:'Imported',
               loader:'Imported',
               installed:true,
               mods:[],
               createdAt:Date.now()
             };

             setBuilds(x=>[...x,b]);
             setStatus('Сборка импортирована.');
           }catch(e){
             setStatus(String(e))
           }
         }}
       />
     }

     {tab==='versions'&&
       <VersionsPage
         versions={versions}
         loading={loadingVersions}
         create={openCreate}
         reload={loadVersions}
       />
     }

     {tab==='mods'&&
       <ModsPage
         mods={mods}
         query={modQuery}
         setQuery={setModQuery}
         loader={modLoader}
         setLoader={setModLoader}
         version={modVersion}
         setVersion={setModVersion}
         type={modType}
         setType={setModType}
         search={searchMods}
         add={addMod}
         selected={selected}
         builds={builds}
         selectBuild={selectBuild}
       />
     }

     {tab==='skins'&&
       <SkinStudio
         skin={skin}
         setSkin={setSkin}
         color={skinColor}
         setColor={setSkinColor}
         canvasRef={canvasRef}
       />
     }
   </main>

   {selected&&
     <BuildPanel
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
       deleteBuild={deleteBuild}
       setBuild={b=>{
         setSelected(b);
         setBuilds(x=>x.map(v=>
           v.id===b.id
             ? b
             : v
         ))
       }}
     />
   }

   {modal==='create'&&
     <CreateModal
       initialVersion={versions.find(v=>v.type==='release')?.id}
       versions={versions}
       close={()=>setModal(null)}
       create={createBuild}
     />
   }

   {modal==='profile'&&
     <ProfileModal
       profile={profile||{name:''}}
       accounts={accounts}
       close={()=>setModal(null)}
       save={saveProfile}
       select={selectAccount}
     />
   }

   {modal==='settings'&&
     <SettingsModal
       settings={settings}
       setSettings={setSettings}
       close={()=>setModal(null)}
       reset={resetSettings}
       installJava={installJava}
       javaInstalling={javaInstalling}
     />
   }

   {logOpen&&
     <LogPanel
       logs={logs}
       close={()=>setLogOpen(false)}
     />
   }

   {download&&
     <DownloadOverlay
       progress={download}
     />
   }

   {status&&
     <div className="statusToast">
       {status}
       <button onClick={()=>setStatus('')}>×</button>
     </div>
   }
 </div>
}

function HomePage({
 profile,
 builds,
 openCreate,
 selectBuild,
 setTab,
 openProfile
}){
 const recent=builds
   .slice()
   .sort((a,b)=>
     (b.createdAt||0)-(a.createdAt||0)
   )
   .slice(0,3);

 return <div className="page homePage">
   <section className="hero">
     <div className="heroCopy">
       <span className="eyebrow">
         SAKURA LAUNCHER
       </span>

       <h1>
         Твой Minecraft.
         <br/>
         Твои правила.
       </h1>

       <p>
         Реальные версии Minecraft, отдельные сборки,
         моды с Modrinth и чистый интерфейс без лишнего.
       </p>

       <div className="heroActions">
         <button
           className="play"
           onClick={openCreate}
         >
           ＋ Создать сборку
         </button>

         <button onClick={()=>setTab('builds')}>
           Мои сборки
         </button>
       </div>

       {profile?.name
         ? <div className="profileHint">
             Играешь как <b>{profile.name}</b>
           </div>
         : <button
             className="profileHint buttonLike"
             onClick={openProfile}
           >
             Настрой ник перед первым запуском →
           </button>
       }
     </div>

     <div className="world minecraftWorld">
       <div className="mcSky"/>
       <div className="mcStars"/>
       <div className="mcMoon"/>
       <div className="mcCloud c1"/>
       <div className="mcCloud c2"/>
       <div className="mcMountain far"/>
       <div className="mcMountain near"/>
       <div className="mcFog"/>

       <div className="mcPine p1">
         <i/>
         <b/>
         <em/>
       </div>

       <div className="mcPine p2">
         <i/>
         <b/>
         <em/>
       </div>

       <div className="mcCabin">
         <i/>
         <b/>
         <em/>
       </div>

       <div className="mcGrass">
         <span/>
         <span/>
         <span/>
         <span/>
         <span/>
       </div>

       <div className="mcRain"/>
     </div>
   </section>

   <section className="homeSection">
     <div className="sectionHeader">
       <div>
         <span className="eyebrow">ТВОИ СБОРКИ</span>
         <h2>Последние сборки</h2>
       </div>

       <button onClick={()=>setTab('builds')}>
         Открыть все →
       </button>
     </div>

     {recent.length
       ? <div className="buildGrid">
           {recent.map(build=>
             <BuildCard
               key={build.id}
               build={build}
               onClick={()=>selectBuild(build)}
             />
           )}
         </div>
       : <div className="emptyState">
           <div className="emptyIcon">✦</div>
           <h3>Пока здесь пусто</h3>
           <p>
             Создай первую сборку — она появится
             здесь и в разделе «Мои сборки».
           </p>

           <button
             className="play small"
             onClick={openCreate}
           >
             Создать первую сборку
           </button>
         </div>
     }
   </section>
 </div>
}

function BuildsPage({
 builds,
 selectBuild,
 openCreate,
 importBuild
}){
 const fileRef=useRef(null);

 return <div className="page">
   <div className="pageTop">
     <div>
       <span className="eyebrow">INSTANCE MANAGER</span>
       <h1>Мои сборки</h1>
       <p>
         Каждый instance живёт отдельно:
         свои моды, миры, конфиги и логи.
       </p>
     </div>

     <div className="pageTopActions">
       <button
         onClick={()=>fileRef.current?.click()}
       >
         Импорт ZIP
       </button>

       <button
         className="play"
         onClick={openCreate}
       >
         ＋ Новая сборка
       </button>

       <input
         ref={fileRef}
         type="file"
         accept=".zip"
         hidden
         onChange={e=>{
           importBuild(e.target.files?.[0]);
           e.target.value='';
         }}
       />
     </div>
   </div>

   {builds.length
     ? <div className="buildGrid">
         {builds.map(build=>
           <BuildCard
             key={build.id}
             build={build}
             onClick={()=>selectBuild(build)}
           />
         )}
       </div>
     : <div className="emptyState large">
         <div className="emptyIcon">◇</div>
         <h2>Сборок ещё нет</h2>
         <p>
           Создай instance в разделе «Версии» или
           кнопкой выше.
         </p>

         <button
           className="play"
           onClick={openCreate}
         >
           Создать сборку
         </button>
       </div>
   }
 </div>
}

function BuildCard({build,onClick}){
 return <button
   className="buildCard"
   onClick={onClick}
 >
   <div className="buildCardTop">
     <span className="versionPill">
       {build.version}
     </span>

     <span className="loaderPill">
       {build.loader}
     </span>
   </div>

   <div className="buildCardIcon">
     ✦
   </div>

   <h3>{build.name}</h3>

   <p>
     {build.installed
       ? 'Minecraft установлена'
       : 'Готова к установке'}
   </p>

   <div className="buildCardBottom">
     <span>
       {build.mods?.length||0} модов
     </span>

     <span>
       Открыть →
     </span>
   </div>
 </button>
}

function VersionsPage({
 versions,
 loading,
 create,
 reload
}){
 return <div className="page">
   <div className="pageTop">
     <div>
       <span className="eyebrow">
         MOJANG MANIFEST
       </span>

       <h1>Версии Minecraft</h1>

       <p>
         Список берётся напрямую из официального
         manifest Mojang.
       </p>
     </div>

     <div className="pageTopActions">
       <button onClick={reload}>
         ↻ Обновить
       </button>

       <button
         className="play"
         onClick={create}
       >
         ＋ Создать
       </button>
     </div>
   </div>

   {loading
     ? <div className="emptyState">
         <div className="spinner"/>
         <h3>Загружаю версии…</h3>
       </div>
     : <div className="versionList">
         {versions
           .filter(v=>v.type==='release')
           .slice(0,80)
           .map(v=>
             <div
               className="versionRow"
               key={v.id}
             >
               <div>
                 <strong>{v.id}</strong>
                 <small>
                   {new Date(v.releaseTime)
                     .toLocaleDateString()}
                 </small>
               </div>

               <span>Release</span>

               <button onClick={create}>
                 Создать →
               </button>
             </div>
           )
         }
       </div>
   }
 </div>
}

function ModsPage({
 mods,
 query,
 setQuery,
 loader,
 setLoader,
 version,
 setVersion,
 type,
 setType,
 search,
 add,
 selected,
 builds,
 selectBuild
}){
 return <div className="page">
   <div className="pageTop">
     <div>
       <span className="eyebrow">
         MODRINTH
       </span>

       <h1>Контент</h1>

       <p>
         Моды, ресурспаки, шейдеры и готовые сборки.
       </p>
     </div>

     <div className="buildSelector">
       <label>Устанавливать в</label>

       <select
         value={selected?.id||''}
         onChange={e=>
           selectBuild(
             builds.find(x=>x.id===e.target.value)
           )
         }
       >
         <option value="">
           Выбери сборку
         </option>

         {builds.map(b=>
           <option
             key={b.id}
             value={b.id}
           >
             {b.name} · {b.version}
           </option>
         )}
       </select>
     </div>
   </div>

   <div className="modToolbar">
     <div className="searchBox">
       <span>⌕</span>

       <input
         value={query}
         onChange={e=>setQuery(e.target.value)}
         onKeyDown={e=>{
           if(e.key==='Enter')search()
         }}
         placeholder="Поиск на Modrinth…"
       />

       <button onClick={search}>
         Найти
       </button>
     </div>

     <div className="filterRow">
       {[
         ['mod','Моды'],
         ['resourcepack','Ресурспаки'],
         ['shader','Шейдеры'],
         ['modpack','Готовые сборки']
       ].map(([id,label])=>
         <button
           key={id}
           className={type===id?'chosen':''}
           onClick={()=>setType(id)}
         >
           {label}
         </button>
       )}

       {type==='mod'&&
         <select
           value={loader}
           onChange={e=>setLoader(e.target.value)}
         >
           <option value="fabric">Fabric</option>
           <option value="forge">Forge</option>
           <option value="neoforge">NeoForge</option>
           <option value="quilt">Quilt</option>
         </select>
       }

       <input
         value={version}
         onChange={e=>setVersion(e.target.value)}
         placeholder="1.21.8"
       />
     </div>
   </div>

   {mods.length
     ? <div className="modGrid">
         {mods.map(m=>
           <article
             className="modCard"
             key={m.project_id}
           >
             <div className="modCardIcon">
               {m.icon_url
                 ? <img
                     src={m.icon_url}
                     alt=""
                   />
                 : '✦'
               }
             </div>

             <div className="modCardBody">
               <div className="modCardTitle">
                 <h3>{m.title}</h3>
                 <span>{m.project_type}</span>
               </div>

               <p>
                 {m.description||'Без описания.'}
               </p>

               <div className="modCardMeta">
                 <span>
                   ★ {m.follows||0}
                 </span>

                 <span>
                   {m.author}
                 </span>
               </div>

               <button
                 className="play small"
                 disabled={!selected}
                 onClick={()=>add(m)}
               >
                 Установить
               </button>
             </div>
           </article>
         )}
       </div>
     : <div className="emptyState large">
         <div className="emptyIcon">✦</div>
         <h2>
           Найди что-нибудь интересное
         </h2>
         <p>
           Выбери тип контента и введи название
           или запрос.
         </p>
       </div>
   }
 </div>
}

function SkinStudio({
 skin,
 setSkin,
 color,
 setColor,
 canvasRef
}){
 const [zoom,setZoom]=useState(8);

 useEffect(()=>{
   const canvas=canvasRef.current;
   if(!canvas)return;

   const ctx=canvas.getContext('2d');
   ctx.imageSmoothingEnabled=false;

   ctx.clearRect(
     0,
     0,
     canvas.width,
     canvas.height
   );

   ctx.fillStyle='#17151c';
   ctx.fillRect(
     0,
     0,
     canvas.width,
     canvas.height
   );

   if(skin){
     ctx.drawImage(
       skin,
       0,
       0,
       canvas.width,
       canvas.height
     )
   }else{
     ctx.fillStyle='#f4a0bd';

     for(let y=0;y<64;y++){
       for(let x=0;x<64;x++){
         if(
           x<8||
           x>=56||
           y<8||
           y>=56
         ){
           ctx.fillRect(
             x,
             y,
             1,
             1
           )
         }
       }
     }
   }
 },[
   skin,
   canvasRef
 ]);

 function paint(e){
   const canvas=canvasRef.current;
   if(!canvas)return;

   const rect=canvas.getBoundingClientRect();

   const x=Math.floor(
     ((e.clientX-rect.left)/rect.width)*64
   );

   const y=Math.floor(
     ((e.clientY-rect.top)/rect.height)*64
   );

   const ctx=canvas.getContext('2d');

   ctx.fillStyle=color;
   ctx.fillRect(x,y,1,1);
 }

 function upload(e){
   const file=e.target.files?.[0];
   if(!file)return;

   const img=new Image();

   img.onload=()=>{
     setSkin(img)
   };

   img.src=URL.createObjectURL(file)
 }

 function exportSkin(){
   const canvas=canvasRef.current;
   if(!canvas)return;

   const a=document.createElement('a');
   a.href=canvas.toDataURL('image/png');
   a.download='sakura-skin.png';
   a.click()
 }

 return <div className="page skinPage">
   <div className="pageTop">
     <div>
       <span className="eyebrow">
         SKIN STUDIO
       </span>

       <h1>Редактор скина</h1>

       <p>
         Рисуй прямо по 64×64 Minecraft skin.
       </p>
     </div>

     <div className="pageTopActions">
       <label className="button">
         Загрузить PNG
         <input
           type="file"
           accept="image/png"
           hidden
           onChange={upload}
         />
       </label>

       <button
         className="play"
         onClick={exportSkin}
       >
         Экспорт PNG
       </button>
     </div>
   </div>

   <div className="skinEditor">
     <div
       className="skinCanvasWrap"
       style={{
         '--skinZoom':zoom
       }}
     >
       <canvas
         ref={canvasRef}
         width="64"
         height="64"
         onPointerDown={paint}
       />
     </div>

     <div className="skinTools">
       <h3>Инструменты</h3>

       <label>
         Цвет

         <div className="accentRow">
           <input
             type="color"
             value={color}
             onChange={e=>setColor(e.target.value)}
           />

           <input
             className="accentText"
             value={color}
             onChange={e=>setColor(e.target.value)}
           />
         </div>
       </label>

       <label>
         Масштаб

         <input
           type="range"
           min="4"
           max="16"
           step="1"
           value={zoom}
           onChange={e=>
             setZoom(Number(e.target.value))
           }
         />
       </label>

       <p>
         PNG должен быть стандартного размера
         64×64.
       </p>
     </div>
   </div>
 </div>
}

function BuildPanel({
 build,
 close,
 launch,
 install,
 repair,
 checkUpdates,
 configureBuild,
 duplicateBuild,
 renameBuild,
 exportBuild,
 deleteBuild,
 setBuild
}){
 const [files,setFiles]=useState({
   mods:[]
 });

 async function refresh(){
   try{
     const d=await invoke(
       'list_instance_files',
       {
         id:build.id
       }
     );

     setFiles(d);

     setBuild({
       ...build,
       mods:(d.mods||[]).map(
         m=>m.name
       )
     })
   }catch{}
 }

 useEffect(()=>{
   refresh()
 },[
   build.id
 ]);

 return <div className="drawer">
   <button
     className="close"
     onClick={close}
   >
     ×
   </button>

   <span className="eyebrow">
     СБОРКА
   </span>

   <h1>{build.name}</h1>

   <p className="drawerSub">
     {build.version} · {build.loader}
   </p>

   <div className="drawerBadge">
     <span className={build.installed?'okDot':''}/>
     {build.installed
       ? 'Minecraft установлена'
       : 'Minecraft ещё не установлена'}
   </div>

   <div className="drawerActions">
     <button
       className="play small"
       onClick={()=>launch(build)}
     >
       ▶ Играть
     </button>

     <button
       onClick={()=>install(build)}
     >
       {build.installed
         ? 'Переустановить'
         : 'Скачать Minecraft'}
     </button>

     <button
       onClick={()=>repair(build)}
     >
       🛠 Repair
     </button>

     <button
       onClick={()=>
         invoke(
           'open_instance',
           {id:build.id}
         )
       }
     >
       Открыть папку
     </button>
   </div>

   <div className="drawerActions">
     <button onClick={()=>duplicateBuild(build)}>
       Дубликат
     </button>

     <button onClick={()=>renameBuild(build)}>
       Переименовать
     </button>

     <button onClick={()=>exportBuild(build)}>
       Экспорт
     </button>

     <button onClick={()=>checkUpdates(build)}>
       Обновить моды
     </button>

     <button onClick={()=>configureBuild(build)}>
       Параметры запуска
     </button>
   </div>

   <div className="drawerStats">
     <span>
       <b>{files.mods?.length||0}</b>
       модов
     </span>

     <span>
       <b>{files.total_files||0}</b>
       файлов
     </span>

     <span>
       <b>{build.installed?'Готово':'—'}</b>
       состояние
     </span>
   </div>

   <div className="drawerSectionHead">
     <h3>Моды этой сборки</h3>
     <button onClick={refresh}>↻</button>
   </div>

   <div className="fileList">
     {(files.mods||[]).length
       ? files.mods.map(m=>
           <div key={m.name}>
             <span>
               ◆ {m.name}
             </span>

             <small>
               {formatBytes(m.size)}
             </small>
           </div>
         )
       : <p>
           Папка mods пока пуста.
         </p>
     }
   </div>

   <h3>Структура</h3>

   <div className="folderChips">
     <span>mods</span>
     <span>config</span>
     <span>saves</span>
     <span>resourcepacks</span>
     <span>shaderpacks</span>
     <span>logs</span>
   </div>

   <h3>Папка сборки</h3>

   <code>
     {files.path||build.dir}
   </code>

   <button
     className="danger"
     onClick={()=>deleteBuild(build.id)}
   >
     Удалить из лаунчера
   </button>
 </div>
}

function formatBytes(n){
 if(!n)return '0 KB';

 if(n<1024*1024)
   return `${Math.max(1,Math.round(n/1024))} KB`;

 return `${(n/1024/1024).toFixed(1)} MB`
}

function LogPanel({
 logs,
 close
}){
 const ref=useRef(null);

 useEffect(()=>{
   ref.current?.scrollTo(
     0,
     ref.current.scrollHeight
   )
 },[
   logs
 ]);

 return <div className="modalShade">
   <div className="logModal">
     <button
       className="close"
       onClick={close}
     >
       ×
     </button>

     <span className="eyebrow">
       MINECRAFT CONSOLE
     </span>

     <h2>Логи запуска</h2>

     <pre ref={ref}>
       {logs.length
         ? logs.map((x,i)=>
             <div key={i}>{x}</div>
           )
         : 'Ожидание вывода Minecraft…'}
     </pre>

     <div className="settingsBottom">
       <button
         onClick={()=>
           navigator.clipboard?.writeText(
             logs.join('\n')
           )
         }
       >
         Скопировать лог
       </button>

       <button onClick={close}>
         Закрыть
       </button>
     </div>
   </div>
 </div>
}

function DownloadOverlay({
 progress
}){
 const pct=Math.max(
   0,
   Math.min(
     100,
     Number(progress.percent)||0
   )
 );

 const determinate=
   Number(progress.total)>0;

 return <div className="downloadShade">
   <div className="downloadCard">
     <div className="downloadLogo">
       <img
         src={logo}
         alt="Sakura"
       />
     </div>

     <span className="eyebrow">
       SAKURA INSTALLER
     </span>

     <h2>
       Устанавливаем Minecraft
     </h2>

     <p>
       {progress.phase||'Загрузка'}
       {' · '}
       {progress.current||'Подготовка файлов…'}
     </p>

     <div className="progressTrack">
       <div
         className="progressBar"
         style={{
           width:determinate
             ? `${pct}%`
             : '35%'
         }}
       />
     </div>

     <div className="progressInfo">
       <b>
         {determinate
           ? `${Math.round(pct)}%`
           : 'Подготовка…'}
       </b>

       <span>
         {progress.completed||0}
         {progress.total
           ? ` / ${progress.total}`
           : ''}
         {' файлов'}
       </span>
     </div>

     <small>
       Окно не зависло — Sakura загружает Minecraft
       и показывает текущий файл.
     </small>
   </div>
 </div>
}

function CreateModal({
 initialVersion,
 versions,
 close,
 create
}){
 const [name,setName]=useState('Моя сборка');

 const [version,setVersion]=useState(
   initialVersion||
   versions.find(v=>v.type==='release')?.id||
   ''
 );

 const [loader,setLoader]=useState('Vanilla');

 return <div className="modalShade">
   <div className="modal">
     <button
       className="close"
       onClick={close}
     >
       ×
     </button>

     <span className="eyebrow">
       НОВАЯ СБОРКА
     </span>

     <h2>
       Создать Minecraft instance
     </h2>

     <p className="modalHint">
       Это отдельный инстанс: его моды и настройки
       не смешиваются с другими сборками.
     </p>

     <input
       value={name}
       onChange={e=>setName(e.target.value)}
       placeholder="Название"
     />

     <select
       value={version}
       onChange={e=>setVersion(e.target.value)}
     >
       {versions
         .filter(v=>v.type==='release')
         .slice(0,80)
         .map(v=>
           <option key={v.id}>
             {v.id}
           </option>
         )
       }
     </select>

     <select
       value={loader}
       onChange={e=>setLoader(e.target.value)}
     >
       <option>Vanilla</option>
       <option>Fabric</option>
     </select>

     <button
       className="play full"
       onClick={()=>
         create({
           name,
           version,
           loader
         })
       }
     >
       Создать сборку
     </button>
   </div>
 </div>
}

function SettingsModal({
 settings,
 setSettings,
 close,
 reset,
 installJava,
 javaInstalling
}){
 const set=(key,value)=>
   setSettings(s=>({
     ...s,
     [key]:value
   }));

 return <div className="modalShade">
   <div className="settingsModal">
     <button
       className="close"
       onClick={close}
     >
       ×
     </button>

     <div className="settingsTitle">
       <div>
         <span className="eyebrow">
           КАСТОМИЗАЦИЯ
         </span>

         <h2>
           Настройки Sakura
         </h2>

         <p>
           Меняй внешний вид, частицы и эффекты —
           всё сохраняется автоматически.
         </p>
       </div>
     </div>

     <div className="settingsGrid">
       <section className="settingSection">
         <h3>Оформление</h3>

         <label>Тема</label>

         <div className="themeChoices">
           {[
             ['sakura','Sakura'],
             ['midnight','Midnight'],
             ['rose','Rose']
           ].map(([id,label])=>
             <button
               key={id}
               className={
                 settings.theme===id
                   ? 'chosen'
                   : ''
               }
               onClick={()=>
                 set('theme',id)
               }
             >
               {label}
             </button>
           )}
         </div>

         <label>Акцент</label>

         <div className="accentRow">
           <input
             type="color"
             value={settings.accent}
             onChange={e=>
               set('accent',e.target.value)
             }
           />

           <input
             className="accentText"
             value={settings.accent}
             onChange={e=>
               set('accent',e.target.value)
             }
           />
         </div>

         <Toggle
           label="Свечение интерфейса"
           value={settings.glow}
           onChange={v=>set('glow',v)}
         />

         <Toggle
           label="Плавные анимации"
           value={settings.animations}
           onChange={v=>set('animations',v)}
         />
       </section>

       <section className="settingSection javaSettings">
         <div className="sectionTitle">
           <div>
             <h3>Java</h3>

             <p>
               Версия Java, которую Sakura использует
               для запуска Minecraft.
             </p>
           </div>

           <span className="javaBadge">
             JVM
           </span>
         </div>

         <label>
           Путь к Java
         </label>

         <div className="javaRow">
           <input
             className="accentText"
             value={settings.javaPath}
             onChange={e=>
               set('javaPath',e.target.value)
             }
             placeholder="Автоопределение"
           />

           <button
             onClick={async()=>{
               const p=await invoke('find_java');

               if(p)
                 set('javaPath',p)
             }}
           >
             Автонайти
           </button>

           <button
             onClick={installJava}
             disabled={javaInstalling}
           >
             {javaInstalling
               ? 'Установка…'
               : 'Установить Java 21'}
           </button>
         </div>

         <p className="javaHint">
           Можно указать сам javaw.exe или папку JDK.
           Если оставить пустым, Sakura сама найдёт
           установленную Java.
         </p>
       </section>

       <section className="settingSection">
         <h3>Запуск</h3>

         <div className="twoCols">
           <label>
             RAM min

             <input
               type="number"
               min="512"
               value={settings.minRam}
               onChange={e=>
                 set(
                   "minRam",
                   Number(e.target.value)
                 )
               }
             />
           </label>

           <label>
             RAM max

             <input
               type="number"
               min="1024"
               value={settings.maxRam}
               onChange={e=>
                 set(
                   "maxRam",
                   Number(e.target.value)
                 )
               }
             />
           </label>

           <label>
             Ширина

             <input
               type="number"
               value={settings.width}
               onChange={e=>
                 set(
                   "width",
                   Number(e.target.value)
                 )
               }
             />
           </label>

           <label>
             Высота

             <input
               type="number"
               value={settings.height}
               onChange={e=>
                 set(
                   "height",
                   Number(e.target.value)
                 )
               }
             />
           </label>
         </div>

         <label>
           JVM аргументы

           <input
             className="accentText"
             value={settings.jvmArgs}
             onChange={e=>
               set(
                 "jvmArgs",
                 e.target.value
               )
             }
             placeholder="-XX:+UseG1GC"
           />
         </label>

         <Toggle
           label="Полный экран"
           value={settings.fullscreen}
           onChange={v=>
             set(
               'fullscreen',
               v
             )
           }
         />
       </section>

       <section className="settingSection particleEditor">
         <div className="sectionTitle">
           <div>
             <h3>
               Редактор частиц
             </h3>

             <p>
               Настрой поток лепестков
               в реальном времени.
             </p>
           </div>

           <span className="particlePreview">
             ✦
           </span>
         </div>

         <Toggle
           label="Включить частицы"
           value={settings.particles}
           onChange={v=>
             set(
               'particles',
               v
             )
           }
         />

         <Range
           label="Количество"
           value={settings.particleCount}
           min={8}
           max={100}
           step={1}
           onChange={v=>
             set(
               'particleCount',
               v
             )
           }
         />

         <Range
           label="Скорость"
           value={settings.particleSpeed}
           min={0.3}
           max={2.5}
           step={0.1}
           suffix="×"
           onChange={v=>
             set(
               'particleSpeed',
               v
             )
           }
         />

         <Range
           label="Прозрачность"
           value={settings.particleOpacity}
           min={0.08}
           max={0.75}
           step={0.01}
           onChange={v=>
             set(
               'particleOpacity',
               v
             )
           }
         />

         <Range
           label="Размер"
           value={settings.particleSize}
           min={0.5}
           max={2.5}
           step={0.1}
           suffix="×"
           onChange={v=>
             set(
               'particleSize',
               v
             )
           }
         />
       </section>
     </div>

     <div className="settingsBottom">
       <span>
         Настройки сохраняются на этом компьютере.
       </span>

       <div>
         <button
           className="resetBtn"
           onClick={reset}
         >
           Сбросить
         </button>

         <button
           className="play small"
           onClick={close}
         >
           Готово
         </button>
       </div>
     </div>
   </div>
 </div>
}

function Toggle({
 label,
 value,
 onChange
}){
 return <button
   className={
     'toggle '+(value?'on':'')
   }
   onClick={()=>onChange(!value)}
 >
   <span>{label}</span>
   <i/>
 </button>
}

function Range({
 label,
 value,
 min,
 max,
 step,
 onChange,
 suffix=''
}){
 return <label className="range">
   <span>
     <b>{label}</b>
     <em>
       {value}
       {suffix}
     </em>
   </span>

   <input
     type="range"
     min={min}
     max={max}
     step={step}
     value={value}
     onChange={e=>
       onChange(
         Number(e.target.value)
       )
     }
   />
 </label>
}

function ProfileModal({
 profile,
 accounts,
 close,
 save,
 select
}){
 const [name,setName]=useState(
   profile.name
 );

 return <div className="modalShade">
   <div className="modal">
     <button
       className="close"
       onClick={close}
     >
       ×
     </button>

     <span className="eyebrow">
       ПРОФИЛЬ
     </span>

     <h2>
       Профили Minecraft
     </h2>

     <p className="modalHint">
       Локальные профили. Для серверов с
       online-mode потребуется Microsoft-авторизация.
     </p>

     {accounts
       .filter(Boolean)
       .map(a=>
         <button
           key={a}
           className={
             a===profile.name
               ? 'chosen'
               : ''
           }
           onClick={()=>select(a)}
         >
           {a}
         </button>
       )
     }

     <input
       value={name}
       onChange={e=>
         setName(
           e.target.value
             .replace(
               /[^A-Za-z0-9_]/g,
               ''
             )
             .slice(0,16)
         )
       }
       placeholder="Новый ник"
     />

     <button
       className="play full"
       disabled={name.length<3}
       onClick={()=>
         save({name})
       }
     >
       Добавить / сохранить
     </button>
   </div>
 </div>
}

createRoot(
  document.getElementById('root')
).render(
  <App/>
);
