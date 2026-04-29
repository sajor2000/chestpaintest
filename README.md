# Rush Chest Pain CDS

Clinical decision support chatbot for the Rush University System for Health **High-Sensitivity Troponin I (hs-TnI) Algorithm**. Guides ER physicians through the chest pain pathway conversationally, with all clinical decisions enforced by deterministic tool functions.

## How It Works

The chatbot walks the physician through the pathway step by step:

1. **EKG Assessment** — STEMI/equivalent detection, ischemic ST/T changes
2. **Troponin Evaluation** — sex-specific 99% URL thresholds (M: 35 ng/L, F: 14 ng/L)
3. **Early MI Rule-Out** — HST <5 ng/L + Sx >3hr + low suspicion (NPV 99.5%)
4. **Delta Calculation** — absolute (>=15 ng/L) or percentage (>=20% when HST >=100)
5. **HEART Score** — 5-component scoring with risk stratification
6. **Disposition** — Low (discharge) / Intermediate (observation) / Chronic Injury / High (admit)

**The LLM never computes clinical values.** All thresholds, deltas, risk levels, and dispositions run through deterministic tool functions with 61 pathway tests verified against the source PDF.

## Features

- **Quick-reply buttons** for binary/choice questions (STEMI yes/no, sex, ESRD, etc.)
- **ECG image upload** with optional AI-assisted second opinion (MD interpretation is always authoritative)
- **Pathway diagram** toggleable in the header for reference during assessment
- **Risk cards** color-coded by disposition (green/yellow/orange/red)
- **SMART on FHIR scaffold** for future Epic Hyperspace embedding
- **Rush branding** matching rush.edu colors and design

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 16, App Router |
| AI SDK | Vercel AI SDK v6 (`@ai-sdk/azure`, `@ai-sdk/react`) |
| LLM | Azure OpenAI GPT-4.1-mini (Chat Completions API) |
| Styling | Tailwind CSS v4 |
| Testing | Vitest (61 pathway tests) |
| FHIR | `fhirclient` (scaffold for Phase 2 Epic integration) |

## Setup

```bash
npm install
```

Create `.env.local`:

```env
CDS_AZURE_KEY=your-azure-api-key
CDS_AZURE_ENDPOINT=https://your-resource.cognitiveservices.azure.com/openai/deployments
CDS_AZURE_DEPLOYMENT=gpt-4.1-mini
CDS_AZURE_API_VERSION=2025-01-01-preview
```

```bash
npm run dev
```

Open http://localhost:3000 and type "start" to begin the pathway.

## Tests

```bash
npx vitest run
```

61 tests verify every decision node from the Rush hs-TnI pathway PDF:
- STEMI/EQV diamond routing
- 99% URL thresholds (boundary values)
- Early MI rule-out (all 6 gate conditions)
- ESRD guard (Footnote C)
- PPV >200 flag (Footnote D)
- Delta significance (absolute + 20% rule + zero baseline)
- HEART score boundaries
- All 4 disposition terminal nodes
- 8 end-to-end patient scenarios

## Project Structure

```
src/
  app/
    api/chat/route.ts    # Streaming endpoint, input validation, tool registration
    page.tsx             # Chat UI, risk cards, quick-reply buttons, ECG upload
    launch/page.tsx      # SMART on FHIR scaffold (Phase 2)
  lib/
    tools.ts             # 6 deterministic tools (assess_ekg, evaluate_troponin,
                         #   calculate_delta, calculate_heart_score,
                         #   determine_disposition, suggest_followups)
    constants.ts         # Clinical thresholds, footnotes A-G, dispositions
    system-prompt.ts     # Pathway conversation guide + safety rules
    azure.ts             # Azure OpenAI provider config
  __tests__/
    pathway.test.ts      # 61 tests against PDF source of truth
```

## Safety

- 6 critical safety rules in the system prompt prevent the LLM from fabricating clinical decisions
- All clinical logic runs in deterministic, tested tool functions
- ESRD guard blocks early rule-out at both troponin evaluation and disposition levels
- Input validation: message role filtering, body size limits, MIME allowlist for images
- ECG image interpretation requires explicit physician confirmation before entering the pathway

## Roadmap

- **Phase 2**: SMART on FHIR Epic integration — auto-pull patient demographics, troponin labs, EKG results from the chart
- **Auth**: Session-based authentication via SMART on FHIR OAuth when embedded in Epic
- **Persistence**: Conversation history and audit trail for clinical documentation
