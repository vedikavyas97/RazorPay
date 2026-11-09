import { NextResponse } from 'next/server';
import data from '../../../data/agentData.json';
import { runCore_, countActivated_ } from '../../../lib/agent.js';
import { normalizeNew } from '../../../lib/normalize.js';
import { getLlm } from '../../../lib/llm.js';

// Rules only: getLlm() returns null because no AI model is connected.
// Optional body: { extra: [ ...new applications typed into the form ] }
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const n = normalizeNew(body.extra, data.catalog);
  if (n.error) return NextResponse.json({ error: n.error }, { status: 400 });
  const apps = [...data.apps, ...n.apps];
  const llm = getLlm();
  const results = runCore_({ ...data, apps }, llm ? llm.interpretReviewerNote : null).map(({ _days, ...r }) => r);
  return NextResponse.json({ results, activated: countActivated_(apps), newIds: n.apps.map((a) => a.application_id), aiConnected: !!llm });
}
