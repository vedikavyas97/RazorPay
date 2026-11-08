import { NextResponse } from 'next/server';
import data from '../../../data/agentData.json';
import { runCore_ } from '../../../lib/agent.js';

// Rules only. No AI is called anywhere in this app.
export async function POST() {
  const results = runCore_(data, null).map(({ _days, ...r }) => r);
  return NextResponse.json({ results });
}
