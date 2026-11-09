// Where an LLM would plug in. NOTHING here calls a model: the app is rules-based today.
//
// Contract for a future provider (return it from getLlm):
//   interpretReviewerNote(text) -> { code: 'R01'..'R12', explanation?: string } | null
//
// Rules the core enforces no matter what a model says:
//  - It is only asked about reviewer notes that no keyword rule matched.
//  - Its answer is always Low confidence and always goes to the human review queue.
//  - It never decides rejection-code mapping, fixable/recoverable, R10 closure, R12 escalation,
//    WhatsApp consent, recovery eligibility or approval. Those stay in plain code (lib/agent.js).
//  - Its drafted text (if a drafting function is added later) must still pass checkMessage_ before it is shown.
export const LLM_CONNECTED = false;

export function getLlm() {
  return null; // no provider connected
}
