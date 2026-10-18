/* session.js — Who is signed in: the account bar, the nav menu, the
 * hamburger, signing in with a one-time code, and the two shared reason
 * modals.
 *
 * Lifted out of the one <script> public/index.html used to carry, in the
 * order it was in. docs/frontend-files.md has the whole map.
 */

import { showPane } from './nav.js';
import { renderOwnership } from './roles.js';
import {
  hasAdminAuthority, isTeamMember, isTester, openFeedback, renderFab, renderIssueBadge,
} from './feedback.js';
import { SITE_TITLE } from './identity.js';

var currentUser = null; // {email, role} or null

/* ---------- account bar / nav ---------- */
// Everything except "Submit a Report" lives in the hamburger — nine tabs
// across the bar was unreadable once the Issues tab landed. Submit stays
// out on its own because burying the site's primary public action behind a
// menu costs real reports from first-time visitors.
var reportCount=0;
/* Set by the board, which is what counts them. A module cannot assign to a
   binding it imported, and the number belongs to whoever draws the nav bar. */
function setReportCount(n){ reportCount=n; }
function applyNavCounts(){
  var tc=document.getElementById('tabcount');
  if(tc){ tc.textContent=reportCount; tc.style.display=reportCount?'':'none'; }
}
function rebuildNavMenu(){
  var el=document.getElementById('navmenu-items');
  el.innerHTML='';
  // Before the logged-out bail-out, so logging out actually hides the
  // feedback button rather than leaving it floating over a public page.
  renderFab();

  // Three public entries, not six. "By the numbers" and "Check a report"
  // are views of the board, and the press pack is a section of About —
  // each is still its own address, but none of them earns a line in a menu
  // somebody has to read past to find the two things they came for.
  /* VOLUNTEER IS IN THE MENU NOW. It was a small link in the footer and
     nowhere else — and the page it pointed at did not exist — so the one way
     to reach somebody who runs this deployment was the hardest thing on the
     site to find. It is last of the public entries because it is the least
     common reason to be here, not because it should be hard to see. */
  var groups=[{items:[['home','Home'],['dash','Live Report Board','tabcount'],
    ['alliance','Organizations'],
    ['how','How to use '+SITE_TITLE],['about','About'],
    ['volunteer','Get in touch']]}];
  if(currentUser){
    var account=[['mine','My Reports'],['notify','Notifications']];
    if(isTester()){
      account.push(['issues','Issues','issues-badge']);
      // Not a pane — opens the bug modal. Second entry point beside the
      // corner link, since the corner one is deliberately quiet.
      account.push([null,'Report a bug',null,'bug']);
    }
    groups.push({label:'Your account',items:account});
    // The organization axis, shown only to people who are actually on it.
    // A menu entry for something you cannot do is a menu entry you have to
    // read past forever.
    var mem=currentUser.memberships||[];
    var org=[];
    if(mem.some(function(m){ return m.role==='coordinator'||m.role==='manager'; })) {
      org.push(['intake','File for an organization']);
    }
    if(mem.some(function(m){ return m.role==='manager'; })) {
      org.push(['org','Your organization']);
    }
    if(org.length) groups.push({label:'Organizations',items:org});

    var staff=[];
    /* On the flag, not on a role. An administrator who is not on the team
       is not shown the team's working notes by default; one click gives
       them the flag if they want them. */
    if(isTeamMember()) staff.push(['portal','Team']);
    if(currentUser.role==='moderator'||hasAdminAuthority(currentUser.role)) staff.push(['mods','Moderators']);
    /* Access before Admin, and an Access Manager gets ONLY Access. It is
       the whole of their remit and every route behind it accepts them;
       Admin is requireRole('admin') at the router and offering it to
       somebody who cannot use it is offering them a locked door. */
    if(currentUser.role==='access_manager'||hasAdminAuthority(currentUser.role)) staff.push(['access','Access']);
    if(hasAdminAuthority(currentUser.role)) staff.push(['admin','Admin']);
    if(staff.length) groups.push({label:'Staff',items:staff});
  }

  groups.forEach(function(g){
    if(g.label){
      var h=document.createElement('div');
      h.className='sect'; h.textContent=g.label;
      el.appendChild(h);
    }
    g.items.forEach(function(it){
      var b=document.createElement('button');
      if(it[0]) b.dataset.tab=it[0];
      var label=document.createElement('span');
      label.textContent=it[1];
      b.appendChild(label);
      if(it[2]){
        var n=document.createElement('span');
        n.className='n'; n.id=it[2]; n.style.display='none';
        b.appendChild(n);
      }
      b.addEventListener('click',function(){
        closeNavMenu();
        if(it[3]==='bug'){ openFeedback(); return; }
        showPane(it[0]);
      });
      el.appendChild(b);
    });
  });

  // Log in / out lives at the foot of the menu rather than on the bar —
  // the bar holds the menu and the site's name, and nothing else fits.
  var auth=document.createElement('div');
  auth.className='authblock';
  if(currentUser){
    var who=document.createElement('div');
    who.className='who';
    who.textContent='Signed in as '+currentUser.email;
    auth.appendChild(who);
    var out=document.createElement('button');
    out.id='logout-btn';
    out.textContent='Log out';
    out.addEventListener('click',function(){
      fetch('/api/auth/logout',{method:'POST'}).then(function(){
        currentUser=null;
        rebuildNavMenu();
        closeNavMenu();
        showPane('home');
      });
    });
    auth.appendChild(out);
  } else {
    var inb=document.createElement('button');
    inb.id='login-btn';
    inb.textContent='Log in';
    inb.addEventListener('click',function(){ showPane('login'); closeNavMenu(); });
    auth.appendChild(inb);
  }
  el.appendChild(auth);

  var active=document.querySelector('.pane.active');
  if(active){
    var cur=document.querySelector('#navmenu-items button[data-tab="'+active.id.replace(/^pane-/,'')+'"]');
    if(cur) cur.classList.add('active');
  }
  applyNavCounts();
  renderIssueBadge();
}

/* ---------- hamburger open/close ---------- */
function closeNavMenu(){
  document.getElementById('navmenu').classList.remove('on');
  document.getElementById('menu-btn').classList.remove('on');
  document.getElementById('menu-btn').setAttribute('aria-expanded','false');
}
function toggleNavMenu(){
  var open=document.getElementById('navmenu').classList.toggle('on');
  document.getElementById('menu-btn').classList.toggle('on',open);
  document.getElementById('menu-btn').setAttribute('aria-expanded',open?'true':'false');
}
document.getElementById('menu-btn').addEventListener('click',function(e){
  e.stopPropagation();
  toggleNavMenu();
});
document.addEventListener('click',function(e){
  var m=document.getElementById('navmenu');
  if(m.classList.contains('on') && !m.contains(e.target)) closeNavMenu();
});
document.addEventListener('keydown',function(e){
  if(e.key==='Escape') closeNavMenu();
});
function checkSession(cb){
  fetch('/api/auth/me').then(function(r){ return r.ok ? r.json() : null; }).then(function(d){
    currentUser = d;
    rebuildNavMenu();
    /* The handover offer can land on somebody with no role at all, who
       will never open a staff pane. Drawn here so the only page they can
       reach carries it. */
    if(d) renderOwnership();
    cb && cb();
  });
}

/* ---------- log in (email + one-time code) ---------- */
function resetLoginForm(){
  document.getElementById('login-step-email').hidden=false;
  document.getElementById('login-step-code').hidden=true;
  document.getElementById('login-err').classList.remove('is-shown');
}
function sendLoginCode(){
  var email=document.getElementById('login-email').value.trim();
  var err=document.getElementById('login-err'); err.classList.remove('is-shown');
  fetch('/api/auth/request-code',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email})})
    .then(function(r){ return r.json().then(function(d){ return {ok:r.ok,d:d}; }); })
    .then(function(res){
      if(!res.ok){ err.textContent=res.d.error||'Something went wrong'; err.classList.add('is-shown'); return; }
      document.getElementById('login-step-email').hidden=true;
      document.getElementById('login-step-code').hidden=false;
    });
}
document.getElementById('login-send-code').addEventListener('click',sendLoginCode);
document.getElementById('login-email').addEventListener('keydown',function(e){ if(e.key==='Enter') sendLoginCode(); });
document.getElementById('login-restart').addEventListener('click',resetLoginForm);
// The home page's alerts CTA points at a logged-in-only pane, so route a
// logged-out visitor through login and remember where they were heading.
var pendingAfterLogin=null;
function openAlerts(){
  if(currentUser){ showPane('notify'); return; }
  pendingAfterLogin='notify';
  showPane('login');
}
/* DELEGATED, because the button is drawn rather than written now. The front
   page's buttons are one ordered list built from the deployment's own
   logbooks and lists (src/homeButtons.js), so this element does not exist
   at load — and `getElementById('home-alerts-cta').addEventListener` threw
   on null the moment it stopped being in the markup, which takes the whole
   module down and with it every other listener below this line. */
document.addEventListener('click',function(e){
  if(!e.target.closest) return;
  if(e.target.closest('[data-alerts-open]')) openAlerts();
});
function verifyLoginCode(){
  var email=document.getElementById('login-email').value.trim();
  var code=document.getElementById('login-code').value.trim();
  var err=document.getElementById('login-err'); err.classList.remove('is-shown');
  fetch('/api/auth/verify-code',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email,code:code})})
    .then(function(r){ return r.json().then(function(d){ return {ok:r.ok,d:d}; }); })
    .then(function(res){
      if(!res.ok){ err.textContent=res.d.error||'Invalid code'; err.classList.add('is-shown'); return; }
      /* Ask the server who this is rather than assembling a user from the
         verify response. That built {email, role} and nothing else, so
         every FLAG — tester, and now team member and desks — was missing
         until the next page load, and the portal tab would not appear for
         somebody who had just signed in to reach it. */
      resetLoginForm();
      document.getElementById('login-email').value='';
      document.getElementById('login-code').value='';
      var dest=pendingAfterLogin||'mine';
      pendingAfterLogin=null;
      checkSession(function(){ showPane(dest); });
    });
}
document.getElementById('login-verify-code').addEventListener('click',verifyLoginCode);
document.getElementById('login-code').addEventListener('keydown',function(e){ if(e.key==='Enter') verifyLoginCode(); });

/* ---------- section toggles ---------- */
['everyone','changelog','docs'].forEach(function(k){
  document.getElementById('about-tab-'+k).addEventListener('click',function(){
    showPane('about',{sub:k});
  });
});
['reports','numbers','check','map'].forEach(function(k){
  document.getElementById('dash-tab-'+k).addEventListener('click',function(){
    showPane('dash',{sub:k});
  });
});

/* ---------- reason modal (shared by withdraw/restore) ---------- */
var ovlR=document.getElementById('ovl-reason'), reasonCb=null;
var REASON_STAFF_ONLY='Visible only to moderators/admins — never shown publicly.';
// Opening someone's identity details or the untouched original of their
// photo is the one moderator action whose reason the REPORTER reads. The
// dialog has to say so at the moment it is written — a reason a moderator
// believes is internal and the subject can read is a trap, and the person
// who would pay for it is the moderator.
var REASON_REPORTER_SEES='The reporter will see this reason. They will not see your name.';
var reasonMin=1;
function openReason(title, cb, opts){
  opts=opts||{};
  document.getElementById('reason-title').textContent=title;
  var note=document.getElementById('reason-note');
  note.textContent=opts.note||REASON_STAFF_ONLY;
  note.classList.toggle('reason-warn',Boolean(opts.note));
  document.getElementById('reason-text').value='';
  document.getElementById('reason-err').classList.remove('on');
  reasonMin=opts.minLength||1;
  reasonCb=cb;
  ovlR.classList.add('on');
}
document.getElementById('reason-cancel').addEventListener('click',function(){ ovlR.classList.remove('on'); });
document.getElementById('reason-go').addEventListener('click',function(){
  var text=document.getElementById('reason-text').value.trim();
  var err=document.getElementById('reason-err');
  if(!text){ err.textContent='A reason is required.'; err.classList.add('on'); return; }
  // Mirrors the server's own floor. A reason that is demanded but never
  // checked becomes "." within a week.
  if(text.length<reasonMin){
    err.textContent='Please give a real reason — the reporter whose data this is will read it.';
    err.classList.add('on'); return;
  }
  ovlR.classList.remove('on');
  reasonCb && reasonCb(text);
});

/* ---------- restore modal (status + reason) ---------- */
var ovlRestore=document.getElementById('ovl-restore'), restoreCb=null;
function openRestore(defaultStatus, cb){
  document.getElementById('restore-text').value='';
  document.getElementById('restore-err').classList.remove('on');
  var radio=document.querySelector('input[name="restore-status"][value="'+(defaultStatus||'pending')+'"]')
    || document.querySelector('input[name="restore-status"][value="pending"]');
  radio.checked=true;
  restoreCb=cb;
  ovlRestore.classList.add('on');
}
document.getElementById('restore-cancel').addEventListener('click',function(){ ovlRestore.classList.remove('on'); });
document.getElementById('restore-go').addEventListener('click',function(){
  var text=document.getElementById('restore-text').value.trim();
  var status=(document.querySelector('input[name="restore-status"]:checked')||{}).value;
  var err=document.getElementById('restore-err');
  if(!text){ err.textContent='A reason is required.'; err.classList.add('on'); return; }
  if(!status){ err.textContent='Choose a status to restore to.'; err.classList.add('on'); return; }
  ovlRestore.classList.remove('on');
  restoreCb && restoreCb(status,text);
});

export {
  REASON_REPORTER_SEES, applyNavCounts, checkSession, currentUser, openReason,
  openRestore, setReportCount,
};
