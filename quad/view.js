// Static experiment viewer, exported by itasc_web.export.
//
// Opened straight from a file share, so it only uses what browsers allow under
// file://: classic scripts (manifest.js, scope-controls.js) and <img> tags.
// Each layer is an <img> stacked on a black stage; image layers are 8-bit
// WebP planes coloured by an SVG feComponentTransfer table (contrast limits,
// gamma and colormap in one lookup, no pixel read-back) and composited with
// mix-blend-mode, so additive channel overlays work like napari's.
// Image layers exported as video (manifest.video) are hidden <video> elements
// seeked to the frame for the current time and plane (one file per projection,
// one holding the planes, time-major), each frame drawn to a <canvas> through
// the same colour table: WebKit (every iPhone browser) ignores SVG filters on
// <video>. Under file:// the canvas cannot read video pixels back, so there the
// <video> itself is shown with the SVG filter.
// Vector layers (TFM displacement and traction arrows, principal stress axes)
// are drawn on a canvas from a sampled grid that vec/<position>.js supplies.
// Positions may carry their own size and frames (one TFM cell each); layers
// may carry a group, which the layer list folds and toggles as one.
(() => {
  'use strict';
  const view = window.ITASC_VIEW, sc = window.ScopeControls;
  const $ = id => document.getElementById(id);
  // viewer-network-cache-v1: compressed assets retained in this tab, not decoded stacks.
  const cacheStatus = document.createElement('small');
  cacheStatus.id = 'cache-progress'; cacheStatus.className = 'dims';
  cacheStatus.style.cssText = 'font-size:11px;flex:none;overflow-wrap:anywhere';
  $('dims').after(cacheStatus);
  const assetCache = new window.ViewerAssetCache({ onChange: progress => {
    cacheStatus.textContent = !assetCache.network ? 'File share · browser-managed loading' :
      `Browser cache: ${progress.planes}/${progress.total} assets · ${Math.round(progress.bytes / 1048576)} MB${progress.full ? ' · RAM limit' : progress.loading ? ' · loading…' : ''}${progress.skipped ? ` · ${progress.skipped} streamed` : ''}${progress.failed ? ` · ${progress.failed} unavailable` : ''}`;
  } });
  window.viewerAssetCache = assetCache;
  cacheStatus.title = 'Up to 128 MiB of compressed assets for visible layers in this position. Hidden layers are not preloaded. Large movies use native streaming. Changing position or visible layers clears this tab cache.';

  document.documentElement.dataset.theme = 'dark';
  if (!view || !sc) { document.body.textContent = 'This viewer is missing manifest.js or scope-controls.js.'; return; }

  let [height, width] = view.size;
  // Z views: the projections by name, and the exported single planes as a
  // stack browsed with a Z slider (state.z is "stack", state.plane an index).
  const planes = view.planes || [];
  // A single plane beside projections (beads at their focal plane) is shown by
  // its layer under any Z view; it only becomes a choice of its own when alone.
  const stacked = planes.length > 1 || (planes.length === 1 && !view.z.length);
  const zOptions = [...view.z, ...(stacked ? [{ key: 'stack', name: planes.length > 1 ? `Z stack (${planes.length} planes)` : `plane ${planes[0]}` }] : [])];
  const state = { position: 0, t: 0, z: zOptions[0].key, plane: Math.floor((planes.length - 1) / 2), scale: 1, x: 0, y: 0 };
  const params = new URLSearchParams(location.hash.slice(1));
  const wantedPosition = view.positions.findIndex(p => p.name === params.get('position'));
  if (wantedPosition >= 0) state.position = wantedPosition;
  const frames = () => view.positions[state.position].frames || view.frames;
  if (params.has('t')) state.t = Math.max(0, frames().indexOf(Number(params.get('t'))));
  if (zOptions.some(z => z.key === params.get('z'))) state.z = params.get('z');
  if (params.has('plane') && planes.includes(Number(params.get('plane')))) state.plane = planes.indexOf(Number(params.get('plane')));
  const planeKey = z => `z${String(z).padStart(2, '0')}`;
  // The image a layer shows for the current Z view: its own plane or
  // projection when it has one; a channel taken at one plane only (brightfield)
  // shows that plane throughout the stack.
  function keyFor(layer) {
    if (state.z !== 'stack') return layer.z.includes(state.z) ? state.z : layer.z[0];
    const wanted = planeKey(planes[state.plane]);
    if (layer.z.includes(wanted)) return wanted;
    const own = layer.z.filter(k => k.startsWith('z'));
    return own.length ? own.reduce((a, b) => Math.abs(+a.slice(1) - planes[state.plane]) <= Math.abs(+b.slice(1) - planes[state.plane]) ? a : b) : layer.z[0];
  }

  document.title = view.title;
  $('title').textContent = view.title;
  if (view.back && window.self === window.top) Object.assign($('back'), { href: view.back.href, textContent: `‹ ${view.back.label}`, hidden: false });
  // Sibling bundles of the same viewer, switched inside the header (website addition).
  if (view.datasets) { const nav = $('datasets'); nav.hidden = false; for (const d of view.datasets) {
    const a = document.createElement('a'); a.textContent = d.label; if (d.current) a.setAttribute('aria-current', 'page'); else a.href = d.href; nav.append(a); } }
  $('subtitle').textContent = [view.experiment !== view.title && view.experiment, `exported ${view.exported_at.slice(0, 10)}`].filter(Boolean).join(' · ');
  const kept = view.layers.filter(l => l.background === 'none').map(l => l.name);
  const steps = [view.video?.blur && `smoothed (Gaussian, σ ${view.video.blur} px)`,
    view.video?.background === 'median' && `background-subtracted (each plane minus its median${kept.length ? `; not ${kept.join(', ')}` : ''})`].filter(Boolean);
  // blur_layers: the preprocessing applies to those layers only (TFM: the
  // cell channel; the maps are stored as computed).
  const only = view.video?.blur_layers?.map(id => view.layers.find(l => l.id === id)?.name).filter(Boolean);
  const smoothing = !view.video ? '' : only?.length
    ? `${only.join(', ')}: ${steps.join(', ')}. All images are compressed for quick browsing; measure on the raw data and the TFM results.`
    : `Images are ${[...steps, 'compressed'].join(', ')} for quick browsing; measure on the raw data.`;
  $('about').textContent = [view.description, smoothing].filter(Boolean).join(' ');
  $('zview').replaceChildren(...zOptions.map(z => new Option(z.name, z.key)));
  if (zOptions.length === 1 && planes.length <= 1) $('zview').closest('label').hidden = true;  // nothing to choose

  const stage = $('stage'), viewport = $('viewport'), filters = $('filters');

  // --- layers ------------------------------------------------------------
  const isVideo = layer => layer.kind === 'image' && layer.media === 'video';
  const VECTOR_SCALE = 2;  // vector canvas pixels per image pixel, for crisp lines
  if (view.layers.some(isVideo) && !document.createElement('video').canPlayType(view.video.mime)) {
    const note = document.createElement('p');
    note.className = 'codec-note';
    note.textContent = view.video.codec === 'av1'
      ? 'This browser cannot decode the AV1 video these images are stored in (Safari before M3 Macs, and every browser on iPhones before the 15 Pro). Open the page in Chrome, Firefox or Edge on a computer or an Android phone.'
      : `This browser cannot decode the ${view.video.codec} video these images are stored in.`;
    viewport.append(note);
  }
  const images = new Map();   // the element shown on the stage, per layer
  const videos = new Map();   // the decoder, per video layer
  const layerState = new Map();
  const decoders = document.createElement('div');
  decoders.className = 'decoders';
  document.body.append(decoders);
  for (const layer of view.layers) {
    let img;
    if (isVideo(layer)) {
      const video = document.createElement('video');
      video.muted = true; video.playsInline = true; video.preload = 'auto';
      img = document.createElement('canvas');
      img.width = width; img.height = height;
      video.addEventListener('error', () => { images.get(layer.id).style.visibility = 'hidden'; });
      video.addEventListener('loadeddata', () => { images.get(layer.id).style.visibility = ''; paint(layer); });
      video.addEventListener('seeked', () => paint(layer));
      decoders.append(video); videos.set(layer.id, video);
    } else if (layer.kind === 'vectors') {
      img = document.createElement('canvas');
    } else {
      img = new Image(); img.alt = ''; img.decoding = 'async';
      img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
      img.addEventListener('load', () => { img.style.visibility = ''; });
    }
    stage.append(img); images.set(layer.id, img);
    if (layer.kind === 'image') {
      const range = layer.limits || layer.windows[keyFor(layer)];
      layerState.set(layer.id, { limits: [...range], gamma: 1, colormap: layer.colormap, opacity: 1, blending: layer.blending || 'additive' });
    } else if (layer.kind === 'vectors') {
      layerState.set(layer.id, { limits: [0, layer.limit], colormap: layer.colormap, opacity: 1, blending: 'translucent' });
    } else {
      layerState.set(layer.id, { opacity: 0.9, blending: 'translucent' });
    }
  }
  // For a vector layer the upper contrast limit is the magnitude drawn
  // arrow_px long and at the top of the colormap (napariTFM's v_max).
  const panelLayers = () => view.layers.map(layer => {
    const s = layerState.get(layer.id), group = layer.group;
    if (layer.kind === 'vectors') return { id: layer.id, name: layer.name, kind: layer.style === 'axes' ? 'axes' : 'vectors', group, visible: layer.visible,
      opacity: s.opacity, dataRange: [0, layer.limit * 4], limits: s.limits, colormap: s.colormap };
    if (layer.kind !== 'image') return { id: layer.id, name: layer.name, kind: 'labels', group, visible: layer.visible, opacity: s.opacity, blending: s.blending, blendings: ['translucent', 'opaque'] };
    const window = currentWindow(layer);
    return { id: layer.id, name: layer.name, kind: 'image', group, visible: layer.visible, opacity: s.opacity, blending: s.blending, blendings: ['additive', 'translucent', 'opaque'],
      dataRange: window, limits: s.limits, gamma: s.gamma, colormap: s.colormap };
  });
  const currentWindow = layer => layer.windows[keyFor(layer)];

  // The exported plane holds window[0]..window[1] as 0..255. The table maps
  // those bytes through the layer's limits, gamma and colormap: n entries of
  // r, g, b.
  function tableFor(layer, n) {
    const s = layerState.get(layer.id), [w0, w1] = currentWindow(layer), [l0, l1] = s.limits;
    const lut = sc.colormapLut(s.colormap), table = new Uint8Array(n * 3);
    for (let i = 0; i < n; i += 1) {
      const raw = w0 + (i / (n - 1)) * (w1 - w0);
      const x = Math.min(1, Math.max(0, (raw - l0) / Math.max(1e-9, l1 - l0))) ** s.gamma;
      const k = Math.round(x * 255) * 3;
      for (let c = 0; c < 3; c += 1) table[i * 3 + c] = lut[k + c];
    }
    return table;
  }
  function filterFor(layer) {
    const table = tableFor(layer, 64), channels = [0, 1, 2].map(c => Array.from({ length: 64 }, (_, i) => (table[i * 3 + c] / 255).toFixed(4)));
    const id = `f-${layer.id}`;
    let node = document.getElementById(id);
    if (!node) {
      node = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
      node.id = id; node.setAttribute('color-interpolation-filters', 'sRGB');
      const transfer = document.createElementNS(node.namespaceURI, 'feComponentTransfer');
      for (const name of ['feFuncR', 'feFuncG', 'feFuncB']) { const f = document.createElementNS(node.namespaceURI, name); f.setAttribute('type', 'table'); transfer.append(f); }
      node.append(transfer); filters.append(node);
    }
    [...node.firstChild.children].forEach((f, c) => f.setAttribute('tableValues', channels[c].join(' ')));
    return `url(#${id})`;
  }

  function styleLayer(layer) {
    syncAssetScope();
    const img = images.get(layer.id), s = layerState.get(layer.id);
    img.style.display = layer.visible ? '' : 'none';
    img.style.opacity = String(s.opacity);
    img.style.mixBlendMode = s.blending === 'additive' ? 'plus-lighter' : 'normal';
    if (layer.kind === 'vectors') drawVectors(layer);
    else if (img.tagName === 'CANVAS') { tables.set(layer.id, tableFor(layer, 256)); paint(layer); }
    else if (layer.kind === 'labels') img.style.filter = window.LayerArrangement.outlineFilter(filters, layer.id, s.thickness ?? 1);
    else if (layer.kind === 'image') img.style.filter = filterFor(layer);
  }

  // Draw a video layer's current frame through its colour table.
  const tables = new Map();
  function paint(layer) {
    const canvas = images.get(layer.id), video = videos.get(layer.id), table = tables.get(layer.id);
    if (canvas.tagName !== 'CANVAS' || !table || video.readyState < 2 || !layer.visible) return;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(video, 0, 0, width, height);
    let pixels;
    try { pixels = context.getImageData(0, 0, width, height); } catch { showVideoItself(layer); return; }
    const d = pixels.data;
    for (let i = 0; i < d.length; i += 4) { const k = d[i] * 3; d[i] = table[k]; d[i + 1] = table[k + 1]; d[i + 2] = table[k + 2]; }
    context.putImageData(pixels, 0, 0);
  }
  // --- vectors -----------------------------------------------------------
  const vectorData = window.ITASC_VECTORS = window.ITASC_VECTORS || {};
  const vectorScripts = new Map(), decoded = new Map();
  function loadVectors(name) {
    if (!vectorScripts.has(name)) vectorScripts.set(name, new Promise(resolve => {
      const script = document.createElement('script');
      script.src = `vec/${name}.js`; script.onload = script.onerror = () => resolve();
      assetCache.script(script, script.getAttribute('src'));
    }));
    return vectorScripts.get(name);
  }
  function vectorField(key) {
    if (!decoded.has(key)) {
      const v = vectorData[key];
      if (!v) return null;
      const bytes = atob(v.data), values = new Int8Array(bytes.length);
      for (let i = 0; i < bytes.length; i += 1) values[i] = (bytes.charCodeAt(i) << 24) >> 24;
      decoded.set(key, { ...v, values });
    }
    return decoded.get(key);
  }
  // Arrows as in napariTFM's movies: from each grid point, limit -> arrow_px
  // long, 2 px shafts; axes: both principal stresses as bars centred on the
  // point, coloured by their signed value.
  function drawVectors(layer) {
    const canvas = images.get(layer.id), context = canvas.getContext('2d');
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    const f = layer.visible && vectorField(`${view.positions[state.position].name}/${layer.id}`);
    if (!f) return;
    const s = layerState.get(layer.id), limit = Math.max(1e-12, s.limits[1]), lut = sc.colormapLut(s.colormap);
    const perUnit = layer.arrow_px / limit, C = f.components, t = Math.min(state.t, f.frames - 1);
    const colour = x => { const k = Math.round(Math.min(1, Math.max(0, x)) * 255) * 3; return `rgb(${lut[k]},${lut[k + 1]},${lut[k + 2]})`; };
    context.setTransform(VECTOR_SCALE, 0, 0, VECTOR_SCALE, 0, 0);
    context.lineWidth = 2 * (s.thickness ?? 1); context.lineCap = 'round';
    const bar = (x, y, dx, dy, style) => { context.strokeStyle = style; context.beginPath(); context.moveTo(x - dx, y - dy); context.lineTo(x + dx, y + dy); context.stroke(); };
    for (let iy = 0; iy < f.ny; iy += 1) for (let ix = 0; ix < f.nx; ix += 1) {
      const base = (((t * f.ny) + iy) * f.nx + ix) * C, x = f.x0 + ix * f.stride, y = f.y0 + iy * f.stride;
      if (layer.style === 'axes') {
        const sxx = f.values[base] * f.scale, syy = f.values[base + 1] * f.scale, sxy = f.values[base + 2] * f.scale;
        const mean = (sxx + syy) / 2, r = Math.hypot((sxx - syy) / 2, sxy), angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
        for (const [value, a] of [[mean + r, angle], [mean - r, angle + Math.PI / 2]]) {
          if (Math.abs(value) < limit * 0.02) continue;
          const half = Math.abs(value) * perUnit / 2;
          bar(x, y, Math.cos(a) * half, Math.sin(a) * half, colour((value / limit + 1) / 2));
        }
        continue;
      }
      const vx = f.values[base] * f.scale, vy = f.values[base + 1] * f.scale, magnitude = Math.hypot(vx, vy);
      if (magnitude < limit * 0.02) continue;
      const dx = vx * perUnit, dy = vy * perUnit, length = Math.hypot(dx, dy), style = colour(magnitude / limit);
      context.strokeStyle = style; context.fillStyle = style;
      context.beginPath(); context.moveTo(x, y); context.lineTo(x + dx, y + dy); context.stroke();
      // matplotlib quiver's head at width 2: 9 px long, 6 px wide.
      const head = Math.min(9, length * 0.6), ux = dx / length, uy = dy / length;
      context.beginPath(); context.moveTo(x + dx, y + dy);
      context.lineTo(x + dx - ux * head - uy * head / 3, y + dy - uy * head + ux * head / 3);
      context.lineTo(x + dx - ux * head + uy * head / 3, y + dy - uy * head - ux * head / 3);
      context.closePath(); context.fill();
    }
  }

  // Stage and canvases follow the position's own size (TFM cells differ).
  function applySize() {
    [height, width] = view.positions[state.position].size || view.size;
    Object.assign(stage.style, { width: `${width}px`, height: `${height}px` });
    for (const layer of view.layers) {
      const el = images.get(layer.id);
      if (el.tagName !== 'CANVAS') continue;
      const k = layer.kind === 'vectors' ? VECTOR_SCALE : 1;
      if (el.width !== width * k || el.height !== height * k) { el.width = width * k; el.height = height * k; }
    }
  }
  applySize();

  function showVideoItself(layer) {
    const canvas = images.get(layer.id), video = videos.get(layer.id);
    canvas.replaceWith(video); images.set(layer.id, video); styleLayer(layer);
  }

  // --- planes ------------------------------------------------------------
  const pad = t => String(t).padStart(4, '0');
  function source(layer) {
    const position = view.positions[state.position], t = frames()[state.t];
    if (layer.kind === 'image') return `img/${position.name}/${layer.id}/${keyFor(layer)}/t${pad(t)}.webp`;
    return (position.labels[layer.id] || []).includes(t) ? `img/${position.name}/${layer.id}/t${pad(t)}.webp` : null;
  }
  // Swap each image only once its next plane has loaded, so stepping and
  // playback never flash black; neighbouring frames are fetched ahead.

  function syncAssetScope() {
    assetCache.setScope(JSON.stringify([state.position, view.layers.filter(l => l.visible).map(l => l.id),
      view.orientation_levels ? orientationLevel : null]));
  }
  function preloadAssets() {
    const position = view.positions[state.position], timeline = position.frames || view.frames;
    const shown = view.layers.filter(layer => layer.visible), urls = new Set();
    const keys = new Map(shown.filter(layer => layer.kind === 'image').map(layer =>
      [layer.id, [...new Set([keyFor(layer), ...layer.z])]]));
    const passes = Math.max(1, ...[...keys.values()].map(list => list.length));
    for (let pass = 0; pass < passes; pass++) for (let dt = 0; dt < timeline.length; dt++) {
      const index = (state.t + dt) % timeline.length, frame = timeline[index];
      for (const layer of shown) {
        if (layer.kind === 'image') {
          const key = keys.get(layer.id)[pass]; if (!key) continue;
          if (layer.media === 'video') urls.add(`img/${position.name}/${layer.id}/${key.startsWith('z') ? 'planes' : key}.${view.video.ext}`);
          else urls.add(`img/${position.name}/${layer.id}/${key}/t${pad(frame)}.webp`);
        } else if (pass === 0 && layer.kind === 'tracked_labels' && window.NEMVPLabelTools?.source) {
          urls.add(window.NEMVPLabelTools.source(position.name, frame));
        } else if (pass === 0 && layer.kind === 'vectors') {
          const name = view.orientation_levels ? `${position.name}/b${orientationLevel}/t${pad(index)}` :
            position.name + (view.vector_frames ? `/t${pad(index)}` : '');
          urls.add(`${view.vector_path || 'vec'}/${name}.js`);
        } else if (pass === 0 && layer.kind === 'tracks') {
          urls.add(`tracks/${position.name}.js`);
        } else if (pass === 0 && layer.kind !== 'tracks' && (position.labels?.[layer.id] || []).includes(frame)) {
          urls.add(`img/${position.name}/${layer.id}/t${pad(frame)}.webp`);
        }
      }
    }
    assetCache.start(urls, urls.size);
  }

  // A video layer's file and frame for the current view.
  function videoFrame(layer) {
    const position = view.positions[state.position], key = keyFor(layer);
    const ext = view.video.ext;
    if (!key.startsWith('z')) return { src: `img/${position.name}/${layer.id}/${key}.${ext}`, frame: layer.static ? 0 : state.t };
    const own = layer.z.filter(k => k.startsWith('z'));
    return { src: `img/${position.name}/${layer.id}/planes.${ext}`, frame: state.t * own.length + own.indexOf(key) };
  }
  function showVideo(layer, video) {
    const { src, frame } = videoFrame(layer), time = (frame + 0.5) / view.video.fps;
    video.dataset.time = time;
    if (video.dataset.source !== src) {
      assetCache.release(video); video.dataset.source = src; video.src = src;
      assetCache.warmVideo(video, src);
      // iOS Safari draws nothing for a paused video that has never played, and
      // a new src resets that: play and pause once (allowed for muted inline
      // video), then seek to wherever the view is by then.
      video.addEventListener('loadedmetadata', () => {
        const seek = () => { video.currentTime = Number(video.dataset.time); };
        video.play().then(() => { video.pause(); seek(); }, seek);
      }, { once: true });
    } else if (video.readyState >= 1) video.currentTime = time;
  }
  // Some mobile browsers hold back video data until the page is touched.
  window.addEventListener('pointerdown', () => {
    for (const el of videos.values()) if (el.readyState < 2) el.play().then(() => { el.pause(); el.currentTime = Number(el.dataset.time) || 0; }, () => {});
  }, { once: true });
  let generation = 0;
  function showPlanes() {
    const mine = ++generation;
    assetCache.setScope(JSON.stringify([state.position, view.layers.filter(l => l.visible).map(l => l.id),
      view.orientation_levels ? orientationLevel : null]));
    assetCache.pause();
    for (const layer of view.layers) {
      const img = images.get(layer.id);
      if (!layer.visible) {
        assetCache.release(img); delete img.dataset.source;
        if (img.tagName === 'IMG') img.removeAttribute('src');
        if (typeof videos !== 'undefined' && videos.has(layer.id)) {
          const video = videos.get(layer.id); assetCache.release(video);
          video.pause(); video.removeAttribute('src'); delete video.dataset.source; video.load();
        }
        continue;
      }
      if (isVideo(layer)) { showVideo(layer, videos.get(layer.id)); continue; }
      if (layer.kind === 'vectors') { const name = view.positions[state.position].name; loadVectors(name).then(() => { if (view.positions[state.position].name === name) drawVectors(layer); }); continue; }
      const src = source(layer);
      if (!src) { assetCache.release(img); delete img.dataset.source; img.removeAttribute('src'); img.style.visibility = 'hidden'; continue; }
      assetCache.showImage(img, src, () => mine === generation && layer.visible);
    }
    preloadAssets();
    renderReadout(); rememberView();
  }

  // --- controls ----------------------------------------------------------
  // viewer-layer-controls-v2
  let arrangement = null;
  const panel = sc.layerPanel({
    onSelect(id) { arrangement?.select(id); },
    controls: $('layer-controls'), list: $('layer-list'), layers: panelLayers(), groups: view.groups,
    selected: view.layers.find(l => l.kind === 'image')?.id,
    contrastCommit: 'input', autoContrast: 'none',
    onChange(id, patch) {
      const layer = view.layers.find(l => l.id === id), s = layerState.get(id);
      if ('visible' in patch) layer.visible = patch.visible;
      for (const key of ['limits', 'gamma', 'colormap', 'opacity', 'blending']) if (key in patch) s[key] = patch[key];
      styleLayer(layer); if ('visible' in patch) showPlanes();
      renderColorbar();
    },
  });
  // Colour bar of the top visible heat map (website addition).
  const colorbar = document.createElement('div');
  colorbar.className = 'colorbar'; colorbar.hidden = true;
  colorbar.innerHTML = '<span class="cb-name"></span><div class="cb-body"><span class="cb-ramp"></span><span class="cb-ticks"><span></span><span></span><span></span></span></div>';
  $('viewport').append(colorbar);
  function renderColorbar() {
    const layer = [...view.layers].reverse().find(l => l.kind === 'image' && l.visible && l.group !== 'raw');
    colorbar.hidden = !layer;
    if (!layer) return;
    const s = layerState.get(layer.id), [low, high] = s.limits, span = Math.abs(high - low);
    const digits = span >= 100 ? 0 : span >= 10 ? 1 : 2;
    const ticks = colorbar.querySelectorAll('.cb-ticks span');
    [high, (low + high) / 2, low].forEach((v, i) => { ticks[i].textContent = (Math.abs(v) < 1e-9 ? 0 : v).toFixed(digits).replace(/\.0+$/, ''); });
    colorbar.querySelector('.cb-name').textContent = layer.name;
    colorbar.querySelector('.cb-ramp').style.background = sc.colormapGradient(s.colormap, 'to top');
  }
  renderColorbar();
  arrangement = window.LayerArrangement.create({ view, stage, images, layerState, panel,
    restyle: styleLayer, host: $('dock') });

  const position = sc.axisControl($('dims'), { label: 'Position', name: 'P', count: view.positions.length, value: state.position, playable: false,
    onChange(value) {
      state.position = value; applySize();
      time.configure({ count: frames().length, spacing: view.positions[state.position].dt || view.scale?.t }); state.t = time.value;
      restyle(true); fit(); showPlanes();
    } });
  const time = sc.axisControl($('dims'), { label: 'Time', name: 't', count: frames().length, value: state.t, fps: 6,
    spacing: view.positions[state.position].dt || view.scale?.t, unit: view.units?.t || 's', onChange(value) { state.t = value; showPlanes(); } });
  const contiguous = planes.every((z, i) => i === 0 || z === planes[i - 1] + 1);
  const depth = planes.length > 1 ? sc.axisControl($('dims'), { label: 'Z plane', name: 'z', count: planes.length, value: state.plane, fps: 4,
    spacing: contiguous ? view.scale?.z : null, unit: view.units?.z || 'µm', onChange(value) { state.plane = value; restyle(); showPlanes(); } }) : null;
  const showDepth = () => { if (depth) depth.element.style.display = state.z === 'stack' ? '' : 'none'; };
  // Planes share one window per channel, projections have their own; the
  // colour table follows the window of what is shown.
  let shownKeys = '';
  function restyle(force = false) {
    const keys = view.layers.map(l => l.kind === 'image' ? keyFor(l) : '').join('|');
    if (force || keys !== shownKeys) { shownKeys = keys; view.layers.forEach(styleLayer); }
  }

  $('zview').value = state.z;
  $('zview').addEventListener('change', () => {
    const before = new Map(view.layers.filter(l => l.kind === 'image').map(l => [l.id, currentWindow(l)]));
    state.z = $('zview').value; showDepth();
    // Keep each channel's limits at the same place within its (new) window.
    for (const layer of view.layers.filter(l => l.kind === 'image')) {
      const s = layerState.get(layer.id), [a0, a1] = before.get(layer.id), [b0, b1] = currentWindow(layer);
      s.limits = s.limits.map(v => b0 + ((v - a0) / (a1 - a0)) * (b1 - b0));
    }
    panel.setLayers(panelLayers()); restyle(); view.layers.forEach(styleLayer); showPlanes();
  });
  $('layers-toggle').addEventListener('click', () => { const dock = $('dock'); dock.hidden = !dock.hidden; $('layers-toggle').setAttribute('aria-expanded', String(!dock.hidden)); });
  if (matchMedia('(max-width: 720px)').matches) $('dock').hidden = true;

  function renderReadout() {
    const p = view.positions[state.position], t = frames()[state.t];
    const dt = view.positions[state.position].dt || view.scale?.t; const hours = dt ? ` · ${(t * dt / 3600).toFixed(2)} h` : '';
    const zText = state.z === 'stack' ? `plane ${planes[state.plane]}` : zOptions.find(z => z.key === state.z)?.name || '';
    $('readout').textContent = `${p.label || p.name} · T${t}${hours} · ${zText} · ${Math.round(state.scale * 100)}%` + (p.marks?.[t] ? ` · ${p.marks[t]}` : '');
  }
  function rememberView() {
    const hash = new URLSearchParams({ position: view.positions[state.position].name, t: frames()[state.t], z: state.z });
    if (state.z === 'stack') hash.set('plane', planes[state.plane]);
    history.replaceState(null, '', `#${hash}`);
  }

  // --- pan and zoom ------------------------------------------------------
  function apply() { stage.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.scale})`; renderReadout(); }
  function fit() {
    const box = viewport.getBoundingClientRect();
    state.scale = Math.min(box.width / width, box.height / height) || 1;
    state.x = (box.width - width * state.scale) / 2; state.y = (box.height - height * state.scale) / 2; apply();
  }
  function zoomAt(factor, cx, cy) {
    const next = Math.min(40, Math.max(0.05, state.scale * factor)); factor = next / state.scale;
    state.x = cx - (cx - state.x) * factor; state.y = cy - (cy - state.y) * factor; state.scale = next; apply();
  }
  viewport.addEventListener('wheel', e => { e.preventDefault(); const r = viewport.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  const pointers = new Map(); let pinch = null;
  viewport.addEventListener('pointerdown', e => { viewport.setPointerCapture(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]); viewport.classList.add('dragging'); });
  viewport.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    const [px, py] = pointers.get(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 1) { state.x += e.clientX - px; state.y += e.clientY - py; apply(); return; }
    const [a, b] = [...pointers.values()], r = viewport.getBoundingClientRect();
    const distance = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (pinch) zoomAt(distance / pinch, (a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top);
    pinch = distance;
  });
  const release = e => { pointers.delete(e.pointerId); pinch = null; if (!pointers.size) viewport.classList.remove('dragging'); };
  viewport.addEventListener('pointerup', release); viewport.addEventListener('pointercancel', release);
  viewport.addEventListener('dblclick', e => { const r = viewport.getBoundingClientRect(); zoomAt(2, e.clientX - r.left, e.clientY - r.top); });
  $('home').addEventListener('click', fit);
  window.addEventListener('resize', fit);
  window.addEventListener('keydown', e => {
    if (e.target.closest('input, select, textarea')) return;
    if (e.key === 'ArrowRight') time.set(Math.min(frames().length - 1, state.t + 1));
    else if (e.key === 'ArrowLeft') time.set(Math.max(0, state.t - 1));
    else if (depth && state.z === 'stack' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); depth.set(Math.max(0, Math.min(planes.length - 1, state.plane + (e.key === 'ArrowUp' ? 1 : -1)))); }
    else if (e.key === 'PageDown' || e.key === 'PageUp') { e.preventDefault(); position.set(state.position + (e.key === 'PageDown' ? 1 : -1)); }
    else if (e.key === ' ') { e.preventDefault(); time.setPlaying(!time.playing); }
    else if (e.key === 'Home' || e.key === '0') fit();
    else return;
  });

  showDepth(); restyle();
  fit(); showPlanes();
})();
