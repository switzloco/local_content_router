// config.js — localStorage-backed configuration for Local Content Router

const STORAGE_KEY = 'lcr_config';

const CATEGORIES = ['work', 'personal', 'health', 'finance', 'education', 'ignore', 'other'];

const PII_TYPES = [
  'person_name', 'date', 'phone', 'email', 'address', 'account', 'medical_id',
];

const DEFAULT_CONFIG = {
  // category → default destination id
  routingRules: {
    work: 'copilot365',
    personal: 'gemini',
    health: 'local',
    finance: 'local',
    education: 'clipboard',
    ignore: 'none',
    other: 'clipboard',
  },
  deidentify: true,
  piiTypes: Object.fromEntries(PII_TYPES.map(t => [t, true])),
  modelId: 'onnx-community/gemma-4-E2B-it-ONNX',
  customDestinations: [], // [{ id, name, urlTemplate }]
  routingInstructions: '', // user's custom instructions for classification
  // Keywords for instant pre-classification (skips Gemma when matched)
  keywords: {
    work: 'report, meeting, standup, deadline, project, sprint, client, invoice, stakeholder, deliverable, KPI, OKR, quarterly',
    health: 'patient, MRN, diagnosis, prescription, appointment, doctor, symptoms, vitals, EKG, cardiology, follow-up, HIPAA, referral, lab results',
    personal: '',
    finance: 'mortgage, payment, account, bank, transfer, insurance, tax',
    education: 'student, class, curriculum, grades, assignment, semester, course',
    ignore: 'sit, stay, heel, good boy, good girl, treat, walk, fetch, drop it, leave it, come here, no, bad',
    other: '',
  },
};

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_CONFIG);
    const saved = JSON.parse(raw);
    // Merge with defaults so new keys added in updates are present
    return { ...structuredClone(DEFAULT_CONFIG), ...saved };
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

function save(config) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

function reset() {
  localStorage.removeItem(STORAGE_KEY);
  return structuredClone(DEFAULT_CONFIG);
}

function exportJSON(config) {
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'local-router-config.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importJSON() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      try {
        const text = await input.files[0].text();
        const config = JSON.parse(text);
        save(config);
        resolve(config);
      } catch (err) {
        reject(err);
      }
    };
    input.click();
  });
}

export { CATEGORIES, PII_TYPES, DEFAULT_CONFIG, load, save, reset, exportJSON, importJSON };
