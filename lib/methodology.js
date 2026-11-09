// Single source for the methodology text shown on the page and written into the exported report.
export const METHOD = {
  aiConnected: false,
  rules: [
    'Rejection-code mapping: a code in the data is used as given, looked up in the rejection catalog.',
    'Fixable / non-fixable and recovery eligibility: read from the catalog (fixable = Yes means recoverable).',
    'Restricted category (R10): closure with a neutral message, no workaround, never in the outreach queue.',
    'Compliance (R12): routed to the Compliance team, generic "under review" wording only, never in the outreach queue.',
    'WhatsApp consent: a WhatsApp channel is offered only if the applicant opted in.',
    'Safety checks on every message and subject: no placeholders, no screening wording, no promises, right script for the language.',
    'Approval: nothing is sent automatically. A person approves every message; Compliance cases cannot be sent from the app.',
    'Reading a blank-code reviewer note: keyword rules (written after seeing the 49 coded notes, so not an independent test).',
    'Message drafting: fixed templates per language with controlled variables (step name, days to fix). No generated text at run time.',
    'Outreach priority: the points scheme below.',
  ],
  ai: [
    'Interpreting ambiguous reviewer messages: not connected. Unmatched notes go to a person.',
    'Classifying unstructured rejection comments beyond the keyword rules: not connected.',
    'Natural-language explanations: not connected.',
    'Drafting multilingual messages at run time: not connected. (The templates were drafted with Claude beforehand and are fixed text.)',
  ],
  confidence: [
    'High: the rejection code is in the data, or no rejection is recorded (the application simply stopped; no cause is claimed).',
    'Medium: the code was blank and a keyword rule read the reviewer text. Always confirmed by a person.',
    'Low: no rule matched (or a model suggested a code). No reason is claimed; a person decides.',
  ],
  priority: [
    'Only recoverable cases that are not R10, R12 or unresolved can enter the outreach queue.',
    'Score 0-8 = TPV (0-2: top / middle / bottom third of queued cases) + recency (0-2: up to 14 days / 15-30 / over 30) + fix clarity (2 for a specific fixable issue, 1 for an abandoned application) + stage reached (0-2: Business details 0, KYC docs 1, Bank verification or Website/App review 2).',
    'High = 6 or more, Medium = 4 or 5, Low = 3 or less. The thresholds and weights are the builder\'s judgment, not from the data pack. TPV alone never decides the tier.',
  ],
  tpv: 'Expected monthly TPV is the applicant\'s own estimate in the application. It is not realised volume and not Razorpay revenue.',
};
