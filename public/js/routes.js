/* routes.js — The verification panel, the standards tabs, volunteering,
 * confirmation links, a report permalink, and the router itself.
 *
 * Lifted out of the one <script> public/index.html used to carry, in the
 * order it was in. docs/frontend-files.md has the whole map.
 */

import { esc, questionsFor } from './answers.js';
import { ROUTES, navProgress, pathForPane, showInvitation, showPane } from './nav.js';
import { showEvidence } from './evidence.js';
import { currentUser } from './session.js';
import { openFileForm, showCard } from './form-logbook.js';
import { showMapNamed } from './map.js';
import { openPrint, plural, reportCardHtml } from './board.js';
import { isGated, isOpenPath, openWhileLocked, relock } from './gate.js';
import { SITE_TITLE } from './identity.js';
import { showListForm } from './list-form.js';

/* ---------- verification ---------- */
// Four separate checks rather than one verdict. They fail for different
// reasons and a reader deserves to know which: an edited report, a broken
// link, a report moved in the sequence, and whether an outside timestamp
// covers it yet are four different situations.
var VERIFY_CHECKS=[
  ['content','The report has not been edited',
   'Its answers, its logbook and its publication answer still produce the fingerprint recorded when it was filed. Change any character and this stops matching.'],
  ['link','Its place in the chain is intact',
   "Each report's fingerprint is combined with the one before it in the same logbook. That combination still comes out right."],
  ['position','Nothing has been inserted or removed around it',
   'The report this one follows is still the report it was filed after, in the same logbook. Adding or deleting a report anywhere before it in that logbook would break this.'],
];

function verifyRow(ok,title,detail){
  return '<div class="vrow '+(ok?'vok':'vbad')+'">'+
    '<span class="vmark">'+(ok?'✓':'✕')+'</span>'+
    '<span><b>'+esc(title)+'</b><br><span class="who">'+esc(detail)+'</span></span></div>';
}

function runVerify(ref,opts){
  opts=opts||{};
  ref=String(ref||'').trim().toUpperCase();
  var box=document.getElementById('verify-box');
  if(!ref){ box.innerHTML=''; return; }
  if(!opts.noPush){
    var path='/verify/'+encodeURIComponent(ref);
    if(location.pathname!==path) history.pushState({},'',path);
  }
  box.innerHTML='<div class="empty_component">Checking…</div>';
  fetch('/api/reports/'+encodeURIComponent(ref)+'/verify').then(function(r){
    if(r.status===404) return null;
    if(!r.ok) throw new Error('failed');
    return r.json();
  }).then(function(d){
    if(!d){
      box.innerHTML='<div class="empty_component">No report with that reference. Check the characters &mdash; references use digits and capital letters, and never the letters I, L, O or U.</div>';
      return;
    }
    var allOk=VERIFY_CHECKS.every(function(c){ return d[c[0]] && d[c[0]].ok; });
    var head=allOk
      ? '<div class="vhead vok"><b>This report is intact.</b><br><span class="who">Everything recorded about it still matches what was filed on '+esc(d.received_at.slice(0,10))+'.</span></div>'
      : '<div class="vhead vbad"><b>This report does not check out.</b><br><span class="who">At least one thing about it no longer matches what was recorded. That is what tampering looks like, and it is worth telling someone about &mdash; including us.</span></div>';

    var rows=VERIFY_CHECKS.map(function(c){
      var v=d[c[0]]||{};
      // The first report in the archive has nothing before it, so there is
      // no predecessor to have moved. Saying so beats a green tick with an
      // explanation that does not apply.
      var detail=(c[0]==='position'&&v.is_first)
        ? 'This is the first report in its logbook, so it follows the logbook\'s own starting value.'
        : c[2];
      return verifyRow(v.ok,c[1],detail);
    }).join('');

    var anchorRow=d.anchor&&d.anchor.anchored
      ? verifyRow(true,'An outside timestamp covers it',
          'On '+d.anchor.date+' an independent timestamp authority signed a list of every logbook\'s latest link, and this report was already part of its logbook\'s. The chain could not have been rebuilt after that date without the signature failing.')
      : '<div class="vrow vwait"><span class="vmark">•</span><span><b>Not yet timestamped by an outside authority</b><br>'+
        '<span class="who">This happens once a day. A report filed since the last run is simply waiting its turn &mdash; it is not a problem with the report.</span></span></div>';

    // Every logbook is its own chain. Saying which one tells a reader what
    // "the report before it" means, and where to download the rest.
    var chainRow=d.chain
      ? '<p class="text-size-small text-color-muted margin-bottom margin-xsmall">In the chain of <b>'+esc(d.chain.logbook_title||d.chain.logbook)+'</b>. Every logbook is its own chain, starting from a value anybody can recompute from its name.</p>'
      : '';
    box.innerHTML=head+chainRow+rows+anchorRow+
      '<details class="vdet"><summary>Check it yourself</summary>'+
      '<p class="who">Below is the exact text that was fingerprinted, in the standard canonical form (RFC 8785). '+
      'Run SHA-256 over it &mdash; on a Mac or Linux machine, paste it into a file and run <code>shasum -a 256 thefile</code> &mdash; and you should get the fingerprint shown underneath. '+
      'Nothing on this page is needed to do that.</p>'+
      '<pre class="vpre">'+esc(d.canonical_json)+'</pre>'+
      '<div class="vkv"><b>fingerprint recorded when filed</b><code>'+esc(d.content.recorded)+'</code></div>'+
      '<div class="vkv"><b>fingerprint computed just now</b><code>'+esc(d.content.computed)+'</code></div>'+
      '<div class="vkv"><b>chain value</b><code>'+esc(d.link.recorded)+'</code></div>'+
      (d.chain?'<div class="vkv"><b>where this logbook\'s chain starts</b><code>'+esc(d.chain.genesis)+'</code></div>'+
        '<p class="who">That is SHA-256 of the text <code>reportlog-chain:'+esc(d.chain.logbook)+'</code>.</p>':'')+
      '</details>'+
      '<p class="text-size-small text-color-muted margin-bottom margin-xsmall grouped"><a href="/r/'+encodeURIComponent(d.public_ref)+'" data-verify-report>Open this report</a></p>';
  }).catch(function(){
    box.innerHTML='<div class="empty_component">Could not check that right now. Try again in a moment.</div>';
  });
}

document.getElementById('verify-go').addEventListener('click',function(){
  runVerify(document.getElementById('verify-ref').value);
});
document.getElementById('verify-ref').addEventListener('keydown',function(e){
  if(e.key==='Enter'){ e.preventDefault(); runVerify(this.value); }
});
document.getElementById('verify-box').addEventListener('click',function(e){
  var a=e.target.closest&&e.target.closest('[data-verify-report]');
  if(a){ e.preventDefault(); showReport(a.getAttribute('href').replace('/r/','')); }
});

/* ---------- magic-link confirm page / per-report permalink ---------- */
function clearActivePanes(){
  document.querySelectorAll('.tab').forEach(function(x){x.classList.remove('active')});
  document.querySelectorAll('.pane').forEach(function(x){x.classList.remove('active')});
  // A pending confirmation poll dies with the pane it belongs to. Left
  // running it would reach showConfirm four seconds after somebody navigated
  // away and drag them back to a page they had left.
  clearTimeout(confirmTimer);
  navProgress(null);
  window.scrollTo(0,0);
}

/* ---------- standards ---------- */
// Each tab has its own address, so a link to the moderation standard stays
// a link to the moderation standard once one exists. Today they all lead to
// the same admission that nothing is written.
var STANDARDS = ['moderation','groups','organizations','evidence','how'];

function showStandard(which, opts){
  opts = opts || {};
  if(STANDARDS.indexOf(which) === -1) which = 'moderation';
  STANDARDS.forEach(function(k){
    var el = document.getElementById('std-'+k);
    if(el) el.style.display = (k === which) ? '' : 'none';
  });
  document.querySelectorAll('#std-tabs button').forEach(function(b){
    b.classList.toggle('active', b.dataset.std === which);
  });
  if(!opts.noPush){
    var path = pathForPane('standards', which);
    if(path && location.pathname !== path) history.pushState({},'',path);
  }
  document.title = 'Standards \u00b7 ' + SITE_TITLE;
}

function initStandards(){
  var tabs = document.getElementById('std-tabs');
  if(!tabs) return;
  tabs.addEventListener('click', function(e){
    var b = e.target.closest('button[data-std]');
    if(b) showStandard(b.dataset.std);
  });
}

/* ---------- volunteering ----------
   The volunteer form is a list now (migration 047) at /list/volunteer. The
   old addresses — /volunteer, /involve, and the confirmation links in emails
   sent before the move — all land there; see routeFromPath. */
function isOldVolunteerPath(p){
  return /^\/(?:volunteer|involve)(?:\/confirm\/[^\/]+)?$/.test(p);
}

/* Still preparing the reporter's files, so the report is not sealed yet.
   The server has written nothing and the link is unspent — see the
   'preparing' branch in src/routes/reports.js. All this does is ask again.

   WHY THE PAGE WAITS AND THE FORM NO LONGER DOES. The form used to refuse
   to send until every file said Ready, which put the whole of a video
   re-encode in front of somebody on the last card. Now it is behind them,
   and usually finished before they have opened their mail. */
var confirmTimer=null;
function confirmPreparing(token,names){
  var box=document.getElementById('confirm-box');
  if(!box) return;
  var which=(names&&names.length)
    ? names.map(function(n){ return esc(n); }).join(', ')
    : 'Your files';
  box.innerHTML='<h2 class="heading-style-h4 margin-bottom margin-tiny">Nearly there</h2>'+
    '<p class="text-size-small text-color-muted margin-bottom margin-xsmall">'+which+
    ' — still being prepared. This page will finish on its own; nothing is lost '+
    'and you do not need to do anything. You can also come back to this link later.</p>';
  clearTimeout(confirmTimer);
  confirmTimer=setTimeout(function(){ showConfirm(token,{quiet:true}); },4000);
}

function showConfirm(token,opts){
  clearActivePanes();
  document.getElementById('pane-confirm').classList.add('active');
  var box=document.getElementById('confirm-box');
  // Quiet on a poll: replacing the wait with "Checking…" every four seconds
  // makes a page that is working look like one that is restarting.
  if(!(opts&&opts.quiet)) box.innerHTML='Checking…';
  fetch('/api/reports/confirm/'+encodeURIComponent(token)).then(function(r){ return r.json(); }).then(function(d){
    if(d.status==='preparing'){ confirmPreparing(token,d.files); return; }
    if(d.status==='public'){
      history.replaceState(null,'','/r/'+encodeURIComponent(d.publicRef));
      showReport(d.publicRef);
      return;
    }
    if(d.status==='created'||d.status==='pending'){
      var att='';
      if(d.attachments){
        if(d.attachments.attached){
          att='<p class="text-size-small text-color-muted margin-bottom margin-xsmall">'+plural(d.attachments.attached,'photo')+' attached to the record. '+
            (d.attachments.attached===1?'It will be':'They will be')+
            ' reviewed separately — the report can be published without '+
            (d.attachments.attached===1?'it':'them')+'.</p>';
        }
        (d.attachments.excluded||[]).forEach(function(x){
          att+='<p class="text-size-small text-color-muted margin-bottom margin-xsmall is-serious">"'+esc(x.name||'A file')+'" was not attached: '+esc(x.reason)+'.</p>';
        });
      }
      box.innerHTML='<h2 class="heading-style-h4 margin-bottom margin-tiny">Submitted</h2><p class="text-size-small text-color-muted margin-bottom margin-xsmall">Thanks — this report has been recorded and is awaiting moderator review before it appears on the public report board. Bookmark this link; revisiting it will show this same page unless and until the report goes live.</p>'+att;
    } else if(d.status==='expired'){
      box.innerHTML='<h2 class="heading-style-h4 margin-bottom margin-tiny">Link expired</h2><p class="text-size-small text-color-muted margin-bottom margin-xsmall">This confirmation link has expired. Please submit the report again.</p>';
    } else {
      box.innerHTML='<h2 class="heading-style-h4 margin-bottom margin-tiny">Not found</h2><p class="text-size-small text-color-muted margin-bottom margin-xsmall">This link isn\'t valid.</p>';
    }
  }).catch(function(){ box.innerHTML='<h2 class="heading-style-h4 margin-bottom margin-tiny">Something went wrong</h2><p class="text-size-small text-color-muted margin-bottom margin-xsmall">Please try again.</p>'; });
}
function showReport(publicRef){
  clearActivePanes();
  document.getElementById('pane-report').classList.add('active');
  var box=document.getElementById('report-box');
  box.innerHTML='Loading…';
  fetch('/api/reports/'+encodeURIComponent(publicRef)).then(function(r){
    if(!r.ok){ box.innerHTML='<div class="empty_component">Not found, or not currently public.</div>'; return null; }
    return r.json();
  }).then(function(r){
    return r?questionsFor([r]).then(function(){ return r; }):null;
  }).then(function(r){
    if(!r) return;
    box.innerHTML=reportCardHtml(r,{})+
      '<div class="panel_component is-raised margin-bottom margin-xsmall"><a class="button is-secondary is-small" href="/api/reports/export.csv?ref='+encodeURIComponent(r.id)+'">Download CSV</a> '+
      '<button class="button is-secondary is-small" id="report-verify-btn">Check this report</button> '+
      '<button class="button is-secondary is-small" id="report-print-btn" hidden>Print / sign PDF</button></div>';
    document.getElementById('report-verify-btn').addEventListener('click',function(){
      showPane('dash',{noPush:true,sub:'check'});
      document.getElementById('verify-ref').value=r.id;
      runVerify(r.id);
    });
    if(currentUser){
      fetch('/api/me/reports').then(function(rr){ return rr.ok?rr.json():[]; }).then(function(list){
        var mine=(list||[]).find(function(x){ return x.id===r.id; });
        if(mine){
          var pb=document.getElementById('report-print-btn');
          pb.hidden=false;
          pb.addEventListener('click',function(){ openPrint(mine); });
        }
      });
    }
  }).catch(function(){ box.innerHTML='<div class="empty_component">Something went wrong.</div>'; });
}
function routeFromPath(){
  var path=location.pathname.replace(/\/+$/,'') || '/';
  var mConfirm=path.match(/^\/r\/confirm\/([^\/]+)$/);
  if(mConfirm){ showConfirm(decodeURIComponent(mConfirm[1])); return true; }
  /* Answering a request for evidence. Its own address because it arrives
     in a mail and has to stand alone — the reporter may no longer have
     their sign-in, which is why the link is scoped so narrowly. */
  var mEvidence=path.match(/^\/evidence\/([^\/]+)$/);
  if(mEvidence){ showEvidence(decodeURIComponent(mEvidence[1])); return true; }
  /* Addresses handed out before volunteering became a list, and confirmation
     links still sitting in inboxes. Those links have nothing left to confirm
     — the old flow is gone — so they land on the form, which is the useful
     place for somebody who wanted to get in touch. */
  if(isOldVolunteerPath(path)){
    history.replaceState({},'','/list/volunteer');
    showListForm('volunteer',{noPush:true});
    return true;
  }
  /* A list's form. Its own address so a link to the Tip List can be handed
     out; the pane is one, and the list is whatever the address names. */
  var mList=path.match(/^\/list\/([a-z0-9][a-z0-9-]{0,62})$/);
  if(mList){ showListForm(mList[1],{noPush:true}); return true; }
  /* One logbook's filing form: the address handed out for a logbook that is
     open without the password, and just as good for anybody signed in. */
  var mFile=path.match(/^\/file\/([a-z0-9][a-z0-9-]{0,62})$/);
  if(mFile){ openFileForm(mFile[1]); return true; }
  /* ONE HEAT MAP AT ITS OWN ADDRESS. A map an operator put on the front
     page is still something somebody wants to link to, and the admin panel
     names this address beside every map — so it has to resolve. It opens
     the board's map tab and draws that map there, whatever slot it was put
     in: a slot is where a map appears for everybody, an address is where
     one person was sent. */
  var mMap=path.match(/^\/board\/map\/([a-z0-9][a-z0-9-]{0,62})$/);
  if(mMap){
    showPane('dash',{sub:'map',noPush:true});
    showMapNamed(mMap[1]);
    return true;
  }
  var mReport=path.match(/^\/r\/([^\/]+)$/);
  if(mReport){ showReport(decodeURIComponent(mReport[1])); return true; }
  var mInvite=path.match(/^\/invitation\/([^\/]+)$/);
  if(mInvite){ showInvitation(decodeURIComponent(mInvite[1])); return true; }
  // /verify/RL-… is the shareable form: it names the report being checked
  // in the URL, so a link to a verification result is a link to a result
  // and not just to a blank form someone has to retype a reference into.
  // /print is the report form with the print dialog already open. There is
  // no PDF to generate and nothing for the server to do — the paper form is
  // this page under its print stylesheet, so a link somebody can hand out is
  // the whole feature.
  if(path==='/print'){
    showPane('submit',{noPush:true});
    // After a tick, or the dialog captures a page that has not laid out yet.
    setTimeout(function(){ window.print(); },400);
    return true;
  }
  var mVerify=path.match(/^\/verify\/([^\/]+)$/);
  if(mVerify){
    showPane('dash',{noPush:true,sub:'check'});
    var ref=decodeURIComponent(mVerify[1]);
    document.getElementById('verify-ref').value=ref;
    runVerify(ref,{noPush:true});
    return true;
  }
  for(var i=0;i<ROUTES.length;i++){
    if(ROUTES[i][0]===path){
      showPane(ROUTES[i][1],{noPush:true,sub:ROUTES[i][2],scrollTo:ROUTES[i][3]});
      // An address that is no longer the canonical one for what it opens
      // gets rewritten, so the reader's location bar and their Back button
      // agree with each other. The old link still works; it just stops
      // pretending to be a place.
      var canon=pathForPane(ROUTES[i][1],ROUTES[i][2]);
      if(canon && canon!==path && !ROUTES[i][3]) history.replaceState({},'',canon);
      return true;
    }
  }
  return false;
}
// Back/forward re-route without pushing another entry; an unknown path
// falls back to home rather than leaving a blank screen.
window.addEventListener('popstate',function(e){
  // A card-form step, before any route handling: the entries the card form
  // pushes all share the same path, so routeFromPath would happily "route"
  // to /submit again and reset the whole thing. Going back one question has
  // to win over going back one page.
  if(e.state&&typeof e.state.submitCard==='number'&&document.getElementById('rcards')
     &&document.getElementById('pane-submit').classList.contains('active')){
    showCard(e.state.submitCard,{push:false});
    return;
  }
  // While the site is locked, history moves between exactly two states: the
  // open page, and the password. routeFromPath must never run — every pane
  // is in the DOM from the first byte, so it would happily open any of them
  // from whatever entry was next in the stack.
  if(isGated()){
    if(isOpenPath()) openWhileLocked(); else relock();
    return;
  }
  /* A SECTION WITHIN A PANE, after the gate branch above and never before
     it. The admin and portal tab strips push an entry carrying `subnav` and
     the same path, so Back moves between tabs instead of leaving the screen
     — which is what it did on a phone, where Back is how people move.
     Reaching it only here is what keeps those entries inert while locked:
     the branch above has already returned. */
  if(e.state && e.state.subnav && e.state.subnav.nav){
    /* AN EVENT RATHER THAN AN IMPORT. nav.js already imports this file, so
       importing the admin module here would put it inside that cycle for
       the sake of one call. The tab strip answers by marking the detail. */
    var d={nav:e.state.subnav.nav,sec:e.state.subnav.sec,handled:false,blocked:false};
    document.dispatchEvent(new CustomEvent('subnav-pop',{detail:d}));
    /* The operator was asked about unsaved changes and said they would
       rather stay, so the entry they just left goes back on the stack.
       Without this, Back has already happened and declining the dialog
       would leave the history one step out of step with the screen. */
    if(d.blocked){ history.pushState(e.state,'',location.pathname+location.search); return; }
    if(d.handled) return;
  }
  if(!routeFromPath()) showPane('home',{noPush:true});
});

export {
  clearActivePanes, initStandards, isOldVolunteerPath, routeFromPath, showConfirm,
  showReport, showStandard,
};
