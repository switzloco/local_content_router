// pipeline.js — Segment → Classify → De-identify pipeline using Gemma 4
//
// Segmentation is done with fast heuristics (no LLM call).
// Only classification + de-identification use Gemma — that's where AI matters.

import model from './model.js';

/**
 * Extract JSON from an LLM response that may contain markdown fences or extra text.
 */
function extractJSON(text) {
  let cleaned = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();

  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrayMatch) return JSON.parse(arrayMatch[0]);

  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) return JSON.parse(objMatch[0]);

  return JSON.parse(cleaned);
}

/**
 * Step 1: Segment transcript using heuristics (instant, no LLM).
 *
 * Strategy: split on paragraph breaks, then on topic-shift signals
 * (sentence ending + new sentence starting with a capital letter and
 * a transition word or clear subject change).
 */
export function segmentTranscript(text) {
  // 1. Paragraph breaks (double newline)
  let parts = text.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  if (parts.length > 1) return mergeShort(parts);

  // 2. Single newlines that separate distinct thoughts
  parts = text.split(/\n/).map(s => s.trim()).filter(Boolean);
  if (parts.length > 1) return mergeShort(parts);

  // 3. Sentence boundaries followed by topic-shift signals
  const TOPIC_SHIFT = /(?<=[.!?])\s+(?=(?:Also|Oh|One more|Another|Remind|Need to|I (?:should|need|have|want|got)|For (?:the|my)|Don't forget|Pick up|Call |Schedule|Check|Submit|Send|OK |Okay ))/i;
  parts = text.split(TOPIC_SHIFT).map(s => s.trim()).filter(s => s.length > 10);
  if (parts.length > 1) return parts;

  // 4. Plain sentence boundary + capital letter
  parts = text
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map(s => s.trim())
    .filter(s => s.length > 10);
  if (parts.length > 1) return mergeShort(parts);

  // 5. Whole transcript as one segment
  return [text.trim()];
}

/** Merge very short segments (< 40 chars) into their neighbor */
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

/**
 * Step 2: Classify a single segment and de-identify PII.
 * This is the only step that calls Gemma.
 */
export async function classifySegment(segmentText, piiConfig, onStatus, userInstructions) {
  const t0 = performance.now();
  onStatus?.('Classifying…');

  const enabledPII = Object.entries(piiConfig || {})
    .filter(([, v]) => v)
    .map(([k]) => k);

  const piiInstruction = enabledPII.length > 0
    ? `Detect these PII types and replace them in "clean": ${enabledPII.join(', ')}. Use placeholders like [PERSON], [DATE], [PHONE], [EMAIL], [ADDRESS], [ACCOUNT], [MEDICAL_ID].`
    : 'Do not modify the text for PII.';

  const customRules = userInstructions
    ? `\nAdditional classification rules from the user:\n${userInstructions}\n`
    : '';

  const messages = [
    {
      role: 'user',
      content: `Classify this text segment and de-identify PII. Respond with ONLY a JSON object, no explanation.

Required JSON format:
{
  "category": "work" | "personal" | "health" | "finance" | "education" | "other",
  "confidence": 0.0 to 1.0,
  "summary": "5-10 word summary",
  "pii": ["list of PII types found, or empty array"],
  "clean": "text with PII replaced by placeholders"
}

${piiInstruction}${customRules}
Text:
"""
${segmentText}
"""`
    },
  ];

  // Cap output tokens to prevent runaway generation.
  // The JSON response should be ~200 tokens max for a typical segment.
  const raw = await model.generate(messages, { maxTokens: 512 });
  const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`[pipeline] classify segment (${segmentText.length} chars) → ${elapsed}s`);

  try {
    const result = extractJSON(raw);
    return {
      category: validCategory(result.category),
      confidence: clamp(Number(result.confidence) || 0.5, 0, 1),
      summary: String(result.summary || '').slice(0, 80),
      pii: Array.isArray(result.pii) ? result.pii : [],
      clean: String(result.clean || segmentText),
      original: segmentText,
    };
  } catch {
    console.warn('[pipeline] failed to parse classification JSON:', raw);
    return {
      category: 'other',
      confidence: 0,
      summary: segmentText.slice(0, 60) + '…',
      pii: [],
      clean: segmentText,
      original: segmentText,
    };
  }
}

const VALID_CATEGORIES = new Set(['work', 'personal', 'health', 'finance', 'education', 'other']);

function validCategory(cat) {
  const c = String(cat || '').toLowerCase().trim();
  return VALID_CATEGORIES.has(c) ? c : 'other';
}

function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

/**
 * Full pipeline: segment (heuristic) → classify each (Gemma) → return results.
 * Calls onSegment(result, index, total) as each segment is classified.
 */
export async function processTranscript(text, piiConfig, onStatus, onSegment, userInstructions) {
  const t0 = performance.now();

  // Step 1: fast heuristic segmentation (instant, no LLM)
  onStatus?.('Segmenting transcript…');
  const segments = segmentTranscript(text);
  console.log(`[pipeline] segmented into ${segments.length} parts (heuristic, instant)`);
  onStatus?.(`Found ${segments.length} segment${segments.length === 1 ? '' : 's'}. Classifying…`);

  // Step 2: classify each with Gemma (sequentially to avoid memory pressure)
  const results = [];
  for (let i = 0; i < segments.length; i++) {
    onStatus?.(`Classifying segment ${i + 1} of ${segments.length}…`);
    const result = await classifySegment(segments[i], piiConfig, () => {}, userInstructions);
    result.id = i;
    results.push(result);
    onSegment?.(result, i, segments.length);
  }

  const total = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`[pipeline] done — ${results.length} segments in ${total}s`);
  onStatus?.(`Done — ${results.length} segments in ${total}s`);
  return results;
}
