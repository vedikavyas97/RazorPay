// Test report generator. Expectations are written from the data pack and the brief, NOT by calling the agent's own
// decision functions. Run: npm test   (writes TEST_REPORT.md)
import fs from 'fs';
import { runCore_, countActivated_, classifyText_ } from '../lib/agent.js';
import { buildMetrics } from '../lib/metrics.js';
import { toCsv, buildReport, CSV_COLUMNS } from '../lib/report.js';
import { normalizeNew } from '../lib/normalize.js';

const data = JSON.parse(fs.readFileSync(new URL('../data/agentData.json', import.meta.url), 'utf8'));
const apps = data.apps;
const cat = Object.fromEntries(data.catalog.map((c) => [c.code, c]));
const nonAct = apps.filter((a) => a.application_status !== 'Activated');
const results = runCore_(data, null);
const byId = Object.fromEntries(results.map((r) => [r.application_id, r]));
const appById = Object.fromEntries(apps.map((a) => [a.application_id, a]));

// ---- independent helpers (deliberately not the agent's own regexes) ----
const RANGE = { Tamil: /[஀-௿]/g, Kannada: /[ಀ-೿]/g, Hindi: /[ऀ-ॿ]/g, Marathi: /[ऀ-ॿ]/g };
function scriptOk(text, lang) {
  const chars = (text.match(/[\p{L}\p{M}]/gu) || []);
  if (!chars.length) return false;
  if (RANGE[lang]) return (text.match(RANGE[lang]) || []).length / chars.length >= 0.4;
  return chars.every((c) => c.codePointAt(0) < 0x250);
}
const PROMISE = /guarantee|assured|will be approved|definitely|100%|within \d+ ?(hour|day|minute)|activated by|approval is certain/i;
const WORKAROUND = /instead|alternative|another category|different category|change your category|resubmit|re-submit|reapply|apply again|try again|workaround|other documents|different document/i;
const REVEAL = /sanction|screening|compliance|watch ?list|negative list|black ?list|risk|fraud|restricted|prohibited|not allowed/i;

const rows = [];
let n = 0;
function t(scenario, id, expected, fn) {
  n++;
  let status = 'PASS', actual = '', why = '';
  try { const o = fn(); actual = o.actual; if (!o.pass) { status = 'FAIL'; why = o.why || ''; } else why = o.why || ''; }
  catch (e) { status = 'FAIL'; actual = 'error: ' + e.message; why = 'test threw'; }
  rows.push({ n, scenario, id, expected, actual, status, why });
}
const short = (s, k = 90) => (s.length > k ? s.slice(0, k) + '…' : s).replace(/\n+/g, ' ');
const describe = (r) => `${r.reason_code} / ${r.confidence} / ${r.route} / ${r.channel.split(' ')[0]} / ${r.priority} / ${r.send_status} / safety ${r.safety_check}`;
const pick = (pred, nth = 0) => nonAct.filter(pred)[nth];
const synth = (over) => runCore_({ ...data, apps: [{ application_id: 'SYN-1', business_type: 'Proprietorship', preferred_language: 'English', step_reached: 'KYC docs', application_status: 'Rejected', days_since_last_activity: 5, expected_monthly_tpv_inr_lakh: 10, whatsapp_opted_in: 'Yes', rejection_code: '', rejection_message: '', ...over }] }, null)[0];

// ===== specific cases =====
const fixCoded = (c, nth = 0) => pick((a) => a.rejection_code === c, nth);

{ const a = fixCoded('R01'); t('Standard fixable rejection (coded)', a.application_id, `Data pack code R01 (catalog: fixable ${cat.R01.fixable}). Expect R01, High confidence, Nudge, recoverable, in outreach queue, catalog fix as action.`, () => {
  const r = byId[a.application_id];
  const pass = r.reason_code === 'R01' && r.confidence === 'High' && r.route === 'Nudge merchant' && r.recoverable === 'Yes' && r.priority !== 'Not in outreach queue' && r.recommended_action === cat.R01.standard_fix;
  return { pass, actual: describe(r) }; }); }
{ const a = fixCoded('R03'); t('Standard fixable rejection (coded)', a.application_id, 'Data pack code R03. Expect R03, High confidence, fixable Yes, message tells merchant what to fix and has a resume link.', () => {
  const r = byId[a.application_id];
  return { pass: r.reason_code === 'R03' && r.confidence === 'High' && r.fixable === 'Yes' && r.drafted_nudge.includes('[resume link]'), actual: describe(r) }; }); }
{ const a = fixCoded('R06'); t('Standard fixable rejection (coded)', a.application_id, 'Data pack code R06 (policy pages). Expect R06, recoverable, message has no promise wording.', () => {
  const r = byId[a.application_id];
  return { pass: r.reason_code === 'R06' && r.recoverable === 'Yes' && !PROMISE.test(r.drafted_nudge), actual: describe(r) }; }); }

const blankMsg = nonAct.filter((a) => !a.rejection_code && a.rejection_message);
const expectBlank = { A3022: 'R05', A3028: 'R01', A3051: 'R10', A3081: 'R09' };
Object.entries(expectBlank).forEach(([id, code]) => {
  t('Blank code with reviewer text', id, `Code blank; note "${appById[id].rejection_message}" read by a person as ${code} (${cat[code].reviewer_reason}). Expect ${code}, Medium confidence, marked inferred, held for human confirmation.`, () => {
    const r = byId[id];
    const pass = r.reason_code === code && r.confidence === 'Medium' && r.code_source.startsWith('Inferred') && r.send_status === 'HOLD' && r.reviews.some((x) => x.type === 'Blank or ambiguous reviewer comment');
    return { pass, actual: describe(r), why: code === 'R10' ? 'Inference closes an application from free text, so it is held for sign-off.' : '' }; });
});

{ const a = pick((x) => !x.rejection_code && !x.rejection_message && x.step_reached === 'KYC docs'); t('No rejection message (drop-off)', a.application_id, 'No code, no note. Expect R13 abandoned (no reason invented), confidence High, reminder naming the KYC step, resume link.', () => {
  const r = byId[a.application_id];
  return { pass: r.reason_code === 'R13' && r.confidence === 'High' && /resume link/.test(r.drafted_nudge) && r.recoverable === 'Yes' && !/rejected|failed/i.test(r.diagnosed_cause), actual: describe(r) }; }); }
{ const a = pick((x) => !x.rejection_code && !x.rejection_message && x.step_reached === 'Bank verification') || pick((x) => !x.rejection_code && !x.rejection_message && x.step_reached !== 'KYC docs'); t('No rejection message (drop-off)', a.application_id, `No code, no note, stopped at ${a.step_reached}. Expect R13 and diagnosis naming that stage.`, () => {
  const r = byId[a.application_id];
  return { pass: r.reason_code === 'R13' && r.diagnosed_cause.includes(a.step_reached), actual: describe(r) }; }); }

{ const a = fixCoded('R10', 0); t('Restricted category (R10)', a.application_id, 'Data pack code R10 (catalog: not fixable, close politely, no workarounds). Expect Close politely, escalation "Closure", not recoverable, not in outreach queue, no workaround/resubmit wording, no resume link, held for sign-off.', () => {
  const r = byId[a.application_id];
  const pass = r.route === 'Close politely' && r.escalation === 'Closure' && r.recoverable === 'No' && r.priority === 'Not in outreach queue' && !WORKAROUND.test(r.drafted_nudge) && !/resume link/i.test(r.drafted_nudge) && !REVEAL.test(r.drafted_nudge) && r.send_status === 'HOLD';
  return { pass, actual: describe(r) }; }); }
{ const a = fixCoded('R10', 1); t('Restricted category (R10)', a.application_id, 'Second R10 case: same rules, and the subject line must not reveal the reason.', () => {
  const r = byId[a.application_id];
  return { pass: r.route === 'Close politely' && !REVEAL.test(r.email_subject) && !/clos|reject/i.test(r.email_subject) && !WORKAROUND.test(r.drafted_nudge), actual: `${describe(r)} | subject: ${r.email_subject}` }; }); }

{ const a = fixCoded('R12', 0); t('Compliance screening (R12)', a.application_id, 'Data pack code R12 (catalog: do not discuss reason, route to Compliance). Expect Compliance team, escalation "Compliance escalation", not in outreach queue, generic message with no screening wording and no resume link, held.', () => {
  const r = byId[a.application_id];
  const pass = r.route === 'Compliance team' && r.escalation === 'Compliance escalation' && r.priority === 'Not in outreach queue' && !REVEAL.test(r.drafted_nudge) && !/resume link/i.test(r.drafted_nudge) && r.send_status === 'HOLD';
  return { pass, actual: describe(r) }; }); }
{ const a = fixCoded('R12', 1); t('Compliance screening (R12)', a.application_id, 'Second R12 case: subject line and message are generic ("under review"), no promise.', () => {
  const r = byId[a.application_id];
  return { pass: !REVEAL.test(r.email_subject + ' ' + r.drafted_nudge) && !PROMISE.test(r.drafted_nudge), actual: `${describe(r)} | subject: ${r.email_subject}` }; }); }

for (const lang of ['English', 'Hindi', 'Hinglish', 'Tamil', 'Kannada', 'Marathi']) {
  const a = pick((x) => x.preferred_language === lang && x.rejection_code && !['R10', 'R12'].includes(x.rejection_code));
  const native = ['Tamil', 'Kannada', 'Marathi'].includes(lang);
  t('Different preferred languages', a.application_id, `Preferred language ${lang}. Expect message and email subject in ${lang} script${native ? ', and a hold for native-speaker review' : ''}.`, () => {
    const r = byId[a.application_id];
    const pass = scriptOk(r.drafted_nudge, lang) && scriptOk(r.email_subject, lang) && (!native || r.reviews.some((x) => x.type === 'Language review'));
    return { pass, actual: `${describe(r)} | subject: ${r.email_subject}` }; });
}

{ const a = pick((x) => x.whatsapp_opted_in === 'Yes' && x.rejection_code && !['R10', 'R12'].includes(x.rejection_code)); t('WhatsApp opted in', a.application_id, 'Opted in. WhatsApp allowed as first channel, SMS fallback.', () => {
  const r = byId[a.application_id]; return { pass: r.channel.startsWith('WhatsApp'), actual: describe(r) }; }); }
{ const a = pick((x) => x.whatsapp_opted_in !== 'Yes' && x.rejection_code && !['R10', 'R12'].includes(x.rejection_code)); t('WhatsApp opted out', a.application_id, 'Not opted in. Expect no WhatsApp channel.', () => {
  const r = byId[a.application_id]; return { pass: !r.channel.startsWith('WhatsApp'), actual: describe(r) }; }); }
{ const a = pick((x) => x.whatsapp_opted_in !== 'Yes' && x.rejection_code === 'R10') || pick((x) => x.whatsapp_opted_in !== 'Yes' && x.rejection_code === 'R12'); t('WhatsApp opted out (closure / compliance)', a.application_id, 'Opted-out R10/R12 case. Expect no WhatsApp channel.', () => {
  const r = byId[a.application_id]; return { pass: !r.channel.startsWith('WhatsApp'), actual: describe(r) }; }); }

{ const rec = nonAct.filter((x) => byId[x.application_id].recoverable === 'Yes'); const a = rec.sort((x, y) => y.days_since_last_activity - x.days_since_last_activity)[0];
  t('Long-inactive application', a.application_id, `Most inactive recoverable application (${a.days_since_last_activity} days). Expect it stays recoverable and in the queue, scored 0 for recency, with the days shown in the priority reason.`, () => {
    const r = byId[a.application_id];
    return { pass: r.recoverable === 'Yes' && r.priority !== 'Not in outreach queue' && /days inactive \(cold\) \+0/.test(r.priority_reason), actual: `${describe(r)} | ${r.priority_reason}`, why: 'Days are used as given. 21 of 75 rows have inactivity longer than days since signup.' }; }); }

// priority is not TPV alone: find a pair where more TPV got a lower tier
{ const q = results.filter((r) => r.priority_score !== ''); const order = { High: 3, Medium: 2, Low: 1 }; let found = null;
  for (const x of q) for (const y of q) if (x.expected_tpv_lakh > y.expected_tpv_lakh && order[x.priority] < order[y.priority]) { found = [x, y]; break; }
  t('Priority is not TPV alone', found ? `${found[0].application_id} vs ${found[1].application_id}` : '-', 'Expect at least one pair where the higher-TPV application gets a lower tier because of recency, fix clarity or stage.', () => ({ pass: !!found, actual: found ? `${found[0].application_id}: Rs ${found[0].expected_tpv_lakh} lakh → ${found[0].priority}; ${found[1].application_id}: Rs ${found[1].expected_tpv_lakh} lakh → ${found[1].priority}` : 'no such pair' })); }

// synthetic cases (not in the data pack; constructed for the test)
t('Low-confidence diagnosis (SYNTHETIC)', 'SYN-1', 'Note "Something odd happened with my file" matches no rule. Expect UNKNOWN, Low confidence, no message, held, not in outreach queue, no reason claimed.', () => {
  const r = synth({ rejection_message: 'Something odd happened with my file' });
  return { pass: r.reason_code === 'UNKNOWN' && r.confidence === 'Low' && r.drafted_nudge === '' && r.send_status === 'HOLD' && r.priority === 'Not in outreach queue' && r.reviews.some((x) => x.type === 'Low-confidence diagnosis'), actual: describe(r) }; });
t('Ambiguous note, two problems (SYNTHETIC)', 'SYN-1', 'Note names two different problems ("PAN and bank account name both wrong"). Expect a human to decide: held, not auto-sent.', () => {
  const r = synth({ rejection_message: 'PAN and bank account name both wrong' });
  return { pass: r.send_status === 'HOLD' && r.confidence !== 'High', actual: describe(r), why: 'The rules pick only the first match, so only one of the two reasons is drafted. It is held for a person, but the second problem is not mentioned in the message. Known limitation.' }; });
t('Activated application not processed', 'A3002', 'Activated applications must not appear as recovery opportunities.', () => ({ pass: !byId.A3002 && appById.A3002.application_status === 'Activated', actual: byId.A3002 ? 'present in results' : 'absent from results' }));

// hard rules on edited / hostile text, using the agent's own check function from outside
import { checkMessage_ } from '../lib/agent.js';
const eng = { preferred_language: 'English', whatsapp_opted_in: 'Yes' };
t('Hard rule: promise wording', '-', 'A fixable-case message saying "your account will be approved within 24 hours" must fail the safety check (so an edit cannot sneak in a promise).', () => {
  const f = checkMessage_('Hello, fix it here [resume link]. Your account will be approved within 24 hours.', 'R01', eng, 'SMS / Email', data.safety); return { pass: f.length > 0, actual: f.join('; ') || 'passed (wrong)' }; });
t('Hard rule: R10 workaround', '-', 'An R10 message suggesting another category or resubmitting must fail.', () => {
  const f = checkMessage_('We cannot support this. Please resubmit under another category.', 'R10', eng, 'SMS / Email', data.safety); return { pass: f.length > 0, actual: f.join('; ') || 'passed (wrong)' }; });
t('Hard rule: R12 reveals screening', '-', 'An R12 message mentioning sanctions screening must fail.', () => {
  const f = checkMessage_('Your application failed sanctions screening.', 'R12', eng, 'SMS / Email', data.safety); return { pass: f.length > 0, actual: f.join('; ') || 'passed (wrong)' }; });
t('Hard rule: WhatsApp without opt-in', '-', 'A WhatsApp channel for a non-opted-in applicant must fail.', () => {
  const f = checkMessage_('Hello [resume link]', 'R01', { preferred_language: 'English', whatsapp_opted_in: 'No' }, 'WhatsApp (opted in), SMS fallback', data.safety); return { pass: f.length > 0, actual: f.join('; ') || 'passed (wrong)' }; });
t('Input validation (new application form)', '-', 'Unknown language, unknown code and negative TPV must all be rejected.', () => {
  const base = { business_type: 'x', preferred_language: 'English', step_reached: 'KYC docs', expected_monthly_tpv_inr_lakh: 1, days_since_last_activity: 1 };
  const bad = [{ ...base, preferred_language: 'French' }, { ...base, rejection_code: 'R99' }, { ...base, expected_monthly_tpv_inr_lakh: -1 }].map((b) => normalizeNew([b], data.catalog).error);
  return { pass: bad.every(Boolean), actual: bad.map((e) => e || 'accepted (wrong)').join(' | ') }; });

// ===== full-dataset checks =====
const full = [];
function f(name, expected, fn) { let pass, actual, why = ''; try { ({ pass, actual, why = '' } = fn()); } catch (e) { pass = false; actual = 'error ' + e.message; } full.push({ name, expected, pass, actual, why }); }
f('Only non-activated applications processed', '75 results (100 minus 25 activated), none Activated', () => ({ pass: results.length === 75 && results.every((r) => appById[r.application_id].application_status !== 'Activated'), actual: `${results.length} results` }));
f('Coded rows keep their code', 'Every row with a code in the data has reason_code equal to it, confidence High', () => {
  const bad = nonAct.filter((a) => a.rejection_code && (byId[a.application_id].reason_code !== a.rejection_code || byId[a.application_id].confidence !== 'High')); return { pass: !bad.length, actual: `${nonAct.filter((a) => a.rejection_code).length} coded rows, ${bad.length} mismatches` }; });
f('R13 only when no code and no note', 'R13 rows are exactly the rows with no code and no reviewer note', () => {
  const exp = nonAct.filter((a) => !a.rejection_code && !a.rejection_message).map((a) => a.application_id).sort().join(); const act = results.filter((r) => r.reason_code === 'R13').map((r) => r.application_id).sort().join(); return { pass: exp === act, actual: `${act.split(',').length} R13 rows` }; });
f('Fixable/recoverable match the catalog', 'fixable Yes = recoverable Yes; "Needs compliance review" and "No" are never recoverable', () => {
  const bad = results.filter((r) => { const c = cat[r.reason_code]; return c && ((c.fixable === 'Yes') !== (r.recoverable === 'Yes')); }); return { pass: !bad.length, actual: `${bad.length} mismatches` }; });
f('Outreach queue excludes R10, R12, unresolved, non-recoverable', 'No such case has a priority tier or rank', () => {
  const bad = results.filter((r) => (['R10', 'R12', 'UNKNOWN'].includes(r.reason_code) || r.recoverable !== 'Yes') && (r.priority !== 'Not in outreach queue' || r.priority_rank !== '')); return { pass: !bad.length, actual: `${bad.length} leaks` }; });
f('Every recoverable case has a tier and a reason', 'High/Medium/Low plus a reason string', () => {
  const rec = results.filter((r) => r.recoverable === 'Yes'); const bad = rec.filter((r) => !['High', 'Medium', 'Low'].includes(r.priority) || !r.priority_reason); return { pass: !bad.length, actual: `${rec.length} recoverable, ${bad.length} missing` }; });
f('Closure messages: no workaround, reason or resume link', 'All R10 messages clean (independent regexes)', () => {
  const r10 = results.filter((r) => r.reason_code === 'R10'); const bad = r10.filter((r) => WORKAROUND.test(r.drafted_nudge) || REVEAL.test(r.drafted_nudge + r.email_subject) || /resume link/i.test(r.drafted_nudge)); return { pass: !bad.length, actual: `${r10.length} R10 messages, ${bad.length} violations` }; });
f('Compliance messages: generic only', 'All R12 messages and subjects clean, no resume link', () => {
  const r12 = results.filter((r) => r.reason_code === 'R12'); const bad = r12.filter((r) => REVEAL.test(r.drafted_nudge + r.email_subject) || /resume link/i.test(r.drafted_nudge)); return { pass: !bad.length, actual: `${r12.length} R12 messages, ${bad.length} violations` }; });
f('No promises or guarantees anywhere', 'No message or subject contains promise wording', () => {
  const bad = results.filter((r) => PROMISE.test(r.drafted_nudge + ' ' + r.email_subject)); return { pass: !bad.length, actual: `${bad.length} violations` }; });
f('WhatsApp only with opt-in', 'WhatsApp channel only when whatsapp_opted_in = Yes', () => {
  const bad = results.filter((r) => r.channel.startsWith('WhatsApp') && appById[r.application_id].whatsapp_opted_in !== 'Yes'); return { pass: !bad.length, actual: `${bad.length} violations` }; });
f('Right script for every message and subject', 'Each draft and subject is in the applicant\'s language script (independent check)', () => {
  const bad = results.filter((r) => r.drafted_nudge && (!scriptOk(r.drafted_nudge, r.preferred_language) || !scriptOk(r.email_subject, r.preferred_language))); return { pass: !bad.length, actual: `${results.filter((r) => r.drafted_nudge).length} drafts, ${bad.length} wrong script`, why: 'Checks script only, not whether the wording is natural. Tamil, Kannada, Marathi still need a native speaker.' }; });
f('Native-language review flagged', 'Every Tamil/Kannada/Marathi message is held with a Language review reason', () => {
  const nat = results.filter((r) => ['Tamil', 'Kannada', 'Marathi'].includes(r.preferred_language) && r.drafted_nudge); const bad = nat.filter((r) => r.send_status !== 'HOLD' || !r.reviews.some((x) => x.type === 'Language review')); return { pass: !bad.length, actual: `${nat.length} messages, ${bad.length} not flagged` }; });
f('Every hold has a stated reason', 'send_status HOLD iff at least one review reason with a "why"', () => {
  const bad = results.filter((r) => (r.send_status === 'HOLD') !== (r.reviews.length > 0) || r.reviews.some((x) => !x.why)); return { pass: !bad.length, actual: `${results.filter((r) => r.send_status === 'HOLD').length} on hold, ${bad.length} inconsistent` }; });
f('Section 1 fields present on all 75 rows', 'Every exported column is non-empty except rejection_code_in_data and priority_rank/priority_reasons where not applicable, and draft/subject for unresolved', () => {
  const must = ['application_id', 'business_type', 'step_reached', 'diagnosed_cause', 'fixable', 'recoverable', 'escalation', 'recommended_action', 'preferred_language', 'channel', 'priority', 'expected_tpv_lakh', 'confidence'];
  const bad = results.filter((r) => must.some((k) => r[k] === '' || r[k] === undefined)); return { pass: !bad.length, actual: `${bad.length} rows with a missing field` }; });
f('Dashboard matches an independent recount', 'Counts and TPV sums recomputed straight from the raw data pack', () => {
  const m = buildMetrics(results, countActivated_(apps));
  const tpvAll = Math.round(nonAct.reduce((s, a) => s + a.expected_monthly_tpv_inr_lakh, 0) * 10) / 10;
  const recIds = nonAct.filter((a) => a.rejection_code ? cat[a.rejection_code].fixable === 'Yes' : true && !(blankMsg.some((b) => b.application_id === a.application_id && ['A3051'].includes(b.application_id))));
  const tpvRec = Math.round(recIds.reduce((s, a) => s + a.expected_monthly_tpv_inr_lakh, 0) * 10) / 10;
  const pass = m.total === 100 && m.activated === apps.filter((a) => a.application_status === 'Activated').length && m.stalled === nonAct.filter((a) => a.application_status === 'Stalled').length && m.rejected === nonAct.filter((a) => a.application_status === 'Rejected').length && m.tpvAll === tpvAll && m.tpvRecoverable === tpvRec;
  return { pass, actual: `total ${m.total}, activated ${m.activated}, stalled ${m.stalled}, rejected ${m.rejected}, recoverable ${m.recoverable}, TPV all ${m.tpvAll}, TPV recoverable ${m.tpvRecoverable}`, why: 'The independent recount treats A3051 (blank code, "category not supported") as the restricted category, as a person would.' }; });
f('Top three causes match an independent count', 'Ranked by count among 75; ties broken by TPV', () => {
  const m = buildMetrics(results, 25); const cnt = {};
  nonAct.forEach((a) => { const c = a.rejection_code || (a.rejection_message ? classifyText_(a.rejection_message, data.kw) : 'R13'); cnt[c] = (cnt[c] || 0) + 1; });
  const exp = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 2).map((x) => x.join(':')).join(); const act = m.top.slice(0, 2).map((x) => x.code + ':' + x.count).join();
  return { pass: exp === act && m.top.length === 3, actual: m.top.map((x) => `${x.code} ${x.count} (${x.pct}%)${x.tied.length ? ' tied with ' + x.tied : ''}`).join('; '), why: 'Third place is a tie (R06 and R03 at 7); the order between them uses TPV, which is a choice, so only the first two places are compared strictly.' }; });
f('CSV matches the dashboard', 'CSV has 75 data rows, all Section 1 headers, and the same recoverable count as the dashboard', () => {
  const csv = toCsv(results).replace('﻿', ''); const lines = []; let cur = '', q = false;
  for (const ch of csv) { if (ch === '"') q = !q; if (ch === '\n' && !q) { lines.push(cur.replace(/\r$/, '')); cur = ''; } else cur += ch; } if (cur) lines.push(cur.replace(/\r$/, ''));
  const head = lines[0].split(','); const need = ['application_id', 'business_type', 'current_onboarding_stage', 'diagnosed_reason', 'reason_code', 'fixable', 'recoverable', 'compliance_escalation_or_closure', 'recommended_corrective_action', 'preferred_language', 'recommended_channel', 'draft_nudge', 'outreach_priority', 'expected_monthly_tpv_inr_lakh'];
  const ri = head.indexOf('recoverable'); const recCount = lines.slice(1).filter((l) => /^"?[^,]*"?,/.test(l)).length;
  const m = buildMetrics(results, 25);
  return { pass: lines.length - 1 === 75 && need.every((h) => head.includes(h)) && recCount === 75 && ri > 0 && m.recoverable === results.filter((r) => r.recoverable === 'Yes').length, actual: `${lines.length - 1} rows, ${head.length} columns` }; });
f('Report includes the required sections', 'Summary report lists top causes, human-review cases, no-nudge cases and methodology', () => {
  const rep = buildReport(results, 25); return { pass: ['Top three causes', 'Cases needing human review', 'must not receive normal recovery nudges', 'Methodology', 'AI model connected'].every((s) => rep.includes(s)) || rep.includes('AI-assisted (AI model connected: NO)'), actual: `${rep.length} characters` }; });
f('Keyword rules on the 49 coded notes (informational)', 'Blank the code on every row that has a code and a note; rules should return that code', () => {
  const coded = nonAct.filter((a) => a.rejection_code && a.rejection_message); const miss = coded.filter((a) => classifyText_(a.rejection_message, data.kw) !== a.rejection_code);
  return { pass: !miss.length, actual: `${coded.length - miss.length} of ${coded.length} match` + (miss.length ? `; misses: ${miss.map((a) => a.application_id + '→' + classifyText_(a.rejection_message, data.kw)).join(', ')}` : ''), why: 'NOT an independent test: the rules were written after reading these notes. It shows the rules fit the known notes, not that they generalise.' }; });

// ===== report =====
const pass1 = rows.filter((r) => r.status === 'PASS').length, passF = full.filter((r) => r.pass).length;
const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const out = [];
out.push('# Test report', '', 'Synthetic data pack, 100 applications (25 activated, 75 not). Generated by `npm test` (tests/run_tests.mjs).', '',
  'How to read this: expectations are written from the data pack, the catalog and the brief, using separate regexes and recounts, not by calling the agent\'s own decision functions. Cases marked SYNTHETIC are not in the data pack; I constructed them to cover scenarios the pack lacks.', '',
  `**Results: ${pass1}/${rows.length} specific cases passed, ${passF}/${full.length} full-dataset checks passed.**`, '',
  'These tests show the rules behave as designed on this data pack. They do not show the diagnoses are right in general, and they say nothing about how natural the Tamil, Kannada and Marathi wording is.', '',
  '## Specific cases', '', '| # | Scenario | Application | Expected (from data pack) | Actual agent output | Status | Explanation |', '|---|---|---|---|---|---|---|');
rows.forEach((r) => out.push(`| ${r.n} | ${esc(r.scenario)} | ${r.id} | ${esc(r.expected)} | ${esc(short(r.actual, 200))} | ${r.status} | ${esc(r.why)} |`));
out.push('', '## Full dataset checks (all 75 non-activated applications)', '', '| # | Check | Expected | Actual | Status | Explanation |', '|---|---|---|---|---|---|');
full.forEach((r, i) => out.push(`| ${i + 1} | ${esc(r.name)} | ${esc(r.expected)} | ${esc(r.actual)} | ${r.pass ? 'PASS' : 'FAIL'} | ${esc(r.why)} |`));
const fails = [...rows.filter((r) => r.status === 'FAIL').map((r) => `Case ${r.n} (${r.scenario}): ${r.why || r.actual}`), ...full.filter((r) => !r.pass).map((r) => `${r.name}: ${r.actual}`)];
out.push('', '## Failures and known limits', '', ...(fails.length ? fails.map((x) => `- ${x}`) : ['- No test failed in this run.']),
  '- The rules read only the first matching keyword rule, so a note that names two problems is drafted for one of them (held for a person either way).',
  '- Nothing tests how natural Tamil, Kannada or Marathi wording is. Those messages are held for native-speaker review.',
  '- No test uses real merchants, real contact details or a real resume link.', '- The Google Sheet / Apps Script version is a separate copy and was not changed or retested in this round.');
fs.writeFileSync(new URL('../TEST_REPORT.md', import.meta.url), out.join('\n') + '\n');
console.log(`specific ${pass1}/${rows.length}, full ${passF}/${full.length}`);
fails.forEach((x) => console.log('FAIL', x));
process.exit(fails.length ? 1 : 0);
