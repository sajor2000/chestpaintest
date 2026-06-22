# Production Readiness Checklist

Last updated: 2026-05-11

Use this checklist before saying the Rush Chest Pain CDS is production-grade clinical decision support. Passing automated tests is required, but it is not enough. The release also needs clinical, operational, compliance, and monitoring sign-off.

## Current Status

Status: **GO for monitored pilot or controlled preview only. Not yet approved for unsupervised production clinical use.**

Current evidence supports this statement:

> The app surfaces the prespecified Rush hs-TnI pathway with deterministic server-owned pathway control and live production stress-audit coverage. It remains a clinician-facing decision support aid; final clinical judgment stays with the treating physician.

Do not use stronger language such as "100% production-grade," "validated clinical software," or "autonomous decision-maker" until all sign-off sections below are complete.

## Automated Release Gate

- [ ] `npm install` completes from a clean checkout.
- [ ] `npx vitest run` passes.
- [ ] `npm run lint` passes.
- [ ] `npm run build` passes.
- [ ] `npm audit --omit=dev` has no unresolved runtime issue accepted as a release blocker.
- [ ] `npm run audit:prod:browser` passes against the target production or preview URL.
- [ ] `npm run audit:prod:md-stress` passes against the target production or preview URL.
- [ ] `npm run audit:prod:hst-regressions` passes against the target production or preview URL.
- [ ] Generated screenshots and summaries remain under ignored `output/` paths and are not committed.

## Clinical Protocol Gate

- [ ] A named Rush clinical owner confirms the source protocol version used by the app.
- [ ] The protocol source file, effective date, and owner are recorded in the release notes.
- [ ] ED/cardiology reviewers complete `docs/validation/CLINICIAN_VALIDATION_PACK.md`.
- [ ] Reviewers confirm STEMI and STEMI-equivalent routing stops the hs-TnI pathway.
- [ ] Reviewers confirm ischemic ST/T changes, ESRD, symptom duration, sex-specific URLs, HST values, repeat EKGs, HEART components, recent normal testing, chronic unchanged HST, and ongoing chest pain are asked in the expected order.
- [ ] Reviewers confirm every final disposition is framed as protocol support, not independent medical advice.
- [ ] Any protocol deviation is documented with clinical owner approval before release.

## Human Factors Gate

- [ ] At least three ED physicians complete a live walkthrough without developer coaching.
- [ ] Each physician validates that the app feels like an AI-guided CDS assistant, not a generic chatbot.
- [ ] Each physician confirms the current required field is clear at every step.
- [ ] Each physician confirms quick replies do not show stale or duplicate options.
- [ ] Each physician confirms HEART scoring guidance helps them think without forcing a score.
- [ ] Any repeated-question loop, confusing button set, or unsafe phrasing is fixed or explicitly accepted by the clinical owner.

## Safety And Compliance Gate

- [ ] Institutional access control is configured for the deployment environment.
- [ ] Legal/compliance reviews the disclaimer and intended-use boundary.
- [ ] The release states that the tool does not replace clinician judgment.
- [ ] ECG image support is reviewed for data-handling and PHI exposure.
- [ ] The production environment has approved Azure OpenAI configuration and data-handling settings.
- [ ] A downtime fallback is documented: use the official Rush pathway directly.
- [ ] A rollback owner and rollback procedure are documented.

## Operational Gate

- [ ] Production environment variables are configured only in Vercel or approved secret storage.
- [ ] No `.env.local` or secret values are committed.
- [ ] Vercel deployment status is green for the release commit.
- [ ] GitHub CI status is green for the release commit.
- [ ] The production URL is tested after deploy, not only the preview URL.
- [ ] A release owner records the deployed commit SHA and deployment URL.

## Monitoring Gate

- [ ] Production errors are monitored.
- [ ] Model/API latency is monitored.
- [ ] Failed `/api/chat` responses are monitored.
- [ ] Conversation failure classes are reviewed after pilot use: repeated required fields, stale buttons, malformed typed answers, terminal states with further buttons, and user complaints.
- [ ] A clinician-facing feedback path exists for workflow issues.
- [ ] A release owner reviews live-audit results after every deploy.

## Pilot Acceptance Criteria

The app may enter monitored pilot use only when:

- [ ] Automated release gate is complete.
- [ ] Clinical protocol gate is complete.
- [ ] Safety/compliance gate has no open blocker.
- [ ] A named clinical owner signs off on monitored pilot use.
- [ ] A named technical owner signs off on deploy/rollback readiness.

## Production Acceptance Criteria

The app may be described as production-grade clinical CDS only when:

- [ ] All pilot acceptance criteria are complete.
- [ ] Pilot feedback has been reviewed and blocking issues are resolved.
- [ ] Human factors gate is complete.
- [ ] Monitoring gate is complete.
- [ ] Durable access control, audit logging, and retention requirements are approved.
- [ ] Legal/compliance approves the exact intended-use language.
- [ ] ED/cardiology leadership signs off on the release.

## Sign-Off Table

| Role | Name | Decision | Date | Notes |
|---|---|---|---|---|
| Clinical owner |  |  |  |  |
| ED reviewer |  |  |  |  |
| Cardiology reviewer |  |  |  |  |
| Technical owner |  |  |  |  |
| Compliance/legal |  |  |  |  |
| Operations owner |  |  |  |  |
