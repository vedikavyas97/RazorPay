'use client';

import { useEffect, useMemo, useState } from 'react';
import { buildMetrics } from '../lib/metrics.js';
import { toCsv, buildReport } from '../lib/report.js';

const STEPS = [
  { n: 1, t: 'Read', d: 'Takes each stalled or rejected application (75 of 100). Activated ones are skipped.' },
  { n: 2, t: 'Diagnose', d: 'Rules find the cause and a confidence level. Blank codes are read from the reviewer text.' },
  { n: 3, t: 'Prioritise and draft', d: 'Scores outreach priority, then picks a fixed template in the applicant’s language.' },
  { n: 4, t: 'Check, review, send', d: 'Safety checks run. A person approves, edits or rejects each draft before anything is sent.' },
];

const CODE_LABELS = {
  R01: 'PAN name mismatch', R02: 'GST not validated', R03: 'Bank account name mismatch', R04: 'Bank verification failed',
  R05: 'Document unreadable', R06: 'Website policy pages missing', R07: 'Website not live', R08: 'Address proof issue',
  R09: 'Signatory ID issue', R10: 'Restricted category', R11: 'Category differs from website', R12: 'Screening hit',
  R13: 'Abandoned application',
};

const REVIEW_TYPES = ['Low-confidence diagnosis', 'Blank or ambiguous reviewer comment', 'Compliance escalation', 'Closure sign-off', 'Language review', 'Safety check failed'];
const LANGS = ['English', 'Hinglish', 'Hindi', 'Tamil', 'Kannada', 'Marathi'];
const STEP_NAMES = ['Business details', 'KYC docs', 'Bank verification', 'Website/App review'];
const BLANK = { business_type: '', preferred_language: 'English', whatsapp_opted_in: 'Yes', step_reached: 'KYC docs', expected_monthly_tpv_inr_lakh: '', days_since_last_activity: '', rejection_code: '', rejection_message: '' };
const PRESETS = [
  ['Blurred document, no code', { business_type: 'Proprietorship', preferred_language: 'English', whatsapp_opted_in: 'Yes', step_reached: 'KYC docs', expected_monthly_tpv_inr_lakh: '8', days_since_last_activity: '5', rejection_code: '', rejection_message: 'Doc blurred and cropped, cannot verify' }],
  ['Hinglish, PAN mismatch', { business_type: 'Private Limited', preferred_language: 'Hinglish', whatsapp_opted_in: 'No', step_reached: 'KYC docs', expected_monthly_tpv_inr_lakh: '25', days_since_last_activity: '9', rejection_code: '', rejection_message: 'PAN ka naam aur application ka naam match nahi kar raha' }],
  ['Tamil, stopped at bank step', { business_type: 'Partnership', preferred_language: 'Tamil', whatsapp_opted_in: 'Yes', step_reached: 'Bank verification', expected_monthly_tpv_inr_lakh: '14', days_since_last_activity: '12', rejection_code: '', rejection_message: '' }],
  ['Restricted category (R10)', { business_type: 'Private Limited', preferred_language: 'English', whatsapp_opted_in: 'Yes', step_reached: 'Website/App review', expected_monthly_tpv_inr_lakh: '30', days_since_last_activity: '3', rejection_code: 'R10', rejection_message: '' }],
  ['Unclear note', { business_type: 'LLP', preferred_language: 'English', whatsapp_opted_in: 'No', step_reached: 'KYC docs', expected_monthly_tpv_inr_lakh: '6', days_since_last_activity: '4', rejection_code: '', rejection_message: 'Something odd happened with my file' }],
];

function routeInfo(r) {
  if (r.reason_code === 'R13') return { label: 'Resume reminder', cls: 'nudge' };
  if (r.route === 'Nudge merchant') return { label: 'Fix nudge', cls: 'nudge' };
  if (r.route === 'Close politely') return { label: 'Close politely', cls: 'close' };
  if (r.route === 'Compliance team') return { label: 'To Compliance', cls: 'comp' };
  return { label: 'Human review', cls: 'comp' };
}

export default function Home() {
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [codeFilter, setCodeFilter] = useState('ALL');
  const [selected, setSelected] = useState(null);
  const [rerunning, setRerunning] = useState(false);
  const [activated, setActivated] = useState(0);
  const [view, setView] = useState('all');
  const [reviewType, setReviewType] = useState('ALL');
  const [prio, setPrio] = useState('ALL');
  const [decisions, setDecisions] = useState({});
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [editFails, setEditFails] = useState([]);
  const [checking, setChecking] = useState(false);
  const [newApps, setNewApps] = useState([]);
  const [newIds, setNewIds] = useState([]);
  const [form, setForm] = useState(BLANK);
  const [adding, setAdding] = useState(false);
  const setF = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function post(url, body) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
    return json;
  }

  async function run(extra = newApps) {
    setBusy(true); setError('');
    try {
      const j = await post('/api/run', { extra });
      setResults(j.results); setNewIds(j.newIds || []); setActivated(j.activated || 0); setLoaded(true);
      setSelected((s) => s || (j.results[0] && j.results[0].application_id) || null);
      return true;
    } catch (e) { setError(String(e.message || e)); return false; }
    finally { setBusy(false); }
  }

  useEffect(() => { run([]); }, []); // eslint-disable-line

  async function addApp(e) {
    e.preventDefault();
    setAdding(true);
    const next = [...newApps, form];
    const ok = await run(next);
    if (ok) {
      setNewApps(next); setForm(BLANK); setFilter('ALL'); setCodeFilter('ALL');
      setSelected(`NEW-${String(next.length).padStart(3, '0')}`);
      setTimeout(() => document.querySelector('.detail')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
    }
    setAdding(false);
  }

  async function clearNew() {
    setNewApps([]); setSelected(null);
    await run([]);
  }

  async function rerun() {
    setRerunning(true);
    await run();
    setRerunning(false);
  }

  function setDecision(id, patch) { setDecisions((d) => ({ ...d, [id]: { ...(d[id] || {}), ...patch } })); }

  async function saveEdit() {
    setChecking(true); setEditFails([]);
    try {
      const j = await post('/api/check', { message: editText, subject: cur.email_subject, reason_code: cur.reason_code, preferred_language: cur.preferred_language, channel: cur.channel });
      if (j.pass) { setDecision(cur.application_id, { message: editText, edited: true, safe: true, status: undefined }); setEditing(false); }
      else setEditFails(j.fails);
    } catch (e) { setEditFails([String(e.message || e)]); }
    setChecking(false);
  }

  function save(text, type, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
  }
  const download = () => save(toCsv(results), 'text/csv;charset=utf-8', 'onboarding_agent_output.csv');
  const downloadReport = () => save(buildReport(results, activated), 'text/markdown;charset=utf-8', 'onboarding_agent_summary.md');

  const M = useMemo(() => buildMetrics(results, activated), [results, activated]);
  const reviewCounts = useMemo(() => Object.fromEntries(REVIEW_TYPES.map((t) => [t, results.filter((r) => r.reviews.some((x) => x.type === t)).length])), [results]);

  const codeCounts = useMemo(() => {
    const m = {};
    results.forEach((r) => { m[r.reason_code] = (m[r.reason_code] || 0) + 1; });
    return Object.keys(m).sort().map((c) => [c, m[c]]);
  }, [results]);

  const FILTERS = [
    ['ALL', 'All', results.length],
    ['READY', 'Ready', results.filter((r) => r.send_status !== 'HOLD').length],
    ['HOLD', 'On hold', M.humanReview],
    ['Yes', 'Recoverable', M.recoverable],
    ['No', 'Not recoverable', results.filter((r) => r.recoverable !== 'Yes').length],
  ];
  const shown = results.filter((r) => {
    if (view === 'review') return r.send_status === 'HOLD' && (reviewType === 'ALL' || r.reviews.some((x) => x.type === reviewType));
    if (view === 'blocked') return r.priority === 'Not in outreach queue';
    if (prio !== 'ALL' && r.priority !== prio) return false;
    if (codeFilter !== 'ALL' && r.reason_code !== codeFilter) return false;
    if (filter === 'ALL') return true;
    if (filter === 'HOLD') return r.send_status === 'HOLD';
    if (filter === 'READY') return r.send_status !== 'HOLD';
    return r.recoverable === filter;
  });
  const cur = results.find((r) => r.application_id === selected) || null;

  // ---- send buttons are a demo: they show when sending would be allowed, but do nothing ----
  // Hard rules come first and cannot be overridden by approving.
  let msg = '', optedIn = false, blocked = '', ok = false, dec = {}, hard = '', safe = false;
  if (cur) {
    dec = decisions[cur.application_id] || {};
    msg = dec.message ?? cur.drafted_nudge;
    safe = dec.edited ? !!dec.safe : cur.safety_check === 'PASS';
    optedIn = cur.channel.startsWith('WhatsApp');
    if (cur.reason_code === 'R12') hard = 'Compliance decides whether anything is sent for this case. It cannot be sent from here.';
    else if (!cur.drafted_nudge) hard = 'There is no message for this case. A person must review it.';
    else if (!safe) hard = 'This message failed a safety check.';
    if (hard) blocked = hard;
    else if (dec.status === 'rejected') blocked = 'You rejected this message.';
    else if (dec.status !== 'approved') blocked = 'Approve the message first.';
    ok = !blocked;
  }
  const ICONS = {
    wa: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 20l1.2-5A8.4 8.4 0 1 1 21 11.5z" /></svg>,
    sms: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="14" rx="2" /><path d="M7 9h10M7 13h6" /></svg>,
    mail: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg>,
  };
  const SendBtn = ({ id, label, extraOff }) => (ok && !extraOff
    ? <button type="button" className={`send ${id}`}>{ICONS[id]}{label}</button>
    : <button type="button" className="send off" disabled title={extraOff || blocked}>{ICONS[id]}{label}</button>);

  return (
    <main>
      <header className="top">
        <div>
          <h1>Onboarding Recovery Agent</h1>
          <p className="sub">A tool for Razorpay&apos;s onboarding team. It finds out why merchant applications stalled, decides what can be recovered, and drafts a safe nudge in the applicant&apos;s own language. A person approves each message and presses send.</p>
        <ol className="steps">
          {STEPS.map((s) => (
            <li key={s.n}><span className="num">{s.n}</span><div><b>{s.t}</b><span>{s.d}</span></div></li>
          ))}
        </ol>
        </div>
        <aside className="hero">
          <div className="hl">Expected monthly TPV · recoverable</div>
          <div className="hbig">{loaded ? `Rs ${M.tpvRecoverable} lakh` : '…'}</div>
          <div className="hsub">of Rs {M.tpvAll} lakh at stake across all {M.nonActivated} non-activated applications. Applicants&apos; own estimates, not realised volume and not Razorpay revenue.</div>
          <div className="hl hl2">Top causes · click to filter</div>
          {M.top.map((t) => (
            <button key={t.code} className="crow" onClick={() => { setView('all'); setCodeFilter(t.code); setFilter('ALL'); setPrio('ALL'); }}>
              <span className="cc">{t.code}</span><span className="cn">{CODE_LABELS[t.code] || t.cause}</span><span className="ck">{t.count}</span>
            </button>
          ))}
        </aside>
      </header>

      <section className="cards">
        <div className="card c-blue"><b>{M.total}</b><span>total applications</span></div>
        <div className="card c-gray"><b>{M.activated}</b><span>activated (not processed)</span></div>
        <div className="card c-blue"><b>{M.nonActivated}</b><span>non-activated (processed)</span></div>
        <div className="card c-amber"><b>{M.stalled}</b><span>stalled</span></div>
        <div className="card c-gray"><b>{M.rejected}</b><span>rejected</span></div>
        <div className="card c-green"><b>{M.recoverable}</b><span>recoverable with a nudge</span></div>
        <div className="card c-gray"><b>{M.nonRecoverable}{M.unresolved ? ` + ${M.unresolved}?` : ''}</b><span>non-recoverable{M.unresolved ? ' (+ reason unidentified)' : ''}</span></div>
        <div className="card c-amber"><b>{M.humanReview}</b><span>need human review</span></div>
        <div className="card c-purple"><b>{M.compliance}</b><span>compliance escalations</span></div>
        <div className="card c-blue"><b>Rs {M.tpvAll}</b><span>lakh TPV at stake, all non-activated</span></div>
        <div className="card c-green"><b>Rs {M.tpvRecoverable}</b><span>lakh TPV, recoverable only</span></div>
        <div className="card c-green"><b>{M.safetyPass}/{M.nonActivated}</b><span>passed every safety check</span></div>
      </section>

      <section className="demo top3">
        <h2>Top three systemic onboarding problems</h2>
        <p className="note">Ranked by how many of the {M.nonActivated} non-activated applications have the cause. Counts come from the diagnoses above, not from estimates. The improvement ideas are the builder&apos;s suggestions, not part of the data pack.</p>
        <div className="tablewrap"><table className="tbl"><thead><tr><th>#</th><th>Cause</th><th>Merchants</th><th>% of non-activated</th><th>Fixable</th><th>Suggested product / process improvement</th></tr></thead>
          <tbody>{M.top.map((t, i) => (
            <tr key={t.code}><td>{i + 1}</td><td><b>{t.code}</b> {t.cause}{t.code === 'R13' && <div className="note">No cause was recorded for these merchants.</div>}{t.tied.length > 0 && <div className="note">Tied on count with {t.tied.join(', ')}; ordered by TPV.</div>}</td>
              <td>{t.count}</td><td>{t.pct}%</td><td>{t.fixable}</td><td>{t.suggestion}</td></tr>
          ))}</tbody></table></div>
      </section>

      <div className="tabs" role="tablist">
        {[['all', 'All applications', M.nonActivated], ['review', 'Human review queue', M.humanReview], ['blocked', 'No normal outreach', M.priority['Not in outreach queue']]].map(([k, l, n]) => (
          <button key={k} role="tab" aria-selected={view === k} className={`tab ${view === k ? 'on' : ''}`} onClick={() => { setView(k); setSelected(null); }}>{l} <i>{n}</i></button>
        ))}
      </div>

      <div className="bar">
        {view === 'all' && (
        <div className="pills">
          {FILTERS.map(([k, l, n]) => (
            <button key={k} className={`pill ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{l} <i>{n}</i></button>
          ))}
          <select aria-label="Filter by reason code" value={codeFilter} onChange={(e) => setCodeFilter(e.target.value)}>
            <option value="ALL">All reason codes</option>
            {codeCounts.map(([c, n]) => <option key={c} value={c}>{c} · {CODE_LABELS[c] || c} ({n})</option>)}
          </select>
          <select aria-label="Filter by priority" value={prio} onChange={(e) => setPrio(e.target.value)}>
            <option value="ALL">All priorities</option>
            {['High', 'Medium', 'Low', 'Not in outreach queue'].map((t) => <option key={t} value={t}>{t} ({M.priority[t]})</option>)}
          </select>
        </div>)}
        {view === 'review' && (
        <div className="pills">
          <select aria-label="Filter by review type" value={reviewType} onChange={(e) => setReviewType(e.target.value)}>
            <option value="ALL">All review types</option>
            {REVIEW_TYPES.map((t) => <option key={t} value={t}>{t} ({reviewCounts[t]})</option>)}
          </select>
          <span className="note">Each case shows why a person has to step in.</span>
        </div>)}
        {view === 'blocked' && <span className="note">Restricted-category, compliance, unresolved and non-recoverable cases never receive a normal recovery nudge.</span>}
        <div className="actions">
          <button onClick={() => run()} disabled={busy}>{busy ? 'Running…' : 'Run agent again'}</button>
          <button className="alt" onClick={download} disabled={!results.length}>Download CSV ({results.length})</button>
          <button className="alt" onClick={downloadReport} disabled={!results.length}>Download summary report</button>
        </div>
      </div>
      {error && <div className="err">{error}</div>}

      <section className="layout">
        <div className="list">
          {!loaded && !error && <div className="empty">Running the agent…</div>}
          {shown.map((r) => {
            const ri = routeInfo(r);
            return (
              <button key={r.application_id} className={`item ${selected === r.application_id ? 'sel' : ''}`} onClick={() => setSelected(r.application_id)}>
                <div className="l1"><b>{r.application_id}</b><span className="lang">{r.preferred_language}{newIds.includes(r.application_id) && <em className="newtag">New</em>}</span><span className={`chip ${r.send_status === 'HOLD' ? 'hold' : 'ready'}`}>{r.send_status === 'HOLD' ? 'On hold' : 'Ready'}</span></div>
                <div className="l2"><span className={`code ${ri.cls}`}>{r.reason_code}</span><span className="cause">{r.diagnosed_cause}</span><span className={`prio p-${r.priority.split(' ')[0]}`}>{r.priority === 'Not in outreach queue' ? 'No outreach' : r.priority}</span></div>
                {view === 'review' && <div className="why">{r.reviews.map((x) => x.type).join(' · ')}</div>}
              </button>
            );
          })}
          {loaded && !shown.length && <div className="empty">No applications in this view.</div>}
        </div>

        <aside className="detail">
          {!cur && <div className="empty">Pick an application on the left to see the diagnosis and the drafted message.</div>}
          {cur && (
            <>
              <div className="dh">
                <div><h2>{cur.application_id}</h2><div className="note">{cur.business_type} · stopped at {cur.step_reached} · {cur.preferred_language}</div></div>
                <span className={`chip big ${cur.send_status === 'HOLD' ? 'hold' : 'ready'}`}>{cur.send_status === 'HOLD' ? 'On hold' : 'Ready after spot check'}</span>
              </div>
              <div className="facts">
                <div><span>Diagnosis</span><b>{cur.reason_code}: {cur.diagnosed_cause}</b></div>
                <div><span>Confidence</span><b>{cur.confidence} <small className="note">({cur.code_source})</small></b></div>
                <div><span>Fixable / recoverable</span><b>{cur.fixable} / {cur.recoverable}</b></div>
                <div><span>Action</span><b className={`code-text ${routeInfo(cur).cls}`}>{routeInfo(cur).label}</b></div>
                <div><span>Escalation or closure</span><b>{cur.escalation}</b></div>
                <div><span>Outreach priority</span><b>{cur.priority}{cur.priority_rank ? ` · #${cur.priority_rank} in queue` : ''}</b></div>
                <div><span>Channel</span><b>{optedIn ? 'WhatsApp (opted in), SMS fallback' : 'SMS / Email (not opted in to WhatsApp)'}</b></div>
                <div><span>Expected TPV (applicant estimate)</span><b>Rs {cur.expected_tpv_lakh} lakh · {cur.days_inactive} days inactive</b></div>
                <div><span>Safety check</span><b className={cur.safety_check === 'PASS' ? 'pass' : 'fail'}>{cur.safety_check}</b></div>
                <div className="wide"><span>Recommended corrective action</span><b>{cur.recommended_action}</b></div>
                <div className="wide"><span>Why this priority</span><b className="small">{cur.priority_reason}</b></div>
              </div>
              {cur.reviews.length > 0 && (
                <div className="holdbox"><b>A person has to step in:</b>
                  <ul>{cur.reviews.map((x) => <li key={x.type}><b>{x.type}.</b> {x.why}</li>)}</ul>
                  Approving a message never overrides the hard rules below.</div>
              )}
              {cur.email_subject && <div className="msglabel">Email subject: <b>{cur.email_subject}</b></div>}
              <div className="msglabel">Drafted message ({optedIn ? 'WhatsApp' : 'SMS / email'} preview){dec.edited ? ' · edited by reviewer' : ''}</div>
              {!editing && <div className={`bubble ${optedIn ? 'wa' : 'sms'}`}>{msg || '(no message: a human must review this case)'}</div>}
              {editing && (
                <div className="editbox">
                  <textarea value={editText} maxLength={1500} onChange={(e) => setEditText(e.target.value)} />
                  {editFails.length > 0 && <div className="err">Safety check failed: {editFails.join('; ')}. Fix the message to save it.</div>}
                  <div className="decide"><button onClick={saveEdit} disabled={checking}>{checking ? 'Checking…' : 'Check and save edit'}</button><button className="alt" onClick={() => { setEditing(false); setEditFails([]); }}>Cancel</button></div>
                </div>
              )}
              {!editing && (
                <div className="decide">
                  <button className="approve-btn" disabled={!!hard || dec.status === 'approved'} title={hard} onClick={() => setDecision(cur.application_id, { status: 'approved' })}>{dec.status === 'approved' ? 'Approved' : 'Approve'}</button>
                  <button className="alt" disabled={!!hard && !(cur.drafted_nudge && cur.reason_code !== 'R12')} title={cur.reason_code === 'R12' ? 'Compliance cases cannot be edited here.' : ''} onClick={() => { setEditText(msg); setEditFails([]); setEditing(true); }}>Edit</button>
                  <button className="alt reject-btn" disabled={!cur.drafted_nudge && cur.reason_code !== 'UNKNOWN'} onClick={() => setDecision(cur.application_id, { status: 'rejected' })}>{dec.status === 'rejected' ? 'Rejected' : 'Reject'}</button>
                  <span className="note">{dec.status === 'approved' ? 'Approved by reviewer.' : dec.status === 'rejected' ? 'Rejected: will not be sent.' : 'Not reviewed yet.'}</span>
                </div>
              )}
              <div className="sendrow">
                <SendBtn id="wa" label="WhatsApp" extraOff={!optedIn && cur.reason_code !== 'R12' ? 'This applicant has not opted in to WhatsApp. Use SMS or email.' : ''} />
                <SendBtn id="sms" label="SMS" />
                <SendBtn id="mail" label="Email" />
              </div>
              <div className="note sendnote">{blocked ? `Send buttons are off: ${blocked}` : 'Sending switches on once contact details are connected. Nothing is sent from this page.'}</div>
              <button className="alt" onClick={rerun} disabled={rerunning}>{rerunning ? 'Running…' : 'Re-run agent'}</button>
            </>
          )}
        </aside>
      </section>

      <section className="demo" id="new">
        <h2>Add a new application</h2>
        <p className="note">The agent works on any application, not only the 100 in the data pack. Fill in what the onboarding system would show and it is diagnosed, drafted and checked the same way. If the code is blank, the reviewer text is read by the rules; if nothing matches, a person decides. New entries last for this browser session only.</p>
        <div className="chips">{PRESETS.map(([l, v]) => <button key={l} type="button" className="pill" onClick={() => setForm(v)}>{l}</button>)}</div>
        <form className="nform" onSubmit={addApp}>
          <label>Business type<input type="text" required maxLength={60} value={form.business_type} onChange={setF('business_type')} placeholder="e.g. Proprietorship" /></label>
          <label>Language<select value={form.preferred_language} onChange={setF('preferred_language')}>{LANGS.map((l) => <option key={l}>{l}</option>)}</select></label>
          <label>Opted in to WhatsApp<select value={form.whatsapp_opted_in} onChange={setF('whatsapp_opted_in')}><option>Yes</option><option>No</option></select></label>
          <label>Stopped at<select value={form.step_reached} onChange={setF('step_reached')}>{STEP_NAMES.map((l) => <option key={l}>{l}</option>)}</select></label>
          <label>Expected monthly volume (Rs lakh)<input type="number" required min="0" step="any" value={form.expected_monthly_tpv_inr_lakh} onChange={setF('expected_monthly_tpv_inr_lakh')} /></label>
          <label>Days inactive<input type="number" required min="0" step="1" value={form.days_since_last_activity} onChange={setF('days_since_last_activity')} /></label>
          <label>Rejection code
            <select value={form.rejection_code} onChange={setF('rejection_code')}>
              <option value="">None / not known</option>
              {Object.entries(CODE_LABELS).filter(([c]) => c !== 'R13').map(([c, l]) => <option key={c} value={c}>{c} · {l}</option>)}
            </select>
          </label>
          <label className="wide">Reviewer note (optional)<textarea maxLength={500} value={form.rejection_message} onChange={setF('rejection_message')} placeholder="e.g. Doc blurred and cropped, cannot verify" /></label>
          <div className="wide row">
            <button type="submit" disabled={adding}>{adding ? 'Running…' : 'Add and run agent'}</button>
            {newApps.length > 0 && <button type="button" className="alt" onClick={clearNew}>Clear {newApps.length} added</button>}
          </div>
        </form>
      </section>

      <footer className="note">Limits: all data is synthetic. No AI model is used in this app; every decision comes from rules you can read. [resume link] marks where the real link goes once the system sends the message. Tamil, Kannada and Marathi wording and subjects have not been checked by a native speaker. 21 of 75 rows have inactivity days longer than days since signup (used as given). Keyword rules were written after seeing the coded notes. Priority weights are the builder&apos;s judgment. Added applications and reviewer decisions are not saved; they disappear when you reload.</footer>
    </main>
  );
}
