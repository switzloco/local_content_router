// worker.js — Web Worker for Gemma 4 model loading + inference
// Runs entirely off the main thread so the UI stays responsive and
// Chrome Android doesn't kill the tab under memory/CPU pressure.

let Gemma4ForConditionalGeneration, AutoProcessor, TextStreamer, env;
let model = null;
let processor = null;
let device = null;

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

async function detectDevice() {
  if (typeof navigator !== 'undefined' && navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) return 'webgpu';
    } catch { /* fall through */ }
  }
  return 'wasm';
}

async function handleInit(modelId) {
  try {
    self.postMessage({ type: 'progress', status: 'detect', message: 'Loading AI runtime…' });
    await loadTransformers();

    device = await detectDevice();
    self.postMessage({ type: 'progress', status: 'detect', message: `Using ${device.toUpperCase()} backend` });
    self.postMessage({ type: 'device', device });

    self.postMessage({ type: 'progress', status: 'download', progress: 0, message: 'Downloading model…' });

    const dtype = device === 'webgpu' ? 'q4f16' : 'q8';

    const fileProgress = {};
    const cachedFiles = new Set();
    let lastPct = 0;
    let lastUpdate = 0;

    const [proc, mdl] = await Promise.all([
      AutoProcessor.from_pretrained(modelId),
      Gemma4ForConditionalGeneration.from_pretrained(modelId, {
        device,
        dtype,
        progress_callback: (p) => {
          if (p.status === 'initiate' && p.file) {
            fileProgress[p.file] = { loaded: 0, total: 0 };
          } else if (p.status === 'progress' && p.file && p.total) {
            fileProgress[p.file] = { loaded: p.loaded, total: p.total };

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

              self.postMessage({ type: 'progress', status: 'download', progress: pct, message: msg });
            }
          } else if (p.status === 'done') {
            self.postMessage({ type: 'progress', status: 'load', progress: 100, message: 'Initializing model…' });
          }
        },
      }),
    ]);

    processor = proc;
    model = mdl;
    self.postMessage({ type: 'progress', status: 'ready', progress: 100, message: 'Model ready' });
    self.postMessage({ type: 'ready' });
  } catch (err) {
    self.postMessage({ type: 'progress', status: 'error', message: `Model load failed: ${err.message}` });
    self.postMessage({ type: 'error', message: err.message });
  }
}

async function handleGenerate(id, messages, maxTokens) {
  if (!model || !processor) {
    self.postMessage({ type: 'error', id, message: 'Model not loaded' });
    return;
  }

  try {
    const prompt = processor.apply_chat_template(messages, {
      enable_thinking: false,
      add_generation_prompt: true,
    });

    const inputs = await processor(prompt, null, null, {
      add_special_tokens: false,
    });

    let result = '';
    const streamer = new TextStreamer(processor.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (text) => {
        result += text;
        self.postMessage({ type: 'token', id, text });
      },
    });

    await model.generate({
      ...inputs,
      max_new_tokens: maxTokens,
      do_sample: false,
      streamer,
    });

    self.postMessage({ type: 'result', id, text: result });
  } catch (err) {
    self.postMessage({ type: 'error', id, message: err.message });
  }
}

async function handlePrewarm() {
  if (!model || !processor) {
    self.postMessage({ type: 'prewarm-done' });
    return;
  }

  console.log('[worker] pre-warming WebGPU shaders…');
  const t0 = performance.now();
  try {
    const prompt = processor.apply_chat_template(
      [{ role: 'user', content: 'Hi' }],
      { enable_thinking: false, add_generation_prompt: true },
    );
    const inputs = await processor(prompt, null, null, { add_special_tokens: false });
    await model.generate({ ...inputs, max_new_tokens: 1, do_sample: false });
    console.log(`[worker] pre-warm done in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  } catch {
    console.warn('[worker] pre-warm failed (non-fatal)');
  }
  self.postMessage({ type: 'prewarm-done' });
}

async function handleClearCache() {
  if (typeof caches !== 'undefined') {
    const keys = await caches.keys();
    for (const key of keys) {
      if (key.includes('transformers') || key.includes('onnx')) {
        await caches.delete(key);
      }
    }
  }
  self.postMessage({ type: 'cache-cleared' });
}

// ── Message dispatcher ──
self.addEventListener('message', (e) => {
  const msg = e.data;
  switch (msg.type) {
    case 'init':
      handleInit(msg.modelId);
      break;
    case 'generate':
      handleGenerate(msg.id, msg.messages, msg.maxTokens);
      break;
    case 'prewarm':
      handlePrewarm();
      break;
    case 'clearCache':
      handleClearCache();
      break;
  }
});
