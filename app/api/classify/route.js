import { NextResponse } from 'next/server';
import data from '../../../data/agentData.json';
import { classifyText_ } from '../../../lib/agent.js';

// Demo: paste a reviewer note and see which reason code the keyword rules pick.
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const text = String(body.text || '').trim().slice(0, 500);
  if (!text) return NextResponse.json({ error: 'Type or paste a reviewer note first.' }, { status: 400 });
  const ruleCode = classifyText_(text, data.kw);
  const cat = Object.fromEntries(data.catalog.map((r) => [r.code, r]));
  return NextResponse.json({
    ruleCode,
    ruleReason: ruleCode ? cat[ruleCode]?.reviewer_reason : null,
    verdict: ruleCode ? 'Rules matched. A person still confirms any code that was inferred from free text.' : 'No rule matched. A person must decide.',
  });
}
