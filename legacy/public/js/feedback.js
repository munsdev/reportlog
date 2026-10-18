/* feedback.js — The feedback tracker, edit mode, the development badge, and
 * the issues list.
 *
 * Lifted out of the one <script> public/index.html used to carry, in the
 * order it was in. docs/frontend-files.md has the whole map.
 */

import { esc } from './answers.js';
import { showPane } from './nav.js';
import { currentUser } from './session.js';
import { renderSiteCopy } from './admin-look.js';
import { initSiteCopy } from './gate.js';

/* ---------- feedback tracker (bugs/questions/suggestions) ---------- */
// Mirrors FEEDBACK_STATUS_LABELS in src/feedbackTaxonomy.js — a status
// added there needs adding here too, or cards fall back to the raw value.
var FB_STATUS_LABELS={new:'New',investigating:'Investigating',in_progress:'In progress',
  need_info:'Needs more info',acknowledged:'Acknowledged',fixed:'Fixed',
  wont_fix:"Won't fix",duplicate:'Duplicate'};
// Class names (see panels.css), never colours: a style attribute in markup this
// script writes is what `style-src-attr` refuses.
var FB_STATUS_COLOR={new:'tone-seal',investigating:'tone-amber',in_progress:'tone-focus',
  need_info:'tone-amber',acknowledged:'tone-muted',fixed:'tone-verify',
  wont_fix:'tone-muted',duplicate:'tone-muted'};
var FB_SEV_COLOR={blocker:'tone-seal',major:'tone-amber',minor:'tone-muted'};
var fbFilter='all', fbPendingContext=null;

/* Owner outranks admin, and this is the ONLY place the page knows it.
   Mirrors src/roleRank.js on the server: the owner holds everything an
   administrator holds, and nothing else outranks anything. Written once
   because the alternative was eight `role==='admin'` comparisons that all
   had to be found and all had to agree — and the ninth, written next
   month, would not have been. */
function hasAdminAuthority(r){ return r==='admin' || r==='owner'; }
function isOwner(){ return !!currentUser && currentUser.role==='owner'; }
function isAdmin(){ return !!currentUser && hasAdminAuthority(currentUser.role); }
// The bug tracker is pre-release surface: testers, and the two roles that
// manage the tester list. Not every signed-in person — an ordinary
// reporter has no use for it and should not be shown a door into it.
/* The team-member flag. Unlike isTester this does NOT fall through to
   admin: an administrator who is not on the team has no business being
   shown the team's internal pages by default, and can be given the flag in
   one click if they want them. Access Manager likewise. */
function isTeamMember(){
  return !!currentUser && !!currentUser.is_team_member;
}
function myDesks(){
  return (currentUser && Array.isArray(currentUser.desks)) ? currentUser.desks : [];
}
function isTester(){
  return !!currentUser && (currentUser.is_tester
    || hasAdminAuthority(currentUser.role) || currentUser.role==='access_manager');
}
// The changelog is a tester's document — it names versions, describes what
// moved, and assumes you were here last week. It is hidden outright rather
// than shown and then explained, because a tab that says "not for you" is
// worse than no tab. Anyone who reaches /about/changelog directly without
// the flag lands on For everyone instead.
function renderTesterChrome(){
  var tab=document.getElementById('about-tab-changelog');
  if(tab) tab.hidden=!isTester();
  if(!isTester()){
    var pane=document.getElementById('about-changelog');
    if(pane && !pane.hidden){
      showPane('about',{sub:'everyone'});
    }
  }
}
function renderFab(){
  renderTesterChrome();
  document.getElementById('fab-feedback').classList.toggle('on', isTester());
  editRefreshButton();
  // Only point at the feedback button when it's actually on screen.
  var rl=document.getElementById('dev-modal-reportline');
  if(rl) rl.hidden=!isTester();
}
function fbWhen(ts){ try{ return new Date(ts).toLocaleString(); }catch(e){ return String(ts||''); } }

// Captured when the modal opens, not when it's sent — so the tab recorded
// is the one the tester was actually on when it went wrong.
function fbContext(){
  var active=document.querySelector('.pane.active');
  return {
    tab: active ? active.id.replace(/^pane-/,'') : '',
    path: location.pathname,
    viewport: window.innerWidth+'x'+window.innerHeight,
    userAgent: navigator.userAgent
  };
}
function openFeedback(){
  document.getElementById('fb-form').style.display='';
  document.getElementById('fb-done').hidden=true;
  document.getElementById('fb-title').value='';
  document.getElementById('fb-body').value='';
  document.getElementById('fb-ref').value='';
  document.querySelector('input[name="fb-type"][value="bug"]').checked=true;
  document.querySelector('input[name="fb-severity"][value="major"]').checked=true;
  document.getElementById('fb-err').classList.remove('on');
  fbPendingContext=fbContext();
  document.getElementById('fb-ctx').textContent=
    'Sent along with this: the '+fbPendingContext.tab+' tab, '+fbPendingContext.path+', '+
    fbPendingContext.viewport+', and your browser version.';
  document.getElementById('ovl-feedback').classList.add('on');
}
function submitFeedback(){
  var err=document.getElementById('fb-err'); err.classList.remove('on');
  var go=document.getElementById('fb-go'); go.disabled=true;
  var payload={
    type:(document.querySelector('input[name="fb-type"]:checked')||{}).value,
    severity:(document.querySelector('input[name="fb-severity"]:checked')||{}).value,
    title:document.getElementById('fb-title').value.trim(),
    body:document.getElementById('fb-body').value.trim(),
    related_public_ref:document.getElementById('fb-ref').value.trim(),
    context:fbPendingContext||fbContext()
  };
  fetch('/api/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
    .then(function(r){ return r.json().then(function(d){ return {ok:r.ok,d:d}; }); })
    .then(function(res){
      go.disabled=false;
      if(!res.ok){
        err.innerHTML=(res.d.errors||[res.d.error||'Something went wrong']).map(esc).join('<br>');
        err.classList.add('on');
        return;
      }
      document.getElementById('fb-form').style.display='none';
      document.getElementById('fb-done-msg').textContent=
        'Filed as issue #'+res.d.id+'. You\'ll get an email whenever its status changes.';
      document.getElementById('fb-done').hidden=false;
      renderIssueBadge();
    })
    .catch(function(){
      go.disabled=false;
      err.textContent='Something went wrong. Please try again.';
      err.classList.add('on');
    });
}
document.getElementById('fab-feedback').addEventListener('click',openFeedback);

/* ---------- edit mode ----------

   An administrator turns this on from the corner and every piece of text
   they own grows a pencil. It is the same four slots the settings page
   edits and the same route — this is a second DOOR onto one setting, not a
   second setting, which is the distinction that keeps them from drifting.

   Why a dialog rather than editing in place: an operator writing three
   paragraphs needs somewhere to write them, and contenteditable on the
   live page lets a stray keystroke rearrange the layout around the words.
   The pencil is on the page; the typing is not.

   Only [data-copy] elements are offered. The submit button, the nav and
   the headings the software owns are deliberately not editable — an
   operator who could rewrite "Submit a report" could make the form lie
   about what it does. */
var EDIT_ON = false;
var EDIT_SLOTS = null;
var EDIT_KEY = null;

function editAvailable(){
  return !!(currentUser && hasAdminAuthority(currentUser.role));
}
function editRefreshButton(){
  document.getElementById('fab-edit').classList.toggle('on', editAvailable());
}
function editPens(on){
  document.querySelectorAll('.editpen').forEach(function(p){ p.remove(); });
  document.body.classList.toggle('editing', on);

  /* ANYTHING ELSE THAT IS EDITABLE ON THE PAGE HAS TO BE TOLD. The pens
     below are written into elements that already exist, so toggling the
     class is enough for them — but a control that is DRAWN only while
     editing (the front page's button order, home-buttons.js) has nothing
     on screen for the class to reveal, and will not appear until something
     repaints it.

     FIRED FROM HERE AND NOT FROM editToggle, which is where it was and
     where it did not work: on the first toggle editToggle calls this
     inside a `.then()`, so the event fired BEFORE `editing` was on the
     body — every listener looked, saw no class, and drew nothing. The
     event means "the class just changed", so it belongs beside the line
     that changes it. */
  document.dispatchEvent(new CustomEvent('editmode', { detail: { on: on } }));

  /* AN UNWRITTEN OPTIONAL SLOT IS HIDDEN, so its pen would be invisible and
     there would be no way to write it for the first time. While editing is on,
     those slots are revealed with a prompt in their place; switching editing off
     puts them back.

     The prompt is a CSS ::after on .copy-unwritten rather than text written into
     the element: anything put in the element reads as content, and the dialog
     takes what it shows from the slot list rather than from the page, so a
     placeholder in the DOM would be a lie waiting to be believed. */
  document.querySelectorAll('[data-copy]').forEach(function(el){
    if(el.dataset.copyOptional!=='1') return;
    var empty=!el.textContent.trim();
    el.classList.toggle('copy-unwritten', on && empty);
    if(on && empty) el.hidden=false;
    else if(!on && empty) el.hidden=true;
  });

  if(!on) return;
  document.querySelectorAll('[data-copy]').forEach(function(el){
    var key=el.getAttribute('data-copy');
    var b=document.createElement('button');
    b.className='editpen'; b.type='button';
    b.setAttribute('data-edit-key',key);
    b.title='Edit this text';
    b.textContent='\u270E Edit';
    /* Appended INSIDE the element it edits, which is what lets one absolute
       rule position it against any of them without knowing the layout. */
    el.appendChild(b);
  });
}
function editToggle(){
  if(!editAvailable()) return;
  EDIT_ON=!EDIT_ON;
  document.getElementById('fab-edit').classList.toggle('is-on', EDIT_ON);
  document.getElementById('fab-edit').textContent = EDIT_ON ? 'Done editing' : 'Edit content';
  if(EDIT_ON && !EDIT_SLOTS){
    fetch('/api/admin/copy').then(function(r){ return r.json(); }).then(function(d){
      EDIT_SLOTS=d.slots||[]; editPens(true);
    }).catch(function(){ editPens(true); });
  } else {
    editPens(EDIT_ON);
  }
}
function editSlot(key){
  return (EDIT_SLOTS||[]).find(function(s){ return s.key===key; })||null;
}
function editOpen(key){
  var slot=editSlot(key);
  EDIT_KEY=key;
  document.getElementById('edit-title').textContent=slot?slot.label:'Edit this text';
  document.getElementById('edit-help').textContent=slot?slot.help:'';
  /* What is in the box is what the page is showing: their words if they
     have written any, the shipped wording otherwise. */
  document.getElementById('edit-body').value=slot?slot.body:'';
  document.getElementById('edit-reset').style.display=(slot&&slot.written)?'':'none';
  var ee=document.getElementById('edit-err'); ee.textContent=''; ee.classList.remove('on');
  document.getElementById('ovl-edit').classList.add('on');
  setTimeout(function(){ document.getElementById('edit-body').focus(); },30);
}
function editClose(){ document.getElementById('ovl-edit').classList.remove('on'); EDIT_KEY=null; }
function editWrite(body){
  var err=document.getElementById('edit-err'); err.classList.remove('on');
  fetch('/api/admin/copy',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({key:EDIT_KEY,body:body})})
    .then(function(r){ return r.json().then(function(d){ return {ok:r.ok,d:d}; }); })
    .then(function(res){
      if(!res.ok){ err.textContent=res.d.error||'That could not be saved'; err.classList.add('on'); return; }
      editClose();
      /* Re-read both: the page, so the new words are on it, and the slot
         list, so the dialog knows it is now theirs rather than ours. The
         pens are rebuilt because initSiteCopy rewrites textContent and
         would otherwise wipe them. */
      fetch('/api/admin/copy').then(function(r){ return r.json(); }).then(function(d){
        EDIT_SLOTS=d.slots||[];
        initSiteCopy();
        setTimeout(function(){ editPens(EDIT_ON); }, 120);
      }).catch(function(){});
      if(typeof renderSiteCopy==='function' && document.getElementById('copy-slots')) renderSiteCopy();
    });
}
/* ---- Insert a number ------------------------------------------------
   The menu is the catalogue the server offers (GET /api/admin/figures), so
   it can never offer a number the page would render as "?". It inserts a
   placeholder at the cursor; the number itself is worked out each time the
   page is served. src/figures.js. */
var EDIT_FIGS=null;
function editFigsLoad(){
  if(EDIT_FIGS) return Promise.resolve(EDIT_FIGS);
  return fetch('/api/admin/figures').then(function(r){ return r.ok?r.json():{figures:[]}; })
    .then(function(d){ EDIT_FIGS=d.figures||[]; return EDIT_FIGS; })
    .catch(function(){ EDIT_FIGS=[]; return EDIT_FIGS; });
}
function editFigShowNow(){
  var sel=document.getElementById('edit-fig-pick');
  var f=(EDIT_FIGS||[]).filter(function(x){ return x.id===sel.value; })[0];
  document.getElementById('edit-fig-now').textContent=f?('Right now: '+f.value.toLocaleString('en-US')):'';
}
document.getElementById('edit-fig-toggle').addEventListener('click',function(){
  var box=document.getElementById('edit-fig');
  box.hidden=!box.hidden;
  if(box.hidden) return;
  editFigsLoad().then(function(list){
    var sel=document.getElementById('edit-fig-pick');
    var groups={};
    list.forEach(function(f){ (groups[f.group]=groups[f.group]||[]).push(f); });
    sel.innerHTML=Object.keys(groups).map(function(g){
      return '<optgroup label="'+esc(g)+'">'+groups[g].map(function(f){
        return '<option value="'+esc(f.id)+'">'+esc(f.label)+'</option>';
      }).join('')+'</optgroup>';
    }).join('');
    editFigShowNow();
  });
});
document.getElementById('edit-fig-pick').addEventListener('change',editFigShowNow);
document.getElementById('edit-fig-insert').addEventListener('click',function(){
  var id=document.getElementById('edit-fig-pick').value;
  if(!id) return;
  var ta=document.getElementById('edit-body');
  var at=ta.selectionStart==null?ta.value.length:ta.selectionStart;
  var end=ta.selectionEnd==null?at:ta.selectionEnd;
  var ins='{{ ['+id+'] }}';
  ta.value=ta.value.slice(0,at)+ins+ta.value.slice(end);
  ta.focus();
  ta.selectionStart=ta.selectionEnd=at+ins.length;
});

document.getElementById('fab-edit').addEventListener('click',editToggle);
document.getElementById('edit-cancel').addEventListener('click',editClose);
document.getElementById('edit-save').addEventListener('click',function(){
  editWrite(document.getElementById('edit-body').value);
});
document.getElementById('edit-reset').addEventListener('click',function(){
  if(!confirm('Put the original wording back? What you wrote here is replaced.')) return;
  editWrite('');
});
/* Delegated, because the pens are created and destroyed as the mode goes
   on and off. */
document.addEventListener('click',function(e){
  var pen=e.target.closest&&e.target.closest('.editpen');
  if(!pen) return;
  e.preventDefault(); e.stopPropagation();
  editOpen(pen.getAttribute('data-edit-key'));
});

/* ---------- "under active development" badge ---------- */
// Server-driven: the notice arms itself on deploy and expires on a clock,
// so the client just reflects it. Given the expiry we can hide it exactly
// when the window closes instead of polling.
// The release label comes from the same status call as the dev notice —
// the page is a static file, so the server is the only thing that knows
// which version it is.
function applyVersion(d){
  var el=document.getElementById('foot-version');
  if(!el || !d || !d.version) return;
  el.textContent=d.version;
  // The printed form carries the same label, so someone holding a sheet of
  // paper can tell whether it is the current set of questions.
  var pv=document.getElementById('print-version');
  if(pv) pv.textContent=d.version;
}
// A folded-away section cannot be unfolded on paper, so everything is
// opened before printing and put back afterwards. CSS cannot do this: a
// closed <details> hides its contents by its own behaviour, not by a
// display rule a stylesheet can override.
(function(){
  var reopened=[];
  window.addEventListener('beforeprint',function(){
    reopened=[];
    document.querySelectorAll('details:not([open])').forEach(function(d){
      d.open=true; reopened.push(d);
    });
  });
  window.addEventListener('afterprint',function(){
    reopened.forEach(function(d){ d.open=false; });
    reopened=[];
  });
})();
(function(){
  var pd=document.getElementById('print-date');
  if(pd) pd.textContent=new Date().toISOString().slice(0,10);
})();
document.getElementById('foot-version').addEventListener('click',function(){
  showPane('about',{sub:'changelog'});
});
function applyDevMode(d){
  var b=document.getElementById('devbadge');
  var on=!!(d&&d.devMode);
  b.classList.toggle('on',on);
  if(on&&d.devModeUntil){
    var ms=new Date(d.devModeUntil).getTime()-Date.now();
    if(ms>0&&ms<2147483647) setTimeout(function(){ b.classList.remove('on'); },ms);
  }
}
document.getElementById('devbadge').addEventListener('click',function(){
  document.getElementById('ovl-dev').classList.add('on');
});
document.getElementById('dev-close').addEventListener('click',function(){
  document.getElementById('ovl-dev').classList.remove('on');
});
document.getElementById('ovl-dev').addEventListener('click',function(e){
  if(e.target===this) this.classList.remove('on');
});
document.getElementById('fb-cancel').addEventListener('click',function(){
  document.getElementById('ovl-feedback').classList.remove('on');
});
document.getElementById('fb-go').addEventListener('click',submitFeedback);
document.getElementById('fb-done-close').addEventListener('click',function(){
  document.getElementById('ovl-feedback').classList.remove('on');
});
document.getElementById('fb-done-view').addEventListener('click',function(){
  document.getElementById('ovl-feedback').classList.remove('on');
  showPane('issues');
});

/* ---------- issue status modal (admin) ---------- */
var ovlFbSt=document.getElementById('ovl-fbstatus'), fbStCb=null;
function openFbStatus(current, cb){
  document.getElementById('fbst-note').value='';
  document.getElementById('fbst-err').classList.remove('on');
  var radio=document.querySelector('input[name="fbst-status"][value="'+(current||'new')+'"]')
    || document.querySelector('input[name="fbst-status"][value="new"]');
  radio.checked=true;
  fbStCb=cb;
  ovlFbSt.classList.add('on');
}
document.getElementById('fbst-cancel').addEventListener('click',function(){ ovlFbSt.classList.remove('on'); });
document.getElementById('fbst-go').addEventListener('click',function(){
  var note=document.getElementById('fbst-note').value.trim();
  var status=(document.querySelector('input[name="fbst-status"]:checked')||{}).value;
  var err=document.getElementById('fbst-err');
  if(!status){ err.textContent='Choose a status.'; err.classList.add('on'); return; }
  if(!note){ err.textContent='A note is required — the reporter is emailed it.'; err.classList.add('on'); return; }
  ovlFbSt.classList.remove('on');
  fbStCb && fbStCb(status,note);
});

/* ---------- issues list ---------- */
function issueCardHtml(f, admin){
  var c=f.context||{};
  var ctx=[c.tab?('tab: '+c.tab):'', c.path?('path: '+c.path):'',
           c.viewport?('viewport: '+c.viewport):'', c.release?('release: '+c.release):'',
           c.appVersion?('build: '+c.appVersion):'',
           c.userAgent?('browser: '+c.userAgent):'']
    .filter(Boolean).map(esc).join('<br>');
  // The 'created' event is skipped — the meta line above already carries
  // "filed <when>", and it never has a note attached.
  var tl=(f.events||[]).filter(function(e){ return e.action!=='created'; }).map(function(e){
    return '<b>→ '+esc(FB_STATUS_LABELS[e.new_status]||e.new_status)+'</b> · '+esc(fbWhen(e.created_at))+
      (e.note?('<br>'+esc(e.note)):'');
  }).join('<br>');
  var sc=FB_STATUS_COLOR[f.status]||'tone-muted';
  var vc=FB_SEV_COLOR[f.severity]||'tone-muted';
  return '<div class="icard">'+
    '<div class="top">'+
      '<span class="num">#'+esc(String(f.id))+'</span>'+
      '<span class="tag '+sc+'">'+esc(FB_STATUS_LABELS[f.status]||f.status)+'</span>'+
      '<span class="tag">'+esc(f.type)+'</span>'+
      '<span class="tag '+vc+'">'+esc(f.severity)+'</span>'+
    '</div>'+
    '<h3>'+esc(f.title)+'</h3>'+
    '<div class="body">'+esc(f.body)+'</div>'+
    (f.related_public_ref?'<div class="meta">Related report: <b>'+esc(f.related_public_ref)+'</b></div>':'')+
    '<div class="meta">'+(admin?('from '+esc(f.submitter_email)+' · '):'')+'filed '+esc(fbWhen(f.created_at))+'</div>'+
    ((admin&&ctx)?('<div class="ctx">'+ctx+'</div>'):'')+
    (tl?('<div class="tl">'+tl+'</div>'):'')+
    (admin?('<div class="actions"><button data-fbid="'+esc(String(f.id))+'">Update status</button></div>'):'')+
    '</div>';
}
function renderIssueBadge(){
  var el=document.getElementById('issues-badge');
  if(!el || !isAdmin()) return;
  fetch('/api/feedback/counts').then(function(r){ return r.ok?r.json():null; }).then(function(d){
    if(!d) return;
    el.textContent=d.open;
    el.style.display=d.open?'':'none';
  });
}
// One pane, two audiences: the admin gets the whole queue with filters,
// everyone else gets only what they filed themselves.
function renderIssues(){
  var admin=isAdmin();
  document.getElementById('issues-filters').hidden=!admin;
  if(admin) updateFbFilterLabel();
  document.getElementById('issues-lede').textContent=admin
    ? 'Everything moderators and testers have filed, newest first. Every status change needs a note, and the reporter is emailed it. The weekly digest email is what flags anything left sitting.'
    : 'Bugs, questions and suggestions you\'ve filed about this site, and where each one stands. Discussion happens on Signal — this is just the record.';
  var url=admin ? ('/api/feedback/queue?status='+encodeURIComponent(fbFilter)) : '/api/feedback/mine';
  fetch(url).then(function(r){ return r.ok?r.json():[]; }).then(function(list){
    var box=document.getElementById('issues-list');
    if(!list.length){
      box.innerHTML='<div class="empty_component">'+(admin
        ? (fbFilter==='all' ? 'Nothing filed yet.' : 'No issues with that status.')
        : 'You haven\'t filed anything yet. Use the “Report a bug” button in the bottom corner.')+'</div>';
      return;
    }
    box.innerHTML=list.map(function(f){ return issueCardHtml(f,admin); }).join('');
    box.querySelectorAll('[data-fbid]').forEach(function(b){
      b.addEventListener('click',function(){
        var id=b.getAttribute('data-fbid');
        var cur=(list.filter(function(x){ return String(x.id)===String(id); })[0]||{}).status;
        openFbStatus(cur,function(status,note){
          fetch('/api/feedback/'+encodeURIComponent(id)+'/status',
            {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:status,note:note})})
            .then(function(){ renderIssues(); });
        });
      });
    });
  });
  renderIssueBadge();
}
/* ---------- issues filter popover ---------- */
// One button that opens a picker, rather than a row of status buttons
// permanently occupying the screen. Single-select: 'all' (the default) and
// 'open' are pseudo-statuses, the rest map straight to feedback.status.
var FB_FILTER_LABELS={all:'All',open:'Open'};
Object.keys(FB_STATUS_LABELS).forEach(function(k){ FB_FILTER_LABELS[k]=FB_STATUS_LABELS[k]; });
function updateFbFilterLabel(){
  document.getElementById('fbfilter-btn').textContent='Filter: '+(FB_FILTER_LABELS[fbFilter]||'All');
}
document.getElementById('fbfilter-btn').addEventListener('click',function(){
  var r=document.querySelector('input[name="fbfilter"][value="'+fbFilter+'"]')
     || document.querySelector('input[name="fbfilter"][value="all"]');
  r.checked=true;
  document.getElementById('ovl-fbfilter').classList.add('on');
});
document.getElementById('fbfilter-cancel').addEventListener('click',function(){
  document.getElementById('ovl-fbfilter').classList.remove('on');
});
document.getElementById('fbfilter-go').addEventListener('click',function(){
  fbFilter=(document.querySelector('input[name="fbfilter"]:checked')||{}).value||'all';
  document.getElementById('ovl-fbfilter').classList.remove('on');
  updateFbFilterLabel();
  renderIssues();
});

export {
  applyDevMode, applyVersion, hasAdminAuthority, isTeamMember, isTester, myDesks,
  openFeedback, renderFab, renderIssueBadge, renderIssues,
};
