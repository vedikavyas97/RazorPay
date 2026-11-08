import { NextResponse } from 'next/server';
import data from '../../../data/agentData.json';
import { runCore_ } from '../../../lib/agent.js';
import { normalizeNew } from '../../../lib/normalize.js';

// Rules only. No AI is called anywhere in this app.
// Optional body: { extra: [ ...new applications typed into the form ] }
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const n = normalizeNew(body.extra, data.catalog);
  if (n.error) return NextResponse.json({ error: n.error }, { status: 400 });
  const results = runCore_({ ...data, apps: [...data.apps, ...n.apps] }, null).map(({ _days, ...r }) => r);
  return NextResponse.json({ results, newIds: n.apps.map((a) => a.application_id) });
}
