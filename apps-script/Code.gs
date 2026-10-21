/**
 * Team Cards — email sender.
 * Runs inside Google Apps Script on the teamcardsdcs@gmail.com account.
 *
 * Setup (see SETUP.md):
 *  1. Project Settings > Script properties: add
 *       SUPABASE_URL         e.g. https://abcd1234.supabase.co
 *       SUPABASE_SECRET_KEY  the "secret" (or legacy service_role) key from Supabase > Project Settings > API Keys
 *       SITE_URL             https://davidclancy-smith-chatgpt.github.io/teamcardsdcs/
 *  2. Choose the function "setup" in the toolbar and press Run once (approve the permissions).
 * After that it runs on its own every 5 minutes.
 */

var FROM_NAME = 'Team Cards';
var BATCH = 40; // emails per run at most

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('tick').timeBased().everyMinutes(5).create();
  tick();
  Logger.log('Set up. Emails left today: ' + MailApp.getRemainingDailyQuota());
}

function tick() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    var result = rpc_('worker_tick', {});
    (result.purge || []).forEach(purgeCard_);
    sendOutbox_();
  } finally {
    lock.releaseLock();
  }
}

// ---------- Supabase ----------

function props_() {
  var p = PropertiesService.getScriptProperties();
  var url = (p.getProperty('SUPABASE_URL') || '').replace(/\/+$/, '');
  var key = p.getProperty('SUPABASE_SECRET_KEY') || '';
  var site = p.getProperty('SITE_URL') || '';
  if (!url || !key || !site) throw new Error('Add SUPABASE_URL, SUPABASE_SECRET_KEY and SITE_URL in Script properties.');
  if (site.slice(-1) !== '/') site += '/';
  return { url: url, key: key, site: site };
}

function headers_(key) {
  var h = { apikey: key };
  if (key.indexOf('eyJ') === 0) h.Authorization = 'Bearer ' + key; // legacy JWT keys
  return h;
}

function rpc_(name, args) {
  var p = props_();
  var res = UrlFetchApp.fetch(p.url + '/rest/v1/rpc/' + name, {
    method: 'post',
    contentType: 'application/json',
    headers: headers_(p.key),
    payload: JSON.stringify(args),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code >= 300) throw new Error(name + ' failed (' + code + '): ' + res.getContentText());
  var text = res.getContentText();
  return text ? JSON.parse(text) : null;
}

function purgeCard_(cardId) {
  var p = props_();
  var prefix = 'cards/' + cardId + '/';
  var list = UrlFetchApp.fetch(p.url + '/storage/v1/object/list/media', {
    method: 'post', contentType: 'application/json', headers: headers_(p.key),
    payload: JSON.stringify({ prefix: prefix, limit: 1000 }), muteHttpExceptions: true
  });
  var files = list.getResponseCode() < 300 ? JSON.parse(list.getContentText()) : [];
  var paths = files.filter(function (f) { return f.name; }).map(function (f) { return prefix + f.name; });
  if (paths.length) {
    UrlFetchApp.fetch(p.url + '/storage/v1/object/media', {
      method: 'delete', contentType: 'application/json', headers: headers_(p.key),
      payload: JSON.stringify({ prefixes: paths }), muteHttpExceptions: true
    });
  }
  rpc_('worker_purge', { p_card: cardId });
}

// ---------- Sending ----------

function sendOutbox_() {
  var left = MailApp.getRemainingDailyQuota();
  if (left <= 0) return;
  var items = rpc_('worker_outbox', { p_limit: Math.min(BATCH, left) }) || [];
  var site = props_().site;
  items.forEach(function (item) {
    try {
      var mail = build_(item.kind, item.payload || {}, site);
      MailApp.sendEmail({ to: item.to, subject: mail.subject, htmlBody: mail.html, body: mail.text, name: FROM_NAME });
      rpc_('worker_mark', { p_id: item.id, p_error: null });
    } catch (e) {
      rpc_('worker_mark', { p_id: item.id, p_error: String(e).slice(0, 500) });
    }
  });
}

function esc_(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function when_(iso) {
  if (!iso) return '';
  return Utilities.formatDate(new Date(iso), 'Europe/London', "EEEE d MMMM 'at' h:mma");
}

function build_(kind, d, site) {
  var link = d.link ? site + '?' + d.link : site;
  var name = d.recipient_name || 'them';
  var occ = (d.occasion || 'card').toLowerCase();
  var t;
  switch (kind) {
    case 'organiser':
      t = { subject: 'Your card for ' + name + ' is set up',
            lines: ['Here is your private link to manage the ' + occ + ' card for ' + name + '. Keep this email: anyone with this link can manage the card.',
                    'Invites are on their way. You\'ll get an email when everyone has signed or the deadline (' + when_(d.deadline) + ') passes.'],
            button: 'Manage the card' };
      break;
    case 'invite':
      t = { subject: 'Sign the ' + occ + ' card for ' + name,
            lines: [(d.organiser_name || 'A colleague') + ' is collecting messages for ' + name + '.',
                    'Add a message, a photo or a GIF before ' + when_(d.deadline) + '. Please keep it a secret from ' + name + '!'],
            button: 'Sign the card' };
      break;
    case 'reminder':
      t = { subject: 'Reminder: sign the card for ' + name,
            lines: ['There\'s still time to sign the ' + occ + ' card for ' + name + '.',
                    'It closes ' + when_(d.deadline) + '.'],
            button: 'Sign the card' };
      break;
    case 'ready':
      t = { subject: 'The card for ' + name + ' is ready to send',
            lines: [d.reason === 'all_signed'
                      ? 'Everyone on the list has signed (' + d.signed + ' of ' + d.total + ').'
                      : 'The deadline has passed: ' + d.signed + ' of ' + d.total + ' people signed.',
                    'Open the card to preview it, then send it now or pick a time.'],
            button: 'Preview and send' };
      break;
    case 'delivery':
      t = { subject: 'You have a ' + occ + ' card from the team',
            lines: [(d.headline ? d.headline + ' ' : '') + (d.count || 'Lots of') + ' people have signed a card for you.'],
            button: 'Open your card' };
      break;
    case 'delivered':
      t = { subject: 'Your card for ' + name + ' has been sent',
            lines: [name + ' has their card. If they write a thank-you, it\'ll arrive by email.'],
            button: 'See the card' };
      break;
    case 'thanks':
      t = { subject: name + ' says thank you',
            lines: [name + ' read the ' + occ + ' card and wrote:', '“' + (d.thank_you || '') + '”'],
            button: null };
      break;
    default:
      throw new Error('Unknown email kind: ' + kind);
  }

  var cover = d.cover_url && kind !== 'thanks'
    ? '<img src="' + esc_(d.cover_url) + '" alt="" width="480" style="display:block;width:100%;max-width:480px;border-radius:12px;margin:0 0 20px">'
    : '';
  var paras = t.lines.map(function (l) {
    return '<p style="margin:0 0 14px;font-size:16px;line-height:1.5;color:#1f2937">' + esc_(l) + '</p>';
  }).join('');
  var btn = t.button
    ? '<p style="margin:22px 0"><a href="' + esc_(link) + '" style="background:#4f46e5;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;font-size:16px;display:inline-block">' + esc_(t.button) + '</a></p>' +
      '<p style="margin:0;font-size:12px;color:#6b7280">Or paste this link into your browser: ' + esc_(link) + '</p>'
    : '';
  var html = '<div style="background:#f5f3ef;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">' +
    '<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;padding:20px">' +
    cover + paras + btn +
    '</div><p style="text-align:center;font-size:12px;color:#9ca3af;margin:14px 0 0">Sent by Team Cards</p></div>';
  var text = t.lines.join('\n\n') + (t.button ? '\n\n' + t.button + ': ' + link : '');
  return { subject: t.subject, html: html, text: text };
}
