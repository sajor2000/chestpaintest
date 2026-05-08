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

Current expected suite coverage is 69 Vitest tests:

- 61 deterministic pathway tests for Rush hs-TnI thresholds, deltas, HEART score, ESRD guard, dispositions, and end-to-end patient scenarios.
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
