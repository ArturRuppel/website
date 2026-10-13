// Bounded RAM caching for exported viewers. Classic script also works under file://.
(function () {
// Keep compressed source previews in this tab's RAM. Mutable results and edits
// deliberately have their own loading paths. Only displayed planes are decoded.
class ViewerAssetCache {
  constructor({ maxBytes = 128 * 1024 * 1024, workers = 2, fetcher = (...args) => fetch(...args), onChange = () => {} } = {}) {
    Object.assign(this, { maxBytes, workers, fetcher, onChange });
    this.items = new Map(); this.pending = new Map(); this.bytes = 0;
    this.scope = null; this.epoch = 0; this.plan = null; this.total = 0;
    this.failed = new Set(); this.skipped = new Set(); this.full = false;
    this.network = typeof location === 'undefined' || /^https?:$/.test(location.protocol);
    this.mediaURLs = new WeakMap();
  }
  setScope(scope) {
    if (scope === this.scope) return;
    this.epoch++; this.scope = scope; this.plan = null;
    for (const request of this.pending.values()) if (!request.keepOnScopeChange) request.controller.abort();
    this.pending.clear(); this.items.clear(); this.failed.clear(); this.skipped.clear();
    this.bytes = 0; this.total = 0; this.full = false; this.notify();
  }
  pause() { this.plan = null; }
  start(urls, total) {
    if (!this.network) return;
    if (this.full) { this.total = total; this.notify(); return; }
    this.plan = urls[Symbol.iterator](); this.total = total; this.full = false;
    this.pump(); this.notify();
  }
  stats() {
    return { planes: this.items.size, total: this.total, bytes: this.bytes,
      maxBytes: this.maxBytes, failed: this.failed.size, skipped: this.skipped.size, full: this.full,
      loading: !!this.plan || this.pending.size > 0 };
  }
  notify() { this.onChange(this.stats()); }
  get(url) {
    if (!this.network || this.skipped.has(url)) return Promise.resolve(null);
    const blob = this.items.get(url);
    if (blob) {
      this.items.delete(url); this.items.set(url, blob);
      return Promise.resolve(blob);
    }
    const pending = this.pending.get(url);
    if (pending) { pending.foreground = true; return pending.promise; }
    return this.request(url, true);
  }
  request(url, foreground) {
    const epoch = this.epoch;
    const entry = { foreground, controller: new AbortController(), promise: null };
    // Defer fetch so even a synchronous failure has a registered pending entry.
    entry.promise = Promise.resolve().then(async () => {
      const response = await this.fetcher(url, { signal: entry.controller.signal, priority: entry.foreground ? 'high' : 'low' });
      if (!response.ok) throw new Error(await response.text());
      const blob = await this.readBounded(response);
      if (epoch !== this.epoch) return blob;
      this.failed.delete(url);
      if (!blob) { this.skipped.add(url); return null; }
      if (blob.size > this.maxBytes || (!entry.foreground && this.bytes + blob.size > this.maxBytes)) {
        this.full = true; this.plan = null;
        return blob;
      }
      while (this.bytes + blob.size > this.maxBytes && this.items.size) {
        const oldest = this.items.keys().next().value;
        this.bytes -= this.items.get(oldest).size; this.items.delete(oldest);
      }
      this.items.set(url, blob); this.bytes += blob.size;
      return blob;
    }).catch(error => {
      if (epoch === this.epoch && error.name !== 'AbortError') this.failed.add(url);
      throw error;
    }).finally(() => {
      if (this.pending.get(url) === entry) this.pending.delete(url);
      if (epoch === this.epoch) { this.pump(); this.notify(); }
    });
    this.pending.set(url, entry);
    return entry.promise;
  }
  pump() {
    // Leave network capacity for the frame being viewed; at most two speculative
    // transfers run concurrently, even when the user scrubs through many frames.
    if ([...this.pending.values()].some(request => request.foreground)) return;
    while (this.plan && this.pending.size < this.workers) {
      const next = this.plan.next();
      if (next.done) { this.plan = null; break; }
      const url = next.value;
      if (this.items.has(url) || this.pending.has(url) || this.failed.has(url) || this.skipped.has(url)) continue;
      if (this.bytes >= this.maxBytes) { this.full = true; this.plan = null; break; }
      this.request(url, false).catch(() => {}); // Report failures in progress; viewing retries them.
    }
  }

  async readBounded(response) {
    // Do not download a multi-gigabyte video merely to discover it cannot fit.
    if (Number(response.headers?.get('Content-Length')) > this.maxBytes) {
      await response.body?.cancel(); return null;
    }
    if (!response.body?.getReader) {
      const blob = await response.blob(); return blob.size <= this.maxBytes ? blob : null;
    }
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > this.maxBytes) { await reader.cancel(); return null; }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    return new Blob(chunks, { type: response.headers.get('Content-Type') || 'application/octet-stream' });
  }
  release(element) {
    const url = this.mediaURLs.get(element);
    if (url) URL.revokeObjectURL(url);
    this.mediaURLs.delete(element);
  }
  async showImage(element, src, current) {
    if (element.dataset.source === src) return;
    let blob;
    try { blob = await this.get(src); }
    catch (error) { if (error.name === 'AbortError' || !current()) return; }
    if (!current()) return;
    const url = blob ? URL.createObjectURL(blob) : src;
    const next = new Image(); next.decoding = 'async'; next.src = url;
    try {
      await next.decode();
      if (!current()) { if (blob) URL.revokeObjectURL(url); return; }
      this.release(element);
      if (blob) this.mediaURLs.set(element, url);
      element.dataset.source = src; element.src = url; element.style.visibility = '';
    } catch {
      if (blob) URL.revokeObjectURL(url);
      if (current()) { element.removeAttribute('src'); delete element.dataset.source; element.style.visibility = 'hidden'; }
    }
  }
  warmVideo(video, src) {
    // Stream the first frame immediately, then retain a complete compressed
    // movie for seeks. A movie above the budget keeps using native streaming.
    if (!this.network) return;
    this.get(src).then(blob => {
      if (!blob || video.dataset.source !== src) return;
      const url = URL.createObjectURL(blob); this.release(video); this.mediaURLs.set(video, url);
      video.addEventListener('loadedmetadata', () => {
        const seek = () => { video.currentTime = Number(video.dataset.time) || 0; };
        video.play().then(() => { video.pause(); seek(); }, seek);
      }, { once: true });
      video.src = url;
    }).catch(() => {}); // Native streaming remains usable on a failed preload.
  }
  async script(script, src) {
    // Keep compressed script payloads without evaluating/decompressing every
    // frame. The viewer still evaluates only the frame it actually needs.
    try {
      const loading = this.get(src);
      // Classic-script loaders share a promise between render passes. Let a
      // demanded script finish across scope changes so a second render cannot
      // inherit an aborted promise; stale render callbacks already check keys.
      const request = this.pending.get(src);
      if (request) request.keepOnScopeChange = true;
      const blob = await loading;
      const url = blob ? URL.createObjectURL(new Blob([blob], { type: 'text/javascript' })) : src;
      if (blob) {
        const release = () => URL.revokeObjectURL(url);
        script.addEventListener('load', release, { once: true });
        script.addEventListener('error', release, { once: true });
      }
      script.src = url; document.head.append(script);
    } catch { script.dispatchEvent(new Event('error')); }
  }
}


window.ViewerAssetCache = ViewerAssetCache;
})();
