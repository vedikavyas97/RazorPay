'use client';

import { useEffect, useMemo, useState, Fragment } from 'react';

const CSV_HEADERS = ['application_id', 'business_type', 'preferred_language', 'step_reached', 'expected_tpv_lakh', 'priority_rank',
  'reason_code', 'diagnosed_cause', 'fixable', 'recoverable', 'route', 'channel', 'drafted_nudge', 'chars', 'safety_check',
  'send_status', 'hold_reasons', 'code_source', 'ai_second_opinion'];

function toCsv(rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return '﻿' + [CSV_HEADERS.join(','), ...rows.map((r) => CSV_HEADERS.map((h) => esc(r[h])).join(','))].join('\r\n');
}

export default function Home() {
  const [results, setResults] = useState([]);
  const [aiStatus, setAiStatus] = useState('');
  const [useAi, setUseAi] = useState(false);
  const [demoCode, setDemoCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [open, setOpen] = useState(null);
  const [previewId, setPreviewId] = useState('');
  const [preview, setPreview] = useState(null);
  const [text, setText] = useState('');
  const [classified, setClassified] = useState(null);

  const headers = () => ({ 'Content-Type': 'application/json', 'x-demo-code': demoCode });

  async function post(url, body) {
    const res = await fetch(url, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
    return json;
  }

  async function run() {
    setBusy(true); setError('');
    try {
      const j = await post('/api/run', { useAi });
      setResults(j.results); setAiStatus(j.aiStatus);
      if (!previewId && j.results.length) setPreviewId(j.results[0].application_id);
    } catch (e) { setError(String(e.message || e)); }
    setBusy(false);
  }

  useEffect(() => { run(); /* first load: rules only, instant */ }, []); // eslint-disable-line

  async function runPreview() {
    setError(''); setPreview(null);
    try { setPreview(await post('/api/preview', { application_id: previewId, useAi })); } catch (e) { setError(String(e.message || e)); }
  }
  async function runClassify() {
    setError(''); setClassified(null);
    try { setClassified(await post('/api/classify', { text, useAi })); } catch (e) { setError(String(e.message || e)); }
  }
  function download() {
    const blob = new Blob([toCsv(results)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'onboarding_agent_output.csv'; a.click();
  }

  const stats = useMemo(() => {
    const rec = results.filter((r) => r.recoverable === 'Yes');
    const sum = (rs) => rs.reduce((s, r) => s + (Number(r.expected_tpv_lakh) || 0), 0);
    return {
      total: results.length, recoverable: rec.length, tpv: sum(rec).toFixed(1),
      close: results.filter((r) => r.reason_code === 'R10').length, compliance: results.filter((r) => r.reason_code === 'R12').length,
      pass: results.filter((r) => r.safety_check === 'PASS').length, hold: results.filter((r) => r.send_status === 'HOLD').length,
    };
  }, [results]);

  const shown = results.filter((r) => filter === 'ALL' || (filter === 'HOLD' ? r.send_status === 'HOLD' : filter === 'READY' ? r.send_status !== 'HOLD' : r.recoverable === filter));

  return (
    <main>
      <h1>Onboarding Recovery Agent</h1>
      <p className="sub">Razorpay Campus AI Build-a-thon, Problem 3. Synthetic data only. Diagnoses stalled merchant applications and drafts safe nudges in the applicant&apos;s language. Nothing is sent: every draft needs a human.</p>

      <div className="cards">
        <div className="card"><b>{stats.total}</b><span>stalled or rejected applications</span></div>
        <div className="card"><b>{stats.recoverable}</b><span>recoverable (Rs {stats.tpv} lakh/month expected)</span></div>
        <div className="card"><b>{stats.close}</b><span>close politely (restricted)</span></div>
        <div className="card"><b>{stats.compliance}</b><span>route to Compliance</span></div>
        <div className="card"><b>{stats.pass}/{stats.total}</b><span>passed all safety checks</span></div>
        <div className="card"><b>{stats.hold}</b><span>on hold for a human</span></div>
      </div>

      <div className="panel">
        <div className="row">
          <button onClick={run} disabled={busy}>{busy ? 'Running…' : 'Run agent on all applications'}</button>
          <label><input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} /> Gemini second opinion on blank-code cases</label>
          <input type="text" placeholder="demo code (if set)" value={demoCode} onChange={(e) => setDemoCode(e.target.value)} />
          <button className="alt" onClick={download} disabled={!results.length}>Download CSV</button>
        </div>
        <div className="note">AI status: {aiStatus || '…'}. Rules decide the code; Gemini can only add a cross-check, and any disagreement puts the case on hold.</div>
        {error && <div className="err">{error}</div>}
      </div>

      <h2>Results</h2>
      <div className="row">
        <span className="note">Show:</span>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="ALL">All</option><option value="READY">Ready after spot check</option><option value="HOLD">On hold</option>
          <option value="Yes">Recoverable</option><option value="No">Not recoverable</option>
        </select>
        <span className="note">Click a row to read the drafted message.</span>
      </div>
      <div className="wrap">
        <table>
          <thead><tr><th>ID</th><th>Language</th><th>Code</th><th>Cause</th><th>Route</th><th>Channel</th><th>Safety</th><th>Status</th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <Fragment key={r.application_id}>
                <tr className="click" onClick={() => setOpen(open === r.application_id ? null : r.application_id)}>
                  <td>{r.application_id}</td><td>{r.preferred_language}</td><td>{r.reason_code}</td><td>{r.diagnosed_cause}</td>
                  <td>{r.route}</td><td>{r.channel.startsWith('WhatsApp') ? 'WhatsApp' : 'SMS / Email'}</td>
                  <td className={r.safety_check === 'PASS' ? 'PASS' : 'FAIL'}>{r.safety_check}</td>
                  <td><span className={`tag ${r.send_status === 'HOLD' ? 'HOLD' : 'READY'}`}>{r.send_status === 'HOLD' ? 'HOLD' : 'READY'}</span></td>
                </tr>
                {open === r.application_id && (
                  <tr className="detail"><td colSpan={8}>
                    <div className="note">Code source: {r.code_source} · AI second opinion: {r.ai_second_opinion} · Fixable: {r.fixable} · Priority rank: {r.priority_rank || '-'} · Expected TPV: Rs {r.expected_tpv_lakh} lakh{r.hold_reasons ? ` · Hold: ${r.hold_reasons}` : ''}</div>
                    <pre className="msg">{r.drafted_nudge || '(no message: human review)'}</pre>
                  </td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Try one application</h2>
      <div className="panel">
        <div className="row">
          <select value={previewId} onChange={(e) => setPreviewId(e.target.value)}>
            {results.map((r) => <option key={r.application_id} value={r.application_id}>{r.application_id} ({r.preferred_language})</option>)}
          </select>
          <button onClick={runPreview}>Run agent on this application</button>
        </div>
        {preview?.result && (
          <div>
            <div className="note">{preview.result.reason_code}: {preview.result.diagnosed_cause} · {preview.result.route} · {preview.result.channel} · Safety: {preview.result.safety_check} · {preview.result.send_status}{preview.result.hold_reasons ? ` (${preview.result.hold_reasons})` : ''} · AI: {preview.result.ai_second_opinion}</div>
            <pre className="msg">{preview.result.drafted_nudge || '(no message: human review)'}</pre>
          </div>
        )}
      </div>

      <h2>Try a reviewer note</h2>
      <div className="panel">
        <textarea placeholder="Paste a reviewer note, e.g. Doc blurred and cropped, cannot verify" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="row" style={{ marginTop: 8 }}><button onClick={runClassify}>Classify</button><span className="note">Uses the Gemini checkbox above if enabled.</span></div>
        {classified && (
          <div>
            <div><b>Rules:</b> {classified.ruleCode ? `${classified.ruleCode} (${classified.ruleReason})` : 'no match'}</div>
            <div><b>Gemini:</b> {classified.ai?.code ? `${classified.ai.code} (${classified.aiReason ?? 'unknown code'})` : classified.ai?.error ? `error: ${classified.ai.error}` : `not used. ${classified.aiStatus}`}</div>
            <div><b>Verdict:</b> {classified.verdict}</div>
          </div>
        )}
      </div>

      <p className="note" style={{ marginTop: 28 }}>Limits: [resume link] is a placeholder; Tamil, Kannada and Marathi wording needs a native-speaker review; 21 of 75 rows have inactivity days longer than days since signup (used as given).</p>
    </main>
  );
}
