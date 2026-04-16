// model.js — Gemma 4 model manager (Web Worker proxy)
// All heavy work (download, load, inference) runs in a dedicated worker
// so the main thread stays responsive and Chrome Android doesn't kill the tab.

class ModelManager {
  constructor() {
    this.worker = null;
    this.device = null;
    this.modelId = null;
    this.ready = false;
    this._pendingCallbacks = new Map(); // id → { resolve, reject, onToken }
    this._nextId = 1;
    this._initResolve = null;
    this._initReject = null;
    this._onProgress = null;
    this._prewarmResolve = null;
    this._clearCacheResolve = null;
  }

  _spawnWorker() {
    // Use module worker so it can use dynamic import() for transformers.js CDN
    this.worker = new Worker(
      new URL('./worker.js', import.meta.url),
      { type: 'module' },
    );
    this.worker.addEventListener('message', (e) => this._onMessage(e.data));
    this.worker.addEventListener('error', (e) => {
      console.error('[model] worker error:', e.message);
      // Reject pending init if worker crashes during load
      if (this._initReject) {
        this._initReject(new Error(`Worker error: ${e.message}`));
        this._initResolve = null;
        this._initReject = null;
      }
    });
  }

  _onMessage(msg) {
    switch (msg.type) {
      case 'progress':
        this._onProgress?.(msg);
        break;

      case 'device':
        this.device = msg.device;
        break;

      case 'ready':
        this.ready = true;
        this._initResolve?.();
        this._initResolve = null;
        this._initReject = null;
        break;

      case 'error':
        if (msg.id) {
          // Error for a specific generate call
          const cb = this._pendingCallbacks.get(msg.id);
          if (cb) {
            this._pendingCallbacks.delete(msg.id);
            cb.reject(new Error(msg.message));
          }
        } else {
          // Init-level error
          this._initReject?.(new Error(msg.message));
          this._initResolve = null;
          this._initReject = null;
        }
        break;

      case 'token': {
        const cb = this._pendingCallbacks.get(msg.id);
        cb?.onToken?.(msg.text);
        break;
      }

      case 'result': {
        const cb = this._pendingCallbacks.get(msg.id);
        if (cb) {
          this._pendingCallbacks.delete(msg.id);
          cb.resolve(msg.text);
        }
        break;
      }

      case 'prewarm-done':
        this._prewarmResolve?.();
        this._prewarmResolve = null;
        break;

      case 'cache-cleared':
        this._clearCacheResolve?.();
        this._clearCacheResolve = null;
        break;
    }
  }

  /**
   * Load model + processor in the worker.
   * Calls onProgress({ status, progress, message }).
   */
  async init(modelId, onProgress) {
    this.modelId = modelId;
    this._onProgress = onProgress;

    this._spawnWorker();

    return new Promise((resolve, reject) => {
      this._initResolve = resolve;
      this._initReject = reject;
      this.worker.postMessage({ type: 'init', modelId });
    });
  }

  /**
   * Generate a completion from chat messages.
   * @param {Array<{role:string, content:string}>} messages
   * @param {object} opts
   * @param {number} opts.maxTokens
   * @param {function} opts.onToken - streaming callback
   * @returns {Promise<string>}
   */
  async generate(messages, { maxTokens = 1024, onToken } = {}) {
    if (!this.ready) throw new Error('Model not loaded');

    const id = this._nextId++;
    return new Promise((resolve, reject) => {
      this._pendingCallbacks.set(id, { resolve, reject, onToken });
      this.worker.postMessage({ type: 'generate', id, messages, maxTokens });
    });
  }

  /**
   * Pre-warm: compile WebGPU shaders in the background.
   */
  async prewarm() {
    if (!this.ready) return;
    console.log('[model] requesting pre-warm from worker…');
    return new Promise((resolve) => {
      this._prewarmResolve = resolve;
      this.worker.postMessage({ type: 'prewarm' });
    });
  }

  /** Clear cached model files from browser storage */
  async clearCache() {
    if (this.worker) {
      return new Promise((resolve) => {
        this._clearCacheResolve = resolve;
        this.worker.postMessage({ type: 'clearCache' });
      });
    }
    // Fallback: clear from main thread if worker not spawned
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      for (const key of keys) {
        if (key.includes('transformers') || key.includes('onnx')) {
          await caches.delete(key);
        }
      }
    }
  }
}

// Singleton
const model = new ModelManager();
export default model;
