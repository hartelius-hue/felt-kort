'use strict';
const el = id => document.getElementById(id);
const themes = {T:['Teknologiforståelse','#065e54'],I:['Ingeniørkunst','#254d8a'],V:['Vand og energi','#764017'],N:['Naturvidenskab','#714477']};
const byId = new Map(stops.map(s => [s.id,s]));
const map = el('map');
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const readSaved = () => {try{return JSON.parse(localStorage.getItem('feltkort')||'{}')||{};}catch{return {};}};
const saved = readSaved();
const readIds = input => [...new Set(input.map(Number).filter(id=>byId.has(id)))].slice(0,stops.length);
const share = new URLSearchParams(location.hash.slice(1));
let route = readIds(share.has('r') ? share.get('r').split(',') : Array.isArray(saved.route) ? saved.route : []);
function nameForRoute(ids){
  return walks.find(([, , , walk]) => walk.join(',')===ids.join(','))?.[0] ?? 'Min rute';
}
let routeName = share.has('r') ? nameForRoute(route) : (typeof saved.name==='string' ? saved.name : 'Min rute');
let selected = null, view = 'explore', player = -1, path = null, routeVersion = 0;
let zoom = 13, center = [56.158,10.209], shown = stops, drag, drawFrame;
let mapInitialized = false;
if (['0','1','2'].includes(share.get('k') ?? saved.level)) el('level').value=share.get('k') ?? saved.level;
if ([45,90,120,150,180].includes(Number(share.get('t') ?? saved.budget))) el('budget').value=share.get('t') ?? saved.budget;
if (Number(share.get('m') ?? saved.dwell) >= 2 && Number(share.get('m') ?? saved.dwell) <= 45) el('dwell').value=share.get('m') ?? saved.dwell;
function routeParams(){
  return new URLSearchParams({r:route.join(','),k:el('level').value,t:el('budget').value,m:el('dwell').value});
}
function persist(){
  if(new URLSearchParams(location.hash.slice(1)).has('r')){
    const url=new URL(location.href);
    url.hash=route.length?routeParams().toString():'';
    history.replaceState(history.state,'',url);
  }
  try{localStorage.setItem('feltkort',JSON.stringify({route,name:routeName,level:el('level').value,budget:el('budget').value,dwell:el('dwell').value}));}catch{}
}
function world(lat,lon,z=zoom){
  const size=256*2**z, s=Math.sin(lat*Math.PI/180);
  return [(lon+180)/360*size,(.5-Math.log((1+s)/(1-s))/(4*Math.PI))*size];
}
function geography(x,y,z=zoom){
  const size=256*2**z;
  return [Math.atan(Math.sinh(Math.PI*(1-2*y/size)))*180/Math.PI,x/size*360-180];
}
function fit(points){
  if(!points.length)return;
  const coords=points.map(p=>world(p.lat,p.lon,0));
  const xs=coords.map(p=>p[0]), ys=coords.map(p=>p[1]);
  const left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys);
  const scale=Math.min(Math.max(100,map.clientWidth-90)/Math.max(right-left,.0001),Math.max(100,map.clientHeight-90)/Math.max(bottom-top,.0001));
  zoom=Math.min(17,Math.max(10,Math.floor(Math.log2(scale))));
  center=geography((left+right)/2,(top+bottom)/2,0);
  scheduleDraw();
}
function move(dx,dy){
  const [x,y]=world(...center);
  const [lat,lon]=geography(x+dx,y+dy);
  center=[Math.max(55.9,Math.min(56.42,lat)),Math.max(9.8,Math.min(10.6,lon))];
  scheduleDraw();
}
function setZoom(next,x=map.clientWidth/2,y=map.clientHeight/2){
  const target=Math.min(19,Math.max(10,next));
  if(target===zoom)return;
  const dx=x-map.clientWidth/2,dy=y-map.clientHeight/2;
  const [wx,wy]=world(...center), scale=2**(target-zoom);
  zoom=target;
  center=geography((wx+dx)*scale-dx,(wy+dy)*scale-dy);
  scheduleDraw();
}
function scheduleDraw(){
  cancelAnimationFrame(drawFrame);
  drawFrame=requestAnimationFrame(draw);
}
const markerNodes=new Map(), tileNodes=new Map();
function visiblePoints(){
  return view==='route'&&route.length?route.map(id=>byId.get(id)):shown;
}
function updateTileStatus(){
  const tiles=[...tileNodes.values()];
  const unavailable=tiles.length>0&&tiles.every(img=>img.complete&&!img.naturalWidth);
  el('tileStatus').hidden=!unavailable;
  if(unavailable)el('tileStatus').textContent='Baggrundskortet kunne ikke hentes. I kan stadig vælge stop på kortet og i listen.';
}
const coastline=[[56.279,10.32],[56.243,10.31],[56.219,10.27],[56.194,10.248],[56.175,10.236],[56.165,10.22],[56.16,10.215],[56.154,10.219],[56.15,10.227],[56.139,10.224],[56.119,10.233],[56.092,10.256],[56.06,10.273],[56.02,10.30]];
function draw(){
  const w=map.clientWidth,h=map.clientHeight;
  if(!w||!h)return;
  const [wx,wy]=world(...center), ox=wx-w/2,oy=wy-h/2;
  const pos=(lat,lon)=>{const [x,y]=world(lat,lon);return [x-ox,y-oy];};
  const keep=new Set();
  for(let x=Math.floor(ox/256);x<=Math.floor((ox+w)/256);x++){
    for(let y=Math.floor(oy/256);y<=Math.floor((oy+h)/256);y++){
      const key=[zoom,x,y].join('/');
      keep.add(key);
      if(!tileNodes.has(key)){
        const img=new Image();
        img.alt='';img.className='tile';img.draggable=false;img.referrerPolicy='strict-origin-when-cross-origin';
        img.onload=updateTileStatus;
        img.onerror=()=>{img.hidden=true;updateTileStatus();};
        img.src='https://tile.openstreetmap.org/'+key+'.png';
        el('tiles').append(img);tileNodes.set(key,img);
      }
      tileNodes.get(key).style.transform='translate('+Math.round(x*256-ox)+'px,'+Math.round(y*256-oy)+'px)';
    }
  }
  for(const [key,img] of tileNodes)if(!keep.has(key)){img.remove();tileNodes.delete(key);}
  updateTileStatus();
  const canvas=el('lines'), ratio=Math.min(2,devicePixelRatio||1);
  canvas.width=w*ratio;canvas.height=h*ratio;canvas.style.width=w+'px';canvas.style.height=h+'px';
  const ctx=canvas.getContext('2d');ctx.scale(ratio,ratio);
  const base=el('coast');base.width=w*ratio;base.height=h*ratio;
  base.style.width=w+'px';base.style.height=h+'px';
  const bg=base.getContext('2d');bg.scale(ratio,ratio);
  bg.fillStyle='#d5e9ef';bg.fillRect(0,0,w,h);
  bg.fillStyle='#edf2e6';bg.beginPath();bg.moveTo(-2,-100000);
  for(const [lat,lon] of coastline)bg.lineTo(...pos(lat,lon));
  bg.lineTo(-2,100000);bg.closePath();bg.fill();
  const coords=path?.geometry ?? route.map(id=>{const s=byId.get(id);return [s.lon,s.lat];});
  if(coords.length>1){
    ctx.beginPath();coords.forEach(([lon,lat],i)=>{const point=pos(lat,lon);i===0?ctx.moveTo(...point):ctx.lineTo(...point);});
    ctx.lineCap='round';ctx.lineJoin='round';
    if(!path)ctx.setLineDash([6,6]);
    ctx.lineWidth=7;ctx.strokeStyle='#fff';ctx.stroke();ctx.lineWidth=4;ctx.strokeStyle='#a44012';ctx.stroke();
  }
  const pins=visiblePoints();
  const display=new Set(), groups=new Map();
  for(const s of pins){
    const [x,y]=pos(s.lat,s.lon);
    if(x<0||x>w||y<0||y>h)continue;
    const key=Math.round(x/33)+':'+Math.round(y/33);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push({s,x,y});
  }
  for(const group of groups.values())group.forEach(({s,x,y},i)=>{
    display.add(s.id);
    let node=markerNodes.get(s.id);
    if(!node){
      node=document.createElement('button');node.className='pin';node.style.setProperty('--pin',themes[s.theme][1]);
      node.setAttribute('aria-label',s.id+'. '+s.name);node.title=s.name;
      node.onclick=()=>openStop(s.id,true);
      el('pins').append(node);markerNodes.set(s.id,node);
    }
    const a=i*2*Math.PI/group.length, offset=group.length>1?Math.min(35,8+group.length*4):0;
    node.style.left=Math.max(16,Math.min(w-16,x+Math.cos(a)*offset))+'px';
    node.style.top=Math.max(16,Math.min(h-24,y+Math.sin(a)*offset))+'px';
    node.textContent=view==='route'&&route.length?route.indexOf(s.id)+1:s.id;
    node.setAttribute('aria-label',(view==='route'&&route.length?'Rutestop '+(route.indexOf(s.id)+1):s.id)+'. '+s.name);
    node.classList.toggle('in-route',route.includes(s.id));
    node.setAttribute('aria-current',String(selected===s.id));
  });
  for(const [id,node] of markerNodes)if(!display.has(id)){node.remove();markerNodes.delete(id);}
  el('visible').textContent=pins.length+' stop';
}
map.addEventListener('pointerdown',e=>{
  if(e.target!==map||e.button!==0)return;
  drag={x:e.clientX,y:e.clientY};map.setPointerCapture(e.pointerId);map.classList.add('drag');
});
map.addEventListener('pointermove',e=>{
  if(!drag)return;
  move(drag.x-e.clientX,drag.y-e.clientY);drag={x:e.clientX,y:e.clientY};
});
for(const name of ['pointerup','pointercancel','lostpointercapture'])map.addEventListener(name,()=>{drag=null;map.classList.remove('drag');});
map.addEventListener('wheel',e=>{
  if(!e.ctrlKey&&!e.metaKey)return;
  e.preventDefault();const bounds=map.getBoundingClientRect();
  setZoom(zoom+(e.deltaY<0?1:-1),e.clientX-bounds.left,e.clientY-bounds.top);
},{passive:false});
map.addEventListener('keydown',e=>{
  if(e.target!==map)return;
  const dirs={ArrowLeft:[-75,0],ArrowRight:[75,0],ArrowUp:[0,-75],ArrowDown:[0,75]};
  if(e.key in dirs){e.preventDefault();move(...dirs[e.key]);}
  if(e.key==='+'||e.key==='-'){e.preventDefault();setZoom(zoom+(e.key==='+'?1:-1));}
});
el('plus').onclick=()=>setZoom(zoom+1);el('minus').onclick=()=>setZoom(zoom-1);el('reset').onclick=()=>fit(visiblePoints());
new ResizeObserver(()=>{if(!mapInitialized&&map.clientWidth){mapInitialized=true;fit(view==='route'&&route.length?route.map(id=>byId.get(id)):stops);}else scheduleDraw();}).observe(map);

const drawings={
  bil:'M18 82V73L32 61H46L61 42H113L136 65L150 72V91H136 M108 91H59 M32 91H18V82 M46 61H135 M74 43L66 61 M47 91m-11 0a11 11 0 1 0 22 0a11 11 0 1 0 -22 0 M124 91m-11 0a11 11 0 1 0 22 0a11 11 0 1 0 -22 0',
  sluse:'M13 48H53V92H13 M107 92V48H147 M53 47L107 67V93 M53 47V29H107V67 M20 73q8-8 16 0t16 0 M108 76q8-8 16 0t16 0 M59 103h45 M65 85V54 M78 91V59 M91 93V63',
  tog:'M19 88V60q0-14 14-14h85q10 0 20 10l12 18v14Z M30 58H119L132 72H30Z M58 58V72 M92 58V72 M30 105H143 M54 47l24-24 25 23 M33 23h105 M42 96h17 M114 96h17',
  varme:'M24 51H54V36H104V51H137V92H105V74H55V92H24Z M66 71V43 M79 71V43 M92 71V43 M14 104H146 M45 25q8-8 1-15 M80 25q8-8 1-15 M114 25q8-8 1-15',
  bad:'M16 49H146V100H16Z M38 49V32q0-15 9-15t9 15v32 M59 49V26q0-12 9-12t9 12v38 M38 57h39 M38 65h39 M27 78q9-9 18 0t18 0 18 0 18 0 18 0 18 0 M27 90q9-9 18 0t18 0 18 0 18 0 18 0 18 0',
  tårn:'M26 103H143 M52 103V26L112 14V103 M52 26H112 M52 43H112 M52 61H112 M52 79H112 M67 43V26 M87 43V26 M70 61V43 M96 61V43 M70 79V61 M96 79V61 M74 103V79 M96 103V79 M112 14l18 12v77',
  bro:'M12 58H149V69H12Z M20 58L49 28L81 58L112 28L141 58 M49 28V58 M112 28V58 M47 69V99 M111 69V99 M14 103q8-7 16 0t16 0 16 0 16 0 16 0 16 0 16 0 16 0',
  plante:'M20 104V66a61 48 0 1 1 122 0v38Z M42 104V62 M120 104V62 M20 67h122 M80 104V67 M81 91q8-29 31-26-6 23-31 26 M80 92Q62 69 47 80Q60 99 80 92 M80 104V89',
  sø:'M13 73Q45 45 76 63T148 64 M15 89q13-10 26 0t26 0 26 0 26 0 26 0 M22 103q13-10 26 0t26 0 26 0 26 0 M38 60V30 M38 45L24 31 M38 48l13-15 M125 60V26 M125 38l13-14 M125 45l-14-13 M68 33q10-9 21 2q10-11 20-3',
  tag:'M16 96L45 60L105 23L144 89H20 M54 90V67l50-29 28 52 M68 90V62 M85 90V53 M102 90V43 M120 90V63 M20 102H145',
  kuppel:'M21 100V77a59 55 0 0 1 118 0v23Z M20 78h120 M64 77l15-34 11-12 M77 49l29-22 8 11-28 22Z M86 61l-15 34 M89 59l14 36 M68 32l7-9 M52 41l4-8 M116 16l6-6',
  bog:'M16 29H63Q78 29 80 39Q82 29 98 29H145V91H98Q85 91 80 101Q73 91 63 91H16Z M80 39V101 M27 47h36 M27 63h36 M27 78h36 M96 47h36 M96 63h36 M96 78h36',
  glas:'M18 93L48 37H143L113 93Z M31 69h95 M68 37L38 93 M94 37L64 93 M120 37L90 93 M18 93v9h95l30-56v-9 M113 93v9',
  regnbue:'M21 94A59 59 0 0 1 139 94 M31 94A49 49 0 0 1 129 94 M41 94A39 39 0 0 1 119 94 M51 94A29 29 0 0 1 109 94 M61 94A19 19 0 0 1 99 94 M12 101H148',
  lyd:'M23 84H46L70 102V30L46 49H23Z M83 50q20 16 0 34 M97 41q31 25 0 51 M112 30q46 37 0 72 M29 57v19',
  laser:'M19 29H141V100H19Z M19 81H141 M55 29V49H105V29 M72 49v9h16v-9 M80 58V81 M67 74l-10-6 M94 74l10-6 M32 90h32 M115 90h13',
  ur:'M58 104V24L80 12L102 24V104 M47 104H114 M58 84h44 M67 83V71 M90 83V71 M80 44m-13 0a13 13 0 1 0 26 0a13 13 0 1 0 -26 0 M80 33v11l7 5',
  skib:'M16 78h131l-16 18H37Z M79 23v55 M76 28L46 68h30 M82 34l33 34H82 M25 108q8-8 16 0t16 0 16 0 16 0 16 0 16 0 16 0 M79 23l19 5-19 5',
  kran:'M14 105H148 M47 105V18H64V105 M47 18H137L120 32H47 M63 34L47 50l17 17-17 17 17 15 M120 32v42q0 10 8 7 M108 84h34v17h-34z M48 18L31 32H47',
  genbrug:'M38 38H68V80H38Z M32 38H74 M47 28h12v10 M45 48v22 M60 48v22 M91 45a19 19 0 0 1 37 4l-6-5 M128 49l6-6 M126 58a19 19 0 0 1-36-2l6 5 M90 56l-6 6 M27 91h109',
  mølle:'M80 57m-39 0a39 39 0 1 0 78 0a39 39 0 1 0 -78 0 M80 18v78 M41 57h78 M53 30l54 54 M107 30L53 84 M80 57m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0 M15 106q10-10 20 0t20 0 20 0 20 0 20 0 20 0',
  dyr:'M39 32q-17-16-25 0-5 12 10 20-1 16 12 17 10 0 13-14l64 21q-3 15 8 19 15 4 19-11 17-2 14-16-2-11-17-10-11-14-22 0L49 39q-3-7-10-7Z',
  signal:'M77 110V89 M58 89V17h39v72Z M39 110h78 M77 31m-6 0a6 6 0 1 0 12 0a6 6 0 1 0 -12 0 M77 52m-6 0a6 6 0 1 0 12 0a6 6 0 1 0 -12 0 M77 73m-6 0a6 6 0 1 0 12 0a6 6 0 1 0 -12 0',
  kort:'M13 37h85v52H13z M13 55h85 M23 72h24 M119 27h29v74h-29z M125 41h17 M128 65h11 M128 75h11 M128 85h11',
  print:'M24 28h112v76H24z M57 28v17h46V28 M77 45v11h6V45 M41 88h78 M59 88V72l21-10 21 10v16 M80 62v26',
  hjælp:'M17 85h26l25-17h24q12 0 12 8t-12 8H74 M104 78l26-16q9-6 14 0t-1 12l-35 25H60l-15 9H17z M67 31q9-15 21 0 12-15 21 0 4 10-21 26-25-16-21-26Z',
  fund:'M55 20h50 M60 20v15q-16 8-16 24 0 23 18 42h36q18-19 18-42 0-16-16-24V20 M45 48q-20-4-19 12 0 12 21 16 M115 48q20-4 19 12 0 12-21 16 M48 64h64 M52 77h55 M64 64l6 13 10-13 9 13 8-13'
};
const imageCache=new Map();
function illustration(s){
  if(imageCache.has(s.id))return imageCache.get(s.id);
  const canvas=document.createElement('canvas');canvas.width=680;canvas.height=300;
  const g=canvas.getContext('2d'), color={T:'#78e3c2',I:'#a6c8ff',V:'#ffbc87',N:'#dbb8f0'}[s.theme];
  const gradient=g.createLinearGradient(0,0,680,300);
  gradient.addColorStop(0,'#112a38');gradient.addColorStop(1,themes[s.theme][1]);
  g.fillStyle=gradient;g.fillRect(0,0,680,300);
  g.strokeStyle='#ebffff22';g.lineWidth=1;
  for(let x=12;x<680;x+=26){g.beginPath();g.moveTo(x,0);g.lineTo(x,300);g.stroke();}
  for(let y=16;y<300;y+=26){g.beginPath();g.moveTo(0,y);g.lineTo(680,y);g.stroke();}
  g.strokeStyle='#e2f4fa50';g.beginPath();g.arc(340,134,116,0,Math.PI*2);g.stroke();
  g.save();
  g.translate(145,0);g.scale(2.43,2.43);g.lineWidth=2.2;
  g.lineCap='round';g.lineJoin='round';g.strokeStyle=color;
  g.stroke(new Path2D(drawings[s.icon]??drawings.tag));g.restore();
  const url=canvas.toDataURL('image/png');imageCache.set(s.id,url);return url;
}
function question(s){
  return s.questions[Number(el('level').value)];
}
function announce(message){el('status').textContent=message;}
function speak(s,feedback){
  if(!('speechSynthesis' in window)||!('SpeechSynthesisUtterance' in window)){feedback.textContent='Denne browser kan ikke læse højt. I kan læse teksten på skærmen.';return;}
  speechSynthesis.cancel();
  const text=new SpeechSynthesisUtterance(s.name.replace(/[:·]/g,'.')+'. '+s.learn+' '+question(s));
  text.lang='da-DK';text.rate=.92;
  const voices=speechSynthesis.getVoices();
  const voice=voices.find(v=>/^da([-_]|$)/i.test(v.lang));
  if(!voice&&voices.length){feedback.textContent='Der er ingen dansk stemme på denne enhed. I kan læse teksten på skærmen.';return;}
  if(voice)text.voice=voice;
  text.onstart=()=>{feedback.textContent='Læser op …';};
  text.onend=()=>{feedback.textContent='';};
  text.onerror=e=>{if(!['interrupted','canceled'].includes(e.error))feedback.textContent='Oplæsningen kunne ikke starte. Tjek enhedens indstillinger for dansk tale.';};
  feedback.textContent='Starter oplæsning …';
  speechSynthesis.speak(text);
}
function stopSpeaking(){if('speechSynthesis' in window)speechSynthesis.cancel();}
function locationLink(s){return 'https://www.google.com/maps/search/?api=1&query='+s.lat+'%2C'+s.lon;}
function walkingLink(from,to){
  return 'https://www.google.com/maps/dir/?api=1&travelmode=walking&origin='+from.lat+'%2C'+from.lon+'&destination='+to.lat+'%2C'+to.lon;
}
const photoPages = {
  1:'https://www.arkitekturbilleder.dk/bygning/parkeringsanlaeg-dokk1',
  5:'https://www.detail.de/de_en/water-in-public-space-aarhus-harbor-bath-by-big-32752',
  6:'https://www.arkitekturbilleder.dk/bygning/salling-taarnet',
  8:'https://sciencemuseerne.dk/vaeksthusene',
  11:'https://www.rasmushjortshoj.com/architectural-photo-02/moesgaard-museum?itemId=twsfp5043pkqn4g3yssoq1d588hmpz',
  12:'https://realdania.dk/nyhedsoverblik/nyheder/2022/08/ole-roemer-observatoriet',
  15:'https://www.aros.dk/en/aros-collection/olafur-eliasson-your-rainbow-panorama-2011/',
  19:'https://commons.wikimedia.org/wiki/File:Aarhus_R%C3%A5dhus_t%C3%A5rn.jpg',
  22:'https://www.au.dk/nyheder/artikel/nu-saetter-aarhus-universitet-sin-ejerdel-i-navitas-til-salg',
  23:'https://www.schueco.com/dk/arkitekt-og-projektering/inspiration/lighthouse-aarhus',
  24:'https://commons.wikimedia.org/wiki/File:Isbjerget_2_2014-09-23.jpg',
  29:'https://kongelunden.aarhus.dk/oplev/attraktioner/den-uendelige-bro',
  42:'https://aarhuswiki.dk/wiki/%C3%98stbaneg%C3%A5rden',
  43:'https://commons.wikimedia.org/wiki/File:Universitets_parken_Aarhus.jpg',
  50:'https://pipeorganmap.com/organ/Aarhus_Dom_St._Clemens_Main_Organ',
  51:'https://dokkx.aarhus.dk/besoeg-dokkx',
  52:'https://aarhus.dk/nyt/teknik-og-miljoe/2024/april-2024/intelligente-lyssignaler-faar-trafikken-paa-viby-torv-til-at-glide-bedre',
  53:'https://www.aakb.dk/viby',
  54:'https://www.transform.dk/da/project/gellerup-bibliotek'
};
function card(s){
  const photo=photoPages[s.id];
  const photoLink=photo && photo!==s.source?'<a href="'+photo+'" target="_blank" rel="noopener">Se foto hos kilden</a>':'';
  return '<figure class="stop-figure"><img src="'+illustration(s)+'" alt=""><figcaption>Illustration af emnet</figcaption></figure>'+
    '<div class="detailtext"><div class="meta">'+themes[s.theme][0]+' · '+s.access+'</div>'+
    '<h2>'+escapeHtml(s.name)+'</h2><p class="meta">'+escapeHtml(s.place)+'</p><p>'+escapeHtml(s.learn)+'</p>'+
    '<div class="question"><strong>Opgave på stedet</strong><br>'+escapeHtml(question(s))+'</div>'+
    '<div class="links"><a href="'+s.source+'" target="_blank" rel="noopener">Adgang og faglig kilde</a>'+photoLink+
    '<a href="'+locationLink(s)+'" target="_blank" rel="noopener">Åbn i Google Maps</a></div></div>';
}
function renderDetail(){
  const node=el('detail'), s=byId.get(selected);
  node.hidden=!s;
  if(!s)return;
  node.innerHTML='<article class="detailbox">'+card(s)+'<div class="detailtext"><div class="actions"><button id="addStop" class="primary">'+(route.includes(s.id)?'Fjern fra ruten':'Tilføj til ruten')+'</button><button id="readStop">Læs op</button><button id="stopRead">Stop oplæsning</button><button id="closeStop">Luk</button></div><div role="status" class="meta" id="audioStatus"></div></div></article>';
  el('addStop').onclick=()=>{changeRoute(route.includes(s.id)?route.filter(id=>id!==s.id):[...route,s.id]);el('addStop').focus();};
  el('readStop').onclick=()=>speak(s,el('audioStatus'));
  el('stopRead').onclick=()=>{stopSpeaking();el('audioStatus').textContent='';};
  el('closeStop').onclick=()=>{selected=null;stopSpeaking();renderDetail();filter();el('search').focus();};
}
function openStop(id,pan){
  selected=id;stopSpeaking();setView('explore');
  if(pan){
    const s=byId.get(id);center=[s.lat,s.lon];zoom=Math.max(zoom,16);
  }
  if(!shown.some(s=>s.id===id)){
    for(const key of ['search','theme','access'])el(key).value='';
  }
  renderDetail();filter();
  el('detail').querySelector('h2').setAttribute('tabindex','-1');
  el('detail').querySelector('h2').focus({preventScroll:true});
  if(matchMedia('(max-width: 760px)').matches)el('detail').scrollIntoView({block:'start'});
}
function filter(){
  const query=el('search').value.trim().toLocaleLowerCase('da'), theme=el('theme').value, access=el('access').value;
  const free=['Udefra','Gratis inde'];
  for(const button of el('legend').querySelectorAll('button'))button.setAttribute('aria-pressed',String(theme===button.dataset.theme));
  shown=stops.filter(s=>(!theme||s.theme===theme)&&(!query||[s.name,s.place,s.learn,...s.questions,themes[s.theme][0]].join(' ').toLocaleLowerCase('da').includes(query))&&(!access||(access==='free'?free.includes(s.access):access==='inside'?s.access==='Gratis inde':!free.includes(s.access))));
  if(selected&&!shown.some(s=>s.id===selected)){selected=null;stopSpeaking();renderDetail();}
  el('results').innerHTML=shown.length?shown.map(s=>'<button class="result" data-stop="'+s.id+'" aria-current="'+(selected===s.id)+'"><span class="stop-number" style="--pin:'+themes[s.theme][1]+'">'+s.id+'</span><span>'+escapeHtml(s.name)+'</span><small>'+s.access+'</small></button>').join('') : '<p>Ingen stop på den søgning. Prøv et andet ord, eller fjern et filter.</p>';
  scheduleDraw();
}
function setView(name){
  if(name!=='route')stopSpeaking();
  view=name;document.querySelector('.layout').dataset.view=name;
  for(const node of document.querySelectorAll('[data-view]')){
    node.setAttribute('aria-pressed',String(node.dataset.view===name));
    el(node.dataset.view).hidden=node.dataset.view!==name;
  }
  el('pane').scrollTop=0;scheduleDraw();
}
document.querySelector('nav').addEventListener('click',e=>{const name=e.target.closest('[data-view]')?.dataset.view;if(name){setView(name);if(name==='route'){renderRoute();if(route.length)fit(route.map(id=>byId.get(id)));}el('fieldmap').scrollIntoView();}});
el('results').addEventListener('click',e=>{const id=Number(e.target.closest('[data-stop]')?.dataset.stop);if(id)openStop(id,true);});
el('search').addEventListener('input',filter);
for(const id of ['theme','access'])el(id).addEventListener('change',()=>{filter();fit(shown);});
for(const [key,[name,color]] of Object.entries(themes)){
  el('theme').add(new Option(name,key));
  const badge=document.createElement('button');
  badge.type='button';badge.dataset.theme=key;badge.textContent=name;
  badge.style.setProperty('--pin',color);el('legend').append(badge);
  badge.onclick=()=>{
    const theme=el('theme');
    theme.value=theme.value===key?'':key;
    setView('explore');filter();fit(shown);
  };
}
el('level').onchange=()=>{stopSpeaking();persist();renderDetail();renderPlayer();};
el('suggestions').innerHTML=walks.map(([name,level,desc,ids,minutes],i)=>'<article class="walk"><div class="meta">'+level+' · '+ids.length+' stop · '+minutes+' min.</div><h3>'+name+'</h3><p>'+desc+'</p><button data-walk="'+i+'">Brug ruten</button></article>').join('');
el('suggestions').onclick=e=>{
  const i=e.target.closest('[data-walk]')?.dataset.walk;
  if(i===undefined)return;
  if(route.length&&!confirm('Vil du erstatte den nuværende rute med temaruten?'))return;
  const [name,,,ids,minutes]=walks[Number(i)];
  el('budget').value=String(minutes);changeRoute([...ids],name);setView('route');fit(route.map(id=>byId.get(id)));
};
function distance(a,b){
  const rad=Math.PI/180, half=(b.lat-a.lat)*rad/2, side=(b.lon-a.lon)*rad/2;
  const h=Math.sin(half)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(side)**2;
  return 12742*Math.asin(Math.sqrt(h));
}
function changeRoute(next,name='Min rute'){
  stopSpeaking();route=next;routeName=name;player=-1;path=null;announce('');
  persist();renderDetail();renderRoute();scheduleDraw();fetchPath();
}
function renderRoute(updateRows=true){
  el('count').textContent=route.length;
  el('routeTitle').textContent=routeName;
  el('routeActions').hidden=!route.length;
  if(!route.length){
    el('routeSummary').textContent='Åbn et stop under Kortet, og vælg Tilføj til ruten.';
    el('routeRows').innerHTML='';renderPlayer();return;
  }
  const points=route.map(id=>byId.get(id));
  const estimated=points.slice(1).reduce((sum,p,i)=>sum+distance(points[i],p),0)*1.4;
  const km=path?.km ?? estimated, minutes=Math.ceil(km/3.5*60);
  const total=minutes+route.length*Number(el('dwell').value||8), budget=Number(el('budget').value);
  const format=new Intl.NumberFormat('da-DK',{maximumFractionDigits:1});
  const timing=route.length>1?'Ca. '+format.format(km)+' km og '+minutes+' min. gang. ':'';
  const basis=route.length<2?'':path?' Gangtiden er regnet ved 3,5 km/t.':' Afstanden er skønnet ud fra luftlinje. Den stiplede linje viser kun stoprækkefølgen.';
  el('routeSummary').textContent=timing+'Med ophold ved '+route.length+' stop tager turen ca. '+total+' min. '+
    (total>budget?'Det er mere end de '+budget+' min., I har sat af.':'Det kan være inden for de '+budget+' min., I har sat af.')+basis;
  if(!updateRows)return;
  el('routeRows').innerHTML=points.map((s,i)=>{
    const walk=i?'<a class="meta" href="'+walkingLink(points[i-1],s)+'" target="_blank" rel="noopener">Gangvej fra forrige stop</a>':'';
    return '<div class="routeRow"><div><button data-open="'+s.id+'">'+(i+1)+'. '+escapeHtml(s.name)+'</button><p class="meta">'+s.access+(walk?' · '+walk:'')+'</p></div><div><button data-order="'+i+':-1" '+(i===0?'disabled ':'')+'aria-label="Flyt '+escapeHtml(s.name)+' op">↑</button> <button data-order="'+i+':1" '+(i===points.length-1?'disabled ':'')+'aria-label="Flyt '+escapeHtml(s.name)+' ned">↓</button> <button data-remove="'+s.id+'" aria-label="Fjern '+escapeHtml(s.name)+'">×</button></div></div>';
  }).join('');
  renderPlayer();
}
let pathController;
async function fetchPath(){
  pathController?.abort();
  const version=++routeVersion;
  if(route.length<2||route.length>12)return;
  const coords=route.map(id=>{const s=byId.get(id);return s.lon+','+s.lat;}).join(';');
  const controller=new AbortController();
  pathController=controller;
  const timeout=setTimeout(()=>controller.abort(),8000);
  try{
    const response=await fetch('https://routing.openstreetmap.de/routed-foot/route/v1/driving/'+coords+'?overview=full&geometries=geojson&steps=false',{signal:controller.signal});
    if(!response.ok)return;
    const result=(await response.json()).routes?.[0];
    if(version!==routeVersion||!Array.isArray(result?.geometry?.coordinates)||!Number.isFinite(result.distance))return;
    path={geometry:result.geometry.coordinates,km:result.distance/1000};renderRoute(false);scheduleDraw();
  }catch{}finally{clearTimeout(timeout);}
}
el('routeRows').onclick=e=>{
  const button=e.target.closest('button');
  if(!button)return;
  if(button.dataset.open)openStop(Number(button.dataset.open),true);
  if(button.dataset.remove)changeRoute(route.filter(id=>id!==Number(button.dataset.remove)));
  if(button.dataset.order){
    const [i,offset]=button.dataset.order.split(':').map(Number), next=[...route], j=i+offset;
    if(j<0||j>=next.length)return;
    [next[i],next[j]]=[next[j],next[i]];changeRoute(next);
    const selector='[data-order="'+j+':'+offset+'"]:not(:disabled)';
    (el('routeRows').querySelector(selector)??el('routeRows').querySelector('[data-open="'+next[j]+'"]'))?.focus();
  }
};
for(const id of ['budget','dwell'])el(id).onchange=()=>{
  el('dwell').value=String(Math.min(45,Math.max(2,Number(el('dwell').value)||8)));persist();renderRoute();
};
el('fit').onclick=()=>fit(route.map(id=>byId.get(id)));
el('clear').onclick=()=>{if(confirm('Vil du fjerne alle stop fra ruten?')){changeRoute([]);announce('Ruten er tømt.');}};
el('copy').onclick=async()=>{
  const link=new URL(location.href);
  link.hash=routeParams().toString();
  try{await navigator.clipboard.writeText(link.href);announce('Rutelinket er kopieret.');}
  catch{prompt('Kopiér rutelinket',link.href);}
};
function renderPlayer(){
  const node=el('player');node.hidden=player<0||player>=route.length;
  if(node.hidden)return;
  const s=byId.get(route[player]);
  node.innerHTML='<div class="playercard"><p class="meta">Lydvandring · stop '+(player+1)+' af '+route.length+'</p>'+card(s)+'<div class="actions"><button id="prev" '+(player===0?'disabled':'')+'>Forrige</button><button id="play" class="primary">Læs stoppet op</button><button id="mute">Stop lyd</button><button id="next" '+(player===route.length-1?'disabled':'')+'>Næste</button><button id="finish">Afslut</button></div><p class="meta" role="status" id="playerStatus"></p></div>';
  el('play').onclick=()=>speak(s,el('playerStatus'));
  el('mute').onclick=()=>{stopSpeaking();el('playerStatus').textContent='';};
  el('prev').onclick=()=>stepPlayer(player-1);
  el('next').onclick=()=>stepPlayer(player+1);
  el('finish').onclick=()=>{stopSpeaking();player=-1;renderPlayer();el('start').focus();};
}
function stepPlayer(index){
  stopSpeaking();player=index;
  const stop=byId.get(route[index]);
  if(stop){selected=stop.id;scheduleDraw();}
  renderPlayer();el('player').scrollIntoView({block:'nearest'});el('play')?.focus({preventScroll:true});
}
el('start').onclick=()=>stepPlayer(0);
filter();renderRoute();fetchPath();
if(share.has('r')&&route.length){setView('route');requestAnimationFrame(()=>fit(route.map(id=>byId.get(id))));}
window.addEventListener('hashchange',()=>{
  const params=new URLSearchParams(location.hash.slice(1));
  if(!params.has('r'))return;
  const ids=readIds(params.get('r').split(','));
  if(!ids.length)return;
  const level=params.get('k'), budget=Number(params.get('t')), dwell=Number(params.get('m'));
  if(['0','1','2'].includes(level))el('level').value=level;
  if([45,90,120,150,180].includes(budget))el('budget').value=String(budget);
  if(dwell>=2&&dwell<=45)el('dwell').value=String(dwell);
  changeRoute(ids,nameForRoute(ids));setView('route');fit(ids.map(id=>byId.get(id)));
});
