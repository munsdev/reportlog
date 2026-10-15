/* admin-settings.js — What the deployment recruits for, whether it accepts
 * reports, its imprint and privacy policy, its name, publishing, and
 * attachment settings.
 *
 * Lifted out of the one <script> public/index.html used to carry, in the
 * order it was in. docs/frontend-files.md has the whole map.
 */

import { esc } from './answers.js';
import { showReport } from './routes.js';
import { applyDevMode } from './feedback.js';
import { initLegalText } from './gate.js';
import { applyBrand, applyLook, paintBrand } from './identity.js';
import { setupBrand } from './setup.js';
import { toast } from './admin-editors.js';

/* ---------- accepting reports ----------

   renderIntakeSwitch, not renderIntake: the coordinator intake pane below
   already owns that name and the whole `intake-*` id space. A second
   function with the same name is not an error anywhere — the later
   declaration silently wins — so the admin page called the coordinator's
   renderer and threw. Found by the browser suite, which is the only thing
   that would have. */
function renderIntakeSwitch(){
  fetch('/api/admin/intake').then(function(r){ return r.json(); }).then(function(d){
    document.getElementById('intake-switch-on').checked=!!d.open;
    document.getElementById('intake-switch-status').textContent=d.open
      ? 'The form is open.'+(d.isSet?'':' Nobody has set this; open is the default.')
      : 'The form is closed. Reports already filed are unaffected, and corrections'
        +' to them still work.';
  });
}
document.getElementById('intake-switch-save').addEventListener('click',function(){
  var err=document.getElementById('intake-switch-err'); err.classList.remove('on');
  fetch('/api/admin/intake',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({open:document.getElementById('intake-switch-on').checked})})
    .then(function(r){ return r.json().then(function(d){ return {ok:r.ok,d:d}; }); })
    .then(function(res){
      if(!res.ok){ err.textContent=res.d.error||'Something went wrong'; err.classList.add('on'); return; }
      renderIntakeSwitch();
    });
});

/* ---------- the imprint and the privacy policy ----------

   Free text, stored as written and published as written. Nothing about it
   is validated, because there is nothing to validate it against: what
   these pages have to say is decided by the jurisdiction the deployment
   runs from, and a field list here would be this software claiming to know
   which fields those are.

   The editor opens on an outline when nothing has been published, and the
   line above the box says which of the two is in it. That distinction is
   the point of serving the outline here rather than storing it as the
   column's default: an operator who reads the outline and closes the tab
   has published nothing, and their page goes on saying so. */
function renderLegal(){
  fetch('/api/admin/legal').then(function(r){ return r.json(); }).then(function(d){
    ['impressum','privacy'].forEach(function(kind){
      var box=document.getElementById('legal-'+kind);
      var state=document.getElementById('legal-'+kind+'-state');
      var got=d[kind]||{};
      box.value=got.text||'';
      box.maxLength=d.maxLength||100000;
      state.textContent=got.published
        ? 'Published. This is what the page shows now.'
        : 'Not published. The page says this deployment has not published one,'
          + ' and it goes on saying that until you save. What is in the box is'
          + ' an outline to work from, not a notice — saving it as it stands'
          + ' would publish the outline.';
      document.getElementById('legal-'+kind+'-clear').style.display=got.published?'':'none';
    });
  });
}
function saveLegal(kind,text){
  var err=document.getElementById('legal-'+kind+'-err'); err.classList.remove('on');
  fetch('/api/admin/legal',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({kind:kind,text:text})})
    .then(function(r){ return r.json().then(function(d){ return {ok:r.ok,d:d}; }); })
    .then(function(res){
      if(!res.ok){ err.textContent=res.d.error||'That could not be saved'; err.classList.add('on'); return; }
      renderLegal();
      /* The public pane is in the DOM from the first byte, so it is showing
         the old answer right now. Refresh it rather than leaving an admin
         to discover the page disagrees with the editor. */
      initLegalText();
    });
}
['impressum','privacy'].forEach(function(kind){
  document.getElementById('legal-'+kind+'-save').addEventListener('click',function(){
    saveLegal(kind,document.getElementById('legal-'+kind).value);
  });
  /* Taking one down is a real thing to want and is not the same as saving
     an empty box by accident, so it is its own button and it asks. */
  document.getElementById('legal-'+kind+'-clear').addEventListener('click',function(){
    var what=kind==='impressum'?'imprint':'privacy policy';
    if(!confirm('Take the '+what+' down? The page will say this deployment has not published one.')) return;
    saveLegal(kind,'');
  });
});

/* ---------- the site's name ---------- */
function renderIdentity(){
  fetch('/api/admin/identity').then(function(r){ return r.json(); }).then(function(d){
    /* The field shows what was STORED, not what it resolved to — otherwise
       an operator who never chose a name sees "ReportLog" in the box and
       cannot tell whether that is their choice or the default. */
    document.getElementById('identity-name').value = d.stored || '';
    document.getElementById('identity-name').placeholder = d.software;
    document.getElementById('identity-status').textContent = d.isDefault
      ? 'Currently ' + d.siteName + ', which is the default because nobody has set a name.'
      : 'Currently ' + d.siteName + '.';
    identityPreview();
  });
}
/* The same live preview the wizard has. An operator renaming the site months
   later is the likelier one to want an accent, and until now this panel
   neither explained the convention nor showed it. Same parser as the wizard
   and the server, which the suite holds all three to. */
function identityPreview(){
  var raw=document.getElementById('identity-name').value.trim();
  var b=setupBrand(raw||'ReportLog');
  paintBrand(document.getElementById('identity-preview'), b, b.plain);
}
document.getElementById('identity-name').addEventListener('input', identityPreview);
document.getElementById('identity-save').addEventListener('click',function(){
  var err=document.getElementById('identity-err'); err.classList.remove('on');
  fetch('/api/admin/identity',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({siteName:document.getElementById('identity-name').value})})
    .then(function(r){ return r.json().then(function(d){ return {ok:r.ok,d:d}; }); })
    .then(function(res){
      if(!res.ok){ err.textContent=res.d.error||'Something went wrong'; err.classList.add('on'); return; }
      renderIdentity();
      /* Re-read the brand rather than reloading: the operator just renamed
         the site and every header should say so before they navigate. */
      fetch('/api/site-access/status').then(function(r){ return r.json(); })
        .then(function(d){ applyLook(d); applyBrand(d); });
    });
});

/* ---------- publishing ---------- */
/* Two switches that gate what leaves the building. Neither touches a
   report's fingerprint, and the copy says so, because an admin pressing
   something on a page about an append-only archive is entitled to know
   whether they are about to change the record or only the shop window. */
function renderPublication(){
  fetch('/api/admin/publication').then(function(r){ return r.json(); }).then(function(d){
    document.getElementById('pub-archive').checked=!!d.publicArchive;
    document.getElementById('pub-dist').checked=!!d.distribution;

    /* "Nobody has pressed this" is a real third state and worth saying.
       Both columns are NULL until somebody decides, and the two resolve in
       opposite directions — so an admin who has never touched this page is
       publishing and not distributing, and neither is obvious from a
       checkbox alone. */
    var bits=[];
    bits.push(d.publicArchive
      ? 'This site publishes a public archive.'
      : 'This site publishes nothing publicly.');
    if(!d.publicArchiveSet) bits.push('(nobody has set this; publishing is the default)');
    bits.push(d.distribution
      ? 'Onward distribution is allowed.'
      : 'Nothing is distributed onward.');
    if(!d.distributionSet) bits.push('(nobody has set this; off is the default)');
    document.getElementById('pub-status').textContent=bits.join(' ');

    /* Said by the server rather than hardcoded here, so the day
       distribution exists this note disappears on its own instead of
       lingering as a line that used to be true. */
    document.getElementById('pub-dist-note').style.display=
      d.distributionImplemented ? 'none' : '';
  });
}
document.getElementById('pub-save').addEventListener('click',function(){
  var err=document.getElementById('pub-err'); err.classList.remove('on');
  fetch('/api/admin/publication',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      publicArchive: document.getElementById('pub-archive').checked,
      distribution: document.getElementById('pub-dist').checked,
    })})
    .then(function(r){ return r.json().then(function(d){ return {ok:r.ok,d:d}; }); })
    .then(function(res){
      if(!res.ok){ err.textContent=res.d.error||'Something went wrong'; err.classList.add('on'); return; }
      renderPublication();
    });
});

/* ---------- attachment settings ---------- */
function renderAttachments(){
  var st=document.getElementById('att-status');
  fetch('/api/admin/attachments').then(function(r){ return r.json(); }).then(function(d){
    document.getElementById('att-enabled').checked = d.enabled;
    document.querySelectorAll('.att-kind').forEach(function(c){
      c.checked = (d.kinds||[]).indexOf(c.value) !== -1;
    });
    // Storage being configured is not something this page can change, so
    // saying so plainly beats a switch that appears to work and does not.
    st.textContent = d.storageConfigured
      ? (d.enabled ? 'Accepting: ' + (d.kinds.join(', ') || 'nothing') + '.'
                   : 'Not accepting attachments.')
      : 'Storage is not configured on this server, so attachments are off regardless of this switch.';
  }).catch(function(){ st.textContent='Could not read the current setting.'; });
}
document.getElementById('att-save').addEventListener('click',function(){
  var err=document.getElementById('att-err'); err.classList.remove('on');
  var kinds=[];
  document.querySelectorAll('.att-kind').forEach(function(c){ if(c.checked) kinds.push(c.value); });
  fetch('/api/admin/attachments',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({ enabled: document.getElementById('att-enabled').checked, kinds: kinds })})
    .then(function(r){ return r.json().then(function(d){ return {ok:r.ok,d:d}; }); })
    .then(function(res){
      if(!res.ok){ err.textContent=res.d.error||'Something went wrong'; err.classList.add('on'); return; }
      renderAttachments();
    });
});

/* ---------- how big, how long, how many ----------
   Eight numbers, resolved through three layers: this logbook, this site,
   and what ships. The panel shows the SITE layer, and its whole job is to
   keep "I set this" and "I inherited this" apart. An operator shown only
   the effective number cannot tell them apart, and the first thing they do
   then is type all eight of the numbers already showing — which silently
   freezes the deployment against every later change underneath it. So an
   inherited value is the PLACEHOLDER and an empty box means inherit. */
var LIM_MB = 1024 * 1024;

/* Bytes in the API, megabytes on the page. One unit in the column and in
   every route; the conversion lives here, at the edge, rather than in four
   places that would each round differently. */
function limToBox(value, unit){
  if(value === null || value === undefined) return '';
  return unit === 'mb' ? String(Math.round(value / LIM_MB)) : String(value);
}
function limFromBox(text, unit){
  var t = String(text == null ? '' : text).trim();
  if(t === '') return null;               // emptied: defer to the layer above
  if(!/^[0-9]+$/.test(t)) return NaN;     // caught before it reaches the server
  var n = Number(t);
  return unit === 'mb' ? n * LIM_MB : n;
}

/* ONE IMPLEMENTATION FOR BOTH PANELS, because there are two of these — the
   site's limits here and a logbook's own in the builder — and they differ
   only in which layer the boxes own and what sits underneath them. Two
   copies of the megabyte conversion is how the two round differently, and
   two copies of "an empty box means inherit" is how one of them forgets. */

/* Where the number in force came from, said in words rather than as a label
   an operator has to decode. `mine` is the layer this panel's boxes write. */
function limSource(row, unit, mine){
  var box = function(v){ return limToBox(v, unit); };
  if(mine === 'logbook'){
    if(row.logbook !== null && row.logbook !== undefined) return 'Set on this logbook: ' + box(row.logbook) + '.';
    if(row.site !== null && row.site !== undefined) return 'From the site: ' + box(row.site) + '.';
    return 'Not set anywhere, so ' + box(row.shipped) + ' applies — the number this software ships with.';
  }
  if(row.site !== null && row.site !== undefined) return 'Set here: ' + box(row.site) + '.';
  return 'Not set here, so ' + box(row.shipped) + ' applies — the number this software ships with.';
}

/* Fill one panel's boxes from the three layers. Returns how many this layer
   has set, which is the only thing its status line needs. */
function limFill(root, layers, mine){
  var set = 0;
  root.querySelectorAll('.lim-n').forEach(function(input){
    var key = input.dataset.key, unit = input.dataset.unit, row = (layers || {})[key];
    if(!row) return;
    // The box holds only what THIS layer stores. What it would inherit is
    // the PLACEHOLDER, so an empty box reads as "whatever is underneath"
    // rather than as nothing at all — the distinction the whole panel is
    // for, and the one an effective-value-only box destroys.
    var own = mine === 'logbook' ? row.logbook : row.site;
    var under = mine === 'logbook'
      ? ((row.site === null || row.site === undefined) ? row.shipped : row.site)
      : row.shipped;
    input.value = limToBox(own, unit);
    input.placeholder = limToBox(under, unit);
    input.classList.remove('is-invalid');
    if(own !== null && own !== undefined) set++;
    var note = root.querySelector('.limsrc[data-key="' + key + '"]');
    if(note) note.textContent = limSource(row, unit, mine);
  });
  return set;
}

/* Reads every box, so a save carries the whole layer. Sending only the boxes
   somebody touched would make an emptied box indistinguishable from one that
   was never visited, and emptying is how a limit is cleared. */
function limRead(root){
  var body = {}, bad = null;
  root.querySelectorAll('.lim-n').forEach(function(input){
    var v = limFromBox(input.value, input.dataset.unit);
    input.classList.remove('is-invalid');
    if(Number.isNaN(v)){ bad = bad || input; input.classList.add('is-invalid'); return; }
    body[input.dataset.key] = v;
  });
  return { body: body, bad: bad };
}

/* Every key cleared — "stop choosing", which is not the same as choosing
   today's numbers and keeping them forever. */
function limClearBody(root){
  var body = {};
  root.querySelectorAll('.lim-n').forEach(function(input){ body[input.dataset.key] = null; });
  return body;
}

var LIM_BAD_NUMBER = 'A limit has to be a whole number, or empty to use the'
  + ' number underneath it.';

function renderUploadLimits(){
  var st = document.getElementById('lim-state');
  var root = document.getElementById('panel-upload-limits');
  fetch('/api/admin/upload-limits').then(function(r){ return r.json(); }).then(function(d){
    var set = limFill(root, d.limits, 'site');
    st.textContent = set === 0
      ? 'Every limit is the one this software ships with. Nothing here has been set.'
      : set + ' of 8 set here; the rest are the shipped numbers.';
    if(d.storageConfigured === false){
      st.textContent += ' Storage is not configured on this server, so nothing'
        + ' is being accepted regardless of these numbers.';
    }
  }).catch(function(){ st.textContent = 'Could not read the current limits.'; });
}

document.getElementById('lim-save').addEventListener('click',function(){
  var err = document.getElementById('lim-err'); err.classList.remove('on');
  var read = limRead(document.getElementById('panel-upload-limits'));
  if(read.bad){
    err.textContent = LIM_BAD_NUMBER;
    err.classList.add('on');
    read.bad.focus();
    return;
  }
  fetch('/api/admin/upload-limits',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(read.body)})
    .then(function(r){ return r.json().then(function(d){ return {ok:r.ok,d:d}; }); })
    .then(function(res){
      if(!res.ok){ err.textContent=res.d.error||'Something went wrong'; err.classList.add('on'); return; }
      renderUploadLimits();
    })
    .catch(function(){ err.textContent='Could not save the limits.'; err.classList.add('on'); });
});

document.getElementById('lim-reset').addEventListener('click',function(){
  /* Clears the whole layer rather than writing the shipped numbers into
     it. An operator pressing this wants to stop choosing, which is not the
     same as choosing today's defaults and keeping them forever. */
  var err = document.getElementById('lim-err'); err.classList.remove('on');
  var body = limClearBody(document.getElementById('panel-upload-limits'));
  fetch('/api/admin/upload-limits',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(body)})
    .then(function(r){ return r.json().then(function(d){ return {ok:r.ok,d:d}; }); })
    .then(function(res){
      if(!res.ok){ err.textContent=res.d.error||'Something went wrong'; err.classList.add('on'); return; }
      renderUploadLimits();
    })
    .catch(function(){ err.textContent='Could not save the limits.'; err.classList.add('on'); });
});

/* ---------- the words that raise a review flag ----------
   Three states, and the box cannot collapse them: not chosen (the shipped
   list), chosen, and chosen-as-empty. The last is an operator running no
   keyword matching on purpose, and showing it as "using the defaults" would
   quietly discard their decision the next time somebody pressed save. */
function renderReviewKeywords(){
  var st=document.getElementById('rkw-state');
  fetch('/api/admin/review-keywords').then(function(r){ return r.json(); }).then(function(d){
    var terms=d.terms||[];
    document.getElementById('rkw-terms').value = terms.join('\n');
    if(d.usingDefault){
      st.textContent = 'Using the shipped list: '+d.defaultCount+' words and phrases.'
        +' Nobody here has edited it.';
    } else if(terms.length===0){
      /* Said as a choice, because it is one. */
      st.textContent = 'No keyword matching. This box was saved empty'
        + whoAndWhen(d) + '.';
    } else {
      st.textContent = terms.length+' word'+(terms.length===1?'':'s')
        +' and phrases, saved' + whoAndWhen(d) + '.';
    }
  }).catch(function(){ st.textContent='Could not read the current list.'; });
}
/* Who last changed the list that decides which reports get a second look is
   a thing somebody should be able to ask about, so it is on the page rather
   than only in the column. Both halves are optional: a list set before the
   columns existed has neither. */
function whoAndWhen(d){
  var out='';
  if(d.setBy) out += ' by '+d.setBy;
  if(d.setAt) out += ' on '+new Date(d.setAt).toLocaleString();
  return out;
}
function postReviewKeywords(body){
  var err=document.getElementById('rkw-err'); err.classList.remove('on');
  fetch('/api/admin/review-keywords',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(body)})
    .then(function(r){ return r.json().then(function(d){ return {ok:r.ok,d:d}; }); })
    .then(function(res){
      if(!res.ok){ err.textContent=res.d.error||'Something went wrong'; err.classList.add('on'); return; }
      renderReviewKeywords();
    })
    .catch(function(){ err.textContent='Could not save the list.'; err.classList.add('on'); });
}
document.getElementById('rkw-save').addEventListener('click',function(){
  /* The textarea goes over as written, newlines and all. The server
     trims, lowercases, drops blanks and de-duplicates — one copy of those
     rules, in src/reviewKeywords.js, so a term typed here and a term in a
     template are normalized the same way. */
  postReviewKeywords({ terms: document.getElementById('rkw-terms').value });
});
document.getElementById('rkw-reset').addEventListener('click',function(){
  /* Not "send the shipped list back": an operator pressing this wants
     whatever this release ships, not whatever the box was showing. */
  postReviewKeywords({ reset: true });
});

function renderDevMode(){
  fetch('/api/admin/dev-mode').then(function(r){ return r.json(); }).then(function(d){
    document.getElementById('dev-mode-status').textContent = d.active
      ? ('On until '+new Date(d.until).toLocaleString()+'.')
      : ('Off. It will arm itself for '+d.defaultHours+' hours the next time a new build is deployed.');
  });
}
function postDevMode(body){
  var err=document.getElementById('dev-mode-err'); err.classList.remove('on');
  fetch('/api/admin/dev-mode',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
    .then(function(r){ return r.json().then(function(d){ return {ok:r.ok,d:d}; }); })
    .then(function(res){
      if(!res.ok){ err.textContent=res.d.error||'Something went wrong'; err.classList.add('on'); return; }
      renderDevMode();
      applyDevMode({devMode:res.d.active,devModeUntil:res.d.until});
      /* IT APPLIED WHEN THEY PRESSED IT. These two buttons write straight
         away — there is no Save next to them — and part of what was
         confusing about this page is that some things save when you touch
         them and some need a button, with nothing on screen saying which.
         After the server has answered, never from the click. */
      toast(res.d.active ? 'Development notice is on.' : 'Development notice is off.');
    });
}
document.getElementById('dev-mode-on').addEventListener('click',function(){ postDevMode({hours:6}); });
document.getElementById('dev-mode-off').addEventListener('click',function(){ postDevMode({off:true}); });

var ALOG_LABEL={
  identity:'identity details',
  attachment_original:'untouched original of an attached file',
  attachment_preview:'preview of an unpublished file',
  audit_log:'this access log'
};
function renderAccessLog(){
  var box=document.getElementById('admin-access-log');
  var months=document.getElementById('alog-months').value;
  box.innerHTML='<div class="empty_component">Loading…</div>';
  fetch('/api/moderators/access-log?months='+encodeURIComponent(months))
    .then(function(r){ return r.ok?r.json():null; })
    .then(function(d){
      if(!d){ box.innerHTML='<div class="empty_component">Could not load the access log.</div>'; return; }
      if(!d.entries.length){ box.innerHTML='<div class="empty_component">Nothing opened in this period.</div>'; return; }
      box.innerHTML=d.entries.map(function(e){
        var what=ALOG_LABEL[e.kind]||e.kind;
        var where=e.public_ref
          ? '<a href="/r/'+encodeURIComponent(e.public_ref)+'" data-alog-ref>'+esc(e.public_ref)+'</a>'
          : '<span class="who">(not about one report)</span>';
        // No reason on the routine kinds, and none on anything recorded
        // before reasons were required. Those two look different on
        // purpose: one was never asked for, the other predates the ask.
        var why=e.reason
          ? '<br>'+esc(e.reason)
          : (e.kind==='identity'||e.kind==='attachment_original'
              ? '<br><span class="who">no reason recorded — this predates the requirement</span>'
              : '');
        return '<div class="row"><span class="who">'+esc(new Date(e.accessed_at).toISOString().replace('T',' ').slice(0,16))+'</span>'+
          '<span><b>'+esc(e.staff_email)+'</b> opened the '+esc(what)+' on '+where+why+'</span></div>';
      }).join('');
      box.querySelectorAll('[data-alog-ref]').forEach(function(a){
        a.addEventListener('click',function(ev){
          ev.preventDefault(); showReport(a.getAttribute('href').replace('/r/',''));
        });
      });
    }).catch(function(){ box.innerHTML='<div class="empty_component">Could not load the access log.</div>'; });
}

document.getElementById('alog-months').addEventListener('change',renderAccessLog);

/* WHAT USED TO BE HERE, and why it is gone. An Access Manager reached this
   page for four panels and the rest was admin-only, so renderAdmin hid the
   others with display:none — selecting them by MATCHING FOUR HEADING
   STRINGS BY NAME. It worked. It was also one rename away from either
   hiding a panel an Access Manager needs or showing one they cannot use,
   and it left them on a page titled "Admin" that told them most of it was
   not theirs.

   Those four panels are their own pane now, and the split follows the route
   guards rather than a list of headings. This page is admin-only and can
   render all of itself. */

export {
  renderAccessLog, renderAttachments, renderDevMode, renderIdentity, renderIntakeSwitch,
  renderLegal, renderPublication, renderReviewKeywords,
  renderUploadLimits,
  LIM_BAD_NUMBER, limClearBody, limFill, limRead,
};
