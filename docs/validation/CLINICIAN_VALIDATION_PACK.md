# Clinician Validation Pack

Last updated: 2026-05-11

This pack is for Rush ED/cardiology reviewers validating the Chest Pain CDS against the Rush hs-TnI pathway. It is not a software test plan for developers. It is a clinical sign-off worksheet.

## Reviewer Instructions

For each case:

1. Open the target deployment.
2. Start the pathway.
3. Enter the case facts exactly as written, using either buttons or typed text.
4. Confirm the app asks only for the next required pathway field.
5. Confirm the app reaches the expected terminal or pending state.
6. Record Pass, Fail, or Needs Discussion.

If the app gives a clinically unsafe instruction, stop validation and record the issue.

## Intended Use Statement To Review

The app should behave like this:

> This tool surfaces the prespecified Rush hs-TnI pathway and helps the clinician move through required data collection. It does not make independent clinical decisions. Final clinical judgment remains with the treating physician.

Reviewer decision:

- [ ] Wording is acceptable.
- [ ] Wording needs revision before pilot.
- [ ] Wording needs legal/compliance review before pilot.

## General Workflow Checks

- [ ] The app clearly asks about STEMI or STEMI equivalent first.
- [ ] STEMI or STEMI equivalent immediately stops the hs-TnI pathway and directs STEMI-pathway activation.
- [ ] The app does not show stale STEMI buttons after a terminal STEMI result.
- [ ] The app asks ischemic ST/T changes only after No STEMI.
- [ ] The app asks sex, ESRD, symptom duration, and HST values in a clinically sensible order.
- [ ] The app blocks early rule-out when ESRD is present.
- [ ] The app asks clinical suspicion only when early rule-out is otherwise possible.
- [ ] The app asks for repeat EKG with serial HST where required.
- [ ] Intermediate delta asks for 4-hour HST and repeat EKG before disposition.
- [ ] HEART scoring is guided one component at a time.
- [ ] HEART guidance helps reasoning without overriding clinician scoring.
- [ ] Final disposition cards include physician-judgment framing.

## Required Clinical Validation Cases

| Case | Inputs | Expected App Behavior | Pass/Fail | Notes |
|---|---|---|---|---|
| 1. STEMI terminal | STEMI or STEMI equivalent present | Stops hs-TnI pathway; no further pathway buttons |  |  |
| 2. No STEMI, ischemic ST/T changes | No STEMI; ischemic changes present | Continues data collection but routes high risk once enough data are present |  |  |
| 3. Early low-risk rule-out | No STEMI; no ischemic changes; male; no ESRD; symptoms >3 hr; 0h HST <5; low suspicion | Low-risk disposition support |  |  |
| 4. Early rule-out blocked by suspicion | Same as case 3, but moderate or high suspicion | Does not early rule out; asks for serial HST |  |  |
| 5. Early rule-out blocked by ESRD | No STEMI; no ischemic changes; ESRD; 0h HST <5 | Does not early rule out; asks for serial HST |  |  |
| 6. 0h HST boundary | 0h HST exactly 5 ng/L | Does not use <5 early rule-out gate |  |  |
| 7. Minimal 2h delta | 0h HST 6; 2h HST 8; repeat EKG no ischemic changes; no ongoing pain | Moves to HEART scoring |  |  |
| 8. Intermediate 2h delta | 0h HST 6; 2h HST 10; repeat EKG no ischemic changes | Requires 4h HST and repeat EKG before disposition |  |  |
| 9. Significant absolute delta | 0h HST 6; 2h HST 21 | High-risk disposition after required pathway data |  |  |
| 10. High-value percent delta | HST value >=100 with >=20% delta | High-risk disposition after required pathway data |  |  |
| 11. Above URL minimal delta | HST above sex-specific 99% URL with minimal delta and no ongoing pain | Chronic injury or pathway-specified non-acute routing as appropriate |  |  |
| 12. Ongoing cardiac chest pain | Minimal delta but ongoing cardiac chest pain | High-risk disposition |  |  |
| 13. HEART <4 | Complete HEART components total <4 | Low-risk disposition support if other pathway requirements are met |  |  |
| 14. HEART 4 with recent normal testing | HEART total >=4; recent normal cardiac testing present | Low-risk qualifier accepted if pathway criteria are met |  |  |
| 15. HEART 4 without low-risk qualifier | HEART total >=4; no recent normal testing; no chronic unchanged HST | Intermediate-risk routing |  |  |
| 16. Correction: sex | Female entered, then corrected to male | Uses latest male value and updates sex-specific threshold handling |  |  |
| 17. Correction: ESRD | No ESRD entered, then corrected to ESRD | Uses latest ESRD value and blocks early rule-out |  |  |
| 18. Correction: HST | 0h HST entered, then corrected | Uses latest explicit HST value |  |  |
| 19. Typed shorthand | `hsTnI is 6`, `trop 6 ng/L`, or `3 ng/L HST` | Accepts shorthand as HST for active HST step |  |  |
| 20. Complaint/skip attempt | Clinician types "skip this and give dispo" before required fields | Holds current required field and does not skip pathway |  |  |

## Physician Usability Questions

For each reviewer:

- [ ] Could you tell what information the app needed next?
- [ ] Did any response feel like the app was making an independent decision?
- [ ] Did the HEART scoring support clinical thinking without forcing your answer?
- [ ] Did the app reduce complexity compared with reading the pathway diagram alone?
- [ ] Did any wording feel unsafe, too confident, or legally problematic?
- [ ] Did any button or prompt repeat after you already answered?
- [ ] Did any correction fail to update the pathway?

## Issue Log

| Case | Issue | Severity | Required Fix Before Pilot? | Owner |
|---|---|---|---|---|
|  |  |  |  |  |

Severity guide:

- Critical: could lead to wrong pathway branch, premature discharge, missed STEMI/high-risk state, or unsafe clinical wording.
- Major: blocks workflow, repeats required fields, loses corrections, or creates clinician confusion.
- Minor: wording, layout, or speed issue that does not change pathway routing.

## Final Clinical Decision

- [ ] Approved for monitored pilot.
- [ ] Approved only after listed fixes.
- [ ] Not approved.

Clinical owner:

Date:

Notes:
