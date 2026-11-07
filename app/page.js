'use client';

import { useEffect, useMemo, useState } from 'react';

const CSV_HEADERS = ['application_id', 'business_type', 'preferred_language', 'step_reached', 'expected_tpv_lakh', 'priority_rank',
  'reason_code', 'diagnosed_cause', 'fixable', 'recoverable', 'route', 'channel', 'drafted_nudge', 'chars', 'safety_check',
  'send_status', 'hold_reasons', 'code_source', 'ai_second_opinion'];

const STEPS = [
  { n: 1, t: 'Read', d: 'Takes each stalled or rejected application from the data pack.' },
  { n: 2, t: 'Diagnose', d: 'Rules find the cause. Blank codes are read from the reviewer text.' },
  { n: 3, t: 'Draft', d: 'Picks a fixed template in the applicant’s language and channel.' },
  { n: 4, t: 'Check & hold', d: 'Safety checks run. Risky cases wait for a human. Nothing is sent.' },
];

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
  const [aiStatus, setAiStatus] = useState('');
  const [useAi, setUseAi] = useState(false);
  const [demoCode, setDemoCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [selected, setSelected] = useState(null);
  const [rerunning, setRerunning] = useState(false);
  const [text, setText] = useState('');
  const [classified, setClassified] = useState(null);

  async function post(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-demo-code': demoCode },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
    return json;
  }

  async function run() {
    setBusy(true); setError('');
    try {
      const j = await post('/api/run', { useAi });
      setResults(j.results); setAiStatus(j.aiStatus); setLoaded(true);
      setSelected((s) => s || (j.results[0] && j.results[0].application_id) || null);
    } catch (e) { setError(String(e.message || e)); }
    setBusy(false);
  }

  useEffect(() => { run(); }, []); // eslint-disable-line

  async function rerun(id) {
    setRerunning(true); setError('');
    try {
      const j = await post('/api/preview', { application_id: id, useAi });
      setResults((rs) => rs.map((r) => (r.application_id === id ? { ...j.result, priority_rank: r.priority_rank } : r)));
      setAiStatus(j.aiStatus);
    } catch (e) { setError(String(e.message || e)); }
    setRerunning(false);
  }

  async function classify(t) {
    const value = (t ?? text).trim();
    setError(''); setClassified(null);
    try { setClassified(await post('/api/classify', { text: value, useAi })); } catch (e) { setError(String(e.message || e)); }
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
    };
  }, [results]);

  const FILTERS = [
    ['ALL', 'All', results.length],
    ['READY', 'Ready', results.filter((r) => r.send_status !== 'HOLD').length],
    ['HOLD', 'On hold', stats.hold],
    ['Yes', 'Recoverable', stats.recoverable],
    ['No', 'Not recoverable', results.filter((r) => r.recoverable !== 'Yes').length],
  ];
  const shown = results.filter((r) => filter === 'ALL' || (filter === 'HOLD' ? r.send_status === 'HOLD' : filter === 'READY' ? r.send_status !== 'HOLD' : r.recoverable === filter));
  const cur = results.find((r) => r.application_id === selected) || null;
  const wa = cur && cur.channel.startsWith('WhatsApp');

  return (
    <main>
      <header className="top">
        <div>
          <div className="badge">Razorpay Campus AI Build-a-thon · Problem 3 · synthetic data</div>
          <h1>Onboarding Recovery Agent</h1>
          <p className="sub">Finds out why merchant applications stalled, decides what can be recovered, and drafts a safe nudge in the applicant&apos;s own language. It never sends anything: a human approves every message.</p>
        </div>
        <div className="aibox">
          <label className="check"><input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} /> Gemini cross-check on blank-code cases</label>
          <input type="text" placeholder="demo code (if one is set)" value={demoCode} onChange={(e) => setDemoCode(e.target.value)} />
          <div className="note">{aiStatus || 'Loading…'}</div>
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
      </section>

      <div className="bar">
        <div className="pills">
          {FILTERS.map(([k, l, n]) => (
            <button key={k} className={`pill ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{l} <i>{n}</i></button>
          ))}
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
            return (
              <button key={r.application_id} className={`item ${selected === r.application_id ? 'sel' : ''}`} onClick={() => setSelected(r.application_id)}>
                <div className="l1"><b>{r.application_id}</b><span className="lang">{r.preferred_language}</span><span className={`chip ${r.send_status === 'HOLD' ? 'hold' : 'ready'}`}>{r.send_status === 'HOLD' ? 'On hold' : 'Ready'}</span></div>
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
                <div><span>Channel</span><b>{wa ? 'WhatsApp (opted in), SMS fallback' : 'SMS / Email (not opted in to WhatsApp)'}</b></div>
                <div><span>Expected TPV · priority</span><b>Rs {cur.expected_tpv_lakh} lakh · {cur.priority_rank ? `#${cur.priority_rank}` : 'n/a'}</b></div>
                <div><span>Safety check</span><b className={cur.safety_check === 'PASS' ? 'pass' : 'fail'}>{cur.safety_check}</b></div>
                <div><span>Code source</span><b>{cur.code_source}</b></div>
                <div><span>Gemini second opinion</span><b>{cur.ai_second_opinion}</b></div>
              </div>
              {cur.hold_reasons && <div className="holdbox"><b>Held because:</b> {cur.hold_reasons}</div>}
              <div className="msglabel">Drafted message ({wa ? 'WhatsApp' : 'SMS / email'} preview, not sent)</div>
              <div className={`bubble ${wa ? 'wa' : 'sms'}`}>{cur.drafted_nudge || '(no message: a human must review this case)'}</div>
              <button className="alt" onClick={() => rerun(cur.application_id)} disabled={rerunning}>{rerunning ? 'Running…' : 'Re-run agent on this application'}</button>
            </>
          )}
        </aside>
      </section>

      <section className="demo">
        <h2>Try a reviewer note</h2>
        <p className="note">Paste a rejection note and see what the rules decide. With the Gemini box ticked, Gemini gives a second opinion. A disagreement or no match always goes to a human.</p>
        <div className="chips">{EXAMPLES.map((e) => <button key={e} className="pill" onClick={() => { setText(e); classify(e); }}>{e}</button>)}</div>
        <textarea placeholder="e.g. Doc blurred and cropped, cannot verify" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="row"><button onClick={() => classify()}>Classify</button></div>
        {classified && (
          <div className="result">
            <div><span>Rules</span><b>{classified.ruleCode ? `${classified.ruleCode}: ${classified.ruleReason}` : 'no match'}</b></div>
            <div><span>Gemini</span><b>{classified.ai && classified.ai.code ? `${classified.ai.code}: ${classified.aiReason || 'unknown code'}` : classified.ai && classified.ai.error ? `error: ${classified.ai.error}` : `not used. ${classified.aiStatus}`}</b></div>
            <div><span>Verdict</span><b>{classified.verdict}</b></div>
          </div>
        )}
      </section>

      <footer className="note">Limits: [resume link] is a placeholder. Tamil, Kannada and Marathi wording needs a native-speaker review. 21 of 75 rows have inactivity days longer than days since signup (used as given). Gemini only cross-checks; the rules decide.</footer>
    </main>
  );
}
