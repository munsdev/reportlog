/* evidence.js — Answering a request for evidence.
 *
 * Reached only from a link in a mail. The page stands on its own because
 * the link does: somebody asked months after filing may no longer have
 * their sign-in, and a request they cannot answer is not worth making.
 *
 * WHAT IS ON SCREEN IS DELIBERATELY SMALL. What was asked, in the
 * moderator's own words, and a box to put files in. There is no report text
 * here and no way to change an answer — a guessed token must not become a
 * way to read somebody's account, and the reporter was asked for files, not
 * invited to revise what they said.
 *
 * ITS OWN UPLOAD CODE, not the filing form's. attachments.js is bound to
 * the filing form's DOM, its own endpoint and a draft token it mints
 * itself; parameterising all three would put the path every report travels
 * at risk to save sixty lines here. The limits shown are the ones the
 * server sent, and THE SERVER ENFORCES THEM REGARDLESS — what this does
 * client-side is save somebody a failed upload, not decide anything.
 */
import { esc } from './answers.js';

var EV = { token: null, cfg: null, files: [], poll: null };

function evBox(){ return document.getElementById('evidence-box'); }

function evSize(n){
  if(n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if(n >= 1024) return Math.round(n / 1024) + ' KB';
  return n + ' bytes';
}

/* Same wording as the filing form's, and for the same reason: what the
   reporter needs to know, not what the pipeline is doing. */
var EV_LABEL = {
  uploading: 'Uploading', uploaded: 'Checking', pending: 'Checking',
  processing: 'Processing', clean: 'Ready', infected: 'Rejected',
  unreadable: "Couldn't be read", rejected: 'Not accepted',
  withdrawn: 'Removed', expired: 'Expired', failed: 'Upload failed',
};

function evErr(msg){
  var e = document.getElementById('ev-err');
  if(!e) return;
  if(!msg){ e.classList.remove('on'); return; }
  e.textContent = msg; e.classList.add('on');
}

function evRenderList(){
  var ul = document.getElementById('ev-list');
  if(!ul) return;
  /* The filing form's own list markup and classes (.attlist in
     public/css/reports.css), so a staged file looks the same in both
     places and neither needs CSS of its own. */
  var bad = ['infected', 'unreadable', 'rejected', 'expired', 'failed'];
  ul.innerHTML = EV.files.map(function(f){
    var cls = f.status === 'clean' ? 'ok' : (bad.indexOf(f.status) >= 0 ? 'bad' : '');
    return '<li><span class="nm">' + esc(f.name) + '</span>'
      + '<span class="sz">' + esc(evSize(f.size)) + '</span>'
      + (f.status === 'uploading'
        ? '<span class="attbar"><i data-pct="' + (f.pct || 0) + '"></i></span>' : '')
      + '<span class="stt ' + cls + '">' + esc(EV_LABEL[f.status] || f.status) + '</span></li>';
  }).join('');
  var send = document.getElementById('ev-send');
  if(send){
    var ready = EV.files.filter(function(f){ return f.status === 'clean'; }).length;
    send.disabled = !ready;
    send.textContent = ready ? ('Send ' + ready + ' file' + (ready === 1 ? '' : 's'))
      : 'Send';
  }
}

/* The status of what has been staged. The same polling the filing form
   does, because scanning and re-encoding take as long here as there. */
function evPoll(){
  if(!EV.files.length) return;
  fetch('/api/uploads/status?draft_token=' + encodeURIComponent(EV.cfg.draftToken))
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(d){
      // A bare array, not { slots: [...] } — slotStatuses returns the rows.
      if(!Array.isArray(d)) return;
      var by = {};
      d.forEach(function(s){ by[s.slot_token] = s.status; });
      EV.files.forEach(function(f){
        if(f.slot && by[f.slot]) f.status = by[f.slot];
      });
      evRenderList();
    }).catch(function(){});
}

function evAdd(file){
  if(EV.files.length >= EV.cfg.maxFiles){
    evErr(EV.cfg.maxFiles === 1
      ? 'This report takes one file. Remove the page and start again if you picked the wrong one.'
      : 'You can send at most ' + EV.cfg.maxFiles + ' files.');
    return;
  }
  evErr('');
  var entry = { name: file.name, size: file.size, status: 'uploading', pct: 0, slot: null };
  EV.files.push(entry);
  evRenderList();

  fetch('/api/evidence/' + encodeURIComponent(EV.token) + '/slots', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: file.name, type: file.type, size: file.size }),
  }).then(function(r){ return r.json().then(function(d){ return { ok: r.ok, d: d }; }); })
    .then(function(res){
      if(!res.ok){
        entry.status = 'failed';
        // The server's own words: it knows which limit was passed and this
        // page would only be guessing.
        evErr(res.d.error || 'Could not start the upload.');
        evRenderList();
        return;
      }
      entry.slot = res.d.slotToken;
      var xhr = new XMLHttpRequest();
      xhr.open('PUT', res.d.uploadUrl, true);
      xhr.setRequestHeader('Content-Type', file.type);
      xhr.upload.onprogress = function(e){
        if(e.lengthComputable){ entry.pct = Math.round((e.loaded / e.total) * 100); evRenderList(); }
      };
      xhr.onload = function(){
        if(xhr.status >= 200 && xhr.status < 300){
          entry.status = 'uploaded';
          evRenderList();
          /* The same hint the filing form sends. It carries the draft
             token because that is what authorises the slot — there is no
             session here — and it is only a hint either way: the media
             worker re-derives everything from the bytes in the bucket. */
          fetch('/api/uploads/' + encodeURIComponent(entry.slot) + '/complete', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ draft_token: EV.cfg.draftToken }),
          }).catch(function(){});
          if(!EV.poll) EV.poll = setInterval(evPoll, 3000);
        } else {
          entry.status = 'failed';
          evErr('That file did not finish uploading. You can try it again.');
          evRenderList();
        }
      };
      xhr.onerror = function(){
        entry.status = 'failed';
        evErr('That file did not finish uploading. You can try it again.');
        evRenderList();
      };
      xhr.send(file);
    })
    .catch(function(){
      entry.status = 'failed';
      evErr('Could not start the upload.');
      evRenderList();
    });
}

function evSend(){
  evErr('');
  var send = document.getElementById('ev-send');
  if(send) send.disabled = true;
  fetch('/api/evidence/' + encodeURIComponent(EV.token) + '/submit', { method: 'POST' })
    .then(function(r){ return r.json().then(function(d){ return { ok: r.ok, d: d }; }); })
    .then(function(res){
      if(!res.ok){
        evErr(res.d.error || 'Something went wrong.');
        evRenderList();
        return;
      }
      if(EV.poll){ clearInterval(EV.poll); EV.poll = null; }
      /* THE LINK IS SPENT NOW, and the page says so rather than leaving a
         Send button that will fail. It also says what happens next, because
         "thank you" alone leaves somebody wondering whether it worked. */
      evBox().innerHTML = '<h2 class="heading-style-h4 margin-bottom margin-tiny">Sent</h2>'
        + '<p class="text-size-small text-color-muted margin-bottom margin-xsmall">'
        + esc(res.d.attached) + ' file' + (res.d.attached === 1 ? '' : 's')
        + ' went with your report. A moderator will look at '
        + (res.d.attached === 1 ? 'it' : 'them') + ' along with everything else.</p>'
        + '<p class="text-size-small text-color-muted margin-bottom margin-xsmall">'
        + '<b>Nothing is published by sending it.</b> Whether your files may be '
        + 'published is a separate permission on your own page, and you can take '
        + 'it back at any time.</p>'
        + '<p class="text-size-small text-color-muted margin-bottom margin-xsmall">'
        + 'This link has now been used and will not work again.</p>';
    })
    .catch(function(){
      evErr('Something went wrong.');
      evRenderList();
    });
}

/* The page. One fetch, and everything it draws comes from the answer. */
function showEvidence(token){
  document.querySelectorAll('.tab').forEach(function(x){ x.classList.remove('active'); });
  document.querySelectorAll('.pane').forEach(function(x){ x.classList.remove('active'); });
  document.getElementById('pane-evidence').classList.add('active');
  window.scrollTo(0, 0);

  EV.token = token;
  var box = evBox();
  box.textContent = 'Checking…';

  fetch('/api/evidence/' + encodeURIComponent(token))
    .then(function(r){ return r.json().then(function(d){ return { ok: r.ok, d: d }; }); })
    .then(function(res){
      if(!res.ok){
        box.innerHTML = '<h2 class="heading-style-h4 margin-bottom margin-tiny">This link is closed</h2>'
          + '<p class="text-size-small text-color-muted margin-bottom margin-xsmall">'
          + esc(res.d.error || 'This link is no longer open.') + '</p>';
        return;
      }
      EV.cfg = res.d;
      var d = res.d;
      var when = d.askedAt ? new Date(d.askedAt).toLocaleDateString() : '';
      var cap = d.maxFiles === 1
        ? 'One file.'
        : 'Up to ' + d.maxFiles + ' files.';

      box.innerHTML =
        '<p class="text-size-small text-color-muted margin-bottom margin-xsmall">'
        + 'Somebody reviewing your report' + (d.logbookTitle ? ' in <b>' + esc(d.logbookTitle) + '</b>' : '')
        + ' has asked you for the photos, video, audio or documents you said you had.'
        + (when ? ' They asked on ' + esc(when) + '.' : '') + '</p>'

        /* THE MODERATOR'S OWN WORDS, set apart and escaped. Set apart
           because it is somebody else writing to the reporter and must not
           read as the site's own text; escaped because it is typed by a
           person and this application has no HTML sanitiser, which is the
           same decision the editorial note made. */
        + '<div class="enote"><div class="enote_by">What they asked for</div>'
        + '<p>' + esc(d.message) + '</p></div>'

        + '<p class="own-danger text-size-small margin-bottom margin-xsmall">'
        + '<b>You do not have to send anything.</b> Closing this page sends nothing, '
        + 'and you can stop being asked at all by switching off '
        + '&ldquo;a moderator may ask me for photos, video or documents&rdquo; on your '
        + 'own page.</p>'

        + (d.uploads
          ? '<p class="lab form_label-sep">The files</p>'
            + '<p class="text-size-small text-color-muted margin-bottom margin-xsmall">'
            + esc(cap) + ' They are scanned and re-encoded, which strips the location '
            + 'and the camera details before anybody sees them.</p>'
            + '<input class="form_input" type="file" id="ev-file" multiple>'
            + '<ul class="attlist" id="ev-list"></ul>'
            + '<div class="form_error" id="ev-err"></div>'
            + '<button class="button is-secondary is-small" id="ev-send" disabled>Send</button>'
            + '<p class="text-size-small text-color-muted margin-bottom margin-xsmall">'
            + 'Nothing is sent until you press Send, and the link works once.</p>'
          : '<p class="own-danger text-size-small margin-bottom margin-xsmall">'
            + 'This site is not accepting files at the moment, so there is nothing to '
            + 'upload here. Whoever asked you can tell you what to do instead.</p>');

      var picker = document.getElementById('ev-file');
      if(picker){
        picker.addEventListener('change', function(){
          [].slice.call(this.files).forEach(evAdd);
          this.value = '';
        });
      }
      var send = document.getElementById('ev-send');
      if(send) send.addEventListener('click', evSend);
    })
    .catch(function(){
      box.innerHTML = '<div class="empty_component">Something went wrong.</div>';
    });
}

export {
  showEvidence,
};
