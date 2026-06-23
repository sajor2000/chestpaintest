# Rush Chest Pain CDS Pathway Build Audit

Audit date: 2026-05-08

Repository: `https://github.com/sajor2000/chestpaintest`

## Scope

This audit covers the current Next.js chest pain clinical decision support app, with emphasis on how the Rush hs-TnI pathway is implemented, tested, and prepared for Vercel deployment.

## Architecture Summary

- The browser UI in `src/app/page.tsx` guides the clinician through the pathway, renders deterministic controller outputs, and uses server-owned quick-reply buttons so stale button sets do not persist across pathway questions.
- The chat route in `src/app/api/chat/route.ts` validates request size before JSON parsing, sanitizes browser-supplied messages, resolves the deterministic pathway controller, and streams a persistent `data-pathway-state` part before model guidance text.
- `src/lib/chat-request.ts` strips non-user messages and keeps only user-owned text plus valid image data URLs, reducing the risk of forged assistant/tool history from the browser.
- `src/lib/tools.ts` owns clinical calculations for EKG routing, troponin thresholds, delta logic, HEART score, disposition, and follow-up suggestions.
- `src/lib/pathway-controller.ts` recomputes canonical state from sanitized messages on every request, runs deterministic clinical tools server-side, chooses the current required field, and emits canonical quick replies/results.
- `src/lib/system-prompt.ts` instructs the model to ask only the controller-selected question and to explain, not compute, pathway logic.
- `src/lib/pathway-state.ts` adds an intermediate prompt-backed state guardrail that extracts accepted clinician fields, prefers later corrections, avoids unsafe HEART parsing shortcuts, and supplies the current required field to the model.
- `src/lib/pathway-ui.ts` uses controller-owned active steps and quick replies first, with assistant-text inference retained only as fallback for older messages.

## Verification Evidence

Local pre-deployment commands to run before every release:

```bash
npm run lint
npx vitest run
npm run build
npm audit --omit=dev
npm run audit:prod:browser
npm run audit:prod:md-stress
npm run audit:prod:hst-regressions
```

Current expected suite coverage is 285 Vitest tests:

- 87 deterministic pathway tests for Rush hs-TnI thresholds, explicit troponin source validation, deltas (including 3-lane routing, 20% switching rule, clinical delta flag, and math summary), HEART score (with labels), ESRD guard, explicit low clinical suspicion gating, dispositions, PENDING_4HR, PENDING_REPEAT (Footnote F), low-risk charting prompts, and end-to-end patient scenarios.
- 30 named original decision-tree tool cases plus 30 matching server-owned controller cases covering STEMI/EQV, ischemic EKG, sex-specific URL thresholds, early rule-out gates, ESRD exclusions, PPV >200, delta lanes, 4hr-pending logic, repeat-HST pending logic, low/intermediate/chronic injury/high-risk dispositions, and ongoing chest pain.
- 13 June 2026 Word-document regression cases covering all 12 physician-tested scenarios plus compound symptom-duration parsing. The source-to-test mapping is recorded in `docs/audits/hst-word-document-traceability.md`.
- 14 chat request sanitization tests, including symptom-duration normalization for alternate "how many hours" phrasing and repeat-EKG answer normalization.
- 38 pathway UI workflow tests, including controller-owned active step/buttons, stale-button suppression for HST and symptom timing prompts, fallback buttons when the model omits the button tool, terminal STEMI result button suppression, final disposition cards, duplicate quick-reply prompt cleanup, repeated question cleanup, physician-facing step guidance, and stale prompt text suppression after hidden buttons.
- 2 chat route tests covering request-size guarding and streaming canonical `data-pathway-state`.
- 9 deterministic pathway controller tests covering canonical required fields, correction precedence, terminal STEMI, early rule-out, pending 4hr routing, HEART sequencing, low-risk qualifiers, and HEART false-positive parsing guards.
- 2 assistant stream cleanup tests covering server-side removal of forbidden button filler, including filler split across streamed token chunks.
- 8 prompt-backed pathway state tests covering accepted-field extraction, latest correction precedence, normalized ESRD false parsing, and HEART false-positive parsing guards.
- 8 system prompt safety-framing tests that require protocol-only wording, early rule-out flow, explicit troponin value gating, typed yes/no progression, typed HST source handling, explicit suspicion gating, final-disposition stop behavior, and clean quick-reply wording.
- Clinician-audit helper tests covering report-first judge results, strict-mode failures, browser-blocked classification, controller-owned quick replies, and stale quick-reply detection.
- MD stress helper tests covering production API failure aggregation and deterministic state summaries.
- Production audit harness contract tests covering repeatable live production commands and safe generated-artifact defaults.

After any commit is pushed, confirm both remote checks:

- GitHub Actions: `CI / test (3.11)`
- Vercel preview status for the pushed commit

## Findings

- Clinical calculations are deterministic and have direct test coverage.
- The app now has an explicit 2 MB `Content-Length` guard in `/api/chat` before JSON parsing. This should be kept in addition to any hosting-platform limits.
- Browser-supplied assistant/tool messages are discarded before AI SDK conversion, so forged client tool results are not trusted.
- `@ai-sdk/openai` has been removed as a direct dependency. It remains in the lockfile only because `@ai-sdk/azure` depends on it.
- Significant deltas now return a structured clinical flag, math summary, pathway logic summary, and recommendations for the UI.
- The June 2026 Word-document regression suite now covers all 12 physician-tested scenarios plus the general compound-duration parsing bug from `HST_Algorithm_Testing_Summary.docx`.
- Low-risk discharge results now return discharge recommendations and chest pain onset/symptom charting prompts.
- The system prompt and UI now state that the app surfaces the prespecified Rush hs-TnI protocol and does not make independent clinical decisions.
- The API now uses a stateless deterministic server-owned pathway controller that parses clinician-provided fields, prefers later corrections, streams canonical state/results/buttons, and binds the model to the server-selected required field.
- Prompt-backed state parsing remains available as a parser layer, but pathway control no longer depends on model phrasing or conversation text cleanup.
- Unsafe single-letter HEART aliases were removed from free-text parsing so `age 1` and `2-hour HST` cannot populate unrelated HEART components.
- Quick-reply UX was tightened so the prompt asks the model not to repeat button labels in prose, and HEART score card labels now wrap instead of truncating clinical labels.
- The UI now includes a guided-CDS panel that makes the original pathway easier to follow by showing the current node, needed clinician input, pathway rationale, and guardrail.
- Live production browser audit is available through `npm run audit:prod:browser`; it exercises STEMI, ESRD, one typed low-risk pathway flow, and the API `data-pathway-state` controller seam against the target URL, then writes screenshots to ignored `output/playwright/` artifacts.
- Live production MD stress audit is available through `npm run audit:prod:md-stress`; it replays 60 adversarial clinician API cases and six browser workflows against the target URL, aggregates all selected API failures before exiting, then writes screenshots and summaries to ignored `output/md-stress/` artifacts.
- Live production HST replay audit is available through `npm run audit:prod:hst-regressions`; it replays all 12 June 2026 Word-document scenarios plus the compound-duration parser case against the target URL and writes summaries to ignored `output/hst-regressions/` artifacts.
- The next major safety improvements are clinical owner sign-off, human-factors review, institutional access control, and durable authenticated persistence/audit trail before Epic or unsupervised clinical production use.

## Current Release Verification (2026-05-11)

- Branch: `main`
- Current production URL: `https://rush-chest-pain-cds.vercel.app/`
- Local verification expected before release:
  - `npx vitest run src/__tests__/pathway-decision-tree-30.test.ts`
  - `npx vitest run src/lib/pathway-state.test.ts src/lib/chat-route.test.ts src/lib/system-prompt.test.ts`
  - `npx vitest run`
  - `npm run lint`
  - `npm run build`
  - `npm run audit:prod:browser`
  - `npm run audit:prod:md-stress`
  - `npm run audit:prod:hst-regressions`
- Latest live production evidence from 2026-05-11: the MD stress API audit passed 60/60 adversarial cases, and the browser-only stress run passed 6/6 visible workflows with console health passing.

## PDF Fidelity Audit (2026-05-08)

A node-by-node audit was performed against `public/troponin-pathway.png`. Seven deviations were found and corrected:

1. **Above URL + no significant delta → was INTERMEDIATE, PDF says CHRONIC_INJURY.** Fixed.
2. **Delta 4–14 intermediate range not enforced.** Added `delta_category` (minimal/intermediate/significant) to `calculateDelta` and `PENDING_4HR` guard to `determineDisposition`.
3. **Footnote F (Sx <4hr) not enforced in tools.** Added `PENDING_REPEAT` guard.
4. **Footnote F never emitted.** Now emitted by `PENDING_REPEAT` path.
5. **Low Risk criteria: HEART <4 treated as mandatory, PDF treats it as one of three OR criteria.** Fixed to match PDF: `(recent_normal_testing || chronic_unchanged_hst || heart_score < 4)`.
6. **Below-URL chronic HST routed to CHRONIC_INJURY; PDF only reaches Chronic Injury via ≥URL path.** Fixed: below-URL chronic HST now qualifies for Low Risk per PDF.
7. **`significant_delta` was a separate LLM input, creating an inconsistency vector.** Removed from schema; now derived internally from `delta_range`.

### LLM Anti-Bypass Hardening

Sixteen system prompt safety rules now keep the LLM in a guide-only role:
- Rules 1-6: No model-side computing, no fabricating values, no skipping steps.
- Rule 7: PENDING results must follow the controller-required field.
- Rule 8: controller-owned `delta_range` is authoritative.
- Rule 9: early rule-out can only be described when the controller reports it.
- Rule 10: Results must be framed as prespecified protocol output.
- Rule 11: Early rule-out must be resolved by the controller before HEART scoring.
- Rule 12: Non-troponin answers cannot be treated as HST values.
- Rule 13: Clinical suspicion must not be inferred from symptoms or documentation text.
- Rule 14: Plain typed yes/no answers must advance the current ESRD or ongoing chest-pain question.
- Rule 15: A typed HST/hs-TnI/troponin value can serve as its own source text.
- Rule 16: Final non-PENDING dispositions stop the flow without additional follow-up buttons.

All 7 PDF footnotes (A-G) are emitted by at least one tool.

### HEART Score UI & Elicitation (2026-05-08)

- `calculateHeartScore` now returns human-readable `labels` for each component (e.g., "Moderately suspicious", "1–2 risk factors").
- `HeartScoreCard` component in `page.tsx` renders a visual 5-row breakdown with score indicators (0/1/2 circles), labels, and risk-level color coding (emerald/amber/red).
- System prompt includes a detailed HEART Score Elicitation Guide with per-component scoring criteria and instructions for the LLM to help clinicians think through each component.
- The LLM may explain how the troponin component relates to prior HST values, but the clinician chooses the score and the controller calculates the total.
- Delta rule system prompt wording corrected: "20% rule replaces (not supplements) the absolute threshold at high values" — matches the switching implementation in `calculateDelta`.

### Final Audit (2026-05-08)

A node-by-node audit of all 10+ PDF decision nodes confirmed full fidelity. No clinical logic deviations remain. One low-severity system prompt wording discrepancy (delta rule "or" vs switching semantics) was found and corrected.

## Release Blockers

Do not call the app production-grade clinical CDS until these are cleared:

- Validate the implementation against the official Rush pathway source with a clinical owner.
- Complete the sign-off workflow in `docs/validation/PRODUCTION_READINESS_CHECKLIST.md`.
- Complete the ED/cardiology worksheet in `docs/validation/CLINICIAN_VALIDATION_PACK.md`.
- Add institutional access control before public, pilot, or Epic-embedded use.
- Add persistence and audit trail support before relying on the app for durable clinical documentation.
- Add durable authenticated persistence and audit trail around the stateless deterministic controller before high-stakes or Epic-embedded use.

## Deployment Notes

- Vercel should use the default Next.js settings.
- Configure `CDS_AZURE_KEY`, `CDS_AZURE_ENDPOINT`, `CDS_AZURE_DEPLOYMENT`, and `CDS_AZURE_API_VERSION` in the target Vercel environment.
- Do not commit `.env.local` or any real secrets.
- Re-run local verification and remote checks after every pushed commit.
