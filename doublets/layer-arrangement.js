// Per-viewer drawing order and line/outline appearance; classic script for file shares.
(function () {
  'use strict';
  const outlined = layer => ['labels', 'tracked_labels'].includes(layer.kind);
  const stroked = layer => outlined(layer) || ['vectors', 'tracks'].includes(layer.kind);
  const limits = layer => outlined(layer) ? { min: 1, max: 12, step: 1, unit: 'px' } : { min: .25, max: 8, step: .25, unit: '×' };
  function clampThickness(layer, value) {
    const { min, max, step } = limits(layer);
    return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value / step) * step)) : 1;
  }
  function normalizeOrder(saved, defaults) {
    const order = Array.isArray(saved) ? [...new Set(saved.filter(id => defaults.includes(id)))] : [];
    return [...order, ...defaults.filter(id => !order.includes(id))];
  }
  function move(order, id, index) {
    const next = order.filter(key => key !== id);
    if (!order.includes(id) || !Number.isFinite(index)) return [...order];
    next.splice(Math.max(0, Math.min(next.length, Math.round(index))), 0, id);
    return next;
  }
  const svgFilters = new WeakMap(); let filterId = 0;
  function outlineFilter(defs, layerId, thickness) {
    if (thickness <= 1) return '';
    let byLayer = svgFilters.get(defs);
    if (!byLayer) { byLayer = new Map(); svgFilters.set(defs, byLayer); }
    let filter = byLayer.get(layerId);
    const node = (name, attrs) => {
      const el = document.createElementNS('http://www.w3.org/2000/svg', name);
      for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
      return el;
    };
    if (!filter) {
      filter = node('filter', { id: `viewer-outline-${++filterId}`, x: '-25%', y: '-25%', width: '150%', height: '150%', 'color-interpolation-filters': 'sRGB' });
      // Exported outlines are opaque, with a faint (40/255 alpha) interior.
      // Isolate their opaque edges before widening; retain the original fill.
      const threshold = node('feComponentTransfer', { in: 'SourceGraphic', result: 'edges' });
      threshold.append(node('feFuncA', { type: 'discrete', tableValues: '0 0 0 1' }));
      const dilation = node('feMorphology', { in: 'edges', operator: 'dilate', radius: '1', result: 'wideEdges' });
      const merge = node('feMerge', {});
      merge.append(node('feMergeNode', { in: 'SourceGraphic' }), node('feMergeNode', { in: 'wideEdges' }));
      filter.append(threshold, dilation, merge); defs.append(filter); byLayer.set(layerId, filter);
    }
    filter.querySelector('feMorphology').setAttribute('radius', String((thickness - 1) / 2));
    return `url(#${filter.id})`;
  }
  function create({ view, stage, images, layerState, panel, restyle, host }) {
    const defaults = view.layers.map(layer => layer.id), byId = new Map(view.layers.map(layer => [layer.id, layer]));
    const key = `viewer-layer-arrangement-v2:${location.pathname.replace(/\/[^/]*$/, '')}`;
    let order = [...defaults], selected = panel.selected || defaults.at(-1);
    try {
      const stored = localStorage.getItem(key) || localStorage.getItem(`mnemosyne-layer-arrangement-v1:${view.experiment || location.pathname}`) || (view.experiment === 'NEMVP-01' && localStorage.getItem('nemvp-layer-arrangement-v1')) || '{}';
      const saved = JSON.parse(stored);
      order = normalizeOrder(saved.order, defaults);
      for (const layer of view.layers) layerState.get(layer.id).thickness = clampThickness(layer, saved.thickness?.[layer.id]);
    } catch { /* Browser storage may be unavailable on a file share. */ }
    const el = (tag, attrs = {}, text = '') => {
      const node = document.createElement(tag);
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
      node.textContent = text; return node;
    };
    const root = el('section', { class: 'layer-arrangement', 'aria-label': 'Layer order and thickness' });
    const title = el('strong', {}, 'Layer order & thickness');
    const selector = el('select', { id: 'stack-layer', 'aria-label': 'Layer to arrange' });
    const stackLabel = el('label', { for: 'stack-layer' }, 'Drawing order · front to back');
    const buttons = el('div', { class: 'layer-order-buttons' });
    const moves = {};
    for (const [id, text, target] of [['front', 'To front', () => order.length - 1], ['up', '↑ Forward', () => order.indexOf(selected) + 1], ['down', '↓ Backward', () => order.indexOf(selected) - 1], ['back', 'To back', () => 0]]) {
      const button = el('button', { type: 'button', id: `layer-${id}` }, text);
      button.addEventListener('click', () => { order = move(order, selected, target()); apply(); save(); render(); });
      buttons.append(button); moves[id] = button;
    }
    const rank = el('input', { id: 'layer-rank', type: 'number', min: '1', max: String(order.length), step: '1', inputmode: 'numeric', 'aria-label': 'Stack position, 1 is front' });
    const rankRow = el('label', { class: 'layer-rank-row' }, 'Stack position');
    rankRow.append(rank, el('span', {}, '(1 is front)'));
    const status = el('p', { id: 'stack-status' });
    const thicknessBox = el('div', { id: 'thickness-controls' });
    const thicknessLabel = el('label', { for: 'layer-thickness', id: 'thickness-label' });
    const slider = el('input', { id: 'layer-thickness', type: 'range' });
    const number = el('input', { id: 'layer-thickness-number', type: 'number', inputmode: 'decimal', 'aria-label': 'Thickness value' });
    const unit = el('span', { id: 'thickness-unit' });
    const row = el('div', { class: 'thickness-row' }); row.append(slider, number, unit);
    thicknessBox.append(thicknessLabel, row);
    const resetLayer = el('button', { id: 'layer-thickness-reset', type: 'button' }, 'Reset this thickness');
    thicknessBox.append(resetLayer);
    const resetAll = el('button', { id: 'layer-style-reset', type: 'button' }, 'Reset all order & thickness');
    root.append(title, stackLabel, selector, buttons, rankRow, status, thicknessBox, resetAll);
    host.querySelector('.layer-arrangement')?.remove();
    host.prepend(root);
    function save() {
      try { localStorage.setItem(key, JSON.stringify({ order, thickness: Object.fromEntries(view.layers.map(layer => [layer.id, layerState.get(layer.id).thickness ?? 1])) })); } catch {}
    }
    function apply() {
      for (const id of order) {
        const image = images.get(id); image.dataset.layerId = id; stage.append(image);
      }
    }
    function render() {
      const layer = byId.get(selected); if (!layer) return;
      selector.replaceChildren(...[...order].reverse().map(id => new Option(byId.get(id).name, id)));
      selector.value = selected; const index = order.indexOf(selected);
      moves.front.disabled = moves.up.disabled = index === order.length - 1;
      moves.back.disabled = moves.down.disabled = index === 0;
      rank.value = String(order.length - index);
      status.textContent = 'Display settings are saved for this viewer in this browser.';
      thicknessBox.hidden = !stroked(layer);
      const bounds = limits(layer), value = layerState.get(selected).thickness ?? 1;
      thicknessLabel.textContent = layer.kind === 'labels' ? 'Outline widening (image pixels)' : outlined(layer) ? 'Outline thickness (image pixels)' : 'Line thickness (× default)';
      thicknessBox.title = layer.kind === 'labels' ? 'Additional outline width; 0 keeps the exported outline unchanged.' : '';
      const offset = layer.kind === 'labels' ? 1 : 0;
      for (const input of [slider, number]) {
        input.min = String(bounds.min - offset); input.max = String(bounds.max - offset); input.step = String(bounds.step); input.value = String(value - offset);
      }
      unit.textContent = bounds.unit;
    }
    selector.addEventListener('change', () => panel.select(selector.value));
    rank.addEventListener('change', () => {
      if (rank.value !== '' && Number.isFinite(rank.valueAsNumber)) {
        order = move(order, selected, order.length - rank.valueAsNumber); apply(); save();
      }
      render();
    });
    function thickness(value) {
      const layer = byId.get(selected); if (!layer || !stroked(layer)) return;
      layerState.get(selected).thickness = clampThickness(layer, Number.isFinite(value) ? value + (layer.kind === 'labels' ? 1 : 0) : NaN);
      restyle(layer); save(); render();
    }
    slider.addEventListener('input', () => thickness(slider.valueAsNumber));
    number.addEventListener('change', () => thickness(number.value === '' ? NaN : number.valueAsNumber));
    resetLayer.addEventListener('click', () => thickness(byId.get(selected).kind === 'labels' ? 0 : 1));
    resetAll.addEventListener('click', () => {
      order = [...defaults]; for (const layer of view.layers) layerState.get(layer.id).thickness = 1;
      apply(); save(); render(); view.layers.forEach(restyle);
    });
    apply(); render();
    return { select(id) { if (byId.has(id)) { selected = id; render(); } } };
  }
  window.LayerArrangement = { create, outlineFilter, clampThickness, normalizeOrder, move };
})();
