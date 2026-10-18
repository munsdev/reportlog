/* roles.js — Roles, organizations and oversight: the role ceiling, the
 * owner's seat, filing for an organization, and running one.
 *
 * Lifted out of the one <script> public/index.html used to carry, in the
 * order it was in. docs/frontend-files.md has the whole map.
 */

import { answerText, esc, qBuild } from './answers.js';
import { checkSession, currentUser } from './session.js';
import { loadOrgInvites, loadOrgListing } from './directory.js';

/* ---------- roles, organizations and oversight ---------- */
function renderRolesAdmin(){
  renderDesks();
  fetch('/api/orgs').then(function(r){ return r.json(); }).then(function(list){
    var box=document.getElementById('admin-orgs');
    if(!list.length){ box.innerHTML='<div class="empty_component">No organizations yet.</div>'; return; }
    box.innerHTML=list.map(function(o){
      return '<div class="rc-card"><div class="who"><b>'+esc(o.name)+'</b>'+
        '<div class="meta">'+o.manager_count+' manager(s) · '+o.coordinator_count+' coordinator(s) · '+
        o.report_count+' report(s)'+(o.verified_by?' · verified by '+esc(o.verified_by):'')+'</div></div></div>';
    }).join('');
  });
  fetch('/api/orgs/roster').then(function(r){ return r.json(); }).then(function(d){
    var box=document.getElementById('admin-roster');
    if(!d.people||!d.people.length){ box.innerHTML='<div class="empty_component">Nobody yet.</div>'; return; }
    box.innerHTML=d.people.map(function(p){
      return '<div class="rc-card"><div class="who"><b>'+esc(p.email)+'</b>'+
        '<div class="meta">'+esc(p.role)+(p.is_tester?' · tester':'')+
        (p.is_team_member?' · team'+((p.desks&&p.desks.length)?' ('+esc(p.desks.join(', '))+')':''):'')+
        (p.organizations?' · '+esc(p.organizations):'')+
        ' · '+p.org_reports+' report(s) in the last '+d.days+' days</div></div></div>';
    }).join('');
  });
  fetch('/api/orgs/audit').then(function(r){ return r.json(); }).then(function(list){
    var box=document.getElementById('admin-audit');
    if(!list.length){ box.innerHTML='<div class="empty_component">Nothing yet.</div>'; return; }
    box.innerHTML=list.map(function(a){
      return '<div class="rcard"><div class="meta">'+
        esc(new Date(a.created_at).toLocaleString())+' — <b>'+esc(a.actor_email)+'</b> '+
        esc(a.action==='grant'?'gave':'removed')+' <b>'+esc(a.detail||'')+'</b> '+
        (a.action==='grant'?'to':'from')+' <b>'+esc(a.subject_email)+'</b></div></div>';
    }).join('');
  });
}

/* The desks are FETCHED, not written into the page, so this list and the
   one the server accepts cannot disagree. Same reasoning as the look
   catalogue. */
function renderDesks(){
  fetch('/api/orgs/desks').then(function(r){ return r.ok?r.json():null; }).then(function(d){
    if(!d || !d.desks) return;
    document.getElementById('role-desks').innerHTML=d.desks.map(function(k){
      return '<label><input type="checkbox" class="deskbox" value="'+esc(k.id)+'">'+
        '<span>'+esc(k.label)+'</span></label>';
    }).join('');
  });
}
/* Only ask what somebody does once they are actually on the team. Asking
   before is a question with no consequence. */
document.getElementById('role-team').addEventListener('change',function(){
  document.getElementById('role-desks-wrap').hidden=!this.checked;
});

/* ---- the owner's seat ------------------------------------------------
   Reads /api/orgs/owner and shows one of three things: the offer form to
   the owner, the standing offer to whoever made it, or the accept button
   to the person it was made to. Everything here is also enforced at the
   server; this only decides what somebody is shown. */
function renderOwnership(){
  fetch('/api/orgs/owner').then(function(r){ return r.json(); }).then(function(o){
    if(!o || o.error) return;
    /* The accept banner is on Home, where anybody can reach it; everything
       else is on the Admin pane. Somebody may be shown one, the other, or
       neither, so each is guarded on its own. */
    var accept=document.getElementById('own-accept');
    if(accept) accept.hidden = !o.awaitingMyAcceptance;
    var panel=document.getElementById('panel-ownership');
    if(!panel) return;
    var who=document.getElementById('own-who');
    if(who) who.innerHTML = o.owner
      ? 'Held by <b>'+esc(o.owner)+'</b>.'
      : 'Nobody holds it. This deployment was installed before the owner existed and had more than one administrator, so the software did not pick one for you.';
    /* The Administrator option and the note beside it: owner only. The
       server refuses anybody else, so this is about not offering a locked
       door rather than about security. */
    var pick=document.getElementById('role-pick-admin');
    if(pick) pick.hidden = !o.iAmOwner;
    var note=document.getElementById('role-owner-note');
    if(note) note.hidden = !o.iAmOwner;

    var pending=o.pending;
    document.getElementById('own-transfer').hidden = !(o.iAmOwner && !pending);
    document.getElementById('own-pending').hidden  = !(o.iAmOwner && pending);
    /* Back behind the first door on every render. Leaving the warning open
       across a refresh would mean an operator who walked away came back to a
       page already one click in. */
    handoverReset();
    if(pending && o.iAmOwner){
      document.getElementById('own-pending-text').innerHTML =
        'Offered to <b>'+esc(pending.to)+'</b>. Nothing has moved: you are still the owner until they accept.';
    }
  }).catch(function(){});
}

/* ---- handing the deployment over, behind three doors -----------------

   Door one is the red button, door two is the notice, door three is the
   modal with the form and a one-time code to the owner's own address. Every
   one of them is only about deliberateness: the server refuses a non-owner
   and refuses a missing or wrong code regardless of what happens here.

   Why three rather than a confirm dialog. A confirm nobody reads is one
   click, and this is the only move on the admin page that cannot be undone —
   once the other person accepts, only they can appoint administrators and
   only they can hand the seat on again. The code is the part a borrowed
   session cannot get past. */
function handoverReset(){
  var warn=document.getElementById('own-warn');
  if(warn) warn.hidden=true;
  var begin=document.getElementById('own-begin');
  if(begin) begin.hidden=false;
  var ovl=document.getElementById('ovl-handover');
  if(ovl) ovl.classList.remove('on');
  ['own-email','own-email2','own-otp'].forEach(function(id){
    var el=document.getElementById(id); if(el){ el.value=''; el.readOnly=false; }
  });
  handoverUnsent();
  handoverErr('');
}

/* Back to "no code has been asked for". Called on open, on cancel, and when
   somebody changes the address — because the code is bound to the address on
   the server, so a code already in hand is worthless once the address moves. */
function handoverUnsent(){
  var sent=document.getElementById('own-otp-sent');
  if(sent) sent.textContent='';
  var otp=document.getElementById('own-otp');
  if(otp) otp.value='';
  var wrap=document.getElementById('own-otp-wrap');
  if(wrap) wrap.hidden=true;
  /* HIDDEN, not merely disabled. A greyed-out "Hand it over" beside an empty
     form invites somebody to hunt for what enables it; a button that is not
     there yet says the step before it has not happened. */
  var go=document.getElementById('own-offer');
  if(go) go.hidden=true;
  var send=document.getElementById('own-otp-send');
  if(send){ send.hidden=false; send.disabled=false; }
  var chg=document.getElementById('own-email-change');
  if(chg) chg.hidden=true;
  ['own-email','own-email2'].forEach(function(id){
    var el=document.getElementById(id); if(el) el.readOnly=false;
  });
}
function handoverErr(m){
  var e=document.getElementById('own-modal-err');
  if(!e) return;
  e.textContent=m||''; e.classList.toggle('on', !!m);
}
document.getElementById('own-begin').addEventListener('click',function(){
  document.getElementById('own-warn').hidden=false;
  this.hidden=true;
});
document.getElementById('own-warn-cancel').addEventListener('click',handoverReset);
document.getElementById('own-warn-go').addEventListener('click',function(){
  document.getElementById('ovl-handover').classList.add('on');
  document.getElementById('own-email').focus();
});
document.getElementById('own-modal-cancel').addEventListener('click',handoverReset);
document.getElementById('own-email-change').addEventListener('click',function(){
  handoverUnsent();
  document.getElementById('own-email').focus();
});
document.getElementById('own-otp-send').addEventListener('click',function(){
  handoverErr('');
  var a=document.getElementById('own-email').value.trim();
  var b=document.getElementById('own-email2').value.trim();
  /* BOTH BOXES, BEFORE A CODE EXISTS. Checked here as well as at the server so
     the mismatch is reported beside the fields rather than after a round trip
     that has already emailed somebody. */
  if(!a){ handoverErr('Enter the address to hand it to.'); return; }
  if(a.toLowerCase()!==b.toLowerCase()){
    handoverErr('The two addresses do not match. The seat cannot be recalled from the wrong one.');
    return;
  }
  var btn=this; btn.disabled=true;
  fetch('/api/orgs/owner/transfer/code',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email:a})})
    .then(function(r){ return r.json(); }).then(function(out){
      btn.disabled=false;
      if(out.error){ handoverErr(out.error); return; }
      /* LOCKED NOW. The code only verifies for this address, so letting it be
         edited would produce a refusal at the last step for a reason nobody
         could see. Change the address and the code is thrown away with it. */
      ['own-email','own-email2'].forEach(function(id){
        document.getElementById(id).readOnly=true;
      });
      btn.hidden=true;
      document.getElementById('own-email-change').hidden=false;
      document.getElementById('own-otp-wrap').hidden=false;
      document.getElementById('own-offer').hidden=false;
      document.getElementById('own-otp-sent').textContent=
        'Sent to '+(out.sentTo||'your address')+', naming '+a+' as the recipient.'
        +' It expires in 10 minutes and works for that address only.';
      document.getElementById('own-otp').focus();
    }).catch(function(){ btn.disabled=false; handoverErr('That could not be sent.'); });
});
function ownErr(m){
  var e=document.getElementById('own-err');
  e.textContent=m||''; e.classList.toggle('on', !!m);
}
document.getElementById('own-offer').addEventListener('click',function(){
  var email=document.getElementById('own-email').value.trim();
  var code=document.getElementById('own-otp').value.trim();
  /* Said rather than silently doing nothing. The old version returned on an
     empty address, so the button looked broken. */
  if(!email){ handoverErr('Enter the address to hand it to.'); return; }
  if(!code){ handoverErr('Enter the code sent to your address.'); return; }
  fetch('/api/orgs/owner/transfer',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email:email,code:code})})
    .then(function(r){ return r.json(); }).then(function(out){
      /* The error stays IN THE MODAL. Writing it to the panel behind would
         put the reason out of sight of the form that caused it. */
      if(out.error){ handoverErr(out.error); return; }
      ownErr(''); handoverReset(); renderOwnership();
    });
});
document.getElementById('own-cancel').addEventListener('click',function(){
  fetch('/api/orgs/owner/transfer',{method:'DELETE'})
    .then(function(r){ return r.json(); }).then(function(out){
      if(out.error){ ownErr(out.error); return; }
      ownErr(''); renderOwnership();
    });
});
document.getElementById('own-accept-btn').addEventListener('click',function(){
  var ae=document.getElementById('own-accept-err');
  fetch('/api/orgs/owner/accept',{method:'POST'})
    .then(function(r){ return r.json(); }).then(function(out){
      if(out.error){ ae.textContent=out.error; ae.classList.add('on'); return; }
      ae.textContent=''; ae.classList.remove('on');
      /* The seat has moved, so this person's own role has changed. Go back
         to the server rather than patching currentUser here: the menu, the
         panes and the edit affordance all read from it, and checkSession
         is what every other role change in this page already uses. */
      checkSession(renderOwnership);
    });
});

document.getElementById('role-apply').addEventListener('click',function(){
  var email=document.getElementById('role-email').value.trim();
  var role=document.getElementById('role-pick').value;
  var tester=document.getElementById('role-tester').checked;
  var team=document.getElementById('role-team').checked;
  var desks=[].slice.call(document.querySelectorAll('#role-desks .deskbox:checked'))
    .map(function(b){ return b.value; });
  var err=document.getElementById('role-err');
  if(!email) return;
  fetch('/api/orgs/system-role',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email:email,role:role})})
    .then(function(r){ return r.json(); }).then(function(out){
      if(out.error){ err.textContent=out.error; err.classList.add('on'); return; }
      err.classList.remove('on');
      return fetch('/api/orgs/tester',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({email:email,isTester:tester})})
        .then(function(){
          return fetch('/api/orgs/team-member',{method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({email:email,isTeamMember:team,desks:desks})});
        });
    }).then(function(){ document.getElementById('role-email').value=''; renderRolesAdmin(); });
});

document.getElementById('org-create').addEventListener('click',function(){
  var name=document.getElementById('org-new-name').value.trim();
  var mgr=document.getElementById('org-new-mgr').value.trim();
  var err=document.getElementById('org-create-err');
  fetch('/api/orgs',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name:name,managerEmails:mgr?[mgr]:[]})})
    .then(function(r){ return r.json(); }).then(function(out){
      if(out.error){ err.textContent=out.error; err.classList.add('on'); return; }
      err.classList.remove('on');
      document.getElementById('org-new-name').value='';
      document.getElementById('org-new-mgr').value='';
      renderRolesAdmin();
    });
});

/* ---------- filing for an organization ---------- */
// A coordinator enters accounts somebody else gave them: off a paper form,
// down a phone, in person. The whole surface is built around one idea —
// nothing reaches the archive until the person doing the typing has looked
// at the whole batch and said so.
var intakeOrgs=[], intakeBatch=null;

function intakeMethodOptions(sel){
  return [['','Choose…'],['paper','A paper form'],['phone','A phone call'],
          ['in_person','In person'],['email','An email or message'],['other','Somewhere else']]
    .map(function(o){ return '<option value="'+o[0]+'"'+(sel===o[0]?' selected':'')+'>'+esc(o[1])+'</option>'; }).join('');
}

function renderIntake(){
  fetch('/api/intake/organizations').then(function(r){ return r.json(); }).then(function(list){
    intakeOrgs=list||[];
    var sel=document.getElementById('intake-org');
    sel.innerHTML=intakeOrgs.map(function(o){
      return '<option value="'+o.organization_id+'">'+esc(o.name)+'</option>'; }).join('');
    // With one membership the selector is noise: it is pre-filled and
    // hidden. With two or more it is a real choice and has to be made once
    // per batch — never per row, which is where mistakes come from.
    document.getElementById('intake-org-field').style.display=intakeOrgs.length>1?'':'none';
  });
  loadBatches();
}

function loadBatches(){
  fetch('/api/intake/batches').then(function(r){ return r.json(); }).then(function(list){
    var box=document.getElementById('intake-batches');
    if(!list.length){ box.innerHTML='<div class="empty_component">No batches yet.</div>'; return; }
    box.innerHTML=list.map(function(b){
      var state=b.status==='submitted'?'filed':(b.entries-b.filed)+' waiting';
      return '<div class="rc-card"><div class="who"><b>'+esc(b.organization)+'</b>'+
        '<div class="meta">'+esc(new Date(b.created_at).toLocaleString())+' · '+esc(state)+'</div></div>'+
        '<button data-batch="'+b.id+'">Open</button></div>';
    }).join('');
    box.querySelectorAll('[data-batch]').forEach(function(btn){
      btn.addEventListener('click',function(){ openBatch(btn.getAttribute('data-batch')); });
    });
  });
}

document.getElementById('intake-new-batch').addEventListener('click',function(){
  var orgId=document.getElementById('intake-org').value||(intakeOrgs[0]&&intakeOrgs[0].organization_id);
  if(!orgId) return;
  fetch('/api/intake/batches',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({organizationId:Number(orgId)})})
    .then(function(r){ return r.json(); }).then(function(b){ loadBatches(); openBatch(b.id); });
});

function openBatch(id){
  fetch('/api/intake/batches/'+id).then(function(r){ return r.json(); }).then(function(d){
    intakeBatch=d.batch;
    document.getElementById('intake-batch-panel').hidden=false;
    document.getElementById('intake-batch-title').textContent=
      'Batch for '+d.batch.organization+(d.batch.status==='submitted'?' — filed':'');
    renderDrafts(d.drafts);
    refreshReview();
  });
}

function renderDrafts(drafts){
  var box=document.getElementById('intake-drafts');
  if(!drafts.length){ box.innerHTML='<div class="empty_component">No accounts entered yet.</div>'; return; }
  box.innerHTML=drafts.map(function(d){
    var p=d.payload||{};
    var first=p.answers?Object.keys(p.answers).map(function(k){ return answerText(p.answers[k]); })[0]:'';
    return '<div class="rcard"><div class="top">'+
      '<span class="cat">Account '+d.ordinal+'</span>'+
      (p.logbook?'<span class="st">'+esc(p.logbook)+'</span>':'')+
      (d.report_id?'<span class="st">filed</span>':'')+
      '</div><div class="txt">'+esc(String(first||'').slice(0,160)||'(nothing entered yet)')+'</div>'+
      (d.report_id?'':'<div class="meta"><button class="button is-secondary is-small" data-edit="'+d.id+'">Edit</button> '+
        '<button class="button is-secondary is-small" data-drop="'+d.id+'">Remove</button></div>')+'</div>';
  }).join('');
  box.querySelectorAll('[data-edit]').forEach(function(b){
    b.addEventListener('click',function(){ editDraft(b.getAttribute('data-edit')); });
  });
  box.querySelectorAll('[data-drop]').forEach(function(b){
    b.addEventListener('click',function(){
      fetch('/api/intake/drafts/'+b.getAttribute('data-drop'),{method:'DELETE'})
        .then(function(){ openBatch(intakeBatch.id); });
    });
  });
}

document.getElementById('intake-add-entry').addEventListener('click',function(){
  if(!intakeBatch) return;
  fetch('/api/intake/batches/'+intakeBatch.id+'/drafts',{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({})})
    .then(function(r){ return r.json(); }).then(function(d){ editDraft(d.id, true); });
});

// One account, edited in a dialog rather than inline: a coordinator works
// through a stack of paper one sheet at a time, and a long editable list
// on screen invites typing into the wrong row.
//
// An account is a logbook's answers, like any other report: the coordinator
// picks the logbook, and its questions are drawn below. The publication
// answer is what the person they spoke to said, on the wording coordinators
// are shown, and its digest is sealed with it.
var draftRead=null, draftLogbooks=[], coordCard=null;
function draftDrawQuestions(slug, answers){
  var box=document.getElementById('draft-questions');
  if(!slug){ box.innerHTML=''; draftRead=null; return Promise.resolve(); }
  return fetch('/api/logbooks/'+encodeURIComponent(slug)).then(function(r){ return r.json(); })
    .then(function(l){ draftRead=qBuild(box,(l&&l.fields)||[],'dq',answers||{}); });
}
document.getElementById('draft-logbook').addEventListener('change',function(){
  draftDrawQuestions(this.value,{});
});
function editDraft(draftId, isNew){
  Promise.all([
    fetch('/api/intake/batches/'+intakeBatch.id).then(function(r){ return r.json(); }),
    fetch('/api/logbooks').then(function(r){ return r.json(); }).catch(function(){ return []; }),
    fetch('/api/reports/consent-text?variant=coordinator').then(function(r){ return r.json(); }).catch(function(){ return null; })
  ]).then(function(got){
    var d=got[0]; draftLogbooks=Array.isArray(got[1])?got[1]:[]; coordCard=got[2];
    var draft=(d.drafts||[]).find(function(x){ return String(x.id)===String(draftId); });
    if(!draft) return;
    var p=draft.payload||{};
    var sel=document.getElementById('draft-logbook');
    sel.innerHTML='';
    sel.appendChild(new Option(draftLogbooks.length?'Choose one':'No logbook is open',''));
    draftLogbooks.forEach(function(l){ sel.appendChild(new Option(l.title,l.slug)); });
    var slug=p.logbook||(draftLogbooks.length===1?draftLogbooks[0].slug:'');
    sel.value=slug;
    document.getElementById('draft-collected').value=p.collected_on||'';
    document.getElementById('draft-ref').value=p.source_ref||'';
    document.getElementById('draft-method').innerHTML=intakeMethodOptions(p.intake_method||'');
    document.querySelectorAll('input[name="draft-publish"]').forEach(function(x){
      x.checked=(p.may_publish===true&&x.value==='yes')||(p.may_publish===false&&x.value==='no');
    });
    if(coordCard&&coordCard.question) document.getElementById('draft-publish-q').textContent=coordCard.body.join(' ');
    draftDrawQuestions(slug,p.answers).then(function(){
      var ovl=document.getElementById('ovl-draft');
      ovl.dataset.draft=draftId;
      ovl.classList.add('on');
      document.getElementById('draft-title').textContent=isNew?'New account':'Account '+draft.ordinal;
    });
  });
}

document.getElementById('draft-save').addEventListener('click',function(){
  var id=document.getElementById('ovl-draft').dataset.draft;
  var pub=(document.querySelector('input[name="draft-publish"]:checked')||{}).value;
  var payload={
    logbook:document.getElementById('draft-logbook').value||undefined,
    answers:draftRead?draftRead():{},
    collected_on:document.getElementById('draft-collected').value||null,
    source_ref:document.getElementById('draft-ref').value.trim(),
    intake_method:document.getElementById('draft-method').value,
    may_publish:pub==='yes'?true:(pub==='no'?false:undefined),
    may_publish_digest:(pub&&coordCard)?coordCard.digest:undefined
  };
  fetch('/api/intake/drafts/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(payload)}).then(function(){
      document.getElementById('ovl-draft').classList.remove('on');
      openBatch(intakeBatch.id);
    });
});
document.getElementById('draft-cancel').addEventListener('click',function(){
  document.getElementById('ovl-draft').classList.remove('on');
});

function refreshReview(){
  if(!intakeBatch) return;
  fetch('/api/intake/batches/'+intakeBatch.id+'/review').then(function(r){ return r.json(); }).then(function(d){
    var box=document.getElementById('intake-review');
    var lines=d.entries.filter(function(e){ return !e.filed && e.problems.length; })
      .map(function(e){ return '<li>Account '+e.ordinal+' — '+esc(e.problems.join('; '))+'</li>'; });
    box.innerHTML=(lines.length
      ? '<div class="form_error on"><b>'+lines.length+' not ready</b><ul>'+lines.join('')+'</ul>'+
        '<p class="text-size-small text-color-muted margin-bottom margin-xsmall">These stay in the batch. Filing sends the ones that are ready and leaves these for you to fix — nothing is thrown away.</p></div>'
      : '')+
      '<p class="summary">'+d.ready+' ready to file'+(d.blocked?', '+d.blocked+' still need work':'')+'</p>';
    document.getElementById('intake-submit').disabled=!d.ready;
  });
}

// The last step before the archive. Deliberately not a second "are you
// sure?" — two of those in a row get clicked through by the third batch.
// It says what is about to happen, in numbers, and what cannot be undone.
document.getElementById('intake-submit').addEventListener('click',function(){
  fetch('/api/intake/batches/'+intakeBatch.id+'/review').then(function(r){ return r.json(); }).then(function(d){
    document.getElementById('commit-count').textContent=d.ready;
    document.getElementById('commit-org').textContent=intakeBatch.organization;
    document.getElementById('commit-attest').checked=false;
    document.getElementById('commit-go').disabled=true;
    document.getElementById('ovl-commit').classList.add('on');
  });
});
document.getElementById('commit-attest').addEventListener('change',function(){
  document.getElementById('commit-go').disabled=!this.checked;
});
document.getElementById('commit-cancel').addEventListener('click',function(){
  document.getElementById('ovl-commit').classList.remove('on');
});
document.getElementById('commit-go').addEventListener('click',function(){
  fetch('/api/intake/batches/'+intakeBatch.id+'/submit',{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({attested:true})})
    .then(function(r){ return r.json(); }).then(function(out){
      document.getElementById('ovl-commit').classList.remove('on');
      if(out.error){ alert(out.error); return; }
      openBatch(intakeBatch.id);
      loadBatches();
    });
});

/* ---------- running an organization ---------- */
var orgCurrent=null;

function managedOrgs(){
  return (currentUser&&currentUser.memberships||[]).filter(function(m){ return m.role==='manager'; });
}

function renderOrgPanel(){
  var mine=managedOrgs();
  var sw=document.getElementById('org-switch');
  sw.innerHTML=mine.map(function(m){
    return '<option value="'+m.organization_id+'">'+esc(m.name)+'</option>'; }).join('');
  // One organization at a time with a switcher, never a merged view: a
  // coalition volunteer handling three groups needs to know which one they
  // are about to add somebody to.
  document.getElementById('org-switch-field').hidden=!(mine.length>1);
  orgCurrent=orgCurrent||(mine[0]&&mine[0].organization_id);
  if(orgCurrent){ loadOrgMembers(); loadOrgListing(); loadOrgInvites(); }
}
document.getElementById('org-switch').addEventListener('change',function(){
  orgCurrent=this.value; loadOrgMembers(); loadOrgListing(); loadOrgInvites();
});

function loadOrgMembers(){
  fetch('/api/orgs/'+orgCurrent+'/members').then(function(r){ return r.json(); }).then(function(list){
    var box=document.getElementById('org-members');
    if(!list.length){ box.innerHTML='<div class="empty_component">Nobody yet.</div>'; return; }
    box.innerHTML=list.map(function(m){
      return '<div class="rc-card"><div class="who"><b>'+esc(m.email)+'</b>'+
        '<div class="meta">'+esc(m.role)+(m.pending?' · invitation not yet accepted':'')+'</div></div>'+
        '<button data-rm="'+esc(m.email)+'">Remove</button></div>';
    }).join('');
    box.querySelectorAll('[data-rm]').forEach(function(b){
      b.addEventListener('click',function(){
        fetch('/api/orgs/'+orgCurrent+'/members/'+encodeURIComponent(b.getAttribute('data-rm')),{method:'DELETE'})
          .then(function(r){ return r.json(); }).then(function(out){
            var err=document.getElementById('org-err');
            if(out.error){ err.textContent=out.error; err.classList.add('on'); return; }
            err.classList.remove('on');
            loadOrgMembers();
          });
      });
    });
  });
}

export {
  loadOrgMembers, orgCurrent, renderIntake, renderOrgPanel, renderOwnership,
  renderRolesAdmin,
};
