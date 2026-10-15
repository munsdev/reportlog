/* mine.js — My Reports: a reporter's own submissions, erasing their
 * details, corrections, notifications, and the moderator modals.
 *
 * Lifted out of the one <script> public/index.html used to carry, in the
 * order it was in. docs/frontend-files.md has the whole map.
 */

import { LB_QCACHE, esc, qBuild, questionsFor } from './answers.js';
import { showPane } from './nav.js';
import { openReason } from './session.js';
import { openPrint, reportCardHtml } from './board.js';
import { renderModerators } from './moderate.js';

/* ---------- my reports ---------- */
var mineById={};
var MY_ACCESS_LABEL={
  identity:'opened your identity and contact details',
  attachment_original:'opened the untouched original of a file you attached'
};
function renderMyAccessLog(){
  var wrap=document.getElementById('mine-access');
  var box=document.getElementById('mine-access-list');
  wrap.hidden=false;
  box.innerHTML='<div class="empty_component">Loading…</div>';
  fetch('/api/me/access-log').then(function(r){ return r.ok?r.json():null; }).then(function(list){
    if(!list){ box.innerHTML='<div class="empty_component">Could not load this right now.</div>'; return; }
    if(!list.length){
      // Worth saying explicitly rather than hiding the section. "Nobody has
      // needed to" is a real answer and the most common one, and an empty
      // panel would read as the feature being broken.
      box.innerHTML='<div class="empty_component">Nobody has opened either of these on your reports.</div>';
      return;
    }
    box.innerHTML=list.map(function(e){
      var why=e.reason
        ? esc(e.reason)
        : '<span class="who">No reason was recorded — this happened before we required one.</span>';
      return '<div class="row">'+
        '<span class="who">'+esc(new Date(e.at).toISOString().replace('T',' ').slice(0,16))+'</span>'+
        '<span>A moderator '+esc(MY_ACCESS_LABEL[e.kind]||e.kind)+
          (e.report?(' on '+esc(e.report)):'')+'<br>'+why+'</span></div>';
    }).join('');
  }).catch(function(){ box.innerHTML='<div class="empty_component">Could not load this right now.</div>'; });
}

function renderMine(){
  fetch('/api/me/reports').then(function(r){
    if(r.status===401){ showPane('login'); return null; }
    return r.json();
  }).then(function(list){
    return list?questionsFor(list):null;
  }).then(function(list){
    if(!list) return;
    var box=document.getElementById('mine-list');
    if(!list.length){ box.innerHTML='<div class="empty_component">No reports found for this email.</div>'; return; }
    mineById={};
    list.forEach(function(r){ mineById[r.thread_id]=r; });
    box.innerHTML=list.map(function(r){ return reportCardHtml(r,{print:true,correct:true,selfWithdraw:true,permissions:true}); }).join('');
    renderMyAccessLog();
    box.querySelectorAll('[data-print]').forEach(function(b){
      b.addEventListener('click',function(){
        var id=b.getAttribute('data-print');
        var r=null; for(var k in mineById){ if(mineById[k].id===id) r=mineById[k]; }
        if(r) openPrint(r);
      });
    });
    box.querySelectorAll('[data-correct]').forEach(function(b){
      b.addEventListener('click',function(){
        openCorrect(b.getAttribute('data-correct'), mineById, '/api/me/reports/');
      });
    });
    box.querySelectorAll('[data-erase]').forEach(function(b){
      b.addEventListener('click',function(){ openErase(b.getAttribute('data-erase')); });
    });
    box.querySelectorAll('[data-perm]').forEach(function(cb){
      cb.addEventListener('change',function(){
        var key=cb.getAttribute('data-perm');
        var threadId=cb.getAttribute('data-perm-thread');
        var granted=cb.checked;
        var status=document.getElementById('perm-status-'+threadId);
        /* Switching the attachment permission off takes published files back
           down — the rendition is deleted from the public bucket, not just
           flagged. That is not something to do on a stray click, so it asks
           first and puts the box back if the answer is no. */
        if(key==='attachment_publication' && !granted && mineById[threadId]
           && mineById[threadId].attachment_published_count){
          if(!confirm('Take your published files back down? They stop being public straight away. A moderator can publish them again only if you switch this back on.')){
            cb.checked=true; return;
          }
        }
        cb.disabled=true;
        if(status) status.textContent='Saving…';
        fetch('/api/me/reports/'+encodeURIComponent(threadId)+'/permissions',{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({permission:key,granted:granted})
        }).then(function(r){ return r.ok?r.json():r.json().then(function(d){ throw new Error(d.error||'That did not work'); }); })
          .then(function(d){
            cb.disabled=false;
            /* Read the answer back rather than trusting the click: the server
               is where the current value lives, and a failed write that left
               the box ticked would be a lie about a permission. */
            cb.checked = !!(d.permissions && d.permissions[key]);
            if(status) status.textContent = d.filesWithdrawn
              ? ('Saved. '+d.filesWithdrawn+' published file'+(d.filesWithdrawn===1?'':'s')+' taken down.')
              : 'Saved.';
            if(d.filesWithdrawn) renderMine();
          })
          .catch(function(e){
            cb.disabled=false; cb.checked=!granted;
            if(status) status.textContent=e.message;
          });
      });
    });
    box.querySelectorAll('[data-withdraw]').forEach(function(b){
      b.addEventListener('click',function(){
        var threadId=b.getAttribute('data-withdraw');
        openReason('Withdraw this report from the public report board?', function(comment){
          fetch('/api/me/reports/'+encodeURIComponent(threadId)+'/withdraw',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({comment:comment})})
            .then(function(){ renderMine(); });
        });
      });
    });
  });
}

/* ---------- erasing a reporter's details (My Reports) ---------- */
var ovlErase=document.getElementById('ovl-erase'), eraseThread=null;
function openErase(threadId){
  eraseThread=threadId;
  document.getElementById('erase-sure').checked=false;
  document.getElementById('erase-err').classList.remove('on');
  ovlErase.classList.add('on');
}
document.getElementById('erase-cancel').addEventListener('click',function(){ ovlErase.classList.remove('on'); });
document.getElementById('erase-go').addEventListener('click',function(){
  var err=document.getElementById('erase-err');
  if(!document.getElementById('erase-sure').checked){
    err.textContent='Tick the box to confirm.'; err.classList.add('on'); return;
  }
  fetch('/api/me/reports/'+encodeURIComponent(eraseThread)+'/erase',{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({confirm:true})})
    .then(function(r){ return r.json().then(function(d){ return {ok:r.ok,d:d}; }); })
    .then(function(res){
      if(!res.ok){ err.textContent=res.d.error||'Something went wrong'; err.classList.add('on'); return; }
      ovlErase.classList.remove('on');
      renderMine();
    });
});

/* ---------- correction modal (My Reports only) ---------- */
// The report's own logbook questions, as they are now — which may include an
// optional one added since it was filed — filled in with its current answers.
var ovlC=document.getElementById('ovl-correct'), curCorrect=null, cxRead=null;
function openCorrect(threadId, byId, base){
  var r=byId[threadId]; if(!r) return;
  curCorrect={thread:threadId,base:base};
  document.getElementById('correct-err').classList.remove('on');
  document.getElementById('cx-comment').value='';
  document.getElementById('cx-unpublish').checked=false;
  // Only a report that may be published can be taken out. The other way is
  // not offered: a correction cannot give a permission the report never had.
  document.getElementById('cx-unpublish-wrap').hidden=(r.may_publish!==true);
  questionsFor([r]).then(function(){
    var fields=(LB_QCACHE[r.logbook_slug]||{}).fields||[];
    cxRead=qBuild(document.getElementById('cx-questions'),fields,'cx',r.answers||{});
    ovlC.classList.add('on');
  });
}
document.getElementById('cx-cancel').addEventListener('click',function(){ ovlC.classList.remove('on'); });
document.getElementById('cx-go').addEventListener('click',function(){
  var err=document.getElementById('correct-err');
  var body={answers:cxRead?cxRead():{},comment:document.getElementById('cx-comment').value.trim()};
  if(document.getElementById('cx-unpublish').checked) body.may_publish=false;
  fetch(curCorrect.base+encodeURIComponent(curCorrect.thread)+'/correct',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
    .then(function(r){ return r.json().then(function(d){ return {ok:r.ok,d:d}; }); })
    .then(function(res){
      if(!res.ok){
        err.textContent=(res.d.errors||[res.d.error]).join('; ');
        err.classList.add('on');
        err.scrollIntoView({behavior:'smooth',block:'center'});
        return;
      }
      ovlC.classList.remove('on');
      renderMine();
    });
});

/* ---------- notifications ---------- */
var notifyGrid=document.getElementById('notify-logbooks-grid');
document.getElementById('notify-all-logbooks').addEventListener('change',function(){
  notifyGrid.hidden=this.checked;
});
function renderNotify(){
  Promise.all([
    fetch('/api/me/notifications').then(function(r){ return r.json(); }),
    // Closed ones too: a closed logbook can be reopened, and following it
    // says so in advance.
    fetch('/api/logbooks?include=closed').then(function(r){ return r.json(); }).catch(function(){ return []; })
  ]).then(function(got){
    var d=got[0]||{}, list=Array.isArray(got[1])?got[1]:[];
    var mode=document.querySelector('input[name="notify-mode"][value="'+(d.notify_mode||'none')+'"]');
    if(mode) mode.checked=true;
    var chosen=d.notify_logbooks||[];
    var all=!chosen.length;
    document.getElementById('notify-all-logbooks').checked=all;
    notifyGrid.hidden=all;
    notifyGrid.innerHTML='';
    list.forEach(function(l){
      var lab=document.createElement('label');
      var cb=document.createElement('input'); cb.type='checkbox'; cb.value=l.slug;
      cb.checked=!all&&chosen.indexOf(l.slug)!==-1;
      var sp=document.createElement('span'); sp.textContent=l.title;
      lab.appendChild(cb); lab.appendChild(sp); notifyGrid.appendChild(lab);
    });
  });
}
document.getElementById('notify-save').addEventListener('click',function(){
  var err=document.getElementById('notify-err'); err.classList.remove('on');
  var mode=(document.querySelector('input[name="notify-mode"]:checked')||{}).value||'none';
  var all=document.getElementById('notify-all-logbooks').checked;
  var books=all?null:[].slice.call(notifyGrid.querySelectorAll('input:checked')).map(function(cb){ return cb.value; });
  fetch('/api/me/notifications',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    notify_mode:mode, notify_logbooks:books
  })})
    .then(function(r){ return r.json().then(function(d){ return {ok:r.ok,d:d}; }); })
    .then(function(res){
      if(!res.ok){ err.textContent=res.d.error||'Save failed'; err.classList.add('on'); return; }
      err.textContent='Saved.'; err.style.color='var(--verify)'; err.classList.add('on');
    });
});

/* ---------- corroboration modal ---------- */
/* THE VERACITY MODAL IS GONE. It asked a moderator to pick one of six
   verdicts about whether a report was true, with a written reason, and
   published the verdict as a coloured chip on the card. src/taxonomy.js has
   why that was withdrawn. The reason box was the only defensible part of
   it, and it is what the editorial note becomes. */
var incThread=null;
/* ---------- the editorial note ----------
 *
 * WHAT THE ARCHIVE SAYS ABOUT A REPORT, written by the moderator who made
 * the publication decision. The verdict modal that used to be here asked
 * somebody to pick one of six words; this asks them to write something they
 * can defend.
 *
 * A REVISION NEEDS A REASON AND A FIRST VERSION DOES NOT. The note is its
 * own reason the first time. The second time, somebody is changing what the
 * archive has already said — and every version stays published, so a change
 * shows as a change. The route enforces this too; the form asking for it is
 * what stops somebody meeting the refusal.
 */
var noteThread=null, noteExisting=false;
function openNote(threadId){
  noteThread=threadId;
  var err=document.getElementById('note-err'); err.classList.remove('on');
  document.getElementById('note-body').value='';
  document.getElementById('note-reason').value='';
  document.getElementById('note-history').innerHTML='';
  document.getElementById('note-reason-wrap').hidden=true;
  document.getElementById('ovl-note').classList.add('on');
  fetch('/api/moderators/reports/'+encodeURIComponent(threadId)+'/note')
    .then(function(r){ return r.json(); })
    .then(function(d){
      noteExisting=!!(d&&d.note);
      /* Prefilled with what it currently says, so a revision is an edit of
         the real text rather than a retype from memory. */
      if(noteExisting) document.getElementById('note-body').value=d.note.body||'';
      document.getElementById('note-reason-wrap').hidden=!noteExisting;
      document.getElementById('note-go').textContent=noteExisting?'Publish the revision':'Publish the note';
      /* EVERY VERSION, SHOWN TO THE PERSON ABOUT TO ADD ANOTHER. The
         history is the feature; a moderator who cannot see what the archive
         already said is being asked to revise it blind. */
      if(d&&d.versions&&d.versions.length>1){
        document.getElementById('note-history').innerHTML=
          '<p class="form_help"><b>'+d.versions.length+' versions.</b> Every one stays published, '+
          'so a change shows as a change.</p>'+
          d.versions.slice().reverse().map(function(v,i){
            return '<div class="text-size-small text-color-muted margin-bottom margin-xsmall">'+
              '<b>v'+(d.versions.length-i)+'</b> &middot; '+esc(String(v.created_at).slice(0,10))+
              (v.revision_reason?(' &middot; '+esc(v.revision_reason)):'')+'</div>';
          }).join('');
      }
    }).catch(function(){});
}
document.getElementById('note-cancel').addEventListener('click',function(){
  document.getElementById('ovl-note').classList.remove('on');
});
document.getElementById('note-go').addEventListener('click',function(){
  var body=document.getElementById('note-body').value.trim();
  var reason=document.getElementById('note-reason').value.trim();
  var err=document.getElementById('note-err'); err.classList.remove('on');
  if(!body){ err.textContent='A note needs something in it.'; err.classList.add('on'); return; }
  if(noteExisting && !reason){
    err.textContent='A revision needs a reason. This note is already published, so changing '+
      'it changes what the archive has said.';
    err.classList.add('on'); return;
  }
  var payload={body:body};
  if(reason) payload.revision_reason=reason;
  fetch('/api/moderators/reports/'+encodeURIComponent(noteThread)+'/note',
    {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
    .then(function(r){ return r.json().then(function(d){ return {ok:r.ok,d:d}; }); })
    .then(function(res){
      if(!res.ok){ err.textContent=res.d.error||'Something went wrong'; err.classList.add('on'); return; }
      document.getElementById('ovl-note').classList.remove('on');
      renderModerators();
    });
});

var sevmThread=null;
function openSeverity(threadId, current){
  sevmThread=threadId;
  document.getElementById('sevm-reason').value='';
  document.getElementById('sevm-err').classList.remove('on');
  document.querySelectorAll('input[name="sevm"]').forEach(function(x){ x.checked=false; });
  // Only preselect a value somebody actually chose. An unrated report
  // opens with nothing ticked, so saving is a deliberate act rather than a
  // default sliding through.
  var r=current?document.querySelector('input[name="sevm"][value="'+current+'"]'):null;
  if(r) r.checked=true;
  document.getElementById('ovl-severity').classList.add('on');
}
document.getElementById('sevm-cancel').addEventListener('click',function(){
  document.getElementById('ovl-severity').classList.remove('on');
});
document.getElementById('sevm-go').addEventListener('click',function(){
  var v=(document.querySelector('input[name="sevm"]:checked')||{}).value;
  var reason=document.getElementById('sevm-reason').value.trim();
  var err=document.getElementById('sevm-err'); err.classList.remove('on');
  if(!v){ err.textContent='Please choose a severity.'; err.classList.add('on'); return; }
  if(!reason){ err.textContent='A reason is required.'; err.classList.add('on'); return; }
  fetch('/api/moderators/reports/'+encodeURIComponent(sevmThread)+'/severity',
    {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({severity:v,comment:reason})})
    .then(function(r){ return r.json().then(function(d){ return {ok:r.ok,d:d}; }); })
    .then(function(res){
      if(!res.ok){ err.textContent=res.d.error||'Something went wrong'; err.classList.add('on'); return; }
      document.getElementById('ovl-severity').classList.remove('on');
      renderModerators();
    });
});

function openIncident(threadId){
  incThread=threadId;
  document.getElementById('inc-ref').value='';
  document.getElementById('inc-reason').value='';
  document.getElementById('inc-err').classList.remove('on');
  document.getElementById('ovl-incident').classList.add('on');
}
document.getElementById('inc-cancel').addEventListener('click',function(){
  document.getElementById('ovl-incident').classList.remove('on');
});
document.getElementById('inc-go').addEventListener('click',function(){
  var ref=document.getElementById('inc-ref').value.trim();
  var reason=document.getElementById('inc-reason').value.trim();
  var err=document.getElementById('inc-err'); err.classList.remove('on');
  if(!reason){ err.textContent='A reason is required.'; err.classList.add('on'); return; }
  fetch('/api/moderators/reports/'+encodeURIComponent(incThread)+'/incident',
    {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({linkTo:ref||null,comment:reason})})
    .then(function(r){ return r.json().then(function(d){ return {ok:r.ok,d:d}; }); })
    .then(function(res){
      if(!res.ok){ err.textContent=res.d.error||'Something went wrong'; err.classList.add('on'); return; }
      document.getElementById('ovl-incident').classList.remove('on');
      renderModerators();
    });
});

export {
  openIncident, openNote, openSeverity, renderMine, renderNotify,
};
