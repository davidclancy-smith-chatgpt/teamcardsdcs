/* Team Cards — the whole web app in one file.
   Pages (chosen by the link):
     ./            create a card
     ./?m=TOKEN    organiser's manage page
     ./?s=TOKEN    sign the card (personal link from the invite email)
     ./?o=TOKEN    latecomer link (anyone with it can add themselves)
     ./?v=TOKEN    the recipient's card
*/
(function () {
  'use strict';

  var CFG = window.TEAMCARDS_CONFIG || {};
  var API = (CFG.SUPABASE_URL || '').replace(/\/+$/, '');
  var KEY = CFG.SUPABASE_PUBLIC_KEY || '';

  var FONTS = ['Caveat', 'Dancing Script', 'Patrick Hand', 'Permanent Marker', 'Pacifico', 'Nunito'];
  var COLOURS = ['#1f2937', '#b91c1c', '#c2410c', '#be185d', '#6d28d9', '#1d4ed8', '#0f766e', '#047857'];
  var OCCASIONS = {
    'Birthday': 'Happy birthday!',
    'Get well soon': 'Get well soon!',
    'Leaving': 'Good luck in your next adventure!',
    'Congratulations': 'Congratulations!',
    'Thank you': 'Thank you!',
    'Welcome': 'Welcome to the team!',
    'Other': ''
  };
  var GIF_SEARCH = {
    'Birthday': 'happy birthday', 'Get well soon': 'get well soon', 'Leaving': 'good luck',
    'Congratulations': 'congratulations', 'Thank you': 'thank you', 'Welcome': 'welcome', 'Other': 'celebrate'
  };
  var LIBS = {
    heic: 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js',
    pdf: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
    pdfWorker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
    confetti: 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js'
  };

  var app = document.getElementById('app');
  var params = new URLSearchParams(location.search);

  // ---------------------------------------------------------------- helpers

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function fontClass(f) { return 'f-' + String(f || 'Caveat').replace(/ /g, '-'); }
  function siteUrl() { return location.origin + location.pathname; }
  function linkFor(k, t) { return siteUrl() + '?' + k + '=' + t; }

  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 3200);
  }

  function when(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit'
    });
  }
  function toLocalInput(d) {
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function fromLocalInput(v) { return v ? new Date(v).toISOString() : null; }

  function parseEmails(text) {
    var seen = {};
    return String(text || '').split(/[\s,;]+/).map(function (e) {
      return e.replace(/^.*</, '').replace(/>.*$/, '').trim().toLowerCase();
    }).filter(function (e) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) || seen[e]) return false;
      seen[e] = true;
      return true;
    });
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  }

  function authHeaders() {
    var h = { apikey: KEY };
    if (KEY.indexOf('eyJ') === 0) h.Authorization = 'Bearer ' + KEY; // legacy anon key
    return h;
  }

  function api(name, args) {
    var h = authHeaders();
    h['Content-Type'] = 'application/json';
    return fetch(API + '/rest/v1/rpc/' + name, { method: 'POST', headers: h, body: JSON.stringify(args || {}) })
      .then(function (res) {
        return res.text().then(function (text) {
          var data = text ? JSON.parse(text) : null;
          if (!res.ok) throw new Error((data && (data.message || data.error)) || 'Something went wrong. Please try again.');
          return data;
        });
      });
  }

  var scripts = {};
  function loadScript(src) {
    if (!scripts[src]) {
      scripts[src] = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = src; s.async = true;
        s.onload = resolve;
        s.onerror = function () { reject(new Error('Could not load a helper. Check your connection.')); };
        document.head.appendChild(s);
      });
    }
    return scripts[src];
  }

  // ------------------------------------------------------- images & upload

  function canvasToBlob(canvas, type, quality) {
    return new Promise(function (resolve) { canvas.toBlob(resolve, type, quality); });
  }

  function loadImage(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('That file could not be read as a picture.')); };
      img.src = url;
    });
  }

  function isHeic(file) { return /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name || ''); }
  function isPdf(file) { return file.type === 'application/pdf' || /\.pdf$/i.test(file.name || ''); }

  function pdfFirstPage(file, maxW) {
    return loadScript(LIBS.pdf).then(function () {
      var lib = window.pdfjsLib;
      lib.GlobalWorkerOptions.workerSrc = LIBS.pdfWorker;
      return file.arrayBuffer().then(function (buf) { return lib.getDocument({ data: buf }).promise; });
    }).then(function (doc) { return doc.getPage(1); }).then(function (page) {
      var base = page.getViewport({ scale: 1 });
      var vp = page.getViewport({ scale: maxW / base.width });
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
        return canvasToBlob(canvas, 'image/jpeg', 0.88);
      });
    });
  }

  // Turns any picture into a web-friendly file no wider than maxW.
  function prepareImage(file, maxW) {
    if (!file) return Promise.resolve(null);
    if (isPdf(file)) return pdfFirstPage(file, maxW).then(function (b) { return { blob: b, ext: 'jpg', kind: 'image' }; });
    var start = isHeic(file)
      ? loadScript(LIBS.heic).then(function () { return window.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.88 }); })
          .then(function (r) { return Array.isArray(r) ? r[0] : r; })
      : Promise.resolve(file);
    return start.then(function (blob) {
      if (blob.type === 'image/gif') {
        if (blob.size > 6 * 1024 * 1024) throw new Error('That GIF is over 6 MB. Try a smaller one, or search GIPHY.');
        return { blob: blob, ext: 'gif', kind: 'gif' };
      }
      if (!/^image\//.test(blob.type)) throw new Error('Please choose a picture (PNG, JPEG, GIF, WebP, HEIC) or a PDF.');
      return loadImage(blob).then(function (img) {
        var scale = Math.min(1, maxW / img.naturalWidth);
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        var ctx = canvas.getContext('2d');
        var png = blob.type === 'image/png';
        if (!png) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        return canvasToBlob(canvas, png ? 'image/png' : 'image/jpeg', 0.86).then(function (out) {
          if (png && out.size > 3 * 1024 * 1024) {
            return canvasToBlob(canvas, 'image/jpeg', 0.86).then(function (j) { return { blob: j, ext: 'jpg', kind: 'image' }; });
          }
          return { blob: out, ext: png ? 'png' : 'jpg', kind: 'image' };
        });
      });
    });
  }

  function upload(cardId, prepared) {
    var path = 'cards/' + cardId + '/' + uuid() + '.' + prepared.ext;
    var h = authHeaders();
    h['Content-Type'] = prepared.blob.type || 'image/jpeg';
    h['x-upsert'] = 'false';
    h['cache-control'] = 'max-age=31536000';
    return fetch(API + '/storage/v1/object/media/' + path, { method: 'POST', headers: h, body: prepared.blob })
      .then(function (res) {
        if (!res.ok) return res.text().then(function (t) { throw new Error('Upload failed: ' + t.slice(0, 160)); });
        return API + '/storage/v1/object/public/media/' + path;
      });
  }

  // Hooks a drop zone (with a hidden file input inside) to a callback.
  function bindDrop(zone, onFile) {
    var input = $('input[type=file]', zone);
    zone.addEventListener('click', function (e) { if (e.target !== input) input.click(); });
    zone.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    input.addEventListener('change', function () { if (input.files[0]) onFile(input.files[0]); input.value = ''; });
    ['dragenter', 'dragover'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove('over'); });
    });
    zone.addEventListener('drop', function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) onFile(f);
    });
  }

  // ------------------------------------------------------------ rendering

  function tileHtml(m, opts) {
    opts = opts || {};
    var media = m.media_url ? '<img src="' + esc(m.media_url) + '" alt="" loading="lazy">' : '';
    var tools = opts.tools ? '<div class="tile-tools">' + opts.tools + '</div>' : '';
    return '<div class="tile' + (m.hidden ? ' is-hidden' : '') + '">' + media +
      (m.body ? '<div class="body ' + fontClass(m.font) + '" style="color:' + esc(m.colour) + '">' + esc(m.body) + '</div>' : '') +
      '<div class="sig">— ' + esc(m.author_name) + (m.hidden ? ' (hidden)' : '') + '</div>' + tools + '</div>';
  }

  function coverOrPlaceholder(card, cls) {
    if (card.cover_url) return '<img class="' + cls + '" src="' + esc(card.cover_url) + '" alt="Card cover">';
    return '<div class="' + cls + ' panel" style="padding:48px 24px;text-align:center"><h1>' +
      esc(card.headline || card.occasion) + '</h1><p class="muted">For ' + esc(card.recipient_name) + '</p></div>';
  }

  function showError(err) {
    app.innerHTML = '<div class="narrow panel"><h2>Hmm, that didn\'t work</h2><p class="error">' + esc(err.message || err) +
      '</p><p><a href="./">Start a new card</a></p></div>';
  }

  function busy(btn, on, label) {
    if (!btn) return;
    if (on) { btn.dataset.label = btn.textContent; btn.textContent = label || 'Working…'; btn.disabled = true; }
    else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
  }

  // ========================================================= CREATE PAGE

  function renderCreate() {
    var deadline = new Date(Date.now() + 7 * 864e5);
    deadline.setHours(17, 0, 0, 0);
    var occOptions = Object.keys(OCCASIONS).map(function (o) { return '<option>' + esc(o) + '</option>'; }).join('');
    app.innerHTML =
      '<div class="narrow">' +
      '<h1>Make a group card</h1>' +
      '<p class="muted">Upload a cover, add everyone\'s email, and we\'ll invite them to sign. You send it when it\'s ready.</p>' +
      '<form id="create" class="panel" novalidate>' +
      '<div class="row"><div class="field"><label for="occasion">Occasion</label><select id="occasion">' + occOptions + '</select></div>' +
      '<div class="field"><label for="headline">Headline</label><input id="headline" type="text" maxlength="120" value="Happy birthday!"></div></div>' +
      '<div class="row"><div class="field"><label for="rname">Who is it for?</label><input id="rname" type="text" maxlength="80" placeholder="Their name" required></div>' +
      '<div class="field"><label for="remail">Their email</label><input id="remail" type="email" placeholder="name@company.com" required>' +
      '<div class="hint">They only get an email when you send the card.</div></div></div>' +
      '<div class="field"><label>Front cover</label>' +
      '<div class="drop" id="coverDrop" tabindex="0" role="button" aria-label="Upload a cover">' +
      '<div id="coverPreview"><p><strong>Drop a cover design here</strong> or click to choose</p>' +
      '<p class="hint">PNG, JPEG, GIF, WebP, iPhone photos or a PDF (first page)</p></div>' +
      '<input type="file" accept="image/*,.heic,.heif,application/pdf"></div></div>' +
      '<div class="field"><label for="emails">Who should sign it?</label>' +
      '<textarea id="emails" placeholder="Paste email addresses, separated by commas or new lines"></textarea>' +
      '<div class="hint" id="emailCount">0 people</div></div>' +
      '<div class="field"><label for="deadline">Signing deadline</label><input id="deadline" type="datetime-local" value="' + toLocalInput(deadline) + '">' +
      '<div class="hint">People not signed get one reminder two days before.</div></div>' +
      '<div class="row"><div class="field"><label for="oname">Your name</label><input id="oname" type="text" maxlength="80" required></div>' +
      '<div class="field"><label for="oemail">Your email</label><input id="oemail" type="email" required>' +
      '<div class="hint">Your private manage link is emailed here.</div></div></div>' +
      '<div class="field"><label class="check"><input id="includeMe" type="checkbox" checked> I\'d like to sign it too</label></div>' +
      '<div class="field"><label for="code">Team code</label><input id="code" type="password" autocomplete="off" required>' +
      '<div class="hint">Ask the person who set up Team Cards. It stops strangers using it.</div></div>' +
      '<p class="error" id="createErr" hidden></p>' +
      '<div class="btns"><button class="btn" type="submit" id="createBtn">Create card and send invites</button></div>' +
      '</form></div>';

    var coverFile = null;
    var occ = $('#occasion'), head = $('#headline');
    occ.addEventListener('change', function () {
      var known = Object.keys(OCCASIONS).map(function (k) { return OCCASIONS[k]; });
      if (!head.value || known.indexOf(head.value) >= 0) head.value = OCCASIONS[occ.value];
    });
    $('#emails').addEventListener('input', function () {
      var n = parseEmails(this.value).length;
      $('#emailCount').textContent = n + (n === 1 ? ' person' : ' people');
    });
    bindDrop($('#coverDrop'), function (file) {
      coverFile = file;
      var box = $('#coverPreview');
      if (isPdf(file) || isHeic(file)) {
        box.innerHTML = '<p><strong>' + esc(file.name) + '</strong></p><p class="hint">Ready. It will be converted when you create the card.</p>';
      } else {
        var url = URL.createObjectURL(file);
        box.innerHTML = '<img src="' + url + '" alt="Cover preview"><p class="hint">Click to change</p>';
      }
    });

    $('#create').addEventListener('submit', function (e) {
      e.preventDefault();
      var err = $('#createErr'); err.hidden = true;
      var btn = $('#createBtn');
      var emails = parseEmails($('#emails').value);
      var payload = {
        id: uuid(),
        code: $('#code').value.trim(),
        occasion: occ.value,
        headline: head.value.trim(),
        recipient_name: $('#rname').value.trim(),
        recipient_email: $('#remail').value.trim(),
        organiser_name: $('#oname').value.trim(),
        organiser_email: $('#oemail').value.trim(),
        deadline: fromLocalInput($('#deadline').value),
        include_me: $('#includeMe').checked,
        emails: emails
      };
      var problem =
        !payload.recipient_name ? 'Who is the card for?' :
        !payload.recipient_email ? 'Add the recipient\'s email.' :
        !payload.organiser_name || !payload.organiser_email ? 'Add your name and email.' :
        !payload.deadline ? 'Pick a deadline.' :
        !emails.length && !payload.include_me ? 'Add at least one person to sign it.' :
        !payload.code ? 'Enter the team code.' : '';
      if (problem) { err.textContent = problem; err.hidden = false; return; }

      busy(btn, true, coverFile ? 'Uploading cover…' : 'Creating…');
      prepareImage(coverFile, 1600)
        .then(function (prep) { return prep ? upload(payload.id, prep) : null; })
        .then(function (url) {
          payload.cover_url = url;
          busy(btn, false); busy(btn, true, 'Creating…');
          return api('create_card', { p: payload });
        })
        .then(function (res) {
          history.replaceState(null, '', '?m=' + res.manage_token);
          params = new URLSearchParams(location.search);
          renderManage(res.manage_token, 'Card created. Invites go out within 5 minutes, and your manage link is on its way to your inbox.');
        })
        .catch(function (ex) { busy(btn, false); err.textContent = ex.message; err.hidden = false; });
    });
  }

  // ========================================================= MANAGE PAGE

  function renderManage(token, notice) {
    api('get_manage', { p_token: token }).then(function (c) { drawManage(token, c, notice); }).catch(showError);
  }

  function drawManage(token, c, notice) {
    var total = c.invitees.length;
    var signed = c.invitees.filter(function (i) { return i.signed_at; }).length;
    var pct = total ? Math.round(signed / total * 100) : 0;
    var sent = c.status === 'sent';
    var statusChip = {
      collecting: '<span class="chip accent">Collecting messages</span>',
      ready: '<span class="chip good">Ready to send</span>',
      scheduled: '<span class="chip warn">Scheduled for ' + esc(when(c.send_at)) + '</span>',
      sent: '<span class="chip good">Sent ' + esc(when(c.sent_at)) + '</span>'
    }[c.status];

    var people = c.invitees.map(function (i) {
      var right = i.signed_at ? '<span class="chip good">Signed</span>'
        : sent ? '<span class="chip">Didn\'t sign</span>'
        : '<button class="btn small secondary" data-nudge="' + esc(i.id) + '"' +
          (i.reminded_at && Date.now() - new Date(i.reminded_at) < 12 * 36e5 ? ' disabled title="Reminded recently"' : '') + '>Nudge</button>';
      return '<li><div class="who"><strong>' + esc(i.name || i.email) + '</strong>' +
        (i.name ? '<div class="small muted">' + esc(i.email) + '</div>' : '') +
        (i.source === 'open' ? '<div class="small muted">Joined by the open link</div>' : '') + '</div>' + right + '</li>';
    }).join('');

    var tiles = c.messages.map(function (m) {
      return tileHtml(m, sent ? {} : { tools: '<button class="btn small ' + (m.hidden ? 'secondary' : 'ghost') + '" data-hide="' + esc(m.id) +
        '" data-hidden="' + (m.hidden ? '1' : '0') + '">' + (m.hidden ? 'Show again' : 'Hide') + '</button>' });
    }).join('');

    var sendPanel;
    if (sent) {
      sendPanel = '<h2>Sent</h2><p>' + esc(c.recipient_name) + ' got their card ' + esc(when(c.sent_at)) + '.</p>' +
        '<div class="linkbox"><input type="text" readonly value="' + esc(linkFor('v', c.view_token)) + '"><button class="btn small secondary" data-copy>Copy</button></div>' +
        (c.thank_you ? '<div class="notice good" style="margin-top:14px"><strong>Their thank-you:</strong><br>' + esc(c.thank_you) + '</div>' : '<p class="hint">If they write a thank-you, everyone who signed gets it by email.</p>') +
        '<p class="hint">The card and its pictures are deleted 90 days after sending.</p>';
    } else if (c.status === 'scheduled') {
      sendPanel = '<h2>Scheduled</h2><p>The card goes to ' + esc(c.recipient_email) + ' on <strong>' + esc(when(c.send_at)) + '</strong>. People can still sign until then.</p>' +
        '<div class="btns"><button class="btn ghost" id="previewBtn">Preview</button><button class="btn danger" id="cancelBtn">Cancel the send</button></div>';
    } else {
      var later = new Date(Date.now() + 864e5); later.setHours(9, 0, 0, 0);
      sendPanel = '<h2>Send the card</h2>' +
        (c.status === 'ready' ? '<div class="notice good">Ready: ' + signed + ' of ' + total + ' have signed.</div>' : '') +
        '<p>It goes to <strong>' + esc(c.recipient_email) + '</strong>. Once sent, messages are locked.</p>' +
        '<div class="btns" style="margin-bottom:14px"><button class="btn ghost" id="previewBtn">Preview</button>' +
        '<button class="btn" id="sendNow">Send now</button></div>' +
        '<label for="sendAt">Or send at a set time</label><div class="linkbox"><input id="sendAt" type="datetime-local" value="' + toLocalInput(later) + '">' +
        '<button class="btn secondary" id="sendLater">Schedule</button></div>';
    }

    app.innerHTML =
      (notice ? '<div class="notice good">' + esc(notice) + '</div>' : '') +
      '<h1>' + esc(c.occasion) + ' card for ' + esc(c.recipient_name) + '</h1>' +
      '<p>' + statusChip + ' <span class="muted small">Deadline ' + esc(when(c.deadline)) + '</span></p>' +
      '<p class="small muted">This is your private manage page. Bookmark it; the link is also in your inbox.</p>' +
      '<div class="layout"><div>' +
      '<div class="panel">' + coverOrPlaceholder(c, 'cover-thumb') +
      (sent ? '' :
        '<div class="drop" id="coverDrop" tabindex="0" role="button" style="padding:12px"><span class="small"><strong>Change cover</strong></span><input type="file" accept="image/*,.heic,.heif,application/pdf"></div>' +
        '<div class="field" style="margin-top:14px"><label for="headline">Headline</label><input id="headline" type="text" maxlength="120" value="' + esc(c.headline || '') + '"></div>' +
        '<div class="field"><label for="deadline">Deadline</label><input id="deadline" type="datetime-local" value="' + toLocalInput(new Date(c.deadline)) + '"></div>' +
        '<button class="btn secondary" id="saveCard">Save changes</button>') +
      '</div>' +
      '<div class="panel">' + sendPanel + '</div>' +
      '</div><div>' +
      '<div class="panel"><h2>' + signed + ' of ' + total + ' signed</h2>' +
      '<div class="progress"><span style="width:' + pct + '%"></span></div>' +
      '<ul class="people">' + (people || '<li class="muted">Nobody yet.</li>') + '</ul>' +
      (sent ? '' :
        '<div class="field" style="margin-top:16px"><label for="moreEmails">Add more people</label><textarea id="moreEmails" style="min-height:70px" placeholder="Email addresses"></textarea></div>' +
        '<button class="btn secondary" id="addPeople">Add and invite</button>') +
      '</div>' +
      (sent ? '' :
        '<div class="panel"><h2>Link for latecomers</h2><p class="small muted">Anyone with this link can add themselves and sign. Handy for a Teams chat.</p>' +
        '<label class="check" style="margin-bottom:10px"><input type="checkbox" id="openToggle"' + (c.open_link_enabled ? ' checked' : '') + '> Link is open</label>' +
        (c.open_link_enabled ? '<div class="linkbox"><input type="text" readonly value="' + esc(linkFor('o', c.open_token)) + '"><button class="btn small secondary" data-copy>Copy</button></div>' : '') +
        '</div>') +
      '<div class="panel"><h2>Messages</h2>' + (c.messages.length ? '<p class="small muted">Hidden messages won\'t appear on the card.</p><div class="tiles">' + tiles + '</div>' : '<p class="muted">No messages yet.</p>') + '</div>' +
      '</div></div>';

    function act(promise, btn, msg) {
      busy(btn, true);
      return promise.then(function (data) { drawManage(token, data); if (msg) toast(msg); })
        .catch(function (ex) { busy(btn, false); toast(ex.message); });
    }

    $all('[data-copy]').forEach(function (b) {
      b.addEventListener('click', function () {
        var input = b.previousElementSibling;
        input.select();
        (navigator.clipboard ? navigator.clipboard.writeText(input.value) : Promise.resolve(document.execCommand('copy')))
          .then(function () { toast('Link copied'); });
      });
    });
    $all('[data-nudge]').forEach(function (b) {
      b.addEventListener('click', function () { act(api('nudge', { p_token: token, p_invitee: b.dataset.nudge }), b, 'Reminder on its way'); });
    });
    $all('[data-hide]').forEach(function (b) {
      b.addEventListener('click', function () {
        act(api('set_hidden', { p_token: token, p_message: b.dataset.hide, p_hidden: b.dataset.hidden !== '1' }), b);
      });
    });

    var drop = $('#coverDrop');
    if (drop) bindDrop(drop, function (file) {
      toast('Uploading cover…');
      prepareImage(file, 1600).then(function (prep) { return upload(c.id, prep); })
        .then(function (url) { return api('update_card', { p_token: token, p: { cover_url: url } }); })
        .then(function (data) { drawManage(token, data); toast('Cover updated'); })
        .catch(function (ex) { toast(ex.message); });
    });
    var save = $('#saveCard');
    if (save) save.addEventListener('click', function () {
      act(api('update_card', { p_token: token, p: { headline: $('#headline').value, deadline: fromLocalInput($('#deadline').value) } }), save, 'Saved');
    });
    var add = $('#addPeople');
    if (add) add.addEventListener('click', function () {
      var list = parseEmails($('#moreEmails').value);
      if (!list.length) { toast('Paste at least one email address'); return; }
      act(api('add_invitees', { p_token: token, p_emails: list }), add, 'Invites on their way');
    });
    var toggle = $('#openToggle');
    if (toggle) toggle.addEventListener('change', function () {
      act(api('update_card', { p_token: token, p: { open_link_enabled: toggle.checked } }), null);
    });
    var preview = $('#previewBtn');
    if (preview) preview.addEventListener('click', function () {
      var visible = c.messages.filter(function (m) { return !m.hidden; });
      drawView(null, { card: c, messages: visible }, { preview: true, back: function () { drawManage(token, c); } });
    });
    var now = $('#sendNow');
    if (now) now.addEventListener('click', function () {
      if (!confirm('Send the card to ' + c.recipient_email + ' now? Messages will be locked.')) return;
      act(api('schedule_send', { p_token: token, p_send_at: null }), now, 'Sending within 5 minutes');
    });
    var laterBtn = $('#sendLater');
    if (laterBtn) laterBtn.addEventListener('click', function () {
      var at = fromLocalInput($('#sendAt').value);
      if (!at || new Date(at) < new Date()) { toast('Pick a time in the future'); return; }
      act(api('schedule_send', { p_token: token, p_send_at: at }), laterBtn, 'Scheduled');
    });
    var cancel = $('#cancelBtn');
    if (cancel) cancel.addEventListener('click', function () { act(api('cancel_send', { p_token: token }), cancel, 'Send cancelled'); });
  }

  // =========================================================== SIGN PAGE

  function renderSign(token, notice) {
    api('get_sign', { p_token: token }).then(function (d) { drawSign(token, d, notice); }).catch(showError);
  }

  function drawSign(token, d, notice) {
    var card = d.card, mine = d.mine;
    var closed = card.status === 'sent';
    var state = {
      font: (mine && mine.font) || 'Caveat',
      colour: (mine && mine.colour) || COLOURS[0],
      media: mine && mine.media_url ? { url: mine.media_url, kind: mine.media_kind } : null,
      pending: null // a picked file not uploaded yet
    };
    var others = d.messages.map(function (m) { return tileHtml(m); }).join('');
    var defaultName = (mine && mine.author_name) || (d.me && d.me.name) || '';

    var form = closed
      ? '<div class="panel"><h2>This card has been sent</h2><p>Signing is closed. Thank you for taking part!</p>' + (mine ? '<div class="tiles" style="columns:1">' + tileHtml(mine) + '</div>' : '') + '</div>'
      : '<form class="panel" id="signForm" novalidate>' +
        '<h2>' + (mine ? 'Edit your message' : 'Add your message') + '</h2>' +
        '<div class="field"><label for="author">Your name</label><input id="author" type="text" maxlength="60" value="' + esc(defaultName) + '"></div>' +
        '<div class="field"><label for="body">Message</label><textarea id="body" maxlength="1000" placeholder="Write something lovely…">' + esc(mine ? mine.body : '') + '</textarea></div>' +
        '<div class="field"><label>Typeface</label><div class="fonts" id="fonts">' +
        FONTS.map(function (f) { return '<button type="button" class="' + fontClass(f) + '" style="font-size:17px !important;line-height:1.4 !important" data-font="' + esc(f) + '" aria-pressed="' + (f === state.font) + '">' + esc(f) + '</button>'; }).join('') +
        '</div></div>' +
        '<div class="field"><label>Colour</label><div class="swatches" id="swatches">' +
        COLOURS.map(function (c) { return '<button type="button" style="background:' + c + '" data-colour="' + c + '" aria-label="Colour ' + c + '" aria-pressed="' + (c === state.colour) + '"></button>'; }).join('') +
        '</div></div>' +
        '<div class="field"><label>Picture or GIF (optional)</label>' +
        '<div class="btns"><label class="btn secondary small" style="margin:0">Upload a photo<input type="file" id="photo" accept="image/*,.heic,.heif" hidden></label>' +
        '<button type="button" class="btn secondary small" id="gifBtn">Search GIFs</button></div>' +
        '<div id="mediaBox"></div>' +
        '<div class="giphy" id="giphy" hidden><input type="search" id="gifQ" placeholder="Search GIPHY"><div class="giphy-grid" id="gifGrid"></div><div class="powered">POWERED BY GIPHY</div></div>' +
        '</div>' +
        '<label>Preview</label><div class="tiles" style="columns:1" id="preview"></div>' +
        '<p class="error" id="signErr" hidden></p>' +
        '<div class="btns"><button class="btn" type="submit" id="saveBtn">' + (mine ? 'Save changes' : 'Add to the card') + '</button>' +
        (mine ? '<button type="button" class="btn danger" id="delBtn">Remove my message</button>' : '') + '</div>' +
        '<p class="hint">You can come back with the same link and edit until the card is sent.</p>' +
        '</form>';

    app.innerHTML =
      (notice ? '<div class="notice good">' + esc(notice) + '</div>' : '') +
      '<div class="layout"><div>' +
      '<div class="panel">' + coverOrPlaceholder(card, 'cover-thumb') +
      '<h2>' + esc(card.occasion) + ' card for ' + esc(card.recipient_name) + '</h2>' +
      '<p class="small muted">Organised by ' + esc(card.organiser_name) + '. Closes ' + esc(when(card.deadline)) + '.</p>' +
      '<p class="small muted">Shh: ' + esc(card.recipient_name) + ' can\'t see this until it\'s sent.</p></div>' +
      '</div><div>' + form +
      '<div class="panel"><h2>Already signed (' + d.messages.length + ')</h2>' +
      (others ? '<div class="tiles">' + others + '</div>' : '<p class="muted">You\'re the first!</p>') + '</div>' +
      '</div></div>';

    if (closed) return;

    function drawMedia() {
      var box = $('#mediaBox');
      var src = state.pending ? state.pending.preview : state.media && state.media.url;
      box.innerHTML = src ? '<div class="media-preview"><img src="' + esc(src) + '" alt=""><button type="button" class="btn small ghost" id="rmMedia" style="background:#fff">Remove</button></div>' : '';
      var rm = $('#rmMedia');
      if (rm) rm.addEventListener('click', function () { state.media = null; state.pending = null; drawMedia(); drawPreview(); });
    }
    function drawPreview() {
      var src = state.pending ? state.pending.preview : state.media && state.media.url;
      $('#preview').innerHTML = tileHtml({
        author_name: $('#author').value || 'You', body: $('#body').value,
        font: state.font, colour: state.colour, media_url: src
      });
    }
    $('#author').addEventListener('input', drawPreview);
    $('#body').addEventListener('input', drawPreview);
    $all('#fonts button').forEach(function (b) {
      b.addEventListener('click', function () {
        state.font = b.dataset.font;
        $all('#fonts button').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
        drawPreview();
      });
    });
    $all('#swatches button').forEach(function (b) {
      b.addEventListener('click', function () {
        state.colour = b.dataset.colour;
        $all('#swatches button').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
        drawPreview();
      });
    });
    $('#photo').addEventListener('change', function () {
      var f = this.files[0]; this.value = '';
      if (!f) return;
      toast('Preparing picture…');
      prepareImage(f, 1000).then(function (prep) {
        state.pending = { prep: prep, preview: URL.createObjectURL(prep.blob) };
        state.media = null;
        drawMedia(); drawPreview();
      }).catch(function (ex) { toast(ex.message); });
    });

    var giphy = $('#giphy'), timer;
    function searchGifs(q) {
      if (!CFG.GIPHY_KEY || CFG.GIPHY_KEY.indexOf('YOUR') === 0) { $('#gifGrid').innerHTML = '<p class="small muted">GIF search isn\'t set up yet.</p>'; return; }
      fetch('https://api.giphy.com/v1/gifs/search?api_key=' + encodeURIComponent(CFG.GIPHY_KEY) + '&q=' + encodeURIComponent(q) + '&limit=24&rating=g&lang=en')
        .then(function (r) { return r.json(); })
        .then(function (j) {
          var grid = $('#gifGrid');
          grid.innerHTML = (j.data || []).map(function (g) {
            var small = g.images && g.images.fixed_width_small && g.images.fixed_width_small.url;
            var full = g.images && (g.images.downsized_medium || g.images.downsized || g.images.original).url;
            return small && full ? '<button type="button" data-gif="' + esc(full) + '"><img src="' + esc(small) + '" alt="' + esc(g.title || 'GIF') + '" loading="lazy"></button>' : '';
          }).join('') || '<p class="small muted">No GIFs found.</p>';
          $all('[data-gif]', grid).forEach(function (b) {
            b.addEventListener('click', function () {
              state.media = { url: b.dataset.gif, kind: 'gif' }; state.pending = null;
              giphy.hidden = true; drawMedia(); drawPreview();
            });
          });
        })
        .catch(function () { toast('GIF search is not available right now'); });
    }
    $('#gifBtn').addEventListener('click', function () {
      giphy.hidden = !giphy.hidden;
      if (!giphy.hidden) { var q = $('#gifQ'); q.focus(); if (!$('#gifGrid').children.length) searchGifs(GIF_SEARCH[card.occasion] || 'celebrate'); }
    });
    $('#gifQ').addEventListener('input', function () {
      var q = this.value.trim();
      clearTimeout(timer);
      timer = setTimeout(function () { if (q) searchGifs(q); }, 400);
    });

    $('#signForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var err = $('#signErr'); err.hidden = true;
      var btn = $('#saveBtn');
      busy(btn, true, 'Saving…');
      var step = state.pending
        ? upload(card.id, state.pending.prep).then(function (url) { return { url: url, kind: state.pending.prep.kind }; })
        : Promise.resolve(state.media);
      step.then(function (media) {
        return api('save_message', { p_token: token, p: {
          author_name: $('#author').value, body: $('#body').value,
          font: state.font, colour: state.colour,
          media_url: media ? media.url : null, media_kind: media ? media.kind : null
        } });
      }).then(function (data) {
        drawSign(token, data, 'Thank you! Your message is on the card.');
        window.scrollTo(0, 0);
      }).catch(function (ex) { busy(btn, false); err.textContent = ex.message; err.hidden = false; });
    });
    var del = $('#delBtn');
    if (del) del.addEventListener('click', function () {
      if (!confirm('Remove your message from the card?')) return;
      busy(del, true);
      api('delete_message', { p_token: token }).then(function (data) { drawSign(token, data, 'Your message was removed.'); })
        .catch(function (ex) { busy(del, false); toast(ex.message); });
    });

    drawMedia(); drawPreview();
  }

  // =========================================================== OPEN LINK

  function renderOpen(openToken) {
    api('get_open', { p_open: openToken }).then(function (card) {
      app.innerHTML = '<div class="narrow"><div class="panel">' + coverOrPlaceholder(card, 'cover-thumb') +
        '<h1>Sign the card for ' + esc(card.recipient_name) + '</h1>' +
        '<p class="muted">Organised by ' + esc(card.organiser_name) + '. Closes ' + esc(when(card.deadline)) + '.</p>' +
        '<form id="joinForm" novalidate><div class="field"><label for="jname">Your name</label><input id="jname" type="text" maxlength="60"></div>' +
        '<div class="field"><label for="jemail">Your work email</label><input id="jemail" type="email"><div class="hint">So you can come back and edit your message.</div></div>' +
        '<p class="error" id="joinErr" hidden></p><button class="btn" id="joinBtn">Continue</button></form></div></div>';
      $('#joinForm').addEventListener('submit', function (e) {
        e.preventDefault();
        var btn = $('#joinBtn'), err = $('#joinErr'); err.hidden = true;
        busy(btn, true);
        api('join_open', { p_open: openToken, p_name: $('#jname').value, p_email: $('#jemail').value })
          .then(function (res) {
            if (res.token) {
              history.replaceState(null, '', '?s=' + res.token);
              renderSign(res.token, 'You\'re in. Bookmark this page to edit your message later.');
            } else {
              app.innerHTML = '<div class="narrow panel"><h2>Check your inbox</h2><p>You\'re already on this card, so we\'ve emailed you your personal signing link. It can take up to 5 minutes.</p></div>';
            }
          })
          .catch(function (ex) { busy(btn, false); err.textContent = ex.message; err.hidden = false; });
      });
    }).catch(showError);
  }

  // ======================================================= RECIPIENT VIEW

  function confetti() {
    loadScript(LIBS.confetti).then(function () {
      var fire = window.confetti;
      if (!fire || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
      fire({ particleCount: 140, spread: 90, origin: { y: 0.6 } });
      setTimeout(function () { fire({ particleCount: 80, angle: 60, spread: 70, origin: { x: 0 } }); }, 250);
      setTimeout(function () { fire({ particleCount: 80, angle: 120, spread: 70, origin: { x: 1 } }); }, 400);
    }).catch(function () {});
  }

  function renderView(viewToken) {
    api('get_view', { p_view: viewToken }).then(function (d) { drawView(viewToken, d, {}); }).catch(showError);
  }

  function drawView(viewToken, d, opts) {
    var card = d.card;
    var bar = opts.preview
      ? '<div class="notice warn no-print">Preview: this is what ' + esc(card.recipient_name) + ' will see. <button class="btn small ghost" id="backBtn">Back to manage</button></div>'
      : '';
    app.innerHTML = bar + '<div class="reveal" id="reveal">' +
      '<div>' + (card.cover_url ? '<img class="cover-big" src="' + esc(card.cover_url) + '" alt="Your card">' : '') +
      '<h1>' + esc(card.headline || card.occasion) + '</h1>' +
      '<p class="muted">A card for ' + esc(card.recipient_name) + ' from ' + d.messages.length + ' people</p>' +
      '<button class="btn" id="openBtn">Open your card</button></div></div>';
    var back = $('#backBtn');
    if (back) back.addEventListener('click', opts.back);

    $('#openBtn').addEventListener('click', function () {
      confetti();
      var tiles = d.messages.map(function (m) { return tileHtml(m); }).join('');
      var thanks = opts.preview ? '' : card.thank_you
        ? '<div class="panel thanks-box"><h3>Your thank-you</h3><p>' + esc(card.thank_you) + '</p></div>'
        : '<div class="panel thanks-box no-print"><h3>Say thank you</h3><p class="small muted">Everyone who signed will get your message by email.</p>' +
          '<form id="thanksForm"><textarea id="thanksText" maxlength="1000" placeholder="Thank you all so much…"></textarea>' +
          '<p class="error" id="thanksErr" hidden></p><button class="btn" id="thanksBtn">Send thank-you</button></form></div>';
      app.innerHTML = bar + '<div class="inside">' +
        '<div class="card-head">' + (card.cover_url ? '<img class="cover-mid" src="' + esc(card.cover_url) + '" alt="Card cover">' : '') +
        '<h1>' + esc(card.headline || card.occasion) + '</h1><p class="muted">For ' + esc(card.recipient_name) + ', with love from the team</p>' +
        '<div class="btns no-print" style="justify-content:center"><button class="btn secondary" id="pdfBtn">Save as PDF</button></div></div>' +
        '<div class="tiles">' + tiles + '</div>' + thanks + '</div>';
      var b2 = $('#backBtn');
      if (b2) b2.addEventListener('click', opts.back);
      $('#pdfBtn').addEventListener('click', function () { toast('Choose "Save as PDF" in the print window'); setTimeout(function () { window.print(); }, 300); });
      var tf = $('#thanksForm');
      if (tf) tf.addEventListener('submit', function (e) {
        e.preventDefault();
        var btn = $('#thanksBtn'), err = $('#thanksErr'); err.hidden = true;
        busy(btn, true, 'Sending…');
        api('post_thanks', { p_view: viewToken, p_text: $('#thanksText').value })
          .then(function () {
            tf.parentNode.innerHTML = '<h3>Thank-you sent</h3><p>' + esc($('#thanksText') ? $('#thanksText').value : '') + '</p><p class="small muted">Everyone who signed will get it by email.</p>';
          })
          .catch(function (ex) { busy(btn, false); err.textContent = ex.message; err.hidden = false; });
      });
    });
  }

  // =============================================================== START

  function start() {
    if (!API || API.indexOf('YOUR-PROJECT') >= 0) {
      app.innerHTML = '<div class="narrow panel"><h2>Almost there</h2><p>Add your Supabase details to <code>assets/config.js</code> to switch Team Cards on.</p></div>';
      return;
    }
    var m = params.get('m'), s = params.get('s'), o = params.get('o'), v = params.get('v');
    if (m) renderManage(m);
    else if (s) renderSign(s);
    else if (o) renderOpen(o);
    else if (v) renderView(v);
    else renderCreate();
  }

  start();
})();
