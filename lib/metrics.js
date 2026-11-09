// Dashboard numbers. The page and the exported report both call buildMetrics, so they always match.
// Product/process suggestions below are the builder's ideas, not part of the data pack.
export const IMPROVEMENTS = {
  R13: 'No reason is recorded for these merchants. Record the step and reason when someone leaves, and send a resume reminder for the step they stopped at.',
  R01: 'Warn the merchant on the spot when the PAN name does not match the business name, before they submit.',
  R02: 'Check the GST certificate against the GSTIN as it is entered and show the mismatch straight away.',
  R03: 'Warn the merchant when the bank account holder name differs from the business name, before submission.',
  R04: 'Show which bank detail failed verification and let the merchant correct it in the same screen.',
  R05: 'Check image quality at upload (blur, cropping) and ask for a retake immediately.',
  R06: 'List the required website policy pages at the start of the website step, with a checklist.',
  R07: 'Tell the merchant the website must be live and open without login before review starts.',
  R08: 'Show the address proof requirements at upload.',
  R09: 'Show the signatory ID requirements and a preview at upload.',
  R10: 'Not a product fix. Handled by policy: close politely.',
  R11: 'Show the merchant the category they chose next to what the website shows, and ask them to confirm.',
  R12: 'Not a product fix. Handled by the Compliance team.',
};

const sum = (a) => a.reduce((s, x) => s + (Number(x) || 0), 0);
const r1 = (n) => Math.round(n * 10) / 10;

export function buildMetrics(results, activated) {
  const n = results.length;
  const rec = results.filter((r) => r.recoverable === 'Yes');
  const non = results.filter((r) => r.recoverable === 'No');
  const unk = results.filter((r) => r.recoverable !== 'Yes' && r.recoverable !== 'No');
  const byCode = {};
  results.forEach((r) => {
    const o = byCode[r.reason_code] || (byCode[r.reason_code] = { code: r.reason_code, cause: r.cause_label, count: 0, tpv: 0, fixable: r.fixable, fix: r.standard_fix });
    o.count++; o.tpv += Number(r.expected_tpv_lakh) || 0;
  });
  const ranked = Object.values(byCode)
    .filter((o) => o.code !== 'UNKNOWN')
    .sort((a, b) => b.count - a.count || b.tpv - a.tpv || (a.code < b.code ? -1 : 1));
  const top = ranked.slice(0, 3).map((o) => ({
    ...o, tpv: r1(o.tpv), pct: n ? r1((100 * o.count) / n) : 0, suggestion: IMPROVEMENTS[o.code] || '',
    tied: ranked.filter((x) => x.code !== o.code && x.count === o.count).map((x) => x.code),
  }));
  const tiers = ['High', 'Medium', 'Low', 'Not in outreach queue'];
  return {
    total: activated + n, activated, nonActivated: n,
    stalled: results.filter((r) => r.application_status === 'Stalled').length,
    rejected: results.filter((r) => r.application_status === 'Rejected').length,
    recoverable: rec.length, nonRecoverable: non.length, unresolved: unk.length,
    humanReview: results.filter((r) => r.send_status === 'HOLD').length,
    compliance: results.filter((r) => r.escalation === 'Compliance escalation').length,
    closure: results.filter((r) => r.escalation === 'Closure').length,
    safetyPass: results.filter((r) => r.safety_check === 'PASS').length,
    tpvAll: r1(sum(results.map((r) => r.expected_tpv_lakh))),
    tpvRecoverable: r1(sum(rec.map((r) => r.expected_tpv_lakh))),
    tpvNotRecoverable: r1(sum(results.filter((r) => r.recoverable !== 'Yes').map((r) => r.expected_tpv_lakh))),
    top, priority: Object.fromEntries(tiers.map((t) => [t, results.filter((r) => r.priority === t).length])),
  };
}

export function reviewQueue(results) {
  return results.filter((r) => r.send_status === 'HOLD');
}
export function noNudgeList(results) {
  return results.filter((r) => r.priority === 'Not in outreach queue');
}
