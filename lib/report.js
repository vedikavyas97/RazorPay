import { buildMetrics, reviewQueue, noNudgeList } from './metrics.js';
import { METHOD } from './methodology.js';

// Every Section 1 field, plus the supporting fields behind it.
export const CSV_COLUMNS = [
  ['application_id', 'application_id'], ['business_type', 'business_type'], ['current_onboarding_stage', 'step_reached'],
  ['diagnosed_reason', 'diagnosed_cause'], ['reason_code', 'reason_code'], ['rejection_code_in_data', 'rejection_code_in_data'],
  ['code_source', 'code_source'], ['diagnosis_confidence', 'confidence'], ['fixable', 'fixable'], ['recoverable', 'recoverable'],
  ['compliance_escalation_or_closure', 'escalation'], ['recommended_corrective_action', 'recommended_action'],
  ['preferred_language', 'preferred_language'], ['recommended_channel', 'channel'], ['email_subject', 'email_subject'],
  ['draft_nudge', 'drafted_nudge'], ['outreach_priority', 'priority'], ['priority_rank', 'priority_rank'],
  ['priority_reasons', 'priority_reason'], ['expected_monthly_tpv_inr_lakh', 'expected_tpv_lakh'],
  ['days_since_last_activity', 'days_inactive'], ['safety_check', 'safety_check'], ['send_status', 'send_status'],
  ['human_review_reasons', 'hold_reasons'], ['needs_human_review', 'needs_human_review'],
];

export function toCsv(rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return '﻿' + [CSV_COLUMNS.map((c) => c[0]).join(','), ...rows.map((r) => CSV_COLUMNS.map((c) => esc(r[c[1]])).join(','))].join('\r\n');
}

export function buildReport(results, activated) {
  const m = buildMetrics(results, activated);
  const L = [];
  L.push('# Onboarding Recovery Agent: summary report', '', 'Synthetic data. Generated from the same results as the dashboard and the CSV.', '');
  L.push('## Dashboard', '',
    `- Total applications: ${m.total}`, `- Activated (not processed): ${m.activated}`, `- Non-activated (processed): ${m.nonActivated}`,
    `- Stalled: ${m.stalled}`, `- Rejected: ${m.rejected}`,
    `- Recoverable: ${m.recoverable}`, `- Non-recoverable: ${m.nonRecoverable}` + (m.unresolved ? `, unresolved (reason not identified): ${m.unresolved}` : ''),
    `- Needing human review (on hold): ${m.humanReview}`, `- Compliance escalations: ${m.compliance}`, `- Closures (restricted category): ${m.closure}`,
    `- Expected monthly TPV, all non-activated applications: Rs ${m.tpvAll} lakh`,
    `- Expected monthly TPV, recoverable applications: Rs ${m.tpvRecoverable} lakh`,
    '', `Note: ${METHOD.tpv}`, '');
  L.push('## Top three causes (by number of non-activated applications)', '');
  m.top.forEach((t, i) => {
    L.push(`${i + 1}. ${t.code}: ${t.cause}. ${t.count} merchants, ${t.pct}% of non-activated. Fixable: ${t.fixable}. Expected TPV Rs ${t.tpv} lakh.`,
      `   Standard fix (catalog): ${t.fix}`, `   Suggested improvement (builder's idea): ${t.suggestion}` + (t.tied.length ? ` Tied on count with ${t.tied.join(', ')}; ordered by TPV.` : ''));
  });
  L.push('', '## Cases needing human review', '');
  reviewQueue(results).forEach((r) => L.push(`- ${r.application_id} (${r.reason_code}, ${r.preferred_language}): ${r.reviews.map((x) => x.type + ' - ' + x.why).join(' | ')}`));
  L.push('', '## Applications that must not receive normal recovery nudges', '');
  noNudgeList(results).forEach((r) => L.push(`- ${r.application_id} (${r.reason_code}): ${r.priority_reason}`));
  L.push('', '## Methodology and decision rules', '', 'Rule-based (running now):', ...METHOD.rules.map((x) => `- ${x}`),
    '', 'AI-assisted (AI model connected: ' + (METHOD.aiConnected ? 'yes' : 'NO') + '):', ...METHOD.ai.map((x) => `- ${x}`),
    '', 'Diagnosis confidence:', ...METHOD.confidence.map((x) => `- ${x}`), '', 'Outreach priority:', ...METHOD.priority.map((x) => `- ${x}`), '');
  return L.join('\n');
}
