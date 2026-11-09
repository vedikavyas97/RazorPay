// Agent core: the same tested logic that runs inside the Google Sheet (see the Apps Script version).
// Pure functions only. No network, no AI calls in here.



var SHEET = {
  apps: 'P3_Applications', catalog: 'P3_RejectionCatalog', templates: 'Templates',
  kw: 'Keyword_Rules', safety: 'Safety_Rules', config: 'Config', out: 'Final_Output', log: 'Run_Log'
};

var OUT_HEADERS = ['application_id', 'business_type', 'preferred_language', 'step_reached', 'expected_tpv_lakh',
  'priority_rank', 'reason_code', 'diagnosed_cause', 'fixable', 'recoverable', 'route', 'channel', 'drafted_nudge',
  'chars', 'safety_check', 'send_status', 'hold_reasons', 'code_source'];

// Outreach priority: judgment-call thresholds, NOT from the data pack. Score 0-8, see PRIORITY_RULES.
var PRIORITY = { HIGH_MIN: 6, MEDIUM_MIN: 4, DAYS_WARM: 14, DAYS_COOL: 30 };
var STAGE_PTS = { 'Business details': 0, 'KYC docs': 1, 'Bank verification': 2, 'Website/App review': 2 };

var SCRIPT_RANGES = { Tamil: [0x0B80, 0x0BFF], Kannada: [0x0C80, 0x0CFF], Hindi: [0x0900, 0x097F], Marathi: [0x0900, 0x097F] };

/* ------------------------------------------------------------------ */
/* CORE LOGIC (no Google services used here, so it can be tested alone) */
/* ------------------------------------------------------------------ */

function str_(v) { return (v === null || v === undefined) ? '' : String(v).trim(); }

function buildTemplateMap_(rows) {
  var map = {};
  rows.forEach(function (r) {
    var k = str_(r.key), l = str_(r.language);
    if (!map[k]) map[k] = {};
    map[k][l] = String(r.text);
  });
  return map;
}

function tpl_(T, key, lang) {
  if (!T[key] || T[key][lang] === undefined) throw new Error('Missing template: ' + key + ' / ' + lang);
  return T[key][lang];
}

function classifyText_(msg, kwRules) {
  var rules = kwRules.slice().sort(function (a, b) { return Number(a.order) - Number(b.order); });
  for (var i = 0; i < rules.length; i++) {
    if (new RegExp(rules[i].pattern, 'i').test(msg)) return str_(rules[i].code);
  }
  return null;
}

function composeMessage_(app, code, ctx) {
  var lang = str_(app.preferred_language);
  var T = ctx.T;
  var body = tpl_(T, 'body:' + code, lang);
  if (code === 'R10' || code === 'R12') return body;
  if (code === 'R13') {
    body = body.split('{step}').join(tpl_(T, 'step:' + str_(app.step_reached), lang));
    return [tpl_(T, 'greeting', lang), body, tpl_(T, 'link_line', lang)].join('\n\n');
  }
  var d = Number(ctx.catalog[code].typical_days_to_fix);
  var time = tpl_(T, d === 1 ? 'time_one' : 'time_many', lang).split('{days}').join(String(d));
  return [tpl_(T, 'greeting', lang), body + ' ' + time, tpl_(T, 'link_line', lang)].join('\n\n');
}

function scriptShare_(text, lang) {
  var letters = text.match(/\p{L}/gu) || [];
  if (!letters.length) return 0;
  var n = 0, i, cp;
  if (SCRIPT_RANGES[lang]) {
    var lo = SCRIPT_RANGES[lang][0], hi = SCRIPT_RANGES[lang][1];
    for (i = 0; i < letters.length; i++) { cp = letters[i].codePointAt(0); if (cp >= lo && cp <= hi) n++; }
  } else {
    for (i = 0; i < letters.length; i++) { cp = letters[i].codePointAt(0); if (cp < 0x250) n++; }
  }
  return n / letters.length;
}

function appliesTo_(appliesTo, code) {
  var parts = str_(appliesTo).split(',').map(function (s) { return s.trim(); });
  if (parts.indexOf('ALL') >= 0) return true;
  if (parts.indexOf('FIX') >= 0 && code !== 'R10' && code !== 'R12') return true;
  return parts.indexOf(code) >= 0;
}

function checkMessage_(msg, code, app, channel, safetyRules) {
  var fails = [];
  safetyRules.forEach(function (r) {
    if (!appliesTo_(r.applies_to, code)) return;
    var hit = new RegExp(r.pattern, 'i').test(msg);
    if ((str_(r.type) === 'forbid' && hit) || (str_(r.type) === 'require' && !hit)) fails.push(str_(r.fail_message));
  });
  var lang = str_(app.preferred_language), share = scriptShare_(msg, lang);
  if (SCRIPT_RANGES[lang] && share < 0.6) fails.push('wrong script for language');
  if (!SCRIPT_RANGES[lang] && share < 0.98) fails.push('non-Latin text in English/Hinglish message');
  if (channel.indexOf('WhatsApp') === 0 && str_(app.whatsapp_opted_in) !== 'Yes') fails.push('WhatsApp without opt-in');
  return fails;
}

function subjectKey_(code) {
  if (code === 'R10' || code === 'R12') return 'subject:update';
  return code === 'R13' ? 'subject:resume' : 'subject:fix';
}

function checkSubject_(subject, code, app) {
  var fails = [];
  var lang = str_(app.preferred_language), share = scriptShare_(subject, lang);
  if (SCRIPT_RANGES[lang] && share < 0.3) fails.push('subject: wrong script for language'); // lower bar: the word Razorpay is Latin and subjects are short
  if (!SCRIPT_RANGES[lang] && share < 0.98) fails.push('subject: non-Latin text in English/Hinglish');
  if ((code === 'R10' || code === 'R12') && /sanction|screening|compliance|watch ?list|negative list|black ?list|risk|reject|clos/i.test(subject)) fails.push('subject: reveals reason');
  if (/guarantee|approved|activated|within \d/i.test(subject)) fails.push('subject: promise wording');
  return fails;
}

function recommendedAction_(code, c, app) {
  if (code === 'R10') return 'Close the application with a neutral message. Do not suggest workarounds, other documents or another category.';
  if (code === 'R12') return 'Route to the Compliance team. Do not tell the merchant why. Only a generic "under review" message, after Compliance sign-off.';
  if (code === 'R13') return 'Remind the merchant to finish the step they stopped at ("' + str_(app.step_reached) + '") using the resume link.';
  return str_(c.standard_fix);
}

/**
 * Diagnose one application and draft its message.
 * ctx = { catalog (by code), T, kw, safety, nativeLangs, aiFn (optional) }
 * Returns an object with the output columns, or null if the application is Activated.
 * aiFn is an optional LLM hook (see lib/llm.js). It is only asked about reviewer notes no rule matched,
 * and anything it returns is Low confidence and always goes to a human.
 */
function diagnoseOne_(app, ctx) {
  if (str_(app.application_status) === 'Activated') return null;
  var given = str_(app.rejection_code), msgText = str_(app.rejection_message);
  var code, src, confidence;

  if (given) {
    code = given; src = 'Given in data'; confidence = 'High';
  } else if (msgText) {
    src = 'Inferred from reviewer text';
    code = classifyText_(msgText, ctx.kw);
    confidence = code ? 'Medium' : 'Low';
    if (!code && ctx.aiFn) {
      var ai = ctx.aiFn(msgText);
      if (ai && ai.code && ctx.catalog[ai.code]) { code = ai.code; src = 'Suggested by AI (no rule matched)'; confidence = 'Low'; }
    }
  } else {
    code = 'R13'; src = 'No rejection: abandoned'; confidence = 'High';
  }

  var out = {
    application_id: app.application_id, business_type: app.business_type, preferred_language: app.preferred_language,
    step_reached: app.step_reached, application_status: str_(app.application_status),
    expected_tpv_lakh: Number(app.expected_monthly_tpv_inr_lakh),
    days_inactive: Number(app.days_since_last_activity), rejection_code_in_data: given, reviewer_text: msgText,
    priority_rank: '', code_source: src, confidence: confidence,
    _days: Number(app.days_since_last_activity)
  };
  var channel = str_(app.whatsapp_opted_in) === 'Yes' ? 'WhatsApp (opted in), SMS fallback' : 'SMS / Email (not opted in to WhatsApp)';
  out.channel = channel;
  var reviews = [];
  function finish_() {
    out.reviews = reviews;
    out.hold_reasons = reviews.map(function (r) { return r.type; }).join('; ');
    out.needs_human_review = reviews.length ? 'Yes' : 'No';
    out.send_status = reviews.length ? 'HOLD' : 'READY after spot check';
    return out;
  }

  if (!code || !ctx.catalog[code]) {
    out.reason_code = 'UNKNOWN'; out.diagnosed_cause = 'Reason could not be identified'; out.cause_label = 'Reason could not be identified';
    out.fixable = 'Unknown'; out.recoverable = 'Unknown'; out.route = 'Human review';
    out.escalation = 'None (human review first)';
    out.recommended_action = 'Human review: the reviewer note did not match any known reason. No message is drafted and no reason is claimed.';
    out.standard_fix = ''; out.email_subject = '';
    out.drafted_nudge = ''; out.chars = 0; out.safety_check = 'N/A'; out.confidence = 'Low';
    reviews.push({ type: 'Low-confidence diagnosis', why: 'No rule matched, so no reason is claimed and no message is drafted.' });
    reviews.push({ type: 'Blank or ambiguous reviewer comment', why: 'Rejection code is blank and the reviewer text could not be mapped: "' + msgText + '".' });
    return finish_();
  }

  var c = ctx.catalog[code];
  var fixable = str_(c.fixable) === 'Needs compliance review' ? 'Compliance review' : str_(c.fixable);
  out.reason_code = code;
  out.cause_label = code === 'R13' ? 'Abandoned application (no rejection recorded)' : str_(c.reviewer_reason);
  out.diagnosed_cause = code === 'R13' ? 'Abandoned application: stopped at "' + str_(app.step_reached) + '"' : str_(c.reviewer_reason);
  out.fixable = fixable;
  out.recoverable = fixable === 'Yes' ? 'Yes' : 'No';
  out.route = code === 'R10' ? 'Close politely' : (code === 'R12' ? 'Compliance team' : 'Nudge merchant');
  out.escalation = code === 'R12' ? 'Compliance escalation' : (code === 'R10' ? 'Closure' : 'None');
  out.standard_fix = str_(c.standard_fix);
  out.recommended_action = recommendedAction_(code, c, app);
  out.drafted_nudge = composeMessage_(app, code, ctx);
  out.chars = out.drafted_nudge.length;
  out.email_subject = tpl_(ctx.T, subjectKey_(code), str_(app.preferred_language));

  var fails = checkMessage_(out.drafted_nudge, code, app, channel, ctx.safety).concat(checkSubject_(out.email_subject, code, app));
  out.safety_check = fails.length ? 'FAIL: ' + fails.join('; ') : 'PASS';

  if (code === 'R12') reviews.push({ type: 'Compliance escalation', why: 'Screening case (R12). Compliance decides what, if anything, is sent. The merchant is never told the reason.' });
  if (code === 'R10') reviews.push({ type: 'Closure sign-off', why: 'Restricted category (R10). A person confirms the closure before anything is sent.' });
  if (src.indexOf('Inferred') === 0 || src.indexOf('Suggested') === 0) {
    reviews.push({ type: 'Blank or ambiguous reviewer comment', why: 'Rejection code is blank. The reason (' + code + ') was inferred from the reviewer text "' + msgText + '". Confirm before sending.' });
  }
  if (confidence === 'Low') reviews.push({ type: 'Low-confidence diagnosis', why: 'Suggested by an AI model, not matched by a rule.' });
  if (ctx.nativeLangs.indexOf(str_(app.preferred_language)) >= 0) {
    reviews.push({ type: 'Language review', why: str_(app.preferred_language) + ' wording has not been checked by a native speaker.' });
  }
  if (fails.length) reviews.push({ type: 'Safety check failed', why: fails.join('; ') });
  return finish_();
}

/** Priority for one application. Returns { tier, score, reason }. */
function prioritise_(r, cut) {
  var blocked = null;
  if (r.reason_code === 'R10') blocked = 'Restricted category: closure only, never in the outreach queue.';
  else if (r.reason_code === 'R12') blocked = 'Compliance case: handled by the Compliance team, never in the outreach queue.';
  else if (r.reason_code === 'UNKNOWN') blocked = 'Reason not identified: a person reviews it before any outreach.';
  else if (r.recoverable !== 'Yes') blocked = 'Not recoverable: no outreach.';
  if (blocked) return { tier: 'Not in outreach queue', score: '', reason: blocked };
  var tp = r.expected_tpv_lakh >= cut.hi ? 2 : (r.expected_tpv_lakh >= cut.lo ? 1 : 0);
  var rp = r._days <= PRIORITY.DAYS_WARM ? 2 : (r._days <= PRIORITY.DAYS_COOL ? 1 : 0);
  var fp = r.reason_code === 'R13' ? 1 : 2;
  var sp = STAGE_PTS[r.step_reached] === undefined ? 0 : STAGE_PTS[r.step_reached];
  var score = tp + rp + fp + sp;
  var reason = 'Expected TPV Rs ' + r.expected_tpv_lakh + ' lakh (' + (tp === 2 ? 'top third' : tp === 1 ? 'middle third' : 'bottom third') + ') +' + tp +
    '; ' + r._days + ' days inactive (' + (rp === 2 ? 'recent' : rp === 1 ? 'cooling' : 'cold') + ') +' + rp +
    '; ' + (r.reason_code === 'R13' ? 'no blocking issue recorded, just resume' : 'specific fixable issue (' + r.reason_code + ')') + ' +' + fp +
    '; stopped at ' + r.step_reached + ' +' + sp + ' = ' + score + '/8';
  var tier = score >= PRIORITY.HIGH_MIN ? 'High' : (score >= PRIORITY.MEDIUM_MIN ? 'Medium' : 'Low');
  return { tier: tier, score: score, reason: reason + ' → ' + tier };
}

/** Runs the whole pipeline. Returns an array of output objects (priority filled in). */
function runCore_(data, aiFn) {
  var catalog = {};
  data.catalog.forEach(function (r) { catalog[str_(r.code)] = r; });
  var ctx = {
    catalog: catalog, T: buildTemplateMap_(data.templates), kw: data.kw, safety: data.safety,
    nativeLangs: str_(data.config.NATIVE_REVIEW_LANGUAGES).split(',').map(function (s) { return s.trim(); }),
    aiFn: aiFn || null
  };
  var results = [];
  data.apps.forEach(function (app) {
    if (!str_(app.application_id)) return;
    var r = diagnoseOne_(app, ctx);
    if (r) results.push(r);
  });
  // TPV thirds among the cases that can enter the outreach queue (data-derived cut points)
  var elig = results.filter(function (r) { return r.recoverable === 'Yes' && r.reason_code !== 'R10' && r.reason_code !== 'R12'; });
  var tpvs = elig.map(function (r) { return r.expected_tpv_lakh; }).sort(function (a, b) { return b - a; });
  var n = tpvs.length;
  var cut = { hi: n ? tpvs[Math.ceil(n / 3) - 1] : 0, lo: n ? tpvs[Math.ceil(2 * n / 3) - 1] : 0 };
  results.forEach(function (r) {
    var p = prioritise_(r, cut);
    r.priority = p.tier; r.priority_score = p.score; r.priority_reason = p.reason;
  });
  var queue = results.filter(function (r) { return r.priority !== 'Not in outreach queue'; });
  queue.sort(function (a, b) {
    if (b.priority_score !== a.priority_score) return b.priority_score - a.priority_score;
    if (b.expected_tpv_lakh !== a.expected_tpv_lakh) return b.expected_tpv_lakh - a.expected_tpv_lakh;
    if (a._days !== b._days) return a._days - b._days;
    return a.application_id < b.application_id ? -1 : 1;
  });
  queue.forEach(function (r, i) { r.priority_rank = i + 1; });
  return results;
}

/** Counts of Activated applications in the input (they are not processed). */
function countActivated_(apps) {
  return apps.filter(function (a) { return str_(a.application_status) === 'Activated'; }).length;
}

export { runCore_, diagnoseOne_, buildTemplateMap_, classifyText_, checkMessage_, checkSubject_, countActivated_, OUT_HEADERS, PRIORITY };
