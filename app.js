'use strict';
const el = id => document.getElementById(id);
const themes = {T:['Teknologiforståelse','#065e54'],I:['Ingeniørkunst','#254d8a'],V:['Vand og energi','#764017'],N:['Naturvidenskab','#714477']};
const byId = new Map(stops.map(s => [s.id,s]));
const map = el('map');
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const activeLevel = () => Number(el('level').value);
const readSaved = () => {try{return JSON.parse(localStorage.getItem('feltkort')||'{}')||{};}catch{return {};}};
const saved = readSaved();
const readIds = input => [...new Set(input.map(Number).filter(id=>byId.has(id)))].slice(0,stops.length);
const share = new URLSearchParams(location.hash.slice(1));
let route = readIds(share.has('r') ? share.get('r').split(',') : Array.isArray(saved.route) ? saved.route : []);
function nameForRoute(ids){
  return walks.find(([, , , walk]) => walk.join(',')===ids.join(','))?.[0] ?? 'Min rute';
}
const sharedRouteName = (params,ids) => params.get('n')?.trim().slice(0,100) || nameForRoute(ids);
let routeName = share.has('r') ? sharedRouteName(share,route) : (typeof saved.name==='string' ? saved.name : 'Min rute');
let selected = null, view = 'explore', player = -1, path, routeVersion = 0;
let draft = null, planVersion = 0;
let zoom = 13, center = [56.158,10.209], shown = stops, drag, drawFrame;
let mapInitialized = false;
if (['0','1','2'].includes(share.get('k') ?? saved.level)) el('level').value=share.get('k') ?? saved.level;
function setTiming(budget,dwell){
  if(Number.isInteger(+budget)&&+budget>=15&&+budget<=360)el('budget').value=+budget;
  if(Number.isInteger(+dwell)&&+dwell>=2&&+dwell<=45)el('dwell').value=+dwell;
}
setTiming(share.get('t') ?? saved.budget, share.get('m') ?? saved.dwell);
function routeParams(){
  const params=new URLSearchParams({r:route.join(','),k:el('level').value,t:el('budget').value,m:el('dwell').value});
  if(routeName!==nameForRoute(route))params.set('n',routeName);
  return params;
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
function mapViewport(points,width,height,margin=90){
  const coords=points.map(p=>world(p.lat,p.lon,0));
  const xs=coords.map(p=>p[0]), ys=coords.map(p=>p[1]);
  const left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys);
  const scale=Math.min(Math.max(100,width-margin)/Math.max(right-left,.0001),Math.max(100,height-margin)/Math.max(bottom-top,.0001));
  return {zoom:Math.min(17,Math.max(10,Math.floor(Math.log2(scale)))),center:geography((left+right)/2,(top+bottom)/2,0)};
}
function fit(points, geometry){
  if(!points.length)return;
  const extent=geometry ? [...points,...geometry.map(([lon,lat])=>({lat,lon}))] : points;
  ({zoom,center}=mapViewport(extent,map.clientWidth,map.clientHeight));
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
function mappedWalk(){
  if(view==='plan')return draft;
  if(view==='route'&&route.length)return {points:route.map(id=>byId.get(id)),path};
  return null;
}
function visiblePoints(){
  return mappedWalk()?.points ?? shown;
}
function updateTileStatus(){
  const tiles=[...tileNodes.values()];
  const unavailable=tiles.length>0&&tiles.every(img=>img.complete&&!img.naturalWidth);
  el('tileStatus').hidden=!unavailable;
  if(unavailable)el('tileStatus').textContent='Baggrundskortet kunne ikke hentes. I kan stadig vælge stop på kortet og i listen.';
}
const coastline=[[56.279,10.32],[56.243,10.31],[56.219,10.27],[56.194,10.248],[56.175,10.236],[56.165,10.22],[56.16,10.215],[56.154,10.219],[56.15,10.227],[56.139,10.224],[56.119,10.233],[56.092,10.256],[56.06,10.273],[56.02,10.30]];
function drawCoast(bg,width,height,pos){
  bg.fillStyle='#d5e9ef';bg.fillRect(0,0,width,height);
  bg.fillStyle='#edf2e6';bg.beginPath();bg.moveTo(-2,-100000);
  for(const [lat,lon] of coastline)bg.lineTo(...pos(lat,lon));
  bg.lineTo(-2,100000);bg.closePath();bg.fill();
}
function drawRouteLine(ctx,coords,pos,streetPath,lineWidth=4){
  if(coords.length<2)return;
  ctx.save();ctx.beginPath();
  coords.forEach(([lon,lat],i)=>{const point=pos(lat,lon);i===0?ctx.moveTo(...point):ctx.lineTo(...point);});
  ctx.lineCap='round';ctx.lineJoin='round';
  if(!streetPath)ctx.setLineDash([6,6]);
  ctx.lineWidth=lineWidth+3;ctx.strokeStyle='#fff';ctx.stroke();
  ctx.lineWidth=lineWidth;ctx.strokeStyle='#a44012';ctx.stroke();ctx.restore();
}
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
  drawCoast(bg,w,h,pos);
  const walk=mappedWalk(), pins=walk?.points ?? shown;
  if(walk)drawRouteLine(ctx,walk.path?.geometry ?? pins.map(s=>[s.lon,s.lat]),pos,walk.path);
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
    const number=walk?pins.indexOf(s)+1:s.id;
    node.textContent=number;
    node.setAttribute('aria-label',(walk?'Rutestop ':'')+number+'. '+s.name);
    node.classList.toggle('in-route',Boolean(walk)||route.includes(s.id));
    node.setAttribute('aria-current',String(selected===s.id));
  });
  for(const [id,node] of markerNodes)if(!display.has(id)){node.remove();markerNodes.delete(id);}
  const count=walk || pins.length===stops.length
    ? pins.length+' stop'
    : pins.length+' af '+stops.length+' stop';
  if(el('visible').textContent!==count)el('visible').textContent=count;
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
function fitVisible(){fit(visiblePoints(),mappedWalk()?.path?.geometry);}
el('plus').onclick=()=>setZoom(zoom+1);el('minus').onclick=()=>setZoom(zoom-1);el('reset').onclick=fitVisible;
new ResizeObserver(()=>{if(!mapInitialized&&map.clientWidth){mapInitialized=true;fitVisible();}else scheduleDraw();}).observe(map);

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
  return s.questions[activeLevel()];
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
  renderDetail();filter({keepSelected:true});
  el('detail').querySelector('h2').setAttribute('tabindex','-1');
  el('detail').querySelector('h2').focus({preventScroll:true});
  if(matchMedia('(max-width: 760px)').matches)el('detail').scrollIntoView({block:'start'});
}
function filter({keepSelected=false}={}){
  const query=el('search').value.trim().toLocaleLowerCase('da'), theme=el('theme').value, access=el('access').value;
  const free=freeAccess;
  const showAll=el('showAllLevels').checked;
  const {recommendedStops}=schoolLevels[activeLevel()];
  for(const button of el('legend').querySelectorAll('button'))button.setAttribute('aria-pressed',String(theme===button.dataset.theme));
  shown=stops.filter(s=>(showAll||recommendedStops.has(s.id))
    &&(!theme||s.theme===theme)
    &&(!query||[s.name,s.place,s.learn,...s.questions,themes[s.theme][0]].join(' ').toLocaleLowerCase('da').includes(query))
    &&(!access||(access==='free'?free.includes(s.access):access==='inside'?s.access==='Gratis inde':!free.includes(s.access))));
  if(!keepSelected&&selected&&!shown.some(s=>s.id===selected)){selected=null;stopSpeaking();renderDetail();}
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
document.querySelector('nav').addEventListener('click',e=>{
  const name=e.target.closest('[data-view]')?.dataset.view;
  if(!name)return;
  setView(name);
  if(name==='route')renderRoute();
  fitVisible();el('fieldmap').scrollIntoView();
});
el('results').addEventListener('click',e=>{const id=Number(e.target.closest('[data-stop]')?.dataset.stop);if(id)openStop(id,true);});
el('search').addEventListener('input',()=>filter());
for(const id of ['theme','access'])el(id).addEventListener('change',()=>{filter();fit(shown);});
for(const [key,[name,color]] of Object.entries(themes)){
  el('theme').add(new Option(name,key));
  el('planTheme').add(new Option(name,key));
  const badge=document.createElement('button');
  badge.type='button';badge.dataset.theme=key;badge.textContent=name;
  badge.style.setProperty('--pin',color);el('legend').append(badge);
  badge.onclick=()=>{
    const theme=el('theme');
    theme.value=theme.value===key?'':key;
    setView('explore');filter();fit(shown);
  };
}
function renderSuggestions(){
  const showAll=el('showAllLevels').checked;
  el('suggestions').innerHTML=walks.map(([name,levels,desc,ids,minutes],i)=>{
    if(!showAll&&!levels.includes(activeLevel()))return '';
    const first=schoolLevels[levels[0]].firstGrade;
    const last=schoolLevels[levels.at(-1)].lastGrade;
    return '<article class="walk"><div class="meta">'+first+'.–'+last+'. klasse · '+ids.length+' stop · '+minutes+' min. afsat</div><h3>'+name+'</h3><p>'+desc+'</p><div class="actions"><button data-walk="'+i+'">Brug ruten</button><button data-sheet="'+i+'">Se feltark</button></div></article>';
  }).join('');
}
function updateLevelFilters(){
  filter();renderSuggestions();updatePlannerChoices();fitVisible();
}
el('level').onchange=()=>{
  el('showAllLevels').checked=false;
  stopSpeaking();persist();updateLevelFilters();renderDetail();renderPlayer();
};
el('showAllLevels').onchange=updateLevelFilters;
el('suggestions').onclick=e=>{
  const button=e.target.closest('button');
  if(!button)return;
  const i=button.dataset.walk??button.dataset.sheet;
  if(i===undefined)return;
  const [name,,desc,ids,minutes]=walks[Number(i)];
  if(button.hasAttribute('data-sheet')){
    showFieldSheet(name,ids.map(id=>byId.get(id)),8,undefined,desc);return;
  }
  if(route.length&&!confirm('Vil du erstatte den nuværende rute med temaruten?'))return;
  el('budget').value=String(minutes);changeRoute([...ids],name);setView('route');fitVisible();
};

function plannerStops(){
  const theme=el('planTheme').value, onlyFree=el('planFree').checked;
  const {recommendedStops}=schoolLevels[activeLevel()];
  return stops.filter(s=>(el('showAllLevels').checked||recommendedStops.has(s.id))
    &&(!theme||s.theme===theme)&&(!onlyFree||freeAccess.includes(s.access)));
}
function invalidateDraft(){
  ++planVersion;draft=null;
  el('planResult').hidden=true;el('generateWalk').disabled=false;
  el('planStatus').textContent='';
  if(view==='plan')fitVisible();
}
function updatePlannerChoices(){
  const select=el('planStart'), previous=select.value;
  select.options.length=1;
  const available=plannerStops().sort((a,b)=>a.name.localeCompare(b.name,'da'));
  for(const s of available)select.add(new Option(s.name,String(s.id)));
  if(available.some(s=>String(s.id)===previous))select.value=previous;
  invalidateDraft();
}
function showDraft(points,streetPath,budget,dwell){
  const name='Fra '+points[0].name+' til '+points.at(-1).name;
  draft={name,points,path:streetPath,budget,dwell};
  el('planResultTitle').textContent=name;
  el('planStats').innerHTML=statsMarkup(points,streetPath,dwell);
  el('planRows').innerHTML=routeList(points);
  el('planResult').hidden=false;
  if(view==='plan')fitVisible();
}
async function generateWalk(event){
  event.preventDefault();
  invalidateDraft();
  const version=planVersion;
  const status=el('planStatus');
  const budget=Number(el('planMinutes').value), count=Number(el('planCount').value);
  const dwell=Number(el('planDwell').value), start=Number(el('planStart').value);
  const distanceValue=Number(el('planDistance').value), stepsUnit=el('planUnit').value==='steps';
  const distanceKm=distanceValue ? distanceValue*(stepsUnit ? stepLength/1000 : 1) : Infinity;
  const maxKm=Math.min(distanceKm,(budget-count*dwell)*walkingSpeed/60);
  const points=plannerStops();
  if(count>points.length){status.textContent='Der er kun '+points.length+' stop med de valgte filtre. Vælg færre stop, eller giv plads til flere temaer eller adgangstyper.';return;}
  if(maxKm<=0){status.textContent='Opholdene bruger hele tiden. Sæt færre minutter af pr. stop, eller giv turen mere tid.';return;}

  const options=walkingCandidates(points,start,count,maxKm);
  if(!options.length){status.textContent='Ingen af de foreslåede ruter passer til rammen. Prøv færre stop, mere tid eller et andet startsted.';return;}
  el('generateWalk').disabled=true;
  status.textContent='Finder stop og tjekker gangvejen …';
  for(const option of options){
    const result=await requestFootpath(option.points);
    if(version!==planVersion)return;
    if(result?.km<=maxKm+1e-9&&walkNumbers(option.points,result,dwell).total<=budget){
      showDraft(option.points,result,budget,dwell);
      status.textContent='Forslaget passer til jeres tid og afstand.';
      break;
    }
    if(result===undefined){
      const estimated=options.find(candidate=>candidate.km<=maxKm+1e-9&&walkNumbers(candidate.points,null,dwell).total<=budget);
      if(estimated)showDraft(estimated.points,null,budget,dwell);
      status.textContent='Gangvejen kunne ikke hentes. '+(draft?'Forslaget er et skøn ud fra luftlinje. Tjek vejen, før I går.':'Prøv igen om lidt.');
      break;
    }
    status.textContent='De beregnede gangruter passede ikke til rammen. Prøv mere tid, en længere afstand eller færre stop.';
  }
  el('generateWalk').disabled=false;
}
el('plannerForm').onsubmit=generateWalk;
el('plannerForm').addEventListener('change',e=>{
  if(e.target.id==='planTheme'||e.target.id==='planFree'){updatePlannerChoices();return;}
  if(e.target.id==='planUnit'){
    const field=el('planDistance'), steps=el('planUnit').value==='steps';
    field.min=steps?'1':'0.1';field.max=steps?'34000':'22';field.step=steps?'1':'any';
  }
  invalidateDraft();
});
el('usePlan').onclick=()=>{
  if(!draft||(route.length&&!confirm('Vil du erstatte din nuværende rute med dette forslag?')))return;
  setTiming(draft.budget,draft.dwell);
  setView('route');changeRoute(draft.points.map(s=>s.id),draft.name,draft.path??undefined);fitVisible();
};
el('printPlan').onclick=()=>{
  if(draft)showFieldSheet(draft.name,draft.points,draft.dwell,draft.path);
};
function showRouteMap(){
  fitVisible();map.scrollIntoView({block:'start'});map.focus({preventScroll:true});
}
el('viewPlanMap').onclick=showRouteMap;
function changeRoute(next,name='Min rute',knownPath){
  stopSpeaking();route=next;routeName=name;player=-1;path=knownPath;announce('');
  ++routeVersion;
  persist();renderDetail();renderRoute();scheduleDraw();
  if(path===undefined)fetchPath();
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
  const dwell=Number(el('dwell').value||8), budget=Number(el('budget').value);
  const {total}=walkNumbers(points,path,dwell);
  const basis=route.length<2||path?'':path===undefined?' Henter gangvejen, hvis den er tilgængelig.':
    ' Afstanden er et skøn. Den stiplede linje viser stoprækkefølgen.';
  el('routeSummary').innerHTML=statsMarkup(points,path,dwell)+'<p>'+
    (total>budget?'Turen tager mere end de '+budget+' min., I har sat af.':'Turen kan være inden for de '+budget+' min., I har sat af.')+basis+'</p>';
  if(!updateRows)return;
  el('routeRows').innerHTML=points.map((s,i)=>{
    const walk=i?'<a class="meta" href="'+walkingLink(points[i-1],s)+'" target="_blank" rel="noopener">Gangvej fra forrige stop</a>':'';
    return '<div class="routeRow"><div><button data-open="'+s.id+'">'+(i+1)+'. '+escapeHtml(s.name)+'</button><p class="meta">'+s.access+(walk?' · '+walk:'')+'</p></div><div><button data-order="'+i+':-1" '+(i===0?'disabled ':'')+'aria-label="Flyt '+escapeHtml(s.name)+' op">↑</button> <button data-order="'+i+':1" '+(i===points.length-1?'disabled ':'')+'aria-label="Flyt '+escapeHtml(s.name)+' ned">↓</button> <button data-remove="'+s.id+'" aria-label="Fjern '+escapeHtml(s.name)+'">×</button></div></div>';
  }).join('');
  renderPlayer();
}
async function fetchPath(){
  if(route.length<2)return;
  const version=routeVersion;
  const found=await requestFootpath(route.map(id=>byId.get(id)));
  if(version!==routeVersion)return;
  path=found??null;
  renderRoute(false);
  if(view==='route'&&path)fitVisible();else scheduleDraw();
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
  const input=el(id), fallback=id==='budget'?90:8;
  input.value=Math.min(+input.max,Math.max(+input.min,Math.round(+input.value||fallback)));
  persist();renderRoute();
};
el('fit').onclick=showRouteMap;
el('printRoute').onclick=()=>showFieldSheet(routeName,route.map(id=>byId.get(id)),Number(el('dwell').value||8),path);
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
bindFieldSheet();
filter();renderSuggestions();updatePlannerChoices();renderRoute();fetchPath();
if(share.has('r')&&route.length){setView('route');requestAnimationFrame(fitVisible);}
window.addEventListener('hashchange',()=>{
  const params=new URLSearchParams(location.hash.slice(1));
  if(!params.has('r'))return;
  const ids=readIds(params.get('r').split(','));
  if(!ids.length)return;
  const level=params.get('k'), budget=Number(params.get('t')), dwell=Number(params.get('m'));
  if(['0','1','2'].includes(level)){
    el('level').value=level;
    el('showAllLevels').checked=false;
    filter();renderSuggestions();updatePlannerChoices();
  }
  setTiming(budget,dwell);
  changeRoute(ids,sharedRouteName(params,ids));setView('route');fitVisible();
});
