# Onboarding Recovery Agent

Razorpay Campus AI Build-a-thon, Problem 3 (merchant onboarding and KYC drop-off recovery). Synthetic data only.

For each stalled or rejected application the agent:

1. Diagnoses the cause. It uses the rejection code if there is one, reads the reviewer text with keyword rules if the code is blank, and treats a missing rejection as an abandoned application (R13).
2. Looks up fixable / recoverable in the rejection catalog. Restricted category (R10) is closed politely. A screening hit (R12) is routed to Compliance. Neither gets a workaround or a reason.
3. Picks the channel (WhatsApp only if the applicant opted in).
4. Drafts the nudge in the applicant's language from fixed templates (`data/agentData.json`).
5. Runs safety checks (no screening wording, no workarounds, no promises, right language script, WhatsApp opt-in) and marks each draft READY or HOLD.

Nothing is sent. Every draft needs a human.

## What is AI and what is not

- Rules, no AI: diagnosis, fixable / recoverable, closure and compliance handling, channel, safety checks, hold decisions.
- AI, optional: Gemini gives a second opinion on blank-code cases. The rules still decide. A disagreement puts the case on hold.
- The message templates were drafted with Claude and spot-checked by the builder.

## Run locally

```
npm install
cp .env.example .env.local     # add GEMINI_API_KEY if you want the Gemini cross-check
npm run dev
```

Open http://localhost:3000

## Deploy

1. Push this folder to a GitHub repository.
2. In Vercel: Add New > Project > import the repository. Framework: Next.js (detected automatically).
3. Before deploying, add Environment Variables: `GEMINI_API_KEY` (free key from Google AI Studio), optionally `GEMINI_MODEL` and `DEMO_CODE`.
4. Deploy. Without a key the app still works with rules only.

Never commit the key. `.env*.local` is already in `.gitignore`.

## Known limits

- `[resume link]` is a placeholder. The data has no real links or contact details.
- Tamil, Kannada and Marathi wording has not been read by a native speaker.
- 21 of 75 non-activated rows have `days_since_last_activity` larger than the days since signup. The field is used as given.
- The keyword rules were written after seeing the 49 coded messages, so matching all 49 is not an independent test.
- The Gemini call could not be tested end to end before submission. If it fails, the error is shown and the agent continues with rules only.
- Checked in a build and by calling the API routes. The page was not checked visually in a browser.
