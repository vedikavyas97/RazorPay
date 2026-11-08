# Onboarding Recovery Agent

Razorpay Campus AI Build-a-thon, Problem 3 (merchant onboarding and KYC drop-off recovery). Synthetic data only.

For each stalled or rejected application the agent:

1. Diagnoses the cause. It uses the rejection code if there is one, reads the reviewer text with keyword rules if the code is blank, and treats a missing rejection as an abandoned application (R13).
2. Looks up fixable / recoverable in the rejection catalog. Restricted category (R10) is closed politely. A screening hit (R12) is routed to Compliance. Neither gets a workaround or a reason.
3. Picks the channel (WhatsApp only if the applicant opted in).
4. Drafts the nudge in the applicant's language from fixed templates (`data/agentData.json`).
5. Runs safety checks (no screening wording, no workarounds, no promises, right language script, WhatsApp opt-in) and marks each draft READY or HOLD.

Nothing is sent automatically. A person reads each draft, approves it and presses send. Cases for Compliance (R12) cannot be sent from the app.

## What is AI and what is not

- Rules, no AI: diagnosis, fixable / recoverable, closure and compliance handling, channel, safety checks, hold decisions.
- AI in the running app: none. Every decision comes from rules and templates you can read.
- The message templates were drafted with Claude and spot-checked by the builder.

## Run locally

```
npm install
npm run dev
```

Open http://localhost:3000

## Deploy

1. Push this folder to a GitHub repository.
2. In Vercel: Add New > Project > import the repository. Framework: Next.js (detected automatically).
3. Deploy. No environment variables or API keys are needed.

## Known limits

- `[resume link]` is a placeholder. The data has no real links or contact details.
- Tamil, Kannada and Marathi wording has not been read by a native speaker.
- 21 of 75 non-activated rows have `days_since_last_activity` larger than the days since signup. The field is used as given.
- The keyword rules were written after seeing the 49 coded messages, so matching all 49 is not an independent test.
- The send buttons open WhatsApp, the SMS app or the email app with the message filled in; a person picks the recipient and presses send. The data has no phone numbers or email addresses, so nothing is sent automatically.
- Checked in a build and by calling the API routes. The page was not checked visually in a browser.
