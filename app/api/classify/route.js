import { NextResponse } from 'next/server';
import data from '../../../data/agentData.json';
import { classifyText_ } from '../../../lib/agent.js';
import { prepareAi } from '../../../lib/ai.js';

export const maxDuration = 30;

// Live demo: paste a reviewer note, see what the rules say and (optionally) what Gemini says.
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const text = String(body.text || '').trim().slice(0, 500);
  if (!text) return NextResponse.json({ error: 'Type or paste a reviewer note first.' }, { status: 400 });
  const ruleCode = classifyText_(text, data.kw);
  const cat = Object.fromEntries(data.catalog.map((r) => [r.code, r]));
  const { aiFn, aiStatus } = await prepareAi(req, !!body.useAi, data, [text]);
  const ai = aiFn ? aiFn(text) : null;
  let verdict = 'No rule matched. A human must decide.';
  if (ruleCode && ai?.code) verdict = ai.code === ruleCode ? 'Rules and Gemini agree.' : 'Rules and Gemini DISAGREE. A human must decide.';
  else if (ruleCode) verdict = 'Rules matched. Any inferred code is still confirmed by a human.';
  return NextResponse.json({
    ruleCode, ruleReason: ruleCode ? cat[ruleCode]?.reviewer_reason : null,
    ai, aiReason: ai?.code ? cat[ai.code]?.reviewer_reason ?? null : null, aiStatus, verdict,
  });
}
