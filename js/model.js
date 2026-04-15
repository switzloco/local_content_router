// model.js — Gemma 4 WebGPU loader via @huggingface/transformers v4+
// Uses Gemma4ForConditionalGeneration + AutoProcessor (NOT the pipeline API)

let Gemma4ForConditionalGeneration, AutoProcessor, TextStreamer, env;

async function loadTransformers() {
  const mod = await import(
    'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4/dist/transformers.min.js'
  );
  Gemma4ForConditionalGeneration = mod.Gemma4ForConditionalGeneration;
  AutoProcessor = mod.AutoProcessor;
  TextStreamer = mod.TextStreamer;
  env = mod.env;
  env.allowLocalModels = false;
}

class ModelManager {
  constructor() {
    this.model = null;
    this.processor = null;
    this.device = null;
    this.modelId = null;
    this.ready = false;
  }

  async detectDevice() {
    if (typeof navigator !== 'undefined' && navigator.gpu) {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) return 'webgpu';
      } catch { /* fall through */ }
    }
    return 'wasm';
  }

  /**
   * Load model + processor. Calls onProgress({ status, progress, message }).
   * status: 'detect' | 'download' | 'load' | 'ready' | 'error'
   */
  async init(modelId, onProgress) {
    try {
      onProgress?.({ status: 'detect', message: 'Loading AI runtime…' });
      await loadTransformers();

      this.device = await this.detectDevice();
      onProgress?.({ status: 'detect', message: `Using ${this.device.toUpperCase()} backend` });

      this.modelId = modelId;
      onProgress?.({ status: 'download', progress: 0, message: 'Downloading model…' });

      const dtype = this.device === 'webgpu' ? 'q4f16' : 'q8';

      // Track aggregate download progress across all model shards.
      // Shards that were cached from a previous (interrupted) download resolve
      // almost instantly — so the bar picks up where it left off, not from 0%.
      const fileProgress = {};   // file → { loaded, total }
      const cachedFiles = new Set();  // files that loaded instantly (= cached)
      let lastPct = 0;
      let lastUpdate = 0;       // timestamp — throttle UI updates to ~4/sec

      const [processor, model] = await Promise.all([
        AutoProcessor.from_pretrained(modelId),
        Gemma4ForConditionalGeneration.from_pretrained(modelId, {
          device: this.device,
          dtype,
          progress_callback: (p) => {
            if (p.status === 'initiate' && p.file) {
              // File starting — track it
              fileProgress[p.file] = { loaded: 0, total: 0 };
            } else if (p.status === 'progress' && p.file && p.total) {
              fileProgress[p.file] = { loaded: p.loaded, total: p.total };

              // If a file jumps to 100% on its very first progress event,
              // it was served from cache — note it for the status message.
              if (p.loaded === p.total && !cachedFiles.has(p.file)) {
                const prev = fileProgress[p.file]?.loaded ?? 0;
                if (prev === 0) cachedFiles.add(p.file);
              }

              let totalLoaded = 0, totalSize = 0;
              for (const f of Object.values(fileProgress)) {
                totalLoaded += f.loaded;
                totalSize += f.total;
              }
              const pct = totalSize > 0 ? Math.round((totalLoaded / totalSize) * 100) : 0;
              const now = Date.now();

              // Only update if progress moved forward + throttle to avoid DOM thrash
              if (pct >= lastPct && (now - lastUpdate > 250 || pct === 100)) {
                lastPct = pct;
                lastUpdate = now;

                const cached = cachedFiles.size;
                const total = Object.keys(fileProgress).length;
                const msg = cached > 0 && cached < total
                  ? `Downloading: ${pct}% (${cached} file${cached > 1 ? 's' : ''} cached)`
                  : cached === total
                    ? 'Loading from cache…'
                    : `Downloading: ${pct}%`;

                onProgress?.({ status: 'download', progress: pct, message: msg });
              }
            } else if (p.status === 'done') {
              onProgress?.({ status: 'load', progress: 100, message: 'Initializing model…' });
            }
          },
        }),
      ]);

      this.processor = processor;
      this.model = model;
      this.ready = true;
      onProgress?.({ status: 'ready', progress: 100, message: 'Model ready' });
    } catch (err) {
      onProgress?.({ status: 'error', message: `Model load failed: ${err.message}` });
      throw err;
    }
  }

  /**
   * Generate a completion from chat messages.
   * @param {Array<{role:string, content:string}>} messages
   * @param {object} opts
   * @param {number} opts.maxTokens - max new tokens (default 1024)
   * @param {function} opts.onToken - streaming callback (receives text chunk)
   * @returns {string} Full generated text
   */
  async generate(messages, { maxTokens = 1024, onToken } = {}) {
    if (!this.ready) throw new Error('Model not loaded');

    // Apply chat template to get formatted prompt string
    const prompt = this.processor.apply_chat_template(messages, {
      enable_thinking: false,
      add_generation_prompt: true,
    });

    // Tokenize — signature: processor(text, image, audio, options)
    const inputs = await this.processor(prompt, null, null, {
      add_special_tokens: false,
    });

    // Stream decoded tokens via TextStreamer
    let result = '';
    const streamer = new TextStreamer(this.processor.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (text) => {
        result += text;
        onToken?.(text);
      },
    });

    await this.model.generate({
      ...inputs,
      max_new_tokens: maxTokens,
      do_sample: false,
      streamer,
    });

    return result;
  }

  /**
   * Pre-warm: fire a tiny silent generation to force Chrome to compile
   * WebGPU shaders in the background. Without this, the first real call
   * pays a ~5-10s shader compilation tax on top of inference time.
   * Call this right after init() — it runs while the user reads the UI.
   */
  async prewarm() {
    if (!this.ready) return;
    const t0 = performance.now();
    console.log('[model] pre-warming WebGPU shaders…');
    try {
      await this.generate(
        [{ role: 'user', content: 'Hi' }],
        { maxTokens: 1 },
      );
      console.log(`[model] pre-warm done in ${((performance.now() - t0) / 1000).toFixed(1)}s — shaders compiled`);
    } catch {
      console.warn('[model] pre-warm failed (non-fatal)');
    }
  }

  /** Clear cached model files from browser storage */
  async clearCache() {
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
