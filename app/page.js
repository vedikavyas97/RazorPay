'use client';

import { useEffect, useMemo, useState } from 'react';

const CSV_HEADERS = ['application_id', 'business_type', 'preferred_language', 'step_reached', 'expected_tpv_lakh', 'priority_rank',
  'reason_code', 'diagnosed_cause', 'fixable', 'recoverable', 'route', 'channel', 'drafted_nudge', 'chars', 'safety_check',
  'send_status', 'hold_reasons', 'code_source'];

const STEPS = [
  { n: 1, t: 'Read', d: 'Takes each stalled or rejected application from the data pack.' },
  { n: 2, t: 'Diagnose', d: 'Rules find the cause. Blank codes are read from the reviewer text.' },
  { n: 3, t: 'Draft', d: 'Picks a fixed template in the applicant’s language and channel.' },
  { n: 4, t: 'Check, approve, send', d: 'Safety checks run. A person reads the draft, approves it and presses send.' },
];

const CODE_LABELS = {
  R01: 'PAN name mismatch', R02: 'GST not validated', R03: 'Bank account name mismatch', R04: 'Bank verification failed',
  R05: 'Document unreadable', R06: 'Website policy pages missing', R07: 'Website not live', R08: 'Address proof issue',
  R09: 'Signatory ID issue', R10: 'Restricted category', R11: 'Category differs from website', R12: 'Screening hit',
  R13: 'Abandoned application',
};

const EXAMPLES = [
  'Doc blurred and cropped, cannot verify',
  'PAN ka naam aur application ka naam match nahi kar raha',
  'Something odd happened with my file',
];

function toCsv(rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return '﻿' + [CSV_HEADERS.join(','), ...rows.map((r) => CSV_HEADERS.map((h) => esc(r[h])).join(','))].join('\r\n');
}

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
  const [link, setLink] = useState('');
  const [approved, setApproved] = useState({});
  const [opened, setOpened] = useState({});
  const [text, setText] = useState('');
  const [classified, setClassified] = useState(null);

  async function post(url, body) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
    return json;
  }

  async function run() {
    setBusy(true); setError('');
    try {
      const j = await post('/api/run', {});
      setResults(j.results); setLoaded(true);
      setSelected((s) => s || (j.results[0] && j.results[0].application_id) || null);
    } catch (e) { setError(String(e.message || e)); }
    setBusy(false);
  }

  useEffect(() => { run(); }, []); // eslint-disable-line

  async function rerun(id) {
    setRerunning(true); setError('');
    try {
      const j = await post('/api/preview', { application_id: id });
      setResults((rs) => rs.map((r) => (r.application_id === id ? { ...j.result, priority_rank: r.priority_rank } : r)));
    } catch (e) { setError(String(e.message || e)); }
    setRerunning(false);
  }

  async function classify(t) {
    const value = (t ?? text).trim();
    setError(''); setClassified(null);
    try { setClassified(await post('/api/classify', { text: value })); } catch (e) { setError(String(e.message || e)); }
  }

  function download() {
    const blob = new Blob([toCsv(results)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'onboarding_agent_output.csv'; a.click();
  }

  const stats = useMemo(() => {
    const rec = results.filter((r) => r.recoverable === 'Yes');
    const tpv = rec.reduce((s, r) => s + (Number(r.expected_tpv_lakh) || 0), 0);
    return {
      total: results.length, recoverable: rec.length, tpv: tpv.toFixed(1),
      close: results.filter((r) => r.reason_code === 'R10').length,
      compliance: results.filter((r) => r.reason_code === 'R12').length,
      pass: results.filter((r) => r.safety_check === 'PASS').length,
      hold: results.filter((r) => r.send_status === 'HOLD').length,
      opened: Object.keys(opened).length,
    };
  }, [results, opened]);

  const codeCounts = useMemo(() => {
    const m = {};
    results.forEach((r) => { m[r.reason_code] = (m[r.reason_code] || 0) + 1; });
    return Object.keys(m).sort().map((c) => [c, m[c]]);
  }, [results]);

  const FILTERS = [
    ['ALL', 'All', results.length],
    ['READY', 'Ready', results.filter((r) => r.send_status !== 'HOLD').length],
    ['HOLD', 'On hold', stats.hold],
    ['Yes', 'Recoverable', stats.recoverable],
    ['No', 'Not recoverable', results.filter((r) => r.recoverable !== 'Yes').length],
  ];
  const shown = results.filter((r) => {
    if (codeFilter !== 'ALL' && r.reason_code !== codeFilter) return false;
    if (filter === 'ALL') return true;
    if (filter === 'HOLD') return r.send_status === 'HOLD';
    if (filter === 'READY') return r.send_status !== 'HOLD';
    return r.recoverable === filter;
  });
  const cur = results.find((r) => r.application_id === selected) || null;

  // ---- sending (opens the app with the message filled in; a person presses send) ----
  let msg = '', needsLink = false, linkMissing = false, optedIn = false, blocked = '', ok = false, urls = {};
  if (cur) {
    needsLink = cur.drafted_nudge.includes('[resume link]');
    linkMissing = needsLink && !link.trim();
    msg = needsLink && link.trim() ? cur.drafted_nudge.split('[resume link]').join(link.trim()) : cur.drafted_nudge;
    optedIn = cur.channel.startsWith('WhatsApp');
    if (cur.reason_code === 'R12') blocked = 'Compliance decides whether anything is sent for this case. Nothing can be sent from here.';
    else if (!cur.drafted_nudge) blocked = 'There is no message for this case. A person must review it.';
    else if (cur.safety_check !== 'PASS') blocked = 'This message failed a safety check.';
    else if (linkMissing) blocked = 'Paste the real resume link in the box at the top first. The message has a [resume link] placeholder.';
    else if (!approved[cur.application_id]) blocked = 'Tick the box to confirm you have read this message and approve it.';
    ok = !blocked;
    const enc = encodeURIComponent(msg);
    urls = {
      wa: `https://wa.me/?text=${enc}`,
      sms: `sms:?body=${enc}`,
      mail: `mailto:?subject=${encodeURIComponent('Your Razorpay application')}&body=${enc}`,
    };
  }
  const mark = (ch) => setOpened((o) => ({ ...o, [cur.application_id]: [...new Set([...(o[cur.application_id] || []), ch])] }));
  const SendBtn = ({ id, label, href, extraOff }) => (ok && !extraOff
    ? <a className={`send ${id}`} href={href} target="_blank" rel="noopener noreferrer" onClick={() => mark(label)}>{label}</a>
    : <span className="send off" aria-disabled="true" title={extraOff || blocked}>{label}</span>);

  return (
    <main>
      <header className="top">
        <div>
          <div className="badge">Razorpay Campus AI Build-a-thon · Problem 3 · synthetic data</div>
          <h1>Onboarding Recovery Agent</h1>
          <p className="sub">A tool for Razorpay&apos;s onboarding team. It finds out why merchant applications stalled, decides what can be recovered, and drafts a safe nudge in the applicant&apos;s own language. A person approves each message and presses send.</p>
        </div>
        <div className="aibox">
          <label className="lbl" htmlFor="link">Resume link to put in messages</label>
          <input id="link" type="text" placeholder="https://… (paste the real link)" value={link} onChange={(e) => setLink(e.target.value)} />
          <div className="note">The data pack has no real links, so messages carry a [resume link] placeholder until you paste one here.</div>
        </div>
      </header>

      <ol className="steps">
        {STEPS.map((s) => (
          <li key={s.n}><span className="num">{s.n}</span><div><b>{s.t}</b><span>{s.d}</span></div></li>
        ))}
      </ol>

      <section className="cards">
        <div className="card c-blue"><b>{stats.total}</b><span>stalled or rejected applications</span></div>
        <div className="card c-green"><b>{stats.recoverable}</b><span>recoverable · Rs {stats.tpv} lakh/month expected</span></div>
        <div className="card c-gray"><b>{stats.close}</b><span>close politely (restricted)</span></div>
        <div className="card c-purple"><b>{stats.compliance}</b><span>route to Compliance</span></div>
        <div className="card c-green"><b>{stats.pass}/{stats.total}</b><span>passed every safety check</span></div>
        <div className="card c-amber"><b>{stats.hold}</b><span>on hold for a human</span></div>
        <div className="card c-blue"><b>{stats.opened}</b><span>opened for sending this session</span></div>
      </section>

      <div className="bar">
        <div className="pills">
          {FILTERS.map(([k, l, n]) => (
            <button key={k} className={`pill ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{l} <i>{n}</i></button>
          ))}
          <select aria-label="Filter by reason code" value={codeFilter} onChange={(e) => setCodeFilter(e.target.value)}>
            <option value="ALL">All reason codes</option>
            {codeCounts.map(([c, n]) => <option key={c} value={c}>{c} · {CODE_LABELS[c] || c} ({n})</option>)}
          </select>
        </div>
        <div className="actions">
          <button onClick={run} disabled={busy}>{busy ? 'Running…' : 'Run agent again'}</button>
          <button className="alt" onClick={download} disabled={!results.length}>Download CSV</button>
        </div>
      </div>
      {error && <div className="err">{error}</div>}

      <section className="layout">
        <div className="list">
          {!loaded && !error && <div className="empty">Running the agent…</div>}
          {shown.map((r) => {
            const ri = routeInfo(r);
            const o = opened[r.application_id];
            return (
              <button key={r.application_id} className={`item ${selected === r.application_id ? 'sel' : ''}`} onClick={() => setSelected(r.application_id)}>
                <div className="l1"><b>{r.application_id}</b><span className="lang">{r.preferred_language}</span>{o && <span className="chip opened">Opened</span>}<span className={`chip ${r.send_status === 'HOLD' ? 'hold' : 'ready'}`}>{r.send_status === 'HOLD' ? 'On hold' : 'Ready'}</span></div>
                <div className="l2"><span className={`code ${ri.cls}`}>{r.reason_code}</span><span className="cause">{r.diagnosed_cause}</span></div>
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
                <div><span>Fixable / recoverable</span><b>{cur.fixable} / {cur.recoverable}</b></div>
                <div><span>Action</span><b className={`code-text ${routeInfo(cur).cls}`}>{routeInfo(cur).label}</b></div>
                <div><span>Channel</span><b>{optedIn ? 'WhatsApp (opted in), SMS fallback' : 'SMS / Email (not opted in to WhatsApp)'}</b></div>
                <div><span>Expected TPV · priority</span><b>Rs {cur.expected_tpv_lakh} lakh · {cur.priority_rank ? `#${cur.priority_rank}` : 'n/a'}</b></div>
                <div><span>Safety check</span><b className={cur.safety_check === 'PASS' ? 'pass' : 'fail'}>{cur.safety_check}</b></div>
                <div><span>Code source</span><b>{cur.code_source}</b></div>
              </div>
              {cur.hold_reasons && <div className="holdbox"><b>Held because:</b> {cur.hold_reasons}. Reading and approving the message below is the sign-off.</div>}
              <div className="msglabel">Drafted message ({optedIn ? 'WhatsApp' : 'SMS / email'} preview)</div>
              <div className={`bubble ${optedIn ? 'wa' : 'sms'}`}>{msg || '(no message: a human must review this case)'}</div>

              <label className="approve"><input type="checkbox" disabled={cur.reason_code === 'R12' || !cur.drafted_nudge} checked={!!approved[cur.application_id]} onChange={(e) => setApproved((a) => ({ ...a, [cur.application_id]: e.target.checked }))} /> I have read this message and approve sending it</label>
              <div className="sendrow">
                <SendBtn id="wa" label="WhatsApp" href={urls.wa} extraOff={!optedIn && cur.reason_code !== 'R12' ? 'This applicant has not opted in to WhatsApp. Use SMS or email.' : ''} />
                <SendBtn id="sms" label="SMS" href={urls.sms} />
                <SendBtn id="mail" label="Email" href={urls.mail} />
              </div>
              <div className="note sendnote">{blocked ? `Send buttons are off: ${blocked}` : 'Each button opens WhatsApp, your SMS app or your email app with this message filled in. You choose the recipient and press send there. The data pack has no phone numbers or email addresses, so nothing is sent automatically.'}</div>
              {opened[cur.application_id] && <div className="note">Opened for sending via: {opened[cur.application_id].join(', ')}</div>}
              <button className="alt" onClick={() => rerun(cur.application_id)} disabled={rerunning}>{rerunning ? 'Running…' : 'Re-run agent on this application'}</button>
            </>
          )}
        </aside>
      </section>

      <section className="demo">
        <h2>Try a reviewer note</h2>
        <p className="note">Paste a rejection note and see which reason code the rules pick. If nothing matches, or the code was inferred from free text, a person decides.</p>
        <div className="chips">{EXAMPLES.map((e) => <button key={e} className="pill" onClick={() => { setText(e); classify(e); }}>{e}</button>)}</div>
        <textarea placeholder="e.g. Doc blurred and cropped, cannot verify" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="row"><button onClick={() => classify()}>Classify</button></div>
        {classified && (
          <div className="result">
            <div><span>Rules</span><b>{classified.ruleCode ? `${classified.ruleCode}: ${classified.ruleReason}` : 'no match'}</b></div>
            <div><span>Verdict</span><b>{classified.verdict}</b></div>
          </div>
        )}
      </section>

      <footer className="note">Limits: no AI model is used in this app; every decision comes from rules you can read. [resume link] is a placeholder until you paste a link. Tamil, Kannada and Marathi wording needs a native-speaker review. 21 of 75 rows have inactivity days longer than days since signup (used as given). The email subject is the same English line for every language.</footer>
    </main>
  );
}
