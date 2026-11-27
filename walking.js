'use strict';

const walkingSpeed = 3.5;
const stepLength = 0.65;
const walkingNumber = new Intl.NumberFormat('da-DK', {maximumFractionDigits: 1});
const freeAccess = ['Udefra', 'Gratis inde'];

function distance(a, b) {
  const rad = Math.PI / 180;
  const half = (b.lat - a.lat) * rad / 2;
  const side = (b.lon - a.lon) * rad / 2;
  const h = Math.sin(half)**2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(side)**2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1, h)));
}

function walkNumbers(points, path, dwell) {
  const km = path?.km ?? points.slice(1).reduce((sum, point, i) => sum + distance(points[i], point), 0) * 1.4;
  const steps = Math.round(km * 1000 / stepLength);
  const walk = Math.ceil(km / walkingSpeed * 60 - 1e-9);
  return {km, steps, walk, total: walk + points.length * dwell};
}

function walkStats(points, path, dwell) {
  const {km, steps, walk, total} = walkNumbers(points, path, dwell);
  const displayKm = km > 0 && km < .1 ? '< 0,1 km' : walkingNumber.format(km) + ' km';
  return [
    [points.length, 'stop'],
    [displayKm, 'afstand'],
    [walkingNumber.format(steps), 'skridt (ca.)'],
    [walk + ' min.', 'gangtid'],
    [total + ' min.', 'med stop']
  ];
}

// Shorten crossings and backtracking while keeping the chosen first stop.
function improveStopOrder(points) {
  let bestGain;
  do {
    bestGain = .001;
    let bestStart, bestEnd;
    for (let first = 1; first < points.length - 1; first++) {
      for (let last = first + 1; last < points.length; last++) {
        const before = points[first - 1], start = points[first], end = points[last], after = points[last + 1];
        const gain = distance(before, start) - distance(before, end)
          + (after ? distance(end, after) - distance(start, after) : 0);
        if (gain > bestGain) {
          bestGain = gain; bestStart = first; bestEnd = last;
        }
      }
    }
    if (bestStart !== undefined) {
      const reversed = points.slice(bestStart, bestEnd + 1).reverse();
      points.splice(bestStart, reversed.length, ...reversed);
    }
  } while (bestGain > .001);
}

function walkingCandidates(points, start, count, maxKm) {
  const near = new Map(points.map(p => [
    p.id,
    points.filter(q => q !== p).map(q => ({point: q, km: distance(p, q)})).sort((a,b) => a.km - b.km)
  ]));
  const options = new Map();
  const starts = start ? points.filter(p => p.id === start) : points;
  const targetKm = maxKm * .75;
  for (const first of starts) {
    for (const spread of [false, true]) {
      const stops = [first];
      let km = 0;
      while (stops.length < count) {
        const nextStops = near.get(stops.at(-1).id).filter(({point}) => !stops.includes(point));
        if (!nextStops.length) break;
        const targetLeg = (targetKm - km) / (count - stops.length);
        const next = spread ? nextStops.slice(0, 5).reduce((best, option) =>
          Math.abs(option.km * 1.4 - targetLeg) < Math.abs(best.km * 1.4 - targetLeg) ? option : best
        ) : nextStops[0];
        km += next.km * 1.4;
        stops.push(next.point);
      }
      if (stops.length !== count) continue;
      improveStopOrder(stops);
      km = walkNumbers(stops, null, 0).km;
      if (km > maxKm * 1.4 + .001) continue;
      const key = stops.map(s => s.id).join(',');
      const score = Math.abs(targetKm - km);
      options.set(key, {points: stops, km, score});
    }
  }
  const ranked = [...options.values()].sort((a,b) => a.score - b.score);
  const shortest = [...ranked].sort((a,b) => a.km - b.km)[0];
  return [...new Set([ranked[0], shortest, ...ranked.slice(1)])].filter(Boolean).slice(0, 4);
}

const footCache = new Map();
let lastFootRequest = 0;
let footQueue = Promise.resolve();

function requestFootpath(points) {
  if (points.length < 2) return Promise.resolve(null);
  const coords = points.map(p => p.lon + ',' + p.lat).join(';');
  if (footCache.has(coords)) return footCache.get(coords);

  // Keep requests to the community routing service at no more than one per second.
  const pending = footQueue.then(async () => {
    const delay = 1100 - (Date.now() - lastFootRequest);
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
    lastFootRequest = Date.now();
    const url = 'https://routing.openstreetmap.de/routed-foot/route/v1/driving/' + coords;
    try {
      const reply = await fetch(url + '?overview=full&geometries=geojson&steps=false',
        {signal: AbortSignal.timeout(6500)});
      const body = await reply.json();
      if (body.code === 'NoRoute' || body.code === 'NoSegment') return null;
      const result = body.routes?.[0];
      const geometry = result?.geometry?.coordinates;
      if (reply.ok && Number.isFinite(result?.distance) && Array.isArray(geometry) && geometry.length >= 2) {
        return {km: result.distance / 1000, geometry};
      }
    } catch {}
    return undefined;
  });
  // Finish the outstanding request before starting another.
  footQueue = pending.then(() => undefined);
  pending.then(result => {
    if (result === undefined) footCache.delete(coords);
  });
  if (footCache.size >= 32) footCache.delete(footCache.keys().next().value);
  footCache.set(coords, pending);
  return pending;
}
