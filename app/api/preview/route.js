import { NextResponse } from 'next/server';
import data from '../../../data/agentData.json';
import { runCore_ } from '../../../lib/agent.js';
import { prepareAi, blankCodeMessages } from '../../../lib/ai.js';

export const maxDuration = 30;

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const app = data.apps.find((a) => a.application_id === body.application_id);
  if (!app) return NextResponse.json({ error: 'Unknown application_id' }, { status: 404 });
  const one = { ...data, apps: [app] };
  const { aiFn, aiStatus } = await prepareAi(req, !!body.useAi, data, blankCodeMessages([app]));
  const [r] = runCore_(one, aiFn);
  if (!r) return NextResponse.json({ error: `${app.application_id} is already Activated. Nothing to do.` }, { status: 422 });
  const { _days, ...result } = r;
  return NextResponse.json({ result, aiStatus });
}
