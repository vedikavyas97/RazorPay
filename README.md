# Onboarding Recovery Agent

Razorpay Campus AI Build-a-thon, Problem 3 (merchant onboarding and KYC drop-off recovery). Synthetic data only.

An internal tool for Razorpay's onboarding team. For each of the 75 non-activated applications (the 25 activated ones are skipped) it:

1. **Diagnoses** the cause with a confidence level. A code in the data is used as given (High). A blank code with a reviewer note is read by keyword rules and marked inferred (Medium, always confirmed by a person). No code and no note is an abandoned application, R13, with no cause invented. A note no rule matches is UNKNOWN (Low): no reason is claimed, no message is drafted, a person decides.
2. **Looks up** fixable / recoverable and the standard fix in the rejection catalog. R10 (restricted category) is closed politely with no workaround. R12 (screening) goes to Compliance with generic wording only.
3. **Prioritises** recoverable cases High / Medium / Low from TPV, days inactive, fix clarity and stage reached (not TPV alone), with the reasons shown. R10, R12, unresolved and non-recoverable cases never enter the outreach queue.
4. **Drafts** the message and the email subject in the applicant's language from fixed templates. WhatsApp is offered only if the applicant opted in.
5. **Checks** every message and subject (no screening wording, no workarounds, no promises, right script, consent) and sets READY or HOLD.
6. **Human review.** A review queue lists every case a person must step in on, with the reason. The reviewer can approve, edit or reject a message. Edits are re-checked by the same safety rules. Approving never overrides the hard rules: Compliance cases cannot be sent from the app, and a message that fails a check cannot be approved.

Nothing is sent. The send buttons are a demo (the data has no phone numbers or email addresses).

The page also has a management dashboard (counts, TPV at stake vs recoverable TPV, top three causes), a form to add new applications for the session, a CSV of all 75 rows, and a summary report (top causes, review list, no-nudge list, methodology). The page, CSV and report use the same functions, so the numbers match.

## What is AI and what is not

- **No AI model is connected.** Everything runs as plain code: code mapping, fixable / recoverable, R10 and R12 handling, WhatsApp consent, eligibility, priority, safety checks, approval rules, reading blank-code notes (keyword rules) and drafting (fixed templates).
- The message templates were drafted with Claude beforehand and are fixed text.
- `lib/llm.js` is an empty, documented hook. A model could later interpret notes that no rule matched and add explanations or drafts, but its answers would always be Low confidence and go to a person, and could never override the rule-based decisions.

## Tests

```
npm test
```

Runs 32 specific cases and 19 full-dataset checks and writes `TEST_REPORT.md`. Expectations come from the data pack and the brief, not from the agent's own functions. Read the limits in that file before quoting the results.

## Run locally

```
npm install
npm run dev
```

Open http://localhost:3000

## Deploy

Push to GitHub and import the repository in Vercel (Next.js is detected). No environment variables or API keys are needed.

## Known limits

- `[resume link]` is a placeholder. The data has no real links or contact details.
- Tamil, Kannada and Marathi wording and subject lines have not been read by a native speaker. Those messages are held.
- 21 of 75 non-activated rows have `days_since_last_activity` larger than the days since signup. The field is used as given.
- The keyword rules were written after seeing the coded notes, so matching them is not an independent test. They take the first matching rule, so a note naming two problems is drafted for one.
- Priority weights and cut-offs are judgment calls, not from the data pack. TPV is the applicant's own estimate, not realised volume or revenue.
- Added applications and reviewer decisions live in the browser session only. There is no database.
- The Google Sheet / Apps Script version is a separate copy and was not updated.
