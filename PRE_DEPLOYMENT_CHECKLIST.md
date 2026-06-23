# Pre-Deployment Checklist

Use this checklist before any public demo, clinical pilot, or production deploy.

For clinical release readiness, also complete:

- [docs/validation/PRODUCTION_READINESS_CHECKLIST.md](docs/validation/PRODUCTION_READINESS_CHECKLIST.md)
- [docs/validation/CLINICIAN_VALIDATION_PACK.md](docs/validation/CLINICIAN_VALIDATION_PACK.md)

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
- [ ] Run `npx vitest run src/__tests__/hst-prototype-regression.test.ts` and confirm all June 2026 Word-document regression cases pass.
- [ ] Run `npx vitest run src/lib/pathway-state.test.ts src/lib/chat-route.test.ts src/lib/system-prompt.test.ts` and confirm parser, route, and prompt guardrails pass.
- [ ] Run `npm run build` and confirm TypeScript and production build pass.
- [ ] Run `npm run audit:prod:browser` against the target Vercel URL and confirm the live STEMI, ESRD, and typed low-risk UI flows pass.
- [ ] Run `npm run audit:prod:md-stress` against the target Vercel URL and confirm the adversarial MD API and browser workflow cases pass.
- [ ] Run `npm run audit:prod:hst-regressions` against the target Vercel URL and confirm all 12 June 2026 Word-document scenarios plus the compound-duration parser case pass.
- [ ] Run `npm audit --omit=dev` and review any runtime dependency advisories.

## Clinical Safety Gate

- [ ] Confirm the Rush hs-TnI source pathway image in `public/troponin-pathway.png` matches the clinical source of truth.
- [ ] Confirm the protocol source version, effective date, and clinical owner are recorded for the release.
- [ ] Confirm deterministic tool tests cover pathway thresholds, deltas, HEART score, ESRD guard, early rule-out, and dispositions.
- [ ] Confirm the 30-case decision-tree audit covers STEMI, ischemic EKG, early rule-out, ESRD, PPV >200, delta lanes, 4hr-pending logic, repeat-HST pending logic, low/intermediate/chronic injury/high-risk dispositions, and ongoing chest pain.
- [ ] Confirm the June 2026 Word-document regression suite covers all 12 physician-tested scenarios plus compound symptom-duration parsing.
- [ ] Confirm the production HST replay audit passes those same Word-document scenarios against the deployed Vercel build.
- [ ] Confirm prompt-backed pathway state tests cover latest clinician correction precedence and HEART false-positive parsing guards.
- [ ] Confirm `/api/chat` accepts only user-owned text and valid ECG image data from the browser.
- [ ] Confirm final disposition text includes the treating-physician judgment disclaimer.
- [ ] Confirm ECG image interpretation remains MD-confirmed before pathway tool calls.
- [ ] Manually run at least five Vercel preview flows: STEMI terminal, early rule-out low-risk, minimal delta to HEART, intermediate delta needing 4hr HST, and high-risk from ischemic EKG or significant delta.
- [ ] Complete clinician sign-off using `docs/validation/CLINICIAN_VALIDATION_PACK.md` before monitored pilot use.

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
- [ ] Complete clinical owner, human-factors, compliance/legal, operations, and monitoring sign-off before calling the tool production-grade clinical CDS.
