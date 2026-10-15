/* moderate.js — By the numbers, and the moderator queue.
 *
 * Lifted out of the one <script> public/index.html used to carry, in the
 * order it was in. docs/frontend-files.md has the whole map.
 */

import { esc, questionsFor } from './answers.js';
import { REASON_REPORTER_SEES, openReason, openRestore } from './session.js';
import {
  VERACITY_LABELS, countActive, plural, reportCardHtml, updateFilterBtn,
} from './board.js';
import { openIncident, openNote, openSeverity } from './mine.js';
import { renderListReview } from './list-review.js';

/* ---------- by the numbers ---------- */
// Deliberately renders every count already broken out. There is no single
// headline figure, because a bare "N incidents" is the number that gets
// quoted stripped of the caveat that these are reviewed accounts, not
// verified facts.
function renderStats(){
  var box=document.getElementById('stats-box');
  box.innerHTML='Loading…';
  fetch('/api/stats').then(function(r){ return r.ok?r.json():null; }).then(function(d){
    if(!d){ box.innerHTML='<div class="empty_component">Couldn\'t load the numbers.</div>'; return; }
    var disp=d.confirmed_reports.by_disposition;
    var pub=d.published_reports;
    function rows(obj,labelFn){
      var keys=Object.keys(obj).filter(function(k){ return obj[k]; });
      if(!keys.length) return '<div class="statrow"><span>Nothing yet</span></div>';
      keys.sort(function(a,b){ return obj[b]-obj[a]; });
      return keys.map(function(k){
        return '<div class="statrow"><span>'+esc(labelFn?labelFn(k):k)+'</span><span class="n">'+obj[k]+'</span></div>';
      }).join('');
    }
    box.innerHTML=
      '<p class="asof">As of '+esc(new Date(d.as_of).toLocaleString())+'</p>'+
      '<div class="callout"><p>'+esc(d.note)+'</p></div>'+
      '<div class="panel_component is-raised margin-bottom margin-xsmall"><h2 class="heading-style-h4 margin-bottom margin-tiny">Every confirmed report</h2>'+
        '<p class="text-size-small text-color-muted margin-bottom margin-xsmall">Including the ones that were never published. This is the denominator &mdash; the approval rate is checkable from it.</p>'+
        '<div class="statgrid">'+
          '<div class="statbox"><div class="v">'+disp.published+'</div><div class="k">Published</div></div>'+
          '<div class="statbox"><div class="v">'+disp.under_review+'</div><div class="k">Under review</div></div>'+
          '<div class="statbox"><div class="v">'+disp.declined+'</div><div class="k">Declined</div></div>'+
          '<div class="statbox"><div class="v">'+disp.unclear+'</div><div class="k">Unclear</div></div>'+
          '<div class="statbox"><div class="v">'+disp.withdrawn+'</div><div class="k">Withdrawn</div></div>'+
        '</div>'+
        '<p class="text-size-small text-color-muted margin-bottom margin-xsmall">'+esc(d.confirmed_reports.excludes)+'</p>'+
      '</div>'+
      /* THE FROZEN BREAKDOWN. The veracity verdict is withdrawn, so nothing
         assesses one and every published report sits at "Pending review".
         The figure is still shown because /api/v1/stats still publishes it
         to honour its stability promise, and a staff screen that quietly
         dropped a number the public API still serves would leave an
         operator unable to explain the API to anybody who asked. The
         heading says what it is rather than implying a judgement. */
      '<div class="panel_component is-raised margin-bottom margin-xsmall"><h2 class="heading-style-h4 margin-bottom margin-tiny">Published reports &mdash; the withdrawn veracity field</h2>'+
        '<p class="text-size-small text-color-muted margin-bottom margin-xsmall">This archive no longer records a verdict on whether an account is true. The field is kept, reading <b>pending</b> for everything, because the public API promised not to remove it without a v2. Where a judgement is owed, the moderator who published writes a note.</p>'+
        rows(pub.by_veracity,function(k){ return VERACITY_LABELS[k]||k; })+'</div>'+
      '<div class="panel_component is-raised margin-bottom margin-xsmall"><h2 class="heading-style-h4 margin-bottom margin-tiny">Corroboration</h2>'+
        '<div class="statrow"><span>Accounts corroborated by at least one other</span><span class="n">'+pub.corroboration.corroborated_accounts+'</span></div>'+
        '<div class="statrow"><span>Single accounts</span><span class="n">'+pub.corroboration.single_accounts+'</span></div>'+
        '<div class="statrow"><span>Distinct incidents with more than one account</span><span class="n">'+pub.corroboration.distinct_incidents_with_multiple_accounts+'</span></div>'+
      '</div>'+
      '<div class="panel_component is-raised margin-bottom margin-xsmall"><h2 class="heading-style-h4 margin-bottom margin-tiny">By severity</h2>'+rows(pub.by_severity,function(k){ return k==='null'?'Not yet assessed':k; })+'</div>'+
      // One panel per logbook, broken out only by the questions its maker
      // marked as filters — the same rule the board follows.
      Object.keys(pub.by_logbook||{}).map(function(slug){
        var b=pub.by_logbook[slug];
        return '<div class="panel_component is-raised margin-bottom margin-xsmall"><h2 class="heading-style-h4 margin-bottom margin-tiny">'+esc(b.title)+'</h2>'+
          '<div class="statrow"><span>Published reports</span><span class="n">'+b.published+'</span></div>'+
          Object.keys(b.by_question).map(function(k){
            var q=b.by_question[k];
            return '<p class="lab form_label-sep">'+esc(q.label)+'</p>'+rows(q.counts)+
              (q.unanswered?'<div class="statrow"><span>Not answered</span><span class="n">'+q.unanswered+'</span></div>':'');
          }).join('')+'</div>';
      }).join('');
  }).catch(function(){ box.innerHTML='<div class="empty_component">Couldn\'t load the numbers.</div>'; });
}

/* ---------- moderators ---------- */
var MODS_DEFAULTS={status:'all',sort:'newest'};
var modsF={status:'all',sort:'newest'};
var MODS_STATUS_ORDER=['pending','valid','unknown','invalid','withdrawn'];

var modsSearchTimer=null;
document.getElementById('mods-q').addEventListener('input',function(){
  clearTimeout(modsSearchTimer);
  modsSearchTimer=setTimeout(renderModerators,300);
});
document.getElementById('mods-filter-btn').addEventListener('click',function(){
  var r=document.querySelector('input[name="modsf-status"][value="'+modsF.status+'"]')
     || document.querySelector('input[name="modsf-status"][value="all"]');
  r.checked=true;
  document.getElementById('modsf-sort').value=modsF.sort;
  document.getElementById('ovl-modsfilter').classList.add('on');
});
document.getElementById('modsf-cancel').addEventListener('click',function(){
  document.getElementById('ovl-modsfilter').classList.remove('on');
});
document.getElementById('modsf-clear').addEventListener('click',function(){
  modsF={status:'all',sort:'newest'};
  document.getElementById('ovl-modsfilter').classList.remove('on');
  renderModerators();
});
document.getElementById('modsf-go').addEventListener('click',function(){
  modsF={
    status:(document.querySelector('input[name="modsf-status"]:checked')||{}).value||'all',
    sort:document.getElementById('modsf-sort').value
  };
  document.getElementById('ovl-modsfilter').classList.remove('on');
  renderModerators();
});
// The press pack, as it stands on disk. Deliberately shows a file that has
// not been built rather than hiding it: a gap means nobody has rebuilt the
// pack since something changed, and that is the thing worth noticing.
function renderPress(){
  var stamp=document.getElementById('press-stamp');
  var box=document.getElementById('press-list');
  stamp.textContent='Loading…';
  box.innerHTML='';
  fetch('/api/press').then(function(r){
    if(!r.ok) throw new Error('press');
    return r.json();
  }).then(function(d){
    stamp.innerHTML=d.version
      ? ('Built from <b>'+esc(d.version)+'</b> · '+esc(d.commit||'')+
         ' · '+esc((d.built_at||'').slice(0,10)))
      : 'No documents have been published yet.';
    // A card each rather than a row of filenames. Somebody choosing
    // between five documents needs to know what is in them; the file name
    // is the least useful thing on the card and is not shown at all.
    d.files.forEach(function(f){
      var row=document.createElement('div');
      row.className='ab-card';
      row.style.marginBottom='12px';
      var size=f.bytes===null ? '' :
        (f.bytes>1048576 ? (f.bytes/1048576).toFixed(1)+' MB'
                         : Math.max(1,Math.round(f.bytes/1024))+' KB');
      var meta=[];
      if(size) meta.push(size);
      // A file carrying its own version is one the release build does not
      // rebuild. Say so, and say which version it is, rather than letting
      // the pack's stamp at the top of the page speak for it.
      if(f.version) meta.push(esc(f.version));
      if(f.version && d.version && f.version!==d.version){
        meta.push('older than the rest of this list');
      }
      if(f.note) meta.push(esc(f.note));
      row.innerHTML=
        '<h4>'+esc(f.label||f.name)+'</h4>'+
        (f.blurb?'<p>'+esc(f.blurb)+'</p>':'')+
        (meta.length?'<p class="ab-meta">'+meta.map(function(m){
          return '<span>'+m+'</span>'; }).join('')+'</p>':'')+
        (f.bytes===null
          ? '<p class="prsmiss">Not built yet.</p>'
          : '<a class="button is-secondary is-small" href="/api/press/'+encodeURIComponent(f.key)+'">Download</a>');
      box.appendChild(row);
    });
  }).catch(function(){
    stamp.textContent='Could not load the pack just now.';
  });
}

function renderModerators(){
  renderListReview();
  var mqs=new URLSearchParams({status:modsF.status});
  var mq=document.getElementById('mods-q').value.trim();
  if(mq) mqs.set('q', mq);
  if(modsF.sort!=='newest') mqs.set('sort', modsF.sort);
  updateFilterBtn('mods-filter-btn',countActive(modsF,MODS_DEFAULTS));
  fetch('/api/moderators/reports?'+mqs.toString()).then(function(r){ return r.json(); })
  .then(questionsFor).then(function(list){
    var box=document.getElementById('mods-list');
    var counts={};
    list.forEach(function(r){ var k=r.withdrawn?'withdrawn':r.moderation_status; counts[k]=(counts[k]||0)+1; });
    var parts=[plural(list.length,'report')];
    MODS_STATUS_ORDER.forEach(function(k){ if(counts[k]) parts.push(counts[k]+' '+k); });
    document.getElementById('mods-summary').textContent=list.length?parts.join(' · '):'';
    if(!list.length){
      box.innerHTML='<div class="empty_component">'+
        ((mq||countActive(modsF,MODS_DEFAULTS))?'No reports match that.':'No reports yet.')+'</div>';
      return;
    }
    var modsById={}; list.forEach(function(r){ modsById[r.thread_id]=r; });
    // Per row, not per filter: with the default 'all' view a withdrawn
    // report sits next to a live one, and each needs its own actions.
    box.innerHTML=list.map(function(r){
      return reportCardHtml(r, r.withdrawn
        ? {restrict:true,restore:true}
        : {restrict:true,review:true,staffWithdraw:true});
    }).join('');
    box.querySelectorAll('[data-restrict]').forEach(function(b){
      b.addEventListener('click',function(){ toggleRestricted(b.getAttribute('data-restrict')); });
    });
    box.querySelectorAll('[data-status]').forEach(function(b){
      b.addEventListener('click',function(){
        var threadId=b.getAttribute('data-thread'), status=b.getAttribute('data-status');
        openReason('Mark this report as '+status+'?', function(comment){
          fetch('/api/moderators/reports/'+encodeURIComponent(threadId)+'/status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:status,comment:comment})})
            .then(function(){ renderModerators(); });
        });
      });
    });
    box.querySelectorAll('[data-severity]').forEach(function(b){
      b.addEventListener('click',function(){
        var t=b.getAttribute('data-severity');
        openSeverity(t,(modsById[t]||{}).assessed_severity);
      });
    });
    box.querySelectorAll('[data-note]').forEach(function(b){
      b.addEventListener('click',function(){ openNote(b.getAttribute('data-note')); });
    });
    box.querySelectorAll('[data-incident]').forEach(function(b){
      b.addEventListener('click',function(){ openIncident(b.getAttribute('data-incident')); });
    });
    /* "I have read it", which is not the moderation decision and does not
       touch it. No reason box: the flag is a reading list, and asking
       somebody to justify having read something is how a queue stops being
       cleared. The clear is recorded against their name server-side. */
    /* ASK, OR WITHDRAW AN ASK. The message is required and typed, because
       a request with no words reads like a phishing mail — which is the one
       thing a mail asking somebody for photographs must not look like. */
    box.querySelectorAll('[data-askevidence]').forEach(function(b){
      b.addEventListener('click',function(){
        var t=b.getAttribute('data-askevidence');
        var row=modsById[t]||{};
        if(row.evidence_open){
          if(!confirm('Withdraw the request?\n\nThe link stops working straight away.'
            +' The record of having asked stays. You can ask again afterwards.')) return;
          fetch('/api/moderators/reports/'+encodeURIComponent(t)+'/evidence/cancel',
            {method:'POST'}).then(function(){ renderModerators(); });
          return;
        }
        openReason('What are you asking them for?',function(message){
          fetch('/api/moderators/reports/'+encodeURIComponent(t)+'/evidence',
            {method:'POST',headers:{'Content-Type':'application/json'},
             body:JSON.stringify({message:message})})
            .then(function(r){ return r.json().then(function(d){ return {ok:r.ok,d:d}; }); })
            .then(function(res){
              /* The server's own words. It knows which of the three gates
                 is shut, and a flat "could not ask" would leave a moderator
                 guessing between "they said no" and "nothing was declared". */
              if(!res.ok){ alert(res.d.error||'Could not send the request.'); return; }
              renderModerators();
            });
        },{
          /* Styled as a warning by openReason, which is right: this is the
             only box on the page whose contents leave the building and
             reach a member of the public under the archive's name. */
          note:'This goes to them word for word, in a mail that names no'
            +' moderator and carries none of their report back to them. Say what'
            +' you need and why it would help.',
          minLength:10,
        });
      });
    });
    box.querySelectorAll('[data-reviewed]').forEach(function(b){
      b.addEventListener('click',function(){
        var t=b.getAttribute('data-reviewed');
        fetch('/api/moderators/reports/'+encodeURIComponent(t)+'/reviewed',{method:'POST'})
          .then(function(){ renderModerators(); });
      });
    });
    box.querySelectorAll('[data-staffwithdraw]').forEach(function(b){
      b.addEventListener('click',function(){
        var threadId=b.getAttribute('data-staffwithdraw');
        openReason('Withdraw this report from the public report board?', function(comment){
          fetch('/api/moderators/reports/'+encodeURIComponent(threadId)+'/withdraw',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({comment:comment})})
            .then(function(){ renderModerators(); });
        });
      });
    });
    box.querySelectorAll('[data-restore]').forEach(function(b){
      b.addEventListener('click',function(){
        var threadId=b.getAttribute('data-restore');
        var prior=(modsById[threadId]||{}).moderation_status;
        openRestore(prior,function(status,comment){
          fetch('/api/moderators/reports/'+encodeURIComponent(threadId)+'/restore',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:status,comment:comment})})
            .then(function(){ renderModerators(); });
        });
      });
    });
  });
}
function toggleRestricted(id){
  var el=document.getElementById('restricted-'+id);
  if(el.classList.contains('on')){ el.classList.remove('on'); return; }
  openReason('Why do you need this reporter\'s identity details?',function(reason){
    loadRestricted(id,reason);
  },{note:REASON_REPORTER_SEES,minLength:10});
}
function loadRestricted(id,reason){
  var el=document.getElementById('restricted-'+id);
  el.textContent='Opening…';
  el.classList.add('on');
  fetch('/api/moderators/reports/'+encodeURIComponent(id)+'/restricted',
    {method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({reason:reason})}).then(function(r){ return r.json(); }).then(function(d){
    if(d.error){ el.textContent=d.error; } else {
      var hist=(d.history||[]).map(function(h){
        var label=(h.action==='review'||h.action==='restore') && h.new_status ? (h.action+' → '+h.new_status) : h.action;
        if(h.action==='upload_rejected'){
          // No actor: the file was turned away by the checks, not by a
          // person, and saying "by nobody" is clearer than a blank name.
          return '<b>file not accepted</b> at '+esc(h.created_at)+' — '+esc(h.comment||'(no detail recorded)');
        }
        // No address means the reporter: on a thread whose contact details
        // can be erased, their own actions are logged without one.
        return esc(label)+' by '+esc(h.actor_email||'the reporter')+' at '+esc(h.created_at)+' — '+esc(h.comment||'(no reason recorded)');
      }).join('<br>');
      el.innerHTML=(d.erased?'<b>The reporter had these details erased.</b> | ':'')+
        'org: '+esc(d.org||'—')+' | observer id: '+esc(d.observer_id||'—')+' | contact: '+esc(d.contact||'—')+
        (hist?('<br><br><b>History</b><br>'+hist):'');
    }
    el.classList.add('on');
  });
}

export {
  renderModerators, renderPress, renderStats,
};
