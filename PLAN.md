# Local Content Router — Project Plan

**Kaggle Gemma 4 Good Hackathon Entry**
**Deadline: May 18, 2026**

---

## The Problem

Every morning, millions of people do brain dumps — voice memos, journal entries, rapid-fire notes. That raw transcript is a jumble: work tasks, personal reminders, health observations, sensitive thoughts. Today, to act on those notes, you either:

1. **Manually copy-paste** segments into the right app (Copilot 365, Google Keep, a health tracker, etc.)
2. **Send everything to one cloud AI** — which means your doctor's visit notes, your kid's school info, and your work strategy all land on the same third-party server

Neither option respects your time or your privacy.

## The Solution

**Local Content Router** is a single-page web app that runs **Gemma 4 entirely in your browser via WebGPU**. It:

1. Takes a raw transcript (pasted text, or voice-to-text input)
2. Classifies each segment by intent/domain (work, personal, health, finance, etc.)
3. **De-identifies sensitive content** (names, dates, medical terms, account numbers) before routing
4. Routes each segment to the correct destination app via share intents, clipboard, or API

**Nothing leaves your device until you explicitly approve it — and even then, PII is stripped first.**

## Why This Matters (Competition Alignment)

The hackathon focuses on **health, education, and climate** with emphasis on:
- **Low bandwidth / offline-capable**: WebGPU inference = zero server dependency
- **Privacy-preserving**: On-device classification + de-identification
- **Real-world impact**: Doctors, teachers, field researchers all generate mixed-context notes

### Use Cases

| User | Problem | How Router Helps |
|------|---------|-----------------|
| **Doctor** | Dictates patient notes mixed with admin tasks. Patient data must stay on-device (HIPAA). | Classifies clinical vs. admin. De-identifies patient info before routing admin tasks to cloud tools. |
| **Teacher** | Morning planning mixes student concerns, curriculum ideas, personal errands. | Routes student-related notes to school LMS, personal items to personal apps. Student names stripped. |
| **Field Researcher** | Climate/ecological observations mixed with logistics and personal notes. | Routes field data to research database, logistics to team chat, personal to private journal. |
| **Knowledge Worker** | Brain dump mixes work strategy, personal todos, health reminders. | Work → Copilot 365, Personal → Gemini/Google Keep, Health → private local store. |

## Does This Already Exist?

**No.** The closest things are:

- **[Gemma Gem](https://github.com/kessler/gemma-gem)** — Runs Gemma 4 in-browser via WebGPU, but it's a general chat interface, not a router
- **[n8n AI Intent Router](https://community.n8n.io/t/ai-intent-router-classify-and-route-messages-to-different-handlers/259959)** — Server-side intent classification and routing, not on-device
- **[HuggingFace Gemma 4 WebGPU](https://huggingface.co/spaces/webml-community/Gemma-4-WebGPU)** — Demo of in-browser inference, not an application
- **Otter.ai, Whisper, etc.** — Transcription tools, but no classification/routing/de-identification

**The novel contribution is the combination**: on-device LLM + transcript segmentation + content classification + PII de-identification + multi-destination routing — all in the browser.

---

## Technical Architecture

### Stack

```
┌─────────────────────────────────────────────────────┐
│                    Browser (Chrome)                   │
│                                                       │
│  ┌─────────────┐   ┌──────────────────────────────┐  │
│  │  UI Layer    │   │  Gemma 4 (WebGPU)            │  │
│  │  HTML/CSS/JS │◄─►│  @huggingface/transformers   │  │
│  │              │   │  Model: gemma-4-e2b-it        │  │
│  └──────┬───────┘   └──────────────────────────────┘  │
│         │                        │                     │
│  ┌──────▼───────┐   ┌───────────▼──────────────────┐  │
│  │  Transcript  │   │  Classification Pipeline     │  │
│  │  Input       │   │  1. Segment transcript        │  │
│  │  (paste/mic) │   │  2. Classify each segment     │  │
│  │              │   │  3. De-identify PII            │  │
│  └──────────────┘   │  4. Present for approval       │  │
│                      └───────────┬──────────────────┘  │
│                                  │                     │
│  ┌───────────────────────────────▼──────────────────┐  │
│  │  Routing Layer                                    │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐         │  │
│  │  │ Copilot  │ │ Gemini   │ │ Local    │  ...     │  │
│  │  │ 365      │ │ /Keep    │ │ Storage  │         │  │
│  │  └──────────┘ └──────────┘ └──────────┘         │  │
│  └──────────────────────────────────────────────────┘  │
│                                                       │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Config Store (localStorage)                      │  │
│  │  - Routing rules                                  │  │
│  │  - Custom categories                              │  │
│  │  - De-identification preferences                  │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### Model Choice

- **Primary**: `gemma-4-e2b-it` (~500MB quantized) — fast enough for segment-by-segment classification
- **Optional upgrade**: `gemma-4-e4b-it` (~1.5GB) — better accuracy for complex de-identification
- **Runtime**: `@huggingface/transformers` with WebGPU backend
- **No server, no Ollama, no API keys**

### Core Pipeline (3 Gemma Calls per Transcript)

#### Step 1: Segment
Split the raw transcript into logical segments. Gemma prompt:
```
Given this raw transcript from a voice memo, split it into separate 
logical segments. Each segment should be one distinct thought, task, 
or topic. Return as a JSON array of strings.
```

#### Step 2: Classify + De-identify
For each segment, classify and flag PII. Single Gemma call with structured output:
```json
{
  "category": "work|personal|health|finance|education|other",
  "confidence": 0.95,
  "destination": "copilot365",
  "pii_detected": ["patient_name", "date_of_birth"],
  "deidentified_text": "Patient [REDACTED] presented with...",
  "original_text": "John Smith presented with..."
}
```

#### Step 3: User Review & Route
Present classified segments in a review UI. User can:
- Override category/destination
- Toggle de-identification on/off per segment
- Approve routing for individual or all segments

### Routing Destinations (Extensible)

Each destination is a simple plugin interface:

```javascript
// Route plugin interface
const RoutePlugin = {
  id: "copilot365",
  name: "Microsoft Copilot 365",
  icon: "...",
  description: "Work tasks and documents",
  
  // How to send content to this destination
  route: async (text, metadata) => {
    // Option A: Copy to clipboard with instructions
    // Option B: Open URL with pre-filled content
    // Option C: Web Share API
    // Option D: Deep link (mobile)
  },
  
  // Categories this destination handles by default
  defaultCategories: ["work"],
}
```

**Built-in destinations (v1):**
- **Copilot 365** — via deep link / Office web URL with pre-filled content
- **Google Gemini** — via URL with prompt parameter
- **Google Keep** — via share intent / URL scheme
- **Local Storage** — stays on device, never leaves
- **Clipboard** — manual routing, copies de-identified text
- **Custom URL** — user-configurable endpoint

### De-identification Engine

Gemma handles entity recognition. The de-identification is configurable:

| Entity Type | Default Action | Configurable |
|-------------|---------------|--------------|
| Person names | Replace with [PERSON] | Yes |
| Dates | Generalize (Jan 15 → Q1) | Yes |
| Phone numbers | Redact | Yes |
| Email addresses | Redact | Yes |
| Medical terms | Keep (needed for routing) | Yes |
| Addresses | Redact | Yes |
| Account numbers | Redact | Yes |

Users can define custom rules (e.g., "always redact student names but keep teacher names").

---

## File Structure

```
local_content_router/
├── PLAN.md                  # This file
├── LICENSE                  # Apache 2.0 (existing)
├── index.html               # Single-page app entry point
├── css/
│   └── styles.css           # UI styles (mobile-first)
├── js/
│   ├── app.js               # Main application logic
│   ├── model.js             # Gemma 4 WebGPU loader + inference
│   ├── pipeline.js          # Segment → Classify → De-identify pipeline
│   ├── router.js            # Routing engine + plugin system
│   └── config.js            # User configuration (localStorage)
├── plugins/
│   ├── copilot365.js        # Microsoft Copilot 365 route
│   ├── gemini.js            # Google Gemini route
│   ├── keep.js              # Google Keep route
│   ├── local.js             # Local-only storage route
│   ├── clipboard.js         # Clipboard route
│   └── custom-url.js        # User-defined URL route
├── assets/
│   └── icons/               # Destination app icons
└── demo/
    └── sample-transcripts.json  # Example transcripts for testing
```

**No build step.** Open `index.html` in Chrome and it works. This is critical for:
- Simplicity (no Node.js required)
- Kaggle notebook compatibility
- Mobile browser deployment (add to home screen as PWA later)

---

## UI Design

### Screen 1: Input
- Large text area for pasting transcript
- Microphone button for live voice-to-text (Web Speech API)
- "Process" button
- Model loading progress indicator (first load only, ~500MB cached after)

### Screen 2: Review & Route
- Each segment shown as a card
- Color-coded by category (work=blue, personal=green, health=red, etc.)
- Each card shows:
  - Original text (collapsible)
  - De-identified text (if PII found)
  - Detected category + confidence
  - Destination selector (dropdown)
  - PII toggle (show/hide redactions)
- "Route All" button + individual "Send" buttons

### Screen 3: Settings
- Add/remove routing destinations
- Configure default categories → destinations mapping
- De-identification preferences
- Model selection (E2B vs E4B)
- Export/import configuration

### Mobile-First
- Responsive layout optimized for phone screens
- Touch-friendly card interactions
- Add-to-homescreen (PWA manifest) for app-like experience

---

## Development Phases

### Phase 1: Foundation (Core MVP)
- [ ] Single HTML page with basic UI
- [ ] Load Gemma 4 E2B via `@huggingface/transformers` + WebGPU
- [ ] Basic transcript segmentation prompt
- [ ] Category classification (work/personal/health)
- [ ] Display classified segments as cards
- [ ] Clipboard routing (copy de-identified text)

### Phase 2: Smart Routing
- [ ] Plugin architecture for destinations
- [ ] Copilot 365, Gemini, Keep deep links
- [ ] De-identification pipeline with entity types
- [ ] User review UI with override controls
- [ ] localStorage config persistence

### Phase 3: Polish & Extend
- [ ] Voice input via Web Speech API
- [ ] Custom routing rules
- [ ] PWA manifest for mobile install
- [ ] Sample transcripts for demo/testing
- [ ] Performance optimization (batched inference)

### Phase 4: Submission Package
- [ ] Demo video (required by competition)
- [ ] Technical write-up
- [ ] Sample use cases with real-world scenarios
- [ ] Performance benchmarks (latency per segment)

---

## Known Challenges & Mitigations

| Challenge | Mitigation |
|-----------|------------|
| **First model load is ~500MB** | Cache via browser Cache API. Show progress bar. After first load, startup is fast. |
| **WebGPU not supported on all browsers** | Detect and show clear message. Chrome 113+ required. Safari/Firefox support growing. |
| **Classification accuracy** | Use structured JSON output prompting. Allow user overrides. Confidence thresholds. |
| **Timeout issues (user reported)** | Stream responses. Process segments one at a time with progress. Avoid large batch calls. |
| **De-identification completeness** | Defense in depth: Gemma identifies PII + regex patterns as backup. User reviews before routing. |
| **Mobile memory constraints** | E2B model (~500MB) fits in most modern phones. Provide clear minimum requirements. |

---

## Competition Submission Checklist

Per [Kaggle requirements](https://www.kaggle.com/competitions/gemma-4-good-hackathon):

- [ ] Working demo (this app, hosted on GitHub Pages)
- [ ] Public code repository (this repo)
- [ ] Technical write-up (README.md with architecture details)
- [ ] Short video demonstrating real-world use
- [ ] Uses Gemma 4 in a meaningful, technically credible way
- [ ] Addresses real-world challenge (health privacy / education data protection)
- [ ] Functions in low-bandwidth environments (fully offline after model download)

---

## Prior Art & References

- [Gemma Gem](https://github.com/kessler/gemma-gem) — Gemma 4 in-browser via WebGPU
- [HuggingFace Gemma 4 WebGPU](https://huggingface.co/spaces/webml-community/Gemma-4-WebGPU) — Browser inference demo
- [Google Gemma 4 Blog](https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/) — Model capabilities
- [Gemma 4 Edge Deployment](https://developers.googleblog.com/bring-state-of-the-art-agentic-skills-to-the-edge-with-gemma-4/) — On-device architecture
- [@huggingface/transformers](https://huggingface.co/docs/transformers.js) — WebGPU inference runtime
