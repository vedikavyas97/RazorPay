import { NextResponse } from 'next/server';
import data from '../../../data/agentData.json';
import { runCore_ } from '../../../lib/agent.js';
import { prepareAi, blankCodeMessages } from '../../../lib/ai.js';

export const maxDuration = 30;

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const { aiFn, aiStatus } = await prepareAi(req, !!body.useAi, data, blankCodeMessages(data.apps));
  const results = runCore_(data, aiFn).map(({ _days, ...r }) => r);
  return NextResponse.json({ results, aiStatus });
}
