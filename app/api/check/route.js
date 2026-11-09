import { NextResponse } from 'next/server';
import data from '../../../data/agentData.json';
import { checkMessage_, checkSubject_ } from '../../../lib/agent.js';

// Re-runs the safety checks on a message a reviewer edited. Approval never bypasses these.
export async function POST(req) {
  const b = await req.json().catch(() => ({}));
  const code = String(b.reason_code || '');
  const message = String(b.message || '');
  const subject = String(b.subject || '');
  if (code === 'R12') return NextResponse.json({ error: 'Compliance cases cannot be edited or sent from this app.' }, { status: 422 });
  if (!data.catalog.some((c) => c.code === code)) return NextResponse.json({ error: 'No message can be edited for this case.' }, { status: 422 });
  if (!message.trim() || message.length > 1500) return NextResponse.json({ error: 'The message must be between 1 and 1500 characters.' }, { status: 400 });
  const channel = String(b.channel || '');
  const app = { preferred_language: String(b.preferred_language || ''), whatsapp_opted_in: channel.startsWith('WhatsApp') ? 'Yes' : 'No' };
  const fails = checkMessage_(message, code, app, channel, data.safety).concat(subject ? checkSubject_(subject, code, app) : []);
  return NextResponse.json({ fails, pass: fails.length === 0 });
}
