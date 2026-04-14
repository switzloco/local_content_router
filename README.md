# Local Content Router

> **Kaggle Gemma 4 Good Hackathon submission**
> Privacy-first brain dump router powered by Gemma 4 running 100% locally in your browser.

## What It Does

Paste your morning brain dump (voice memo transcript, stream-of-consciousness notes, doctor's dictation) and the app uses **Gemma 4 running on-device via WebGPU** to:

1. **Segment** — break your text into discrete topics/thoughts
2. **Classify** — assign each segment to a destination (Work, Personal, Ideas, Health, etc.)
3. **De-identify** — strip PII/PHI before anything sensitive leaves your device
4. **Route** — copy-ready content for each destination app (Copilot 365, Gemini, NotebookLM, etc.)

**Zero data leaves your device during classification.** Open the browser network tab — you'll see nothing but local requests.

## Use Cases

| User | Brain Dump | Routing |
|------|-----------|---------|
| Knowledge worker | Morning notes | Work → Copilot 365, Personal → Gemini, Ideas → NotebookLM |
| Doctor | Patient dictation | Patient notes (de-identified) → Local only, Admin → Copilot |
| Lawyer | Case notes | Confidential (de-identified) → Local only, Research → Gemini |

## How to Use

1. Open `index.html` in Chrome or Edge (WebGPU required)
2. Select a profile (Morning Brain Dump, Medical Professional, Legal, or Custom)
3. Click **Load Model** — Gemma downloads once, then caches locally (~700MB)
4. Paste or speak your brain dump
5. Click **Route My Notes**
6. Review the classified segments, override any mis-classifications
7. Click **Copy** for each destination and paste into your app of choice

## Privacy Story

All AI inference happens in the browser via WebGPU. The model weights are cached in IndexedDB on your device. The de-identification pipeline runs two layers:

- **Regex layer**: Instantly strips SSNs, phone numbers, emails, DOBs, MRNs
- **Gemma layer**: NLP-based detection for names, locations, and other context-dependent PII/PHI

## Architecture

```
index.html  (single self-contained file — no build step, no server)
├── CSS     — embedded styles, dark theme, category color system
├── HTML    — 4-panel flow: Setup → Input → Review → Summary
└── JS      — embedded ES module
    ├── WebGPU detection + @mlc-ai/web-llm engine management
    ├── Profile system (JSON stored in localStorage)
    ├── Classification prompt pipeline (structured JSON output)
    ├── De-identification (regex + Gemma NER)
    └── Routing (clipboard copy + optional URL open)
```

## Profiles

Profiles are JSON objects stored in `localStorage`. Three are built in:

### Morning Brain Dump (default)
| Category | Destination | De-identify |
|----------|------------|-------------|
| Work | Copilot 365 | No |
| Personal | Gemini | No |
| Ideas | NotebookLM | No |
| Health | Local Only | Yes |

### Medical Professional
| Category | Destination | De-identify |
|----------|------------|-------------|
| Patient Notes | Local Only | Yes (full HIPAA) |
| Administrative | Copilot 365 | Yes (names, MRN) |
| Research | Gemini | Yes (names, dates) |
| Personal | Gemini | No |

### Legal Professional
| Category | Destination | De-identify |
|----------|------------|-------------|
| Client Confidential | Local Only | Yes |
| Administrative | Copilot 365 | No |
| Legal Research | Gemini | No |
| Personal | Gemini | No |

## Adding Custom Profiles

In the Settings panel, create a new profile and define:
- Category names and color coding
- Destination app per category
- De-identification rules per category
- Category definitions (fed into Gemma's classification prompt)

## Tech Stack

| Component | Technology |
|-----------|-----------|
| AI Runtime | WebGPU via `@mlc-ai/web-llm` |
| Model | Gemma 3 1B (in-browser) — upgradeable to Gemma 4 1B as web-llm adds support |
| Storage | Browser `localStorage` + `IndexedDB` (model cache) |
| Speech input | Web Speech API (optional, Chrome/Edge only) |
| No build step | Pure HTML/CSS/JS ES module |

## Why This Matters for "Gemma 4 Good"

- **Health**: Doctors can dictate freely knowing PHI is stripped before any AI cloud call
- **Digital Equity**: No API key, no subscription, no internet required after first load
- **Safety**: Gemma acts as a *privacy gateway* — your thoughts get classified and scrubbed before reaching external AI services

## Requirements

- Chrome 113+ or Edge 113+ (WebGPU support)
- ~700MB free storage (model cache, one-time download)
- Works on Android Chrome with a capable GPU

## Status

- [ ] `index.html` — main application (in progress)
- [ ] Profile editor UI
- [ ] Voice input integration
- [ ] Medical de-identification (HIPAA Safe Harbor)
