// model.js — Gemma 4 WebGPU / WASM loader via @huggingface/transformers

const TF_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3';

let pipeline, TextStreamer, env;

async function loadTransformers() {
  const mod = await import(`${TF_CDN}/dist/transformers.min.js`);
  pipeline = mod.pipeline;
  TextStreamer = mod.TextStreamer;
  env = mod.env;
  env.allowLocalModels = false;
}

class ModelManager {
  constructor() {
    this.generator = null;
    this.device = null;
    this.modelId = null;
    this.ready = false;
  }

  /** Check if browser supports WebGPU */
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
   * Load the model. Calls onProgress({ status, progress, message }) throughout.
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

      this.generator = await pipeline('text-generation', modelId, {
        device: this.device,
        dtype,
        progress_callback: (p) => {
          if (p.status === 'progress' && p.progress != null) {
            onProgress?.({
              status: 'download',
              progress: Math.round(p.progress),
              message: `Downloading: ${Math.round(p.progress)}%`,
            });
          } else if (p.status === 'done') {
            onProgress?.({ status: 'load', progress: 100, message: 'Initializing model…' });
          }
        },
      });

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
   * @param {function} opts.onToken - streaming callback (receives partial text)
   * @returns {string} Generated text
   */
  async generate(messages, { maxTokens = 1024, onToken } = {}) {
    if (!this.ready) throw new Error('Model not loaded');

    const genOpts = {
      max_new_tokens: maxTokens,
      do_sample: false,
      return_full_text: false,
    };

    if (onToken && TextStreamer) {
      genOpts.streamer = new TextStreamer(this.generator.tokenizer, {
        skip_prompt: true,
        callback_function: onToken,
      });
    }

    const result = await this.generator(messages, genOpts);

    // transformers.js returns an array; get generated text from last message
    const output = result[0]?.generated_text;
    if (Array.isArray(output)) {
      // Chat-mode: array of messages
      return output.at(-1)?.content ?? '';
    }
    // Plain string
    return typeof output === 'string' ? output : '';
  }

  /** Clear the cached model files */
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
