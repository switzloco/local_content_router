# Local Content Router

**Your brain dump stays on your device. Only the right pieces leave — and only when you say so.**

Local Content Router is a privacy-first web app that uses [Gemma 4](https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/) running **entirely in your browser** to classify your morning notes, voice memos, and brain dumps — then routes each piece to the right app with sensitive information automatically stripped out.

No servers. No cloud AI. No data leaves your phone until you explicitly approve it.

---

## Why This Exists

Every morning, millions of people dump everything into one stream of consciousness: work tasks, personal reminders, health notes, financial details, things about their kids. Then they have two bad options:

1. **Manually copy-paste** each piece into the right app — tedious and nobody actually does it
2. **Send everything to a cloud AI** — which means your doctor visit details, your kid's school schedule, and your work strategy all sit on someone else's server

Local Content Router gives you a third option: **an AI that runs on your device, classifies everything locally, strips out sensitive details, and only sends the sanitized pieces where they need to go.**

### Who is this for?

| You | The Problem | How Router Helps |
|-----|------------|-----------------|
| **Anyone with a morning routine** | Brain dump mixes work, personal, health. Too lazy to sort it manually. | Classifies and routes automatically. Work → Copilot, personal → Gemini, health → stays on device. |
| **Doctors & healthcare workers** | Dictating rounds mixes patient data (HIPAA-protected) with admin tasks. One wrong paste and you have a compliance violation. | Patient names, MRNs, and medical IDs are **redacted before anything leaves the device**. Admin tasks route to work tools safely. |
| **Teachers** | Planning notes mix student names (FERPA-protected) with curriculum work and personal errands. | Student identifiers stripped. Curriculum notes go to school LMS, personal stuff goes to personal apps. |
| **Therapists & counselors** | Session notes mixed with scheduling and personal thoughts. Client information is privileged. | Client details never leave the device. Only de-identified scheduling tasks get routed out. |
| **Parents** | Voice memos mix kids' info, medical appointments, work tasks, grocery lists. | Each piece lands in the right app. Kids' info stays private. |
| **Field researchers** | Observations mixed with logistics and personal notes in remote areas with limited connectivity. | Works offline after first load. Research data routes to the database, logistics to team chat. |

---

## The Privacy Argument

### The problem with cloud AI assistants

When you paste your morning notes into ChatGPT, Gemini, or Copilot, you're sending **everything** to a remote server:

- Your doctor said your blood pressure is high → **now a health AI company has your medical data**
- Your kid's teacher is Mrs. Rodriguez at Jefferson Elementary → **now a tech company knows your child's school**
- Your mortgage payment on 1234 Oak St is due the 15th → **now a cloud service has your home address and financial schedule**
- Patient John Smith, MRN 44821, presented with chest pain → **congratulations, that's a HIPAA violation**

Most people don't think about this because the alternative (manually sorting notes) is too annoying. So they just send everything.

### How Local Content Router is different

```
┌─────────────────────────────────────────────────────┐
│                YOUR DEVICE                           │
│                                                      │
│  "Need to email Sarah the Q3 report.                │
│   Call Dr. Martinez about my follow-up.              │
│   Patient Smith MRN-4482 needs cardiology consult.   │
│   Pick up groceries — milk, bread, pasta sauce."     │
│                                                      │
│         ↓  Gemma 4 (runs HERE, on device)  ↓        │
│                                                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────────┐ │
│  │ WORK     │ │ PERSONAL │ │ HEALTH               │ │
│  │          │ │          │ │ 🔒 STAYS ON DEVICE   │ │
│  │ "Email   │ │ "Pick up │ │                      │ │
│  │  Sarah   │ │  grocer- │ │ "Patient [REDACTED]  │ │
│  │  the Q3  │ │  ies"    │ │  [ID] needs cardio   │ │
│  │  report" │ │          │ │  consult"            │ │
│  └────┬─────┘ └────┬─────┘ └──────────────────────┘ │
│       │             │         NEVER LEAVES            │
└───────┼─────────────┼────────────────────────────────┘
        ↓             ↓
   Copilot 365    Google Keep
   (de-identified) (de-identified)
```

**The AI never phones home.** Gemma 4 downloads once (~500 MB), caches in your browser, and runs entirely on your device's GPU via WebGPU. There is no server. There is no API call. There is no telemetry.

**PII is stripped before routing.** Names, dates, phone numbers, medical IDs, addresses, and account numbers are replaced with `[PERSON]`, `[DATE]`, `[PHONE]` etc. before any text leaves your device. You review every redaction before approving.

**You control what goes where.** Set rules like "health always stays on device" or "work goes to Copilot." Override any classification before sending. Nothing routes without your explicit tap.

**It works offline.** After the one-time model download, the entire app works without an internet connection. Process and classify transcripts on airplane mode. Route when you're back online.

---

## How to Use It

### Quick Start

1. **Open** [switzloco.github.io/local_content_router](https://switzloco.github.io/local_content_router) in Chrome
2. **Wait** for Gemma 4 to load (~500 MB first time, cached after that)
3. **Paste** your brain dump or tap 🎤 to speak
4. **Tap** "Route my notes →"
5. **Review** the classified cards — each segment is color-coded by category
6. **Send** individually or tap "Send All" to route everything

### On Android

1. Open the link in Chrome
2. Tap the browser menu → **"Add to Home Screen"**
3. Now it's an app — share text from any other app directly to Local Router

### Setting Up Your Rules

Go to **Settings** and configure:

- **Routing rules**: Which category goes to which app by default
  - Work → Copilot 365
  - Personal → Google Gemini
  - Health → Keep on Device (never leaves)
  - Finance → Keep on Device
- **De-identification**: Toggle which PII types get stripped
  - Person names, dates, phone numbers, emails, addresses, account numbers, medical IDs
- **Custom destinations**: Add your own URL-based routing targets

### Tips

- **Load a demo** to see how classification works before using your own text
- **Tap the 🔒 icon** on any card to toggle between redacted and original text
- **Override the destination** per-card using the dropdown if the AI got it wrong
- **Health and finance default to on-device storage** — they never leave unless you change it
- The model gets better with context — longer, more detailed notes classify more accurately than one-liners

---

## Privacy Guarantees

| Guarantee | How |
|-----------|-----|
| **No server** | Gemma 4 runs via WebGPU in your browser. Zero network calls for inference. |
| **No API keys** | Nothing to configure, nothing to leak. |
| **No telemetry** | The app makes no analytics calls. Check the network tab yourself. |
| **PII stripped by default** | Names, dates, phones, emails, addresses, accounts, medical IDs — all replaced with placeholders before any text leaves the device. |
| **User approval required** | Every routed segment requires your explicit tap. Nothing auto-sends. |
| **Offline capable** | After first model download, works without internet. |
| **Open source** | Every line of code is auditable in this repo. No hidden data collection. |
| **HIPAA-friendly design** | Patient data can be configured to never leave the device. De-identification runs locally. |
| **FERPA-friendly design** | Student names and identifiers stripped before routing to any cloud service. |

---

## Technical Details

- **Model**: [Gemma 4 E2B](https://huggingface.co/onnx-community/gemma-4-E2B-it-ONNX) (~500 MB, q4f16 quantized) or [Gemma 4 E4B](https://huggingface.co/onnx-community/gemma-4-E4B-it-ONNX) (~1.5 GB)
- **Runtime**: [@huggingface/transformers](https://huggingface.co/docs/transformers.js) with WebGPU backend
- **Fallback**: WASM backend for browsers without WebGPU
- **No build step**: Pure HTML/CSS/JS — open `index.html` and go
- **Browser**: Chrome 113+ recommended (WebGPU support)

### Local Development

```bash
# Clone and serve
git clone https://github.com/switzloco/local_content_router.git
cd local_content_router
python -m http.server 8080
# Open http://localhost:8080
```

### Deploy to Google Cloud Run

```bash
gcloud run deploy local-router --source . --allow-unauthenticated
```

### Architecture

```
Browser
├── Gemma 4 (WebGPU)          ← AI runs here, on your device
├── Pipeline
│   ├── Segment transcript     ← Split brain dump into topics
│   ├── Classify each segment  ← work / personal / health / finance / education
│   └── De-identify PII        ← Strip names, dates, phones, etc.
├── User Review UI             ← You approve every piece before it leaves
└── Route Plugins
    ├── Copilot 365            ← Opens with content pre-filled
    ├── Google Gemini           ← Share or copy-paste
    ├── Google Keep             ← Share or copy-paste
    ├── On-Device Storage       ← Never leaves (health, finance default)
    ├── Clipboard               ← Manual routing
    └── Custom URL              ← Your own endpoints
```

---

## For the Kaggle Competition

This project is a submission to the [Gemma 4 Good Hackathon](https://www.kaggle.com/competitions/gemma-4-good-hackathon) ($200K prize pool, deadline May 18, 2026).

**Category**: Health + Education (privacy-preserving AI for HIPAA/FERPA compliance)

**Why it matters**: The biggest barrier to AI adoption in healthcare and education isn't capability — it's trust. Doctors won't use AI note-takers if patient data goes to the cloud. Teachers won't use AI planners if student names get uploaded. Local Content Router proves that powerful AI classification and de-identification can happen entirely on-device, making AI safe for the people who need it most.

---

## License

Apache 2.0 — see [LICENSE](LICENSE)
