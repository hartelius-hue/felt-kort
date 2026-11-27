'use strict';

function statsMarkup(points, path, dwell) {
  return '<dl class="walk-stats">' + walkStats(points, path, dwell).map(([value, label]) =>
    '<div><dt>' + label + '</dt><dd>' + escapeHtml(value) + '</dd></div>'
  ).join('') + '</dl>';
}

function routeList(points) {
  return points.map((s,i) => '<li><b aria-hidden="true">' + (i + 1) + '</b><span>' + escapeHtml(s.name) + '</span></li>').join('');
}

function sheetMapFrame(points, path) {
  const width = 820, height = 435;
  const coords = path?.geometry ?? points.map(s => [s.lon, s.lat]);
  const view = mapViewport([...points, ...coords.map(([lon,lat]) => ({lat,lon}))], width, height, 82);
  const [x0,y0] = world(...view.center, view.zoom);
  const west = x0 - width / 2, north = y0 - height / 2;
  const position = (lat,lon) => {
    const [x,y] = world(lat,lon,view.zoom);
    return [x - west,y - north];
  };
  const tiles = el('sheetTiles'), loads = [];
  for (let x = Math.floor(west / 256); x * 256 < west + width; x++) {
    for (let y = Math.floor(north / 256); y * 256 < north + height; y++) {
      const img = new Image();
      img.alt = ''; img.referrerPolicy = 'strict-origin-when-cross-origin';
      img.style.left = (x * 256 - west) / width * 100 + '%';
      img.style.top = (y * 256 - north) / height * 100 + '%';
      img.style.width = 256 / width * 100 + '%';
      loads.push(new Promise(resolve => {
        img.onload = () => resolve(true);
        img.onerror = () => {img.hidden = true; resolve(false);};
      }));
      img.src = 'https://tile.openstreetmap.org/' + [view.zoom,x,y].join('/') + '.png';
      tiles.append(img);
    }
  }

  const base = el('sheetBase'), overlay = el('sheetOverlay');
  for (const canvas of [base, overlay]) {
    canvas.width = width * 2; canvas.height = height * 2;
  }
  const bg = base.getContext('2d'), ctx = overlay.getContext('2d');
  bg.scale(2,2); ctx.scale(2,2);
  drawCoast(bg,width,height,position);
  drawRouteLine(ctx,coords,position,path,5);

  const pins = [];
  points.forEach((s,i) => {
    const [x,y] = position(s.lat,s.lon);
    const choices = [[x,y]];
    for (const radius of [29,49,70]) {
      for (let angle = 0; angle < 8; angle++) {
        choices.push([x + radius * Math.cos(angle * Math.PI / 4), y + radius * Math.sin(angle * Math.PI / 4)]);
      }
    }
    const [px,py] = choices.find(([cx,cy]) => cx > 17 && cx < width - 17 && cy > 17 && cy < height - 17 &&
      pins.every(([ox,oy]) => Math.hypot(ox - cx,oy - cy) >= 32)) ?? [x,y];
    pins.push([px,py]);
    if (px !== x || py !== y) {
      ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(px,py);
      ctx.strokeStyle = '#455f5e'; ctx.lineWidth = 2; ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(px,py,13,0,Math.PI * 2);
    ctx.fillStyle = '#0d3e38'; ctx.fill(); ctx.lineWidth = 2.3; ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 15px system-ui';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(i + 1,px,py + .5);
  });

  const metersPerPixel = Math.cos(view.center[0] * Math.PI / 180) * 40075017 / (256 * 2**view.zoom);
  const meters = [20,50,100,200,500,1000,2000,5000].filter(n => n / metersPerPixel <= 110).at(-1) ?? 10;
  const scale = el('sheetScale');
  scale.textContent = meters >= 1000 ? meters / 1000 + ' km' : meters + ' m';
  scale.style.width = meters / metersPerPixel / width * 100 + '%';

  return Promise.race([
    Promise.all(loads).then(results => results.every(Boolean)),
    new Promise(resolve => setTimeout(() => resolve(false), 4200))
  ]);
}

let sheetVersion = 0;
async function showFieldSheet(name, points, dwell, suppliedPath, description = '') {
  const version = ++sheetVersion;
  const dialog = el('fieldSheet'), print = el('printSheet');
  const level = activeLevel();
  const {firstGrade,lastGrade} = schoolLevels[level];
  el('sheetContent').innerHTML =
    '<article class="field-sheet" aria-busy="true"><section class="sheet-overview">' +
      '<div class="sheet-heading"><p>Aarhus Feltkort · TeknologiWalk</p><h2 id="sheetTitle">' + escapeHtml(name) + '</h2>' +
      '<p>' + firstGrade + '.–' + lastGrade + '. klasse</p></div>' +
      (description ? '<p class="sheet-intro">' + escapeHtml(description) + '</p>' : '') +
      '<div id="sheetStats"></div>' +
      '<figure class="sheet-figure"><div class="sheet-map" role="img" aria-label="Kortudsnit med den nummererede rute">' +
      '<canvas id="sheetBase" aria-hidden="true"></canvas><div id="sheetTiles" aria-hidden="true"></div>' +
      '<canvas id="sheetOverlay" aria-hidden="true"></canvas><span class="sheet-north" aria-hidden="true">▲ N</span>' +
      '<span id="sheetScale" aria-hidden="true"></span></div>' +
      '<figcaption><span id="sheetMapNote"></span><span>© OpenStreetMap-bidragsydere · openstreetmap.org/copyright</span></figcaption></figure>' +
      '<h3>Stop i rækkefølge</h3><ol class="numbered-list sheet-order">' + routeList(points) + '</ol>' +
      '<p class="sheet-method">Gangtid ved 3,5 km/t. Ca. 65 cm pr. skridt og ' + dwell +
      ' min. ved hvert stop. Transport til første og fra sidste stop kommer oveni.</p></section>' +
    '<section class="sheet-details"><h3>Undersøg det ved stoppene</h3>' +
      points.map((s,i) => '<section class="sheet-stop"><h4><span>' + (i + 1) + '.</span> ' + escapeHtml(s.name) +
        '</h4><p class="sheet-location">' + escapeHtml(s.place) + ' · ' + escapeHtml(s.access) + '</p><p>' +
        escapeHtml(s.learn) + '</p><p class="sheet-task"><strong>Jeres opgave</strong> ' +
        escapeHtml(s.questions[level]) + '</p></section>').join('') +
    '</section></article>';
  print.disabled = true;
  el('sheetStatus').textContent = 'Henter kort og rute …';
  if (!dialog.open) dialog.showModal();

  const path = suppliedPath === undefined ? await requestFootpath(points) : suppliedPath;
  if (version !== sheetVersion || !dialog.open) return;
  el('sheetStats').innerHTML = statsMarkup(points,path,dwell);
  const note = points.length === 1 ? 'Ét stop' : path ? 'Gangrute · OpenStreetMap / FOSSGIS' :
    'Stiplet linje viser stoprækkefølgen. Gangvej og afstand skal tjekkes.';
  el('sheetMapNote').textContent = note;
  const hasTiles = await sheetMapFrame(points,path);
  if (version !== sheetVersion || !dialog.open) return;
  if (!hasTiles) el('sheetMapNote').textContent += ' · Baggrundskortet kunne ikke hentes helt.';
  el('sheetContent').firstElementChild.setAttribute('aria-busy','false');
  print.disabled = false;
  el('sheetStatus').textContent = '';
}

function bindFieldSheet() {
  el('closeSheet').onclick = () => el('fieldSheet').close();
  el('printSheet').onclick = () => window.print();
}
