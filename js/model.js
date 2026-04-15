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

      // Load processor and model in parallel
      const [processor, model] = await Promise.all([
        AutoProcessor.from_pretrained(modelId),
        Gemma4ForConditionalGeneration.from_pretrained(modelId, {
          device: this.device,
          dtype,
          progress_callback: (p) => {
            if (p.status === 'progress' && p.total) {
              const pct = Math.round((p.loaded / p.total) * 100);
              onProgress?.({
                status: 'download',
                progress: pct,
                message: `Downloading: ${pct}%`,
              });
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
