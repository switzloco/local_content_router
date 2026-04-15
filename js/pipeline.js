// pipeline.js — Segment → Classify → De-identify pipeline
//
// Speed tiers:
//   1. Segmentation: instant heuristics (no LLM)
//   2. Keyword-matched + no PII: instant, zero Gemma calls
//   3. Keyword-matched + PII: light deidentify-only micro-prompt
//   4. Ambiguous: full classify+deidentify micro-prompt
//
// All Gemma prompts use compressed single-letter JSON keys to minimize
// token generation. Every character Gemma doesn't have to generate saves ms.

import model from './model.js';

// ── Compressed key maps ──
// Gemma outputs: { c, f, s, p, t }
// We expand to full keys after parsing
const EXPAND_CATEGORY = { w: 'work', p: 'personal', h: 'health', f: 'finance', e: 'education', o: 'other' };

function expandResult(compressed, originalText) {
  return {
    category: EXPAND_CATEGORY[compressed.c] || validCategory(compressed.c) || 'other',
    confidence: clamp(Number(compressed.f) || 0.5, 0, 1),
    summary: String(compressed.s || '').slice(0, 80),
    pii: Array.isArray(compressed.p) ? compressed.p : [],
    clean: String(compressed.t || originalText),
    original: originalText,
  };
}

function extractJSON(text) {
  let cleaned = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) return JSON.parse(objMatch[0]);
  return JSON.parse(cleaned);
}

// ── Step 1: Heuristic segmentation (instant) ──

export function segmentTranscript(text) {
  let parts = text.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  if (parts.length > 1) return mergeShort(parts);

  parts = text.split(/\n/).map(s => s.trim()).filter(Boolean);
  if (parts.length > 1) return mergeShort(parts);

  const TOPIC_SHIFT = /(?<=[.!?])\s+(?=(?:Also|Oh|One more|Another|Remind|Need to|I (?:should|need|have|want|got)|For (?:the|my)|Don't forget|Pick up|Call |Schedule|Check|Submit|Send|OK |Okay ))/i;
  parts = text.split(TOPIC_SHIFT).map(s => s.trim()).filter(s => s.length > 10);
  if (parts.length > 1) return parts;

  parts = text.split(/(?<=[.!?])\s+(?=[A-Z])/).map(s => s.trim()).filter(s => s.length > 10);
  if (parts.length > 1) return mergeShort(parts);

  return [text.trim()];
}

function mergeShort(parts, minLen = 40) {
  const merged = [];
  for (const p of parts) {
    if (merged.length > 0 && merged[merged.length - 1].length < minLen) {
      merged[merged.length - 1] += ' ' + p;
    } else {
      merged.push(p);
    }
  }
  return merged;
}

// ── Step 1.5: Keyword pre-classification (instant) ──

export function buildKeywordMatchers(keywordsConfig) {
  const matchers = new Map();
  for (const [category, csv] of Object.entries(keywordsConfig || {})) {
    const words = (csv || '').split(',').map(w => w.trim().toLowerCase()).filter(w => w.length > 0);
    if (words.length === 0) continue;
    const pattern = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    matchers.set(category, new RegExp(`\\b(?:${pattern})\\b`, 'i'));
  }
  return matchers;
}

export function matchKeywords(text, matchers) {
  let bestCategory = null;
  let bestCount = 0;
  let bestWords = [];

  for (const [category, regex] of matchers) {
    const matches = text.match(new RegExp(regex.source, 'gi'));
    if (matches && matches.length > bestCount) {
      bestCount = matches.length;
      bestCategory = category;
      bestWords = [...new Set(matches.map(m => m.toLowerCase()))];
    }
  }
  return bestCategory ? { category: bestCategory, matchedKeywords: bestWords } : null;
}

// ── Step 2a: De-identify only (keyword-matched segments) ──

async function deidentifyOnly(segmentText, piiConfig, category, matchedKeywords) {
  const t0 = performance.now();

  const enabledPII = Object.entries(piiConfig || {}).filter(([, v]) => v).map(([k]) => k);

  // No PII types enabled → skip Gemma entirely
  if (enabledPII.length === 0) {
    console.log(`[pipeline] keyword "${category}" [${matchedKeywords}] → 0s (no PII check)`);
    return {
      category, confidence: 0.95,
      summary: segmentText.slice(0, 60).replace(/\s+/g, ' '),
      pii: [], clean: segmentText, original: segmentText, matchedBy: 'keyword',
    };
  }

  // Micro-prompt: bare minimum, compressed keys
  const messages = [
    {
      role: 'user',
      content: `Replace PII with placeholders. ONLY return JSON.
{"s":"summary","p":["pii_types"],"t":"cleaned text"}
PII: ${enabledPII.join(',')}. Tags: [PERSON],[DATE],[PHONE],[EMAIL],[ADDRESS],[ACCOUNT],[MEDICAL_ID]
Text: ${segmentText}`
    },
  ];

  const raw = await model.generate(messages, { maxTokens: 384 });
  const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`[pipeline] deidentify "${category}" [${matchedKeywords}] (${segmentText.length}ch) → ${elapsed}s`);

  try {
    const r = extractJSON(raw);
    return {
      category, confidence: 0.95,
      summary: String(r.s || segmentText.slice(0, 60)),
      pii: Array.isArray(r.p) ? r.p : [],
      clean: String(r.t || segmentText),
      original: segmentText, matchedBy: 'keyword',
    };
  } catch {
    console.warn('[pipeline] deidentify parse failed');
    return {
      category, confidence: 0.9,
      summary: segmentText.slice(0, 60).replace(/\s+/g, ' '),
      pii: [], clean: segmentText, original: segmentText, matchedBy: 'keyword',
    };
  }
}

// ── Step 2b: Full classify + de-identify (ambiguous segments) ──

async function fullClassify(segmentText, piiConfig, userInstructions) {
  const t0 = performance.now();

  const enabledPII = Object.entries(piiConfig || {}).filter(([, v]) => v).map(([k]) => k);

  const piiLine = enabledPII.length > 0
    ? `PII(${enabledPII.join(',')}): use [PERSON],[DATE],[PHONE],[EMAIL],[ADDRESS],[ACCOUNT],[MEDICAL_ID]`
    : '';

  const rulesLine = userInstructions ? `Rules: ${userInstructions}` : '';

  // Micro-prompt: compressed JSON keys, no fluff
  const messages = [
    {
      role: 'user',
      content: `Classify and de-identify. ONLY return JSON.
{"c":"w|p|h|f|e|o","f":0.9,"s":"summary","p":["pii_types"],"t":"cleaned text"}
c: w=work,p=personal,h=health,f=finance,e=education,o=other
${piiLine}
${rulesLine}
Text: ${segmentText}`
    },
  ];

  const raw = await model.generate(messages, { maxTokens: 384 });
  const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`[pipeline] full classify (${segmentText.length}ch) → ${elapsed}s`);

  try {
    const r = extractJSON(raw);
    const result = expandResult(r, segmentText);
    result.matchedBy = 'gemma';
    return result;
  } catch {
    console.warn('[pipeline] classify parse failed:', raw.slice(0, 200));
    return {
      category: 'other', confidence: 0,
      summary: segmentText.slice(0, 60) + '…',
      pii: [], clean: segmentText, original: segmentText, matchedBy: 'gemma',
    };
  }
}

const VALID_CATEGORIES = new Set(['work', 'personal', 'health', 'finance', 'education', 'other']);
function validCategory(cat) {
  const c = String(cat || '').toLowerCase().trim();
  return VALID_CATEGORIES.has(c) ? c : 'other';
}
function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

// ── Main pipeline ──

export async function processTranscript(text, piiConfig, onStatus, onSegment, userInstructions, keywordsConfig) {
  const t0 = performance.now();

  onStatus?.('Segmenting transcript…');
  const segments = segmentTranscript(text);
  console.log(`[pipeline] segmented into ${segments.length} parts (instant)`);

  const matchers = buildKeywordMatchers(keywordsConfig);
  const hasKeywords = matchers.size > 0;

  const results = [];
  let keywordHits = 0, gemmaHits = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const kwMatch = hasKeywords ? matchKeywords(seg, matchers) : null;

    let result;
    if (kwMatch) {
      keywordHits++;
      onStatus?.(`${i + 1}/${segments.length}: "${kwMatch.category}" ⚡ keyword: ${kwMatch.matchedKeywords[0]}${piiConfig ? ' — PII scan…' : ''}`);
      result = await deidentifyOnly(seg, piiConfig, kwMatch.category, kwMatch.matchedKeywords);
    } else {
      gemmaHits++;
      onStatus?.(`${i + 1}/${segments.length}: classifying with Gemma…`);
      result = await fullClassify(seg, piiConfig, userInstructions);
    }

    result.id = i;
    results.push(result);
    onSegment?.(result, i, segments.length);
  }

  const totalSec = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`[pipeline] done — ${results.length} segments in ${totalSec}s (${keywordHits} keyword, ${gemmaHits} gemma)`);
  onStatus?.(`Done — ${results.length} segments in ${totalSec}s (${keywordHits} instant, ${gemmaHits} AI)`);
  return results;
}
