// pipeline.js — Segment → Classify → De-identify pipeline using Gemma 4

import model from './model.js';

/**
 * Extract JSON from an LLM response that may contain markdown fences or extra text.
 */
function extractJSON(text) {
  // Strip markdown code fences
  let cleaned = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();

  // Try to find a JSON array or object
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrayMatch) return JSON.parse(arrayMatch[0]);

  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) return JSON.parse(objMatch[0]);

  return JSON.parse(cleaned);
}

/**
 * Step 1: Segment a raw transcript into distinct topics/thoughts.
 * Returns string[] of segments.
 */
export async function segmentTranscript(text, onStatus) {
  onStatus?.('Segmenting transcript…');

  const messages = [
    {
      role: 'user',
      content: `You are a transcript segmenter. Split the following voice memo transcript into distinct segments. Each segment should cover one complete thought, task, or topic. Keep the original wording — do not summarize or rephrase. Return ONLY a JSON array of strings, nothing else.

Transcript:
"""
${text}
"""`
    },
  ];

  const raw = await model.generate(messages, { maxTokens: 2048 });

  try {
    const segments = extractJSON(raw);
    if (Array.isArray(segments) && segments.length > 0) {
      return segments.map(s => String(s).trim()).filter(Boolean);
    }
  } catch { /* fall through to fallback */ }

  // Fallback: split on double newlines or sentence boundaries
  onStatus?.('Using fallback segmentation…');
  return fallbackSegment(text);
}

function fallbackSegment(text) {
  // Try double-newline split first
  let parts = text.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  if (parts.length > 1) return parts;

  // Split on sentence-ending punctuation followed by a topic shift signal
  parts = text
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map(s => s.trim())
    .filter(s => s.length > 10);

  if (parts.length > 1) return parts;

  // Last resort: return the whole thing as one segment
  return [text.trim()];
}

/**
 * Step 2: Classify a single segment and de-identify PII.
 * Returns a classification object.
 */
export async function classifySegment(segmentText, piiConfig, onStatus) {
  onStatus?.('Classifying…');

  const enabledPII = Object.entries(piiConfig || {})
    .filter(([, v]) => v)
    .map(([k]) => k);

  const piiInstruction = enabledPII.length > 0
    ? `Detect these PII types and replace them in "clean": ${enabledPII.join(', ')}. Use placeholders like [PERSON], [DATE], [PHONE], [EMAIL], [ADDRESS], [ACCOUNT], [MEDICAL_ID].`
    : 'Do not modify the text for PII.';

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

${piiInstruction}

Text:
"""
${segmentText}
"""`
    },
  ];

  const raw = await model.generate(messages, { maxTokens: 1024 });

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
    // Fallback: return a best-effort classification
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
 * Full pipeline: segment → classify each → return results.
 * Calls onSegment(result, index, total) as each segment is classified.
 */
export async function processTranscript(text, piiConfig, onStatus, onSegment) {
  onStatus?.('Starting pipeline…');

  // Step 1: segment
  const segments = await segmentTranscript(text, onStatus);
  onStatus?.(`Found ${segments.length} segment${segments.length === 1 ? '' : 's'}. Classifying…`);

  // Step 2: classify each (sequentially to avoid memory pressure)
  const results = [];
  for (let i = 0; i < segments.length; i++) {
    onStatus?.(`Classifying segment ${i + 1} of ${segments.length}…`);
    const result = await classifySegment(segments[i], piiConfig, () => {});
    result.id = i;
    results.push(result);
    onSegment?.(result, i, segments.length);
  }

  onStatus?.(`Done — ${results.length} segments classified.`);
  return results;
}
