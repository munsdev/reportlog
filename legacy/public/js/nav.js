/* nav.js — The tab bar and the nav wiring, accepting an invitation, the
 * Alliance directory, page titles, the progress rule, and showPane.
 *
 * Lifted out of the one <script> public/index.html used to carry, in the
 * order it was in. docs/frontend-files.md has the whole map.
 */

import { showStandard } from './routes.js';
import { checkSession, currentUser } from './session.js';
import { resetSubmitPane } from './form-logbook.js';
import { renderDash } from './board.js';
import { renderMine, renderNotify } from './mine.js';
import { renderModerators, renderPress, renderStats } from './moderate.js';
import { renderMapsFor } from './map.js';
import { renderPortal } from './admin-look.js';
import { initEditors } from './admin-editors.js';
import { renderAccess, renderAdmin } from './logbook-builder.js';
import { renderIntake, renderOrgPanel } from './roles.js';
import { hasAdminAuthority, isTeamMember, isTester, renderIssues } from './feedback.js';
import { abtocSync, scrollToSection } from './contents.js';
import { relock } from './gate.js';
import { SITE_TITLE } from './identity.js';
import { showListForm } from './list-form.js';
import { renderHomeButtons } from './home-buttons.js';

/* ---------- tabs / nav ---------- */
// Every pane has a real path, so any page can be linked to directly.
// nginx already falls back to index.html for unknown paths
// (try_files $uri $uri/ /index.html), so deep links need no server routing.
// A group of radios or checkboxes announces what it is a group OF.
//
// Each of these sets sits in a .f with a visible heading — "Severity",
// "Were you observing directly?" — that is styled text and nothing more, so
// it was never read out. Someone using a screen reader heard "Procedural
// note, radio button, 1 of 4" with no idea what the four were answering.
// Tying the heading to the group fixes that without moving any markup, which
// matters because the card form picks these fields up and relocates them.
document.querySelectorAll('#pane-submit .form_field-wrapper').forEach(function(f,i){
  var lab=f.querySelector(':scope > .form_label');
  if(!lab) return;
  var inputs=f.querySelectorAll('input[type="radio"],input[type="checkbox"]');
  if(inputs.length<2) return;
  if(!lab.id) lab.id='grouplab-'+i;
  f.setAttribute('role',inputs[0].type==='radio'?'radiogroup':'group');
  f.setAttribute('aria-labelledby',lab.id);
});

// Every error box on every page announces itself.
//
// There are two dozen of these — sign-in, the report form, each moderator
// action — and they are shown by a couple of dozen separate lines that set
// the text and add a class. Rather than find and change every one, they are
// all marked as live regions once, here: a message appearing in any of them
// is then read out instead of appearing silently to someone who cannot see
// it happen. role=alert is the assertive one on purpose. An error is the
// answer to something the person just did, and it is worth interrupting for.
document.querySelectorAll('.form_error').forEach(function(e){
  e.setAttribute('role','alert');
  e.setAttribute('aria-live','assertive');
});

var ROUTES=[
  ['/','home'],
  ['/submit','submit'],
  ['/board','dash','reports'],
  ['/board/numbers','dash','numbers'],
  ['/board/map','dash','map'],
  ['/board/check','dash','check'],
  // The addresses these three pages had before they became views of the
  // board. Kept resolving because they have been given out, and a link
  // that used to work should keep working.
  ['/stats','dash','numbers'],
  ['/verify','dash','check'],
  ['/about','about','everyone'],
  ['/how','how'],
  // Addresses that were handed out and must keep landing somewhere
  // sensible. /about/technical is now a position in one document rather
  // than a pane of its own, and /about/using is a page of its own rather
  // than a section — both are handled after routing, in showPane.
  ['/about/technical','about','everyone','ab-chain'],
  ['/about/using','how'],
  ['/about/changelog','about','changelog'],
  ['/about/documents','about','docs'],
  ['/about/press','about','docs'],
  ['/standards','standards','moderation'],
  ['/standards/moderation','standards','moderation'],
  ['/standards/groups','standards','groups'],
  ['/standards/organizations','standards','organizations'],
  ['/standards/evidence','standards','evidence'],
  ['/standards/how','standards','how'],
  ['/alliance','alliance'],
  ['/impressum','impressum'],
  ['/privacy','privacy'],
  ['/login','login'],
  ['/my-reports','mine'],
  ['/notifications','notify'],
  ['/issues','issues'],
  ['/intake','intake'],
  ['/organization','org'],
  ['/press','about','docs'],
  // nginx serves public/ directly and only proxies /api/*, so unless it is
  // told otherwise /updatenotes never reaches the server route that returns
  // the PDF — it falls through to index.html and the app loads instead.
  // Rather than let that land silently on the home page, the path resolves
  // to the page carrying the document. With the nginx block in place (see
  // the README) the server answers first and this never runs; without it,
  // the link still goes somewhere useful. It sits after /press so /press
  // stays the canonical address for the pane.
  ['/updatenotes','about','docs'],
  ['/moderators','mods'],
  ['/team','portal'],
  ['/access','access'],
  ['/admin','admin']
];
function pathForPane(name,sub){
  for(var i=0;i<ROUTES.length;i++){
    var r=ROUTES[i];
    if(r[1]!==name) continue;
    if(name==='how') return r[0];
    if(name==='about') { if(r[2]===(sub||'everyone')) return r[0]; continue; }
    if(name==='dash')  { if(r[2]===(sub||'reports'))  return r[0]; continue; }
    // The bare /standards route is listed first and shares its sub with
    // /standards/moderation, so skip it and let the named address win.
    if(name==='standards'){ if(r[0]!=='/standards' && r[2]===(sub||'moderation')) return r[0]; continue; }
    return r[0];
  }
  return null;
}
// About's sections are separate routes rather than hidden divs behind a
// toggle, so "read the changelog" is something you can send someone.
function showAboutSection(which){
  if(typeof abtocSync === 'function') abtocSync(which);
  ['everyone','changelog','docs'].forEach(function(k){
    var d=document.getElementById('about-'+k);
    if(d) d.hidden=(k!==which);
    var b=document.getElementById('about-tab-'+k);
    if(b) b.classList.toggle('active',k===which);
  });
}
// The page never reloads, so without this every screen is called the same
// thing — in the tab, in the history, and to a screen reader announcing
// where it just landed.

/* Resolve a label written before the deployment's name was known. Any
   string built at parse time that mentions the site has to go through this
   at RENDER time, or it keeps the default forever — which is exactly the
   bug ABTOC_EXTRA had. */
function brand(tpl){ return String(tpl).split('{}').join(SITE_TITLE); }
/* ---------- accepting an invitation ---------- */
/* Looking is a GET that consumes nothing; accepting is a POST. That split
   is not tidiness — a mail client prefetching the link must not be able to
   join somebody to an organization, and the person has to be able to read
   what the role means before there is anything to press. */
var invToken=null;

function showInvitation(token){
  invToken=token;
  showPane('invitation',{noPush:true});
  document.getElementById('inv-loading').style.display='';
  document.getElementById('inv-bad').hidden=true;
  document.getElementById('inv-body').hidden=true;
  document.getElementById('inv-done').hidden=true;

  fetch('/api/invitations/'+encodeURIComponent(token))
    .then(function(r){ return r.json().then(function(d){ return {ok:r.ok,d:d}; }); })
    .then(function(res){
      document.getElementById('inv-loading').style.display='none';
      if(!res.ok){
        document.getElementById('inv-bad-text').textContent=res.d.error||'This invitation is not valid.';
        document.getElementById('inv-bad').hidden=false;
        return;
      }
      var d=res.d;
      document.getElementById('inv-org').textContent=d.organization;
      document.getElementById('inv-who').textContent=
        d.invitedBy+' invited '+d.email+' to join as a '+
        ((d.permissions&&d.permissions.label)||d.role).toLowerCase()+'.';

      var can=document.getElementById('inv-can'); can.innerHTML='';
      var cannot=document.getElementById('inv-cannot'); cannot.innerHTML='';
      ((d.permissions&&d.permissions.can)||[]).forEach(function(t){
        var li=document.createElement('li'); li.textContent=t; can.appendChild(li);
      });
      ((d.permissions&&d.permissions.cannot)||[]).forEach(function(t){
        var li=document.createElement('li'); li.textContent=t; cannot.appendChild(li);
      });

      document.getElementById('inv-expiry').textContent= d.expiresAt
        ? 'This invitation expires on '+new Date(d.expiresAt).toLocaleDateString(undefined,
            {year:'numeric',month:'long',day:'numeric'})+'.' : '';

      /* Signed in as the wrong person, or not at all, is worth saying HERE
         rather than letting them press Accept and be refused. The link is a
         credential for one address; a forwarded email must not become
         somebody else's membership. */
      var signedInAs=currentUser&&currentUser.email;
      var needsSignIn=!signedInAs||signedInAs.toLowerCase()!==String(d.email).toLowerCase();
      document.getElementById('inv-signin').hidden=!needsSignIn;
      document.getElementById('inv-accept-box').style.display=needsSignIn?'none':'';
      if(needsSignIn){
        document.getElementById('inv-signin-text').textContent= signedInAs
          ? 'This invitation was sent to '+d.email+', and you are signed in as '
            +signedInAs+'. Sign in as '+d.email+' to accept it.'
          : 'This invitation was sent to '+d.email+'. Sign in with that address to accept it.';
      }
      document.getElementById('inv-body').hidden=false;
    })
    .catch(function(){
      document.getElementById('inv-loading').style.display='none';
      document.getElementById('inv-bad-text').textContent='The invitation could not be loaded.';
      document.getElementById('inv-bad').hidden=false;
    });
}

document.getElementById('inv-signin-btn').addEventListener('click',function(){
  showPane('login');
});

document.getElementById('inv-accept').addEventListener('click',function(){
  var err=document.getElementById('inv-err'); err.classList.remove('on');
  fetch('/api/invitations/'+encodeURIComponent(invToken)+'/accept',{method:'POST'})
    .then(function(r){ return r.json().then(function(d){ return {ok:r.ok,d:d}; }); })
    .then(function(res){
      if(!res.ok){ err.textContent=res.d.error||'That did not work.'; err.classList.add('on'); return; }
      document.getElementById('inv-body').hidden=true;
      document.getElementById('inv-done-title').textContent='You have joined '+res.d.organization+'.';
      document.getElementById('inv-done-text').textContent=
        'You are a '+res.d.role+' of '+res.d.organization+'. '
        +'Reports you file for it will carry its name.';
      document.getElementById('inv-done').hidden=false;
      /* The menu is built from the session's memberships, so it has to be
         rebuilt or the organization somebody just joined is missing from
         the nav until they reload. */
      checkSession();
    });
});

document.getElementById('inv-done-go').addEventListener('click',function(){
  showPane('org');
});

/* ---------- the Alliance directory ---------- */
/* Ordered by member count, exact numbers, and nothing else on the row
   invites comparison — no rank, no bar, no badge. Report counts are
   deliberately absent: ranking by them would create a public incentive to
   file more reports, and the archive's whole value is that its contents
   were not manufactured. Members cannot be manufactured by typing, which
   is why a headcount is safe to show and a report count is not.

   The server does the ordering. Re-sorting here would be a second opinion
   about a rule that has one place to live. */
function loadAlliance(){
  var list=document.getElementById('alliance-list');
  var empty=document.getElementById('alliance-empty');
  fetch('/api/alliance').then(function(r){ return r.json(); }).then(function(d){
    // Rendered from what the API sent, never from a copy kept here. The
    // sentence saying this is not verification travels with the rows on
    // purpose, so the page cannot show one without the other.
    document.getElementById('alliance-disclaimer').textContent=d.disclaimer||'';
    if(d.name) document.getElementById('alliance-title').textContent=d.name;
    list.innerHTML='';
    var orgs=d.organizations||[];
    empty.hidden=!!orgs.length;
    orgs.forEach(function(o){
      var row=document.createElement('div'); row.className='orgrow';
      var top=document.createElement('div'); top.className='top';
      var nm=document.createElement('span'); nm.className='nm'; nm.textContent=o.name;
      var mc=document.createElement('span'); mc.className='mc';
      // "1 member", not "1 members". An organization of one is the normal
      // way one starts.
      mc.textContent=o.member_count+(o.member_count===1?' member':' members');
      top.appendChild(nm); top.appendChild(mc); row.appendChild(top);
      if(o.joined){
        var meta=document.createElement('p'); meta.className='meta';
        meta.textContent='Joined '+new Date(o.joined).toLocaleDateString(undefined,
          {year:'numeric',month:'long',day:'numeric'});
        row.appendChild(meta);
      }
      if(o.details){
        var desc=document.createElement('p'); desc.className='desc';
        desc.textContent=o.details;
        row.appendChild(desc);
      }
      list.appendChild(row);
    });
  }).catch(function(){
    list.innerHTML='';
    empty.hidden=false;
    empty.textContent='The directory could not be loaded.';
  });
}

var PANE_TITLES={
  home:'', submit:'Submit a report', dash:'Live report board',
  about:'About', how:'How to use this site',
  standards:'Standards', impressum:'Impressum', privacy:'Privacy Policy', login:'Sign in',
  mine:'My reports', notify:'Notifications', issues:'Known issues',
  mods:'Moderators', admin:'Admin', report:'Report', confirm:'Confirm your report',
  intake:'Filing for an organization', org:'Your organization',
  alliance:'Organizations', invitation:'Invitation',
  // A list's form takes its title from the list, once it has loaded.
  list:''
};
function setTitle(part){
  document.title=part?(part+' — '+SITE_TITLE):SITE_TITLE;
}

// Draw the form's progress along the bottom edge of the navigation bar, or
// pass null to put the plain green rule back. Null rather than 0 on
// purpose: nothing to show and no progress yet are different states, and
// the opening card should not look like a form you have already failed to
// start.
function navProgress(percent){
  var tabs=document.querySelector('.tabs');
  var fill=document.querySelector('#navprog i');
  if(!tabs||!fill) return;
  if(percent===null||percent===undefined){
    tabs.classList.remove('progress');
    fill.style.width='0';
    return;
  }
  tabs.classList.add('progress');
  fill.style.width=percent+'%';
}
// The board's three views. Same rule as About: each is a real address, so
// the checker is still something you can link a sceptic to directly.
function showDashSection(which){
  ['reports','numbers','check','map'].forEach(function(k){
    var d=document.getElementById('dash-'+k);
    if(d) d.hidden=(k!==which);
    var b=document.getElementById('dash-tab-'+k);
    if(b) b.classList.toggle('active',k===which);
  });
  if(which==='numbers') renderStats();
  /* A map is loaded when the screen holding it is opened, and not before —
     the module promises nothing of a map is fetched until its view is, and
     an operator can put one on any of the board's three tabs. So the tab
     that just opened is what gets asked for, rather than all of them. */
  renderMapsFor('dash', which);
}
function showPane(name,opts){
  opts=opts||{};
  // "Get in touch" in the menu is the volunteer form, which is a list now
  // and has no pane of its own. First, before any pane is looked up by name.
  if(name==='volunteer'){ showListForm('volunteer'); return; }
  // Belt and braces for the popstate guard above: anything that routes away
  // from the open form while the site is locked re-asserts the password,
  // whatever called it.
  // While locked, only the one open page itself may be shown: a list's form,
  // or a logbook's filing form. Anything else puts the password back.
  if(document.body.classList.contains('gated-open') && name!=='list' && name!=='submit' && name!=='confirm'){ relock(); return; }
  document.querySelectorAll('.tab').forEach(function(x){x.classList.remove('active')});
  document.querySelectorAll('.pane').forEach(function(x){x.classList.remove('active')});
  document.querySelectorAll('#navmenu-items button').forEach(function(x){x.classList.remove('active')});
  var tabBtn=document.querySelector('.tab[data-tab="'+name+'"]');
  if(tabBtn) tabBtn.classList.add('active');
  var menuBtn=document.querySelector('#navmenu-items button[data-tab="'+name+'"]');
  if(menuBtn) menuBtn.classList.add('active');
  document.getElementById('pane-'+name).classList.add('active');
  // The progress rule belongs to the form and nothing else, so leaving the
  // form puts the bar's plain green edge back.
  if(name!=='submit') navProgress(null);
  // Arriving at the form after having sent one gets a form, not the
  // confirmation left over from last time.
  if(name==='submit' && typeof resetSubmitPane==='function') resetSubmitPane();
  /* The portal is behind the team-member flag. Guarded HERE as well as in
     the menu, because a link and a typed address are ways in too — the
     menu only decides what is offered. It holds nothing confidential, so
     this is tidiness rather than security; the real protection for anything
     that mattered would be on the server, and nothing here is served. */
  if(name==='portal' && !isTeamMember()){ showPane('home'); return; }
  /* Guarded here as well as in the menu: a link and a typed address are
     ways in too. The server refuses either way — these only decide whether
     somebody is shown a page that would answer 403 at every panel. */
  if(name==='access' && !(currentUser
      && (hasAdminAuthority(currentUser.role) || currentUser.role==='access_manager'))){
    showPane('home'); return;
  }
  if(name==='admin' && !(currentUser && hasAdminAuthority(currentUser.role))){
    showPane('home'); return;
  }
  if(name==='standards') showStandard(opts.sub||'moderation',{noPush:true});
  if(name==='about'){
    var sub=opts.sub||'everyone';
    // Guarded here as well as in the tab bar: a link is a way in too.
    if(sub==='changelog' && !isTester()) sub='everyone';
    showAboutSection(sub);
  }
  // The technical half is no longer a pane. Somebody arriving on the
  // address that used to open it gets the document, scrolled to where
  // that half begins — which is what they were asking for either way.
  if(name==='about' && opts.scrollTo){
    var target=opts.scrollTo;
    setTimeout(function(){ scrollToSection(target); }, 30);
  }
  if(name==='dash') showDashSection(opts.sub||'reports');
  if(name==='alliance') loadAlliance();
  setTitle(PANE_TITLES[name]);
  if(!opts.noPush){
    var path=pathForPane(name,opts.sub);
    if(path && location.pathname!==path) history.pushState({},'',path);
  }
  window.scrollTo(0,0);
  if(name==='dash') renderDash();
  if(name==='mine') renderMine();
  if(name==='notify') renderNotify();
  if(name==='mods') renderModerators();
  if(name==='home'){ renderHomeButtons(); renderMapsFor('home'); }
  if(name==='portal') renderPortal();
  if(name==='about'){ renderMapsFor('about'); }
  if(name==='about' && (opts.sub||'')==='docs') renderPress();
  if(name==='access') renderAccess();
  if(name==='admin'){
    renderAdmin();
    /* ONE EDITOR OPEN AT A TIME. Collapses every panel on this pane that
       has a save button of its own, leaves the switches alone, and
       repaints the collapsed summaries once the panels' own fetches have
       answered. Idempotent, so arriving here again is free. */
    initEditors('pane-admin');
  }
  if(name==='issues') renderIssues();
  if(name==='intake') renderIntake();
  if(name==='org') renderOrgPanel();

}
document.querySelectorAll('.tabs [data-tab]').forEach(function(b){
  b.addEventListener('click',function(){ showPane(b.dataset.tab); });
});
// data-sub carries the section for panes that have them — About and the
// board — so one link can point at "About, the technical part" rather than
// landing on the first tab and leaving the reader to find it.
document.querySelectorAll('[data-nav]').forEach(function(b){
  b.addEventListener('click',function(e){
    e.preventDefault();
    var sub=b.getAttribute('data-sub');
    showPane(b.getAttribute('data-nav'), sub?{sub:sub}:undefined);
  });
});

export {
  PANE_TITLES, ROUTES, brand, navProgress, pathForPane, setTitle, showInvitation,
  showPane,
};
