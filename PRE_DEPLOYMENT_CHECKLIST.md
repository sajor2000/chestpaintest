# Pre-Deployment Checklist

Use this checklist before any public demo, clinical pilot, or production deploy.

## Required Verification

- [ ] Install dependencies with `npm install`.
- [ ] Confirm `.env.local` or hosting secrets define:
  - `CDS_AZURE_KEY`
  - `CDS_AZURE_ENDPOINT`
  - `CDS_AZURE_DEPLOYMENT`
  - `CDS_AZURE_API_VERSION`
- [ ] Run `npm run lint` and resolve all errors.
- [ ] Run `npx vitest run` and confirm all tests pass.
- [ ] Run `npx vitest run src/__tests__/pathway-decision-tree-30.test.ts` and confirm all 30 original decision-tree cases pass.
- [ ] Run `npx vitest run src/__tests__/hst-prototype-regression.test.ts` and confirm the June 2026 physician prototype regressions pass.
- [ ] Run `npx vitest run src/lib/pathway-state.test.ts src/lib/chat-route.test.ts src/lib/system-prompt.test.ts` and confirm parser, route, and prompt guardrails pass.
- [ ] Run `npm run build` and confirm TypeScript and production build pass.
- [ ] Run `npm run audit:prod:browser` against the target Vercel URL and confirm the live STEMI, ESRD, and typed low-risk UI flows pass.
- [ ] Run `npm audit --omit=dev` and review any runtime dependency advisories.

## Clinical Safety Gate

- [ ] Confirm the Rush hs-TnI source pathway image in `public/troponin-pathway.png` matches the clinical source of truth.
- [ ] Confirm deterministic tool tests cover pathway thresholds, deltas, HEART score, ESRD guard, early rule-out, and dispositions.
- [ ] Confirm the 30-case decision-tree audit covers STEMI, ischemic EKG, early rule-out, ESRD, PPV >200, delta lanes, 4hr-pending logic, repeat-HST pending logic, low/intermediate/chronic injury/high-risk dispositions, and ongoing chest pain.
- [ ] Confirm the June 2026 prototype regression suite covers significant 2hr delta, high-value 20% delta, falling recent-MI delta, Chronic Injury branch eligibility, female URL routing, and compound symptom-duration parsing.
- [ ] Confirm prompt-backed pathway state tests cover latest clinician correction precedence and HEART false-positive parsing guards.
- [ ] Confirm `/api/chat` accepts only user-owned text and valid ECG image data from the browser.
- [ ] Confirm final disposition text includes the treating-physician judgment disclaimer.
- [ ] Confirm ECG image interpretation remains MD-confirmed before pathway tool calls.
- [ ] Manually run at least three Vercel preview flows: early rule-out low-risk, intermediate delta needing 4hr HST, and high-risk from ischemic EKG or significant delta.

## Deployment Environment Gate

- [ ] In Vercel, import `https://github.com/sajor2000/chestpaintest` with the default Next.js settings.
- [ ] Confirm the app is deployed behind the intended institutional access controls.
- [ ] Confirm Azure OpenAI deployment name and API version match the configured production resource.
- [ ] Confirm all four `CDS_AZURE_*` variables from `.env.example` are configured in Vercel for the target environment.
- [ ] Confirm no secrets are committed; `.env*` files must remain ignored.
- [ ] Confirm the `/api/chat` 2 MB `Content-Length` guard is active and that the deployment host also enforces appropriate request body limits.
- [ ] Confirm build output does not warn about an unintended workspace root. If it does, configure `turbopack.root` or remove the extra parent lockfile.

## Known Release Blockers To Clear

- [ ] Resolve any runtime dependency audit findings before production use.
- [ ] Complete SMART on FHIR authentication before Epic-embedded use.
- [ ] Add persistence and audit trail before relying on the app for durable clinical documentation.
- [ ] Replace prompt-backed pathway state guidance and inferred UI pathway state with a deterministic server-owned pathway session controller before high-stakes clinical use.
