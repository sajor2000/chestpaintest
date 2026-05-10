# Rush Chest Pain CDS

Clinical decision support chatbot for the Rush University System for Health **High-Sensitivity Troponin I (hs-TnI) Algorithm**. Guides ER physicians through the chest pain pathway conversationally by surfacing the prespecified protocol with deterministic tool functions.

## How It Works

The chatbot walks the physician through the pathway step by step:

1. **EKG Assessment** — STEMI/equivalent detection, ischemic ST/T changes
2. **Troponin Evaluation** — sex-specific 99% URL thresholds (M: 35 ng/L, F: 14 ng/L)
3. **Early MI Rule-Out** — HST <5 ng/L + Sx >3hr + low suspicion (NPV 99.5%)
4. **Delta Calculation** — 3-lane routing: minimal (<4), intermediate (4–14, requires 4hr HST), significant (≥15 absolute or ≥20% when HST ≥100)
5. **HEART Score** — LLM-guided 5-component scoring with visual breakdown card
6. **Disposition** — Low (discharge) / Intermediate (observation) / Chronic Injury / High (admit) / Pending (4hr or repeat HST required)

**The LLM never computes clinical values.** All thresholds, deltas, risk levels, and dispositions run through deterministic tool functions with 127 tests, including 83 tests verified node-by-node against the source PDF.

## Features

- **Quick-reply buttons** for binary/choice questions (STEMI yes/no, sex, ESRD, etc.)
- **ECG image upload** with optional AI-assisted second opinion (MD interpretation is always authoritative)
- **HEART Score card** — visual 5-row breakdown with per-component scores, labels, and risk-level color coding; LLM walks clinician through each component with scoring criteria
- **Delta math card** — displays the HST subtraction, pathway rule, delta category, and a clear clinically significant delta flag when criteria are met
- **Low-risk discharge support** — surfaces discharge recommendations plus chest pain onset and symptom charting prompts
- **Pathway diagram** toggleable in the header for reference during assessment
- **Risk cards** color-coded by disposition (green/amber/orange/red)
- **PENDING dispositions** — intermediate delta (4–14) blocks disposition until 4hr HST obtained; symptoms <4hr require repeat HST (Footnote F)
- **SMART on FHIR scaffold** for future Epic Hyperspace embedding
- **Rush branding** matching rush.edu colors and design

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 16, App Router |
| AI SDK | Vercel AI SDK v6 (`@ai-sdk/azure`, `@ai-sdk/react`) |
| LLM | Azure OpenAI GPT-4.1-mini (Chat Completions API) |
| Styling | Tailwind CSS v4 |
| Testing | Vitest (127 tests; 83 deterministic pathway tests) |
| FHIR | SMART on FHIR scaffold; add `fhirclient` during Phase 2 Epic integration |

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

## Deploy to Vercel

Import the GitHub repository into Vercel and use the default Next.js settings:

- Framework preset: Next.js
- Install command: `npm install`
- Build command: `npm run build`
- Output directory: Next.js default

Add these environment variables in Vercel before building:

- `CDS_AZURE_KEY`
- `CDS_AZURE_ENDPOINT`
- `CDS_AZURE_DEPLOYMENT`
- `CDS_AZURE_API_VERSION`

Use `.env.example` as the template. Do not commit `.env.local`.

## Tests

```bash
npx vitest run
```

127 tests cover the pathway logic, request sanitization, route guard, system-prompt safety framing, and pathway UI workflow. The 83 deterministic pathway tests verify every decision node from the Rush hs-TnI pathway PDF:
- STEMI/EQV diamond routing
- 99% URL thresholds (boundary values)
- Early MI rule-out (all 6 gate conditions)
- Explicit low clinical suspicion gating for early rule-out
- ESRD guard (Footnote C)
- PPV >200 flag (Footnote D)
- Delta 3-lane routing: minimal (<4), intermediate (4–14), significant (≥15 / ≥20%)
- Significant delta clinical flag, math summary, and pathway recommendations
- 20% switching rule (replaces absolute threshold when either value ≥100)
- HEART score boundaries and labels
- PENDING_4HR (intermediate delta without 4hr result)
- PENDING_REPEAT (symptoms <4hr, Footnote F)
- Chronic Injury routing (above URL, no significant delta)
- Low Risk OR criteria (recent testing / chronic HST / HEART <4), discharge recommendations, and chest pain charting prompts
- All 7 PDF footnotes (A–G) emitted
- 8 end-to-end patient scenarios

## Pre-Deployment

Use [PRE_DEPLOYMENT_CHECKLIST.md](PRE_DEPLOYMENT_CHECKLIST.md) before any public demo, clinical pilot, or production deploy.

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
    pathway.test.ts      # 83 tests against PDF source of truth
    chat-route.test.ts   # /api/chat request-size guard
    system-prompt.test.ts # protocol-only safety framing and flow guards
    chat-request.test.ts # browser message sanitization
    pathway-ui.test.ts   # pathway step and quick-reply normalization
```

## Safety

- **16 critical safety rules** in the system prompt prevent the LLM from fabricating clinical decisions, skipping steps, bypassing PENDING results, repeating answered steps, or treating the app as an independent decision-maker
- The app is framed as surfacing a prespecified Rush hs-TnI protocol, not making independent clinical decisions
- All clinical logic runs in deterministic, tested tool functions — the LLM cannot compute thresholds, deltas, or dispositions
- `delta_range` must come verbatim from `calculate_delta` output (Rule 8); `early_rule_out` only from `evaluate_troponin` (Rule 9)
- PENDING dispositions force data collection before final risk stratification (Rule 7)
- ESRD guard blocks early rule-out at both troponin evaluation and disposition levels (double-lock)
- Input validation: message role filtering, a 2 MB `/api/chat` Content-Length guard, and MIME allowlist for images
- ECG image interpretation requires explicit physician confirmation before entering the pathway
- Node-by-node PDF fidelity audit with 7 deviations found and corrected (see `docs/audits/pathway-build-audit.md`)

## Roadmap

- **Phase 2**: SMART on FHIR Epic integration — auto-pull patient demographics, troponin labs, EKG results from the chart
- **Server-owned pathway state**: Replace text-inferred step tracking with a deterministic state machine
- **Auth**: Session-based authentication via SMART on FHIR OAuth when embedded in Epic
- **Persistence**: Conversation history and audit trail for clinical documentation
- **Clinical validation**: Physician walkthrough and sign-off against the official Rush pathway source
