# HST Word Document Traceability Audit

Audit date: 2026-06-22

Source document: `HST_Algorithm_Testing_Summary.docx`

## Scope

This audit maps the June 2026 HST Algorithm Testing Summary Word document to deterministic code coverage and production-or-preview replay coverage. It covers the 12 physician-tested clinical scenarios plus the general compound symptom-duration parsing bug listed in the bug report.

This is a technical pathway-conformance audit for the prototype. It does not replace clinical owner sign-off or validation against the official Rush pathway source.

## Summary

- The six failed or partially passing Word-document issues are covered by direct local regression tests in `src/__tests__/hst-prototype-regression.test.ts`.
- The shared case definitions in `scripts/hst-word-document-cases.mjs` feed both local regression tests and the production replay, so the two audit surfaces use the same inputs and expected deterministic fields.
- The production replay in `scripts/audit-prod-hst-regressions.mjs` checks the full Word-document surface instead of only the six previous failures.
- Pass/fail decisions use deterministic `data-pathway-state` fields from the server-owned controller, not generated assistant prose.
- The relevant implementation owners are `src/lib/pathway-controller.ts`, `src/lib/tools.ts`, `src/lib/chat-request.ts`, and `src/lib/pathway-state.ts`.

## Case Matrix

| Source case | Original result | Original issue | Expected fixed behavior | Local coverage | Vercel replay coverage |
|---|---:|---|---|---|---|
| Case 1: STEMI, classic presentation | PASS | None | Terminal `STEMI_PATHWAY`; no hs-TnI continuation. | `src/__tests__/hst-prototype-regression.test.ts` case `Case 1` and `src/__tests__/pathway-decision-tree-30.test.ts` case 01. | `scripts/audit-prod-hst-regressions.mjs` case `Case 1`. |
| Case 1b: STEMI equivalent, de Winter pattern | PASS | None | Direct `de Winter pattern` wording terminates to `STEMI_PATHWAY` without requiring the generic words `STEMI equivalent`. | `src/__tests__/hst-prototype-regression.test.ts` case `Case 1b`. | `scripts/audit-prod-hst-regressions.mjs` case `Case 1b`. |
| Case 2: Low-risk chest pain, early rule-out | PASS | None | HST <5 ng/L, symptoms >3 hr, no ESRD, and explicit low suspicion route `LOW`. | `src/__tests__/hst-prototype-regression.test.ts` case `Case 2` and `src/__tests__/pathway-decision-tree-30.test.ts` case 06. | `scripts/audit-prod-hst-regressions.mjs` case `Case 2`. |
| Case 3: Rising troponin, significant 2-hour delta | FAIL | Significant 2-hour delta >=15 ng/L did not trigger High Risk when both values were below URL; 4-hour draw was incorrectly ordered. | Terminal `HIGH`; no `hst4` request. | `src/__tests__/hst-prototype-regression.test.ts` case `Case 3` and `src/__tests__/pathway-decision-tree-30.test.ts` case 16. | `scripts/audit-prod-hst-regressions.mjs` case `Case 3`. |
| Case 4: Falling troponin, recent MI | PARTIAL | Redundant ongoing chest pain prompt appeared even though disposition was already High Risk. | Falling significant delta routes `HIGH` without `ongoingChestPain`. | `src/__tests__/hst-prototype-regression.test.ts` case `Case 4` and `src/__tests__/pathway-decision-tree-30.test.ts` case 17. | `scripts/audit-prod-hst-regressions.mjs` case `Case 4`. |
| Case 5: 0-hour troponin >100, 20% delta rule | FAIL | High-value 20% delta rule was not applied; tool fell back to 4-hour pathway. | Relative delta >=20% routes `HIGH` at 2 hours. | `src/__tests__/hst-prototype-regression.test.ts` case `Case 5` and `src/__tests__/pathway-decision-tree-30.test.ts` case 19. | `scripts/audit-prod-hst-regressions.mjs` case `Case 5`. |
| Case 6: 4-hour draw required, 2-hour delta 4-14 | FAIL | Chronic Injury was offered after 4-hour follow-up branch. | Intermediate 2-hour delta enters 4-hour branch; post-4-hour non-high-risk branch does not return `CHRONIC_INJURY`. | `src/__tests__/hst-prototype-regression.test.ts` case `Case 6`, `src/lib/pathway-controller.test.ts` 4-hour prompt test, and `src/__tests__/pathway-decision-tree-30.test.ts` cases 14, 20, and 21. | `scripts/audit-prod-hst-regressions.mjs` case `Case 6`. |
| Case 7: Significant 4-hour delta, admit | PASS | None | Significant 4-hour delta routes `HIGH`. | `src/__tests__/hst-prototype-regression.test.ts` case `Case 7` and `src/__tests__/pathway-decision-tree-30.test.ts` 4-hour significant-delta coverage. | `scripts/audit-prod-hst-regressions.mjs` case `Case 7`. |
| Case 8: Stable chronic troponin elevation, CKD | PASS | None | Above-URL, non-significant serial troponins on the MI-ruled-out branch route `CHRONIC_INJURY`. | `src/__tests__/hst-prototype-regression.test.ts` case `Case 8` and `src/__tests__/pathway-decision-tree-30.test.ts` case 27. | `scripts/audit-prod-hst-regressions.mjs` case `Case 8`. |
| Case 9: ESRD mandatory 2-hour draw override | PASS | None | ESRD blocks 0-hour early rule-out and requires 2-hour HST. | `src/__tests__/hst-prototype-regression.test.ts` case `Case 9` and `src/__tests__/pathway-decision-tree-30.test.ts` cases 11 and 30. | `scripts/audit-prod-hst-regressions.mjs` case `Case 9`. |
| Case 10: Symptoms <4 hr, early presenter | PASS | None | Early presenter stays on repeat/serial HST before final disposition. | `src/__tests__/hst-prototype-regression.test.ts` case `Case 10` and `src/__tests__/pathway-decision-tree-30.test.ts` case 22. | `scripts/audit-prod-hst-regressions.mjs` case `Case 10`. |
| Case 11: Female-specific URL, rule-in at 16 ng/L | FAIL | Female 99% URL appeared not to be applied; 4-hour troponin was ordered instead of above-URL non-significant routing. | Female URL threshold is 14 ng/L; female HST 16 ng/L with no significant serial delta routes `CHRONIC_INJURY`. | `src/__tests__/hst-prototype-regression.test.ts` case `Case 11` and `src/__tests__/pathway-decision-tree-30.test.ts` case 05. | `scripts/audit-prod-hst-regressions.mjs` case `Case 11`. |
| General bug: `3 hours 15 minutes` | LOW | Free-text duration failed to parse or advance. | Bare duration reply after the active symptom-duration prompt parses as 3.25 hours and advances to the 0-hour HST prompt. | `src/__tests__/hst-prototype-regression.test.ts` case `General bug`, `src/lib/chat-request.test.ts`, and `src/lib/pathway-state.test.ts`. | `scripts/audit-prod-hst-regressions.mjs` case `General bug`. |

## Code Audit Mapping

| Bug | Implementation owner | Current protection |
|---|---|---|
| BUG-01: significant 2-hour delta not High Risk | `src/lib/pathway-controller.ts` consumes `calculate_delta` before 4-hour branching; `src/lib/tools.ts` owns delta significance. | Case 3 local and Vercel replay assert terminal `HIGH`, significant delta, and no `hst4`. |
| BUG-02: high-value 20% rule not applied | `src/lib/tools.ts` uses the 20% method when either compared HST value is >=100 ng/L; `src/lib/pathway-controller.ts` treats significant result as terminal High Risk. | Case 5 local and Vercel replay assert terminal `HIGH` and significant high-value delta. |
| BUG-03: Chronic Injury wrong branch | `src/lib/tools.ts` only returns Chronic Injury for above-URL values when `has_4hr_result` is false; `src/lib/pathway-controller.ts` passes branch provenance. | Case 6 asserts post-4-hour branch is not `CHRONIC_INJURY`; Case 8 and Case 11 assert valid Chronic Injury branch still works. |
| BUG-04: female URL | `src/lib/tools.ts` owns sex-specific URL thresholds. | Case 11 asserts female threshold 14 ng/L and terminal `CHRONIC_INJURY`. |
| BUG-05: redundant ongoing chest pain prompt | `src/lib/pathway-controller.ts` gates terminal high-risk deltas before asking ongoing pain. | Case 4 asserts terminal `HIGH` and no `ongoingChestPain` required field. |
| BUG-06: compound symptom duration | `src/lib/chat-request.ts` normalizes active-question answers; `src/lib/pathway-state.ts` extracts duration from bundled text. | General bug asserts 3.25 hours and advancement to `hst0`. |

## Commands

Run local deterministic coverage:

```bash
npx vitest run src/__tests__/hst-prototype-regression.test.ts
```

Run full local coverage:

```bash
npx vitest run
```

Run the live Vercel Word-document replay:

```bash
PROD_BASE_URL=https://rush-chest-pain-cds.vercel.app npm run audit:prod:hst-regressions
```

The Vercel replay writes `output/hst-regressions/hst-regression-summary.json`. The summary should show all Word-document cases passing, with expected and actual deterministic fields recorded per case.
