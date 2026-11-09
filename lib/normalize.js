// Validates applications typed into the form. Returns { apps } or { error }.
export const LANGUAGES = ['English', 'Hinglish', 'Hindi', 'Tamil', 'Kannada', 'Marathi'];
export const STEPS = ['Business details', 'KYC docs', 'Bank verification', 'Website/App review'];
export const MAX_NEW = 50;

export function normalizeNew(list, catalog) {
  if (list === undefined || list === null) return { apps: [] };
  if (!Array.isArray(list)) return { error: 'New applications must be a list.' };
  if (list.length > MAX_NEW) return { error: `At most ${MAX_NEW} new applications per session.` };
  const codes = new Set(catalog.map((c) => c.code));
  const apps = [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i] || {};
    const tag = `New application ${i + 1}`;
    const biz = String(a.business_type || '').trim().slice(0, 60);
    if (!biz) return { error: `${tag}: business type is required.` };
    if (!LANGUAGES.includes(a.preferred_language)) return { error: `${tag}: choose a language from the list.` };
    if (!STEPS.includes(a.step_reached)) return { error: `${tag}: choose the step where the applicant stopped.` };
    const tpv = Number(a.expected_monthly_tpv_inr_lakh);
    if (!Number.isFinite(tpv) || tpv < 0 || tpv > 100000) return { error: `${tag}: expected monthly volume is in Rs lakh (Rs 5 lakh = 5) and must be between 0 and 100000. You entered ${a.expected_monthly_tpv_inr_lakh}.` };
    const days = Number(a.days_since_last_activity);
    if (!Number.isFinite(days) || days < 0 || days > 3650) return { error: `${tag}: days inactive must be a number from 0 up.` };
    const code = String(a.rejection_code || '').trim();
    if (code && !codes.has(code)) return { error: `${tag}: unknown rejection code.` };
    const message = String(a.rejection_message || '').trim().slice(0, 500);
    apps.push({
      application_id: `NEW-${String(i + 1).padStart(3, '0')}`,
      business_type: biz,
      preferred_language: a.preferred_language,
      step_reached: a.step_reached,
      application_status: code || message ? 'Rejected' : 'Stalled',
      days_since_last_activity: Math.round(days),
      expected_monthly_tpv_inr_lakh: tpv,
      whatsapp_opted_in: a.whatsapp_opted_in === true || a.whatsapp_opted_in === 'Yes' ? 'Yes' : 'No',
      rejection_code: code,
      rejection_message: message,
    });
  }
  return { apps };
}
