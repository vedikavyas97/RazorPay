// Agent core: the same tested logic that runs inside the Google Sheet (see the Apps Script version).
// Pure functions only. No network, no AI calls in here.



var SHEET = {
  apps: 'P3_Applications', catalog: 'P3_RejectionCatalog', templates: 'Templates',
  kw: 'Keyword_Rules', safety: 'Safety_Rules', config: 'Config', out: 'Final_Output', log: 'Run_Log'
};

var OUT_HEADERS = ['application_id', 'business_type', 'preferred_language', 'step_reached', 'expected_tpv_lakh',
  'priority_rank', 'reason_code', 'diagnosed_cause', 'fixable', 'recoverable', 'route', 'channel', 'drafted_nudge',
  'chars', 'safety_check', 'send_status', 'hold_reasons', 'code_source', 'ai_second_opinion'];

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

/**
 * Diagnose one application and draft its message.
 * ctx = { catalog (by code), T, kw, safety, nativeLangs, aiFn (optional) }
 * Returns an object with the output columns, or null if the application is Activated.
 */
function diagnoseOne_(app, ctx) {
  if (str_(app.application_status) === 'Activated') return null;
  var given = str_(app.rejection_code), msgText = str_(app.rejection_message);
  var code, src, aiNote = '', aiDisagrees = false;

  if (given) {
    code = given; src = 'Given in data'; aiNote = 'n/a (code given)';
  } else if (msgText) {
    src = 'Inferred from reviewer text';
    var ruleCode = classifyText_(msgText, ctx.kw);
    code = ruleCode;
    if (ctx.aiFn) {
      var ai = ctx.aiFn(msgText);
      if (ai && ai.code && ctx.catalog[ai.code]) {
        if (ruleCode && ai.code === ruleCode) aiNote = 'AI agrees (' + ai.code + ')';
        else if (ruleCode) { aiNote = 'AI DISAGREES: ' + ai.code; aiDisagrees = true; }
        else { code = ai.code; src = 'Inferred by AI (no keyword rule matched)'; aiNote = 'AI chose ' + ai.code; }
      } else if (ai && ai.error) aiNote = 'AI error: ' + ai.error;
      else aiNote = 'AI gave no usable code';
    } else aiNote = 'Not run';
  } else {
    code = 'R13'; src = 'No rejection: abandoned'; aiNote = 'n/a (no rejection)';
  }

  var out = {
    application_id: app.application_id, business_type: app.business_type, preferred_language: app.preferred_language,
    step_reached: app.step_reached, expected_tpv_lakh: Number(app.expected_monthly_tpv_inr_lakh),
    priority_rank: '', code_source: src, ai_second_opinion: aiNote,
    _days: Number(app.days_since_last_activity)
  };
  var channel = str_(app.whatsapp_opted_in) === 'Yes' ? 'WhatsApp (opted in), SMS fallback' : 'SMS / Email (not opted in to WhatsApp)';
  out.channel = channel;

  if (!code || !ctx.catalog[code]) {
    out.reason_code = 'UNKNOWN'; out.diagnosed_cause = 'Reason could not be identified';
    out.fixable = 'Unknown'; out.recoverable = 'Unknown'; out.route = 'Human review';
    out.drafted_nudge = ''; out.chars = 0; out.safety_check = 'N/A';
    out.hold_reasons = 'No code found: human review';
    out.send_status = 'HOLD';
    return out;
  }

  var c = ctx.catalog[code];
  var fixable = str_(c.fixable) === 'Needs compliance review' ? 'Compliance review' : str_(c.fixable);
  out.reason_code = code;
  out.diagnosed_cause = code === 'R13' ? 'Abandoned application: stopped at "' + str_(app.step_reached) + '"' : str_(c.reviewer_reason);
  out.fixable = fixable;
  out.recoverable = fixable === 'Yes' ? 'Yes' : 'No';
  out.route = code === 'R10' ? 'Close politely' : (code === 'R12' ? 'Compliance team' : 'Nudge merchant');
  out.drafted_nudge = composeMessage_(app, code, ctx);
  out.chars = out.drafted_nudge.length;

  var fails = checkMessage_(out.drafted_nudge, code, app, channel, ctx.safety);
  out.safety_check = fails.length ? 'FAIL: ' + fails.join('; ') : 'PASS';

  var holds = [];
  if (code === 'R10') holds.push('R10 closure sign-off');
  if (code === 'R12') holds.push('R12 Compliance sign-off');
  if (src.indexOf('Inferred') === 0) holds.push('Inferred code check');
  if (ctx.nativeLangs.indexOf(str_(app.preferred_language)) >= 0) holds.push('Native-language review');
  if (fails.length) holds.push('Safety check failed');
  if (aiDisagrees) holds.push('AI and rules disagree');
  out.hold_reasons = holds.join('; ');
  out.send_status = holds.length ? 'HOLD' : 'READY after spot check';
  return out;
}

/** Runs the whole pipeline. Returns an array of output objects (priority rank filled in). */
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
  // priority: recoverable cases by expected TPV (high first), then fewer days inactive, then id
  var rec = results.filter(function (r) { return r.recoverable === 'Yes'; });
  rec.sort(function (a, b) {
    if (b.expected_tpv_lakh !== a.expected_tpv_lakh) return b.expected_tpv_lakh - a.expected_tpv_lakh;
    if (a._days !== b._days) return a._days - b._days;
    return a.application_id < b.application_id ? -1 : 1;
  });
  rec.forEach(function (r, i) { r.priority_rank = i + 1; });
  return results;
}


export { runCore_, diagnoseOne_, buildTemplateMap_, classifyText_, checkMessage_, OUT_HEADERS };
