# Rush Chest Pain CDS Pathway Build Audit

Audit date: 2026-05-08

Repository: `https://github.com/sajor2000/chestpaintest`

## Scope

This audit covers the current Next.js chest pain clinical decision support app, with emphasis on how the Rush hs-TnI pathway is implemented, tested, and prepared for Vercel deployment.

## Architecture Summary

- The browser UI in `src/app/page.tsx` guides the clinician through the pathway, renders deterministic tool outputs, and normalizes quick-reply buttons so stale button sets do not persist across pathway questions.
- The chat route in `src/app/api/chat/route.ts` validates request size before JSON parsing, sanitizes browser-supplied messages, and registers the deterministic clinical tools used by the LLM.
- `src/lib/chat-request.ts` strips non-user messages and keeps only user-owned text plus valid image data URLs, reducing the risk of forged assistant/tool history from the browser.
- `src/lib/tools.ts` owns clinical calculations for EKG routing, troponin thresholds, delta logic, HEART score, disposition, and follow-up suggestions.
- `src/lib/system-prompt.ts` instructs the model to ask one pathway question at a time and to use tools for every clinical calculation.
- `src/lib/pathway-ui.ts` infers the visible pathway step from assistant text and fixes known quick-reply button mismatches.

## Verification Evidence

Local pre-deployment commands to run before every release:

```bash
npm run lint
npx vitest run
npm run build
npm audit --omit=dev
```

Current expected suite coverage is 86 Vitest tests:

- 78 deterministic pathway tests for Rush hs-TnI thresholds, deltas (including 3-lane routing, 20% switching rule), HEART score (with labels), ESRD guard, dispositions, PENDING_4HR, PENDING_REPEAT (Footnote F), and end-to-end patient scenarios.
- 2 chat request sanitization tests.
- 5 pathway UI workflow tests, including the ESRD question stale-button correction.
- 1 chat route request-size guard test.

After any commit is pushed, confirm both remote checks:

- GitHub Actions: `CI / test (3.11)`
- Vercel preview status for the pushed commit

## Findings

- Clinical calculations are deterministic and have direct test coverage.
- The app now has an explicit 2 MB `Content-Length` guard in `/api/chat` before JSON parsing. This should be kept in addition to any hosting-platform limits.
- Browser-supplied assistant/tool messages are discarded before AI SDK conversion, so forged client tool results are not trusted.
- `@ai-sdk/openai` has been removed as a direct dependency. It remains in the lockfile only because `@ai-sdk/azure` depends on it.
- The current workflow step is still inferred in the UI from assistant text. This is useful for presentation, but it is not a server-owned pathway state.
- The next major safety improvement is a deterministic pathway session controller that returns canonical `step`, `question`, `allowedOptions`, and tool-derived clinical results.

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

Nine system prompt safety rules now prevent the LLM from deviating:
- Rules 1-6: No computing without tools, no fabricating values, no skipping steps.
- Rule 7: PENDING results must be followed (collect data, re-call tool).
- Rule 8: `delta_range` must come from `calculate_delta` output verbatim.
- Rule 9: `early_rule_out` only true if `evaluate_troponin` said eligible.

All 7 PDF footnotes (A-G) are emitted by at least one tool.

### HEART Score UI & Elicitation (2026-05-08)

- `calculateHeartScore` now returns human-readable `labels` for each component (e.g., "Moderately suspicious", "1–2 risk factors").
- `HeartScoreCard` component in `page.tsx` renders a visual 5-row breakdown with score indicators (0/1/2 circles), labels, and risk-level color coding (emerald/amber/red).
- System prompt includes a detailed HEART Score Elicitation Guide with per-component scoring criteria, suggested button labels, and instructions for the LLM to help clinicians think through each component.
- The LLM suggests troponin scoring based on prior HST values but always asks the clinician to confirm.
- Delta rule system prompt wording corrected: "20% rule replaces (not supplements) the absolute threshold at high values" — matches the switching implementation in `calculateDelta`.

### Final Audit (2026-05-08)

A node-by-node audit of all 10+ PDF decision nodes confirmed full fidelity. No clinical logic deviations remain. One low-severity system prompt wording discrepancy (delta rule "or" vs switching semantics) was found and corrected.

## Release Blockers

Do not treat the app as ready for public clinical production use until these are cleared:

- Validate the implementation against the official Rush pathway source with a clinical owner.
- Add institutional access control before public or Epic-embedded use.
- Add persistence and audit trail support before relying on the app for durable clinical documentation.
- Replace inferred pathway workflow state with server-owned pathway state before high-stakes use.

## Deployment Notes

- Vercel should use the default Next.js settings.
- Configure `CDS_AZURE_KEY`, `CDS_AZURE_ENDPOINT`, `CDS_AZURE_DEPLOYMENT`, and `CDS_AZURE_API_VERSION` in the target Vercel environment.
- Do not commit `.env.local` or any real secrets.
- Re-run local verification and remote checks after every pushed commit.
