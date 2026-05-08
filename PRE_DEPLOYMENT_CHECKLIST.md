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
- [ ] Run `npm run build` and confirm TypeScript and production build pass.
- [ ] Run `npm audit --omit=dev` and review any runtime dependency advisories.

## Clinical Safety Gate

- [ ] Confirm the Rush hs-TnI source pathway image in `public/troponin-pathway.png` matches the clinical source of truth.
- [ ] Confirm deterministic tool tests cover pathway thresholds, deltas, HEART score, ESRD guard, early rule-out, and dispositions.
- [ ] Confirm `/api/chat` accepts only user-owned text and valid ECG image data from the browser.
- [ ] Confirm final disposition text includes the treating-physician judgment disclaimer.
- [ ] Confirm ECG image interpretation remains MD-confirmed before pathway tool calls.

## Deployment Environment Gate

- [ ] In Vercel, import `https://github.com/sajor2000/chestpaintest` with the default Next.js settings.
- [ ] Confirm the app is deployed behind the intended institutional access controls.
- [ ] Confirm Azure OpenAI deployment name and API version match the configured production resource.
- [ ] Confirm all four `CDS_AZURE_*` variables from `.env.example` are configured in Vercel for the target environment.
- [ ] Confirm no secrets are committed; `.env*` files must remain ignored.
- [ ] Confirm request body limits are enforced by the deployment host or an explicit app-level guard.
- [ ] Confirm build output does not warn about an unintended workspace root. If it does, configure `turbopack.root` or remove the extra parent lockfile.

## Known Release Blockers To Clear

- [ ] Resolve any runtime dependency audit findings before production use.
- [ ] Complete SMART on FHIR authentication before Epic-embedded use.
- [ ] Add persistence and audit trail before relying on the app for durable clinical documentation.
