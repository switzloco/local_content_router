// app.js — Main controller for Local Content Router

import * as config from './config.js';
import model from './model.js';
import { processTranscript } from './pipeline.js';
import * as router from './router.js';

// Import built-in plugins
import clipboardPlugin from '../plugins/clipboard.js';
import copilot365Plugin from '../plugins/copilot365.js';
import geminiPlugin from '../plugins/gemini.js';
import keepPlugin from '../plugins/keep.js';
import localPlugin from '../plugins/local.js';

// ── State ──
let cfg = config.load();
let segments = [];           // classified segment results
let destinationMap = {};     // segmentId → destinationId overrides
let modelReady = false;
let recognition = null;      // SpeechRecognition instance

// ── DOM refs ──
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  overlay:       $('#loading-overlay'),
  loadTitle:     $('#loading-title'),
  loadStatus:    $('#loading-status'),
  loadDetail:    $('#loading-detail'),
  progressFill:  $('#progress-fill'),
  webgpuWarn:    $('#webgpu-warning'),

  screenInput:   $('#screen-input'),
  screenReview:  $('#screen-review'),
  screenSettings:$('#screen-settings'),

  textarea:      $('#transcript-input'),
  charCount:     $('#char-count'),
  micStatus:     $('#mic-status'),
  btnMic:        $('#btn-mic'),
  btnClear:      $('#btn-clear'),
  btnDemo:       $('#btn-demo'),
  btnProcess:    $('#btn-process'),

  navReview:     $('#nav-review'),
  reviewSummary: $('#review-summary'),
  btnBack:       $('#btn-back'),
  btnRouteAll:   $('#btn-route-all'),
  processBanner: $('#processing-banner'),
  processStatus: $('#processing-status'),
  segContainer:  $('#segments-container'),
  cardTpl:       $('#segment-card-tpl'),

  routingRules:  $('#routing-rules'),
  toggleDeident: $('#toggle-deidentify'),
  piiOptions:    $('#pii-options'),
  modelSelect:   $('#model-select'),
  customName:    $('#custom-dest-name'),
  customUrl:     $('#custom-dest-url'),
  btnAddDest:    $('#btn-add-dest'),
  btnExport:     $('#btn-export-config'),
  btnImport:     $('#btn-import-config'),
  btnClearCache: $('#btn-clear-cache'),
};

// ── Init ──
async function init() {
  registerPlugins();
  bindEvents();
  applyConfig();
  checkWebGPU();
  handleShareTarget();
  await loadModel();
}

/** Pick up text shared via Android share target (or URL params) */
function handleShareTarget() {
  const params = new URLSearchParams(window.location.search);
  const shared = params.get('text') || params.get('title') || params.get('url');
  if (shared) {
    dom.textarea.value = shared;
    onTextChange();
    // Clean up the URL without reloading
    window.history.replaceState({}, '', window.location.pathname);
  }
}

function registerPlugins() {
  router.register(clipboardPlugin);
  router.register(copilot365Plugin);
  router.register(geminiPlugin);
  router.register(keepPlugin);
  router.register(localPlugin);

  // Re-register any custom destinations from config
  for (const custom of cfg.customDestinations) {
    router.registerCustom(custom);
  }
}

// ── Navigation ──
function showScreen(name) {
  for (const s of $$('.screen')) s.hidden = true;
  const screen = $(`#screen-${name}`);
  if (screen) {
    screen.hidden = false;
    screen.classList.add('active');
  }
  for (const b of $$('.nav-btn')) {
    b.classList.toggle('active', b.dataset.screen === name);
  }
}

// ── Event Binding ──
function bindEvents() {
  // Navigation
  for (const btn of $$('.nav-btn')) {
    btn.addEventListener('click', () => {
      if (!btn.disabled) showScreen(btn.dataset.screen);
    });
  }

  // Input screen
  dom.textarea.addEventListener('input', onTextChange);
  dom.btnClear.addEventListener('click', () => { dom.textarea.value = ''; onTextChange(); });
  dom.btnDemo.addEventListener('click', loadDemo);
  dom.btnProcess.addEventListener('click', onProcess);
  dom.btnMic.addEventListener('click', toggleMic);

  // Review screen
  dom.btnBack.addEventListener('click', () => showScreen('input'));
  dom.btnRouteAll.addEventListener('click', onRouteAll);

  // Settings screen
  dom.toggleDeident.addEventListener('change', onDeidentToggle);
  for (const cb of $$('[data-pii]')) {
    cb.addEventListener('change', onPiiChange);
  }
  dom.modelSelect.addEventListener('change', onModelChange);
  dom.btnAddDest.addEventListener('click', onAddCustomDest);

  // Routing instructions
  const instrEl = $('#routing-instructions');
  if (instrEl) {
    instrEl.value = cfg.routingInstructions || '';
    instrEl.addEventListener('input', () => {
      cfg.routingInstructions = instrEl.value;
      config.save(cfg);
    });
  }
  dom.btnExport.addEventListener('click', () => config.exportJSON(cfg));
  dom.btnImport.addEventListener('click', async () => {
    try {
      cfg = await config.importJSON();
      applyConfig();
    } catch { /* user cancelled or bad file */ }
  });
  dom.btnClearCache.addEventListener('click', async () => {
    await model.clearCache();
    dom.btnClearCache.textContent = 'Cache cleared ✓';
    setTimeout(() => { dom.btnClearCache.textContent = 'Clear Model Cache'; }, 2000);
  });
}

// ── Text input ──
function onTextChange() {
  const len = dom.textarea.value.length;
  dom.charCount.textContent = `${len.toLocaleString()} character${len === 1 ? '' : 's'}`;
  dom.btnProcess.disabled = !modelReady || len < 10;
}

// ── Load demo transcript ──
async function loadDemo() {
  try {
    const resp = await fetch('demo/sample-transcripts.json');
    const data = await resp.json();
    const samples = data.samples;
    // Cycle through samples
    const idx = (parseInt(dom.btnDemo.dataset.idx || '0', 10)) % samples.length;
    dom.textarea.value = samples[idx].text;
    dom.btnDemo.dataset.idx = idx + 1;
    onTextChange();
  } catch {
    dom.textarea.value = 'Need to send Q3 report to Sarah by Friday. Also remind me to call the dentist — my appointment was supposed to be next week. Pick up groceries: milk, bread, pasta sauce.';
    onTextChange();
  }
}

// ── Voice input ──
function toggleMic() {
  if (recognition) {
    recognition.stop();
    return;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    dom.micStatus.textContent = 'Speech recognition not supported';
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onstart = () => {
    dom.micStatus.textContent = '● Recording';
    dom.micStatus.classList.add('recording');
    dom.btnMic.classList.add('active');
  };

  recognition.onresult = (e) => {
    let transcript = '';
    for (let i = 0; i < e.results.length; i++) {
      transcript += e.results[i][0].transcript;
    }
    dom.textarea.value = transcript;
    onTextChange();
  };

  recognition.onend = () => {
    recognition = null;
    dom.micStatus.textContent = '';
    dom.micStatus.classList.remove('recording');
    dom.btnMic.classList.remove('active');
  };

  recognition.onerror = (e) => {
    dom.micStatus.textContent = `Mic error: ${e.error}`;
    recognition = null;
    dom.btnMic.classList.remove('active');
  };

  recognition.start();
}

// ── Process transcript ──
async function onProcess() {
  const text = dom.textarea.value.trim();
  if (!text || !modelReady) return;

  segments = [];
  destinationMap = {};
  dom.segContainer.innerHTML = '';
  dom.processBanner.hidden = false;
  dom.btnRouteAll.disabled = true;

  showScreen('review');
  dom.navReview.disabled = false;

  try {
    segments = await processTranscript(
      text,
      cfg.deidentify ? cfg.piiTypes : null,
      (msg) => { dom.processStatus.textContent = msg; },
      (seg, i, total) => {
        // Assign default destination from config
        destinationMap[seg.id] = cfg.routingRules[seg.category] || 'clipboard';
        appendSegmentCard(seg);
        dom.reviewSummary.textContent = `${i + 1} of ${total} segments`;
      },
      cfg.routingInstructions || '',
    );

    dom.processBanner.hidden = true;
    dom.btnRouteAll.disabled = false;
    dom.reviewSummary.textContent = `${segments.length} segment${segments.length === 1 ? '' : 's'} ready`;
  } catch (err) {
    dom.processStatus.textContent = `Error: ${err.message}`;
  }
}

// ── Render a segment card ──
function appendSegmentCard(seg) {
  const tpl = dom.cardTpl.content.cloneNode(true);
  const card = tpl.querySelector('.segment-card');
  card.dataset.category = seg.category;
  card.dataset.id = seg.id;

  card.querySelector('.category-pill').textContent = seg.category;
  card.querySelector('.confidence-badge').textContent = `${Math.round(seg.confidence * 100)}%`;
  card.querySelector('.card-summary').textContent = seg.summary;
  card.querySelector('.clean-text').innerHTML = highlightPII(seg.clean);
  card.querySelector('.original-text').textContent = seg.original;

  // Hide original details if no PII was found
  if (!seg.pii || seg.pii.length === 0) {
    card.querySelector('.original-details').hidden = true;
    card.querySelector('.card-toggle-pii').hidden = true;
  }

  // Destination select
  const destSelect = card.querySelector('.dest-select');
  for (const opt of router.buildDestOptions()) {
    const el = document.createElement('option');
    el.value = opt.id;
    el.textContent = opt.name;
    destSelect.appendChild(el);
  }
  destSelect.value = destinationMap[seg.id] || 'clipboard';
  destSelect.addEventListener('change', () => {
    destinationMap[seg.id] = destSelect.value;
  });

  // PII toggle
  const toggleBtn = card.querySelector('.card-toggle-pii');
  let showClean = true;
  toggleBtn.addEventListener('click', () => {
    showClean = !showClean;
    const textEl = card.querySelector('.clean-text');
    if (showClean) {
      textEl.innerHTML = highlightPII(seg.clean);
      toggleBtn.textContent = '🔒';
      toggleBtn.title = 'Showing de-identified text';
    } else {
      textEl.textContent = seg.original;
      toggleBtn.textContent = '🔓';
      toggleBtn.title = 'Showing original text';
    }
  });

  // Send button
  const sendBtn = card.querySelector('.card-send-btn');
  sendBtn.addEventListener('click', async () => {
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending…';
    const destId = destinationMap[seg.id] || 'clipboard';
    const result = await router.route(seg, destId, cfg.deidentify);
    const sentMsg = card.querySelector('.card-sent-msg');
    sentMsg.hidden = false;
    sentMsg.textContent = result.message;
    if (result.success) {
      card.classList.add('sent');
      sendBtn.textContent = 'Sent ✓';
    } else {
      sendBtn.textContent = 'Retry →';
      sendBtn.disabled = false;
      sentMsg.style.color = 'var(--danger)';
    }
  });

  dom.segContainer.appendChild(tpl);
}

/** Highlight [PLACEHOLDER] tags in de-identified text */
function highlightPII(text) {
  return text.replace(
    /\[([A-Z_]+)\]/g,
    '<span class="pii-tag">[$1]</span>',
  );
}

// ── Route All ──
async function onRouteAll() {
  dom.btnRouteAll.disabled = true;
  dom.btnRouteAll.textContent = 'Sending…';

  const results = await router.routeAll(segments, destinationMap, cfg.deidentify);

  for (const { segmentId, result } of results) {
    const card = dom.segContainer.querySelector(`[data-id="${segmentId}"]`);
    if (!card) continue;
    const sentMsg = card.querySelector('.card-sent-msg');
    sentMsg.hidden = false;
    sentMsg.textContent = result.message;
    const sendBtn = card.querySelector('.card-send-btn');
    if (result.success) {
      card.classList.add('sent');
      sendBtn.textContent = 'Sent ✓';
      sendBtn.disabled = true;
    } else {
      sentMsg.style.color = 'var(--danger)';
    }
  }

  dom.btnRouteAll.textContent = 'All Sent ✓';
}

// ── Settings handlers ──
function applyConfig() {
  // Routing rules grid
  dom.routingRules.innerHTML = '';
  const allDest = router.buildDestOptions();
  for (const cat of config.CATEGORIES) {
    const row = document.createElement('div');
    row.className = 'routing-rule-row';

    const label = document.createElement('span');
    label.className = 'routing-rule-label';
    label.textContent = cat;

    const sel = document.createElement('select');
    sel.className = 'routing-rule-select';
    sel.dataset.cat = cat;
    for (const opt of allDest) {
      const el = document.createElement('option');
      el.value = opt.id;
      el.textContent = opt.name;
      sel.appendChild(el);
    }
    sel.value = cfg.routingRules[cat] || 'clipboard';
    sel.addEventListener('change', () => {
      cfg.routingRules[cat] = sel.value;
      config.save(cfg);
    });

    row.appendChild(label);
    row.appendChild(sel);
    dom.routingRules.appendChild(row);
  }

  // De-identification toggles
  dom.toggleDeident.checked = cfg.deidentify;
  dom.piiOptions.style.opacity = cfg.deidentify ? '1' : '0.4';
  dom.piiOptions.style.pointerEvents = cfg.deidentify ? 'auto' : 'none';

  for (const cb of $$('[data-pii]')) {
    const key = cb.dataset.pii;
    cb.checked = cfg.piiTypes?.[key] ?? true;
  }

  // Model select
  dom.modelSelect.value = cfg.modelId;
}

function onDeidentToggle() {
  cfg.deidentify = dom.toggleDeident.checked;
  dom.piiOptions.style.opacity = cfg.deidentify ? '1' : '0.4';
  dom.piiOptions.style.pointerEvents = cfg.deidentify ? 'auto' : 'none';
  config.save(cfg);
}

function onPiiChange(e) {
  const key = e.target.dataset.pii;
  cfg.piiTypes[key] = e.target.checked;
  config.save(cfg);
}

function onModelChange() {
  cfg.modelId = dom.modelSelect.value;
  config.save(cfg);
  // Inform user they need to reload to switch models
  dom.modelSelect.insertAdjacentHTML(
    'afterend',
    '<p class="settings-hint" style="color:var(--warning-text)">Reload the page to load the new model.</p>',
  );
}

function onAddCustomDest() {
  const name = dom.customName.value.trim();
  const urlTemplate = dom.customUrl.value.trim();
  if (!name || !urlTemplate) return;

  const id = 'custom_' + name.toLowerCase().replace(/\s+/g, '_');
  const custom = { id, name, urlTemplate };
  router.registerCustom(custom);
  cfg.customDestinations.push(custom);
  config.save(cfg);

  // Refresh settings UI to show new destination in dropdowns
  applyConfig();

  dom.customName.value = '';
  dom.customUrl.value = '';
}

// ── WebGPU check ──
function checkWebGPU() {
  if (!navigator.gpu) {
    dom.webgpuWarn.hidden = false;
  }
}

// ── Model loading ──
async function loadModel() {
  dom.overlay.hidden = false;
  dom.btnProcess.disabled = true;

  try {
    await model.init(cfg.modelId, (p) => {
      dom.loadStatus.textContent = p.message;
      if (p.progress != null) {
        dom.progressFill.style.width = `${p.progress}%`;
      }
      if (p.status === 'detect' && p.message.includes('WASM')) {
        dom.webgpuWarn.hidden = false;
      }
    });
    modelReady = true;
    dom.overlay.hidden = true;
    onTextChange(); // enable process button if text present
  } catch (err) {
    dom.loadTitle.textContent = 'Load failed';
    dom.loadStatus.textContent = err.message;
    dom.loadDetail.innerHTML = `
      Check that you're using Chrome 113+ with WebGPU enabled.<br>
      <button onclick="location.reload()" class="btn btn-primary" style="margin-top:12px">Retry</button>
    `;
  }
}

// ── Service worker + persistent storage ──
async function registerSW() {
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./sw.js');
    } catch { /* ok if it fails */ }
  }
  // Ask the browser to protect our storage from eviction.
  // On Chrome Android this usually auto-grants for installed PWAs.
  if (navigator.storage?.persist) {
    const persisted = await navigator.storage.persist();
    if (!persisted) {
      console.log('Storage persistence not granted — model cache may be evicted under pressure');
    }
  }
}

// ── Start ──
registerSW();
init();
