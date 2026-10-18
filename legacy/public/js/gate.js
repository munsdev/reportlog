/* gate.js — The site-wide password gate, the legal text, whether reports
 * are being accepted, and the first call every page makes.
 *
 * Lifted out of the one <script> public/index.html used to carry, in the
 * order it was in. docs/frontend-files.md has the whole map.
 */

import { showPane } from './nav.js';
import {
  clearActivePanes, initStandards, isOldVolunteerPath, routeFromPath, showConfirm,
} from './routes.js';
import { showListForm } from './list-form.js';
import { esc } from './answers.js';
import { checkSession } from './session.js';
import { initAttach } from './attachments.js';
import { cardify, openFileForm } from './form-logbook.js';
import { applyDevMode, applyVersion } from './feedback.js';
import { applyBrand, applyLook } from './identity.js';
import { afterUnlock } from './setup.js';

/* ---------- site-wide password gate ---------- */
/* The operator's own legal notices, if they have written any.

   Written with textContent, never innerHTML: this is somebody else's
   writing arriving from a database, and it is published as typed rather
   than interpreted. The unwritten state is what the markup already shows,
   so a failed fetch leaves the page saying nothing has been published —
   which is true, and is the safe direction to be wrong in. */
function initLegalText(){
  fetch('/api/legal').then(function(r){ return r.ok?r.json():null; }).then(function(d){
    if(!d) return;
    ['impressum','privacy'].forEach(function(kind){
      var text=d[kind];
      var body=document.getElementById(kind+'-text');
      var none=document.getElementById(kind+'-none');
      if(typeof text==='string' && text.trim()){
        body.textContent=text;
        body.hidden=false; none.hidden=true;
      } else {
        body.textContent=''; body.hidden=true; none.hidden=false;
      }
    });
  }).catch(function(){});
}

/* Whether the operator is accepting reports.

   Asked before the form is offered, because somebody who fills in eleven
   cards and is refused at the end has been wasted — and on this form that
   person is often typing an account of something that just happened to
   them. The server refuses regardless of what this does; this is the
   courtesy, not the rule.

   A check that does not answer leaves the form up. That is the deliberate
   direction: the cost of a form that works on a closed archive is one
   refusal at the end, and the cost of a wrongly closed one is an account
   that never gets recorded. */
function initIntakeGate(){
  fetch('/api/reports/intake').then(function(r){ return r.ok?r.json():null; })
    .then(function(d){
      if(!d || d.open !== false) return;
      // Open, but no logbook is taking reports. Every report is filed through
      // one, so there is no form — and the reason is not that anybody closed
      // the site, so the notice does not say that.
      if(d.switchOpen && !d.logbooks){
        document.getElementById('intake-closed-why').textContent=
          'Nothing is open for reports here right now. Reports are filed to a logbook, '
          +'and none is taking them at the moment.';
      }
      document.getElementById('intake-closed').hidden=false;
      var f=document.getElementById('rform');
      if(f) f.hidden=true;
    }).catch(function(){});
}

/* The words this deployment puts on its own pages.

   textContent, never innerHTML: this is somebody else's writing arriving
   from a database, published as typed rather than interpreted — the same
   rule as the imprint, and for the same reason.

   Every slot always resolves to something, so a failed fetch leaves the
   markup's own wording in place, which is the same string the module
   carries as that slot's fallback. The page is never blank and never
   half-replaced. */
function initSiteCopy(){
  fetch('/api/legal/copy').then(function(r){ return r.ok?r.json():null; })
    .then(function(d){
      if(!d) return;
      document.querySelectorAll('[data-copy]').forEach(function(el){
        var text=d[el.getAttribute('data-copy')];
        var written=typeof text==='string' && text.trim();
        if(written) el.textContent=text;
        /* AN OPTIONAL SLOT IS MARKED `hidden` IN THE MARKUP and is revealed only
           once somebody has written it. The slots that carry a fallback are
           never hidden — their unwritten state is a sentence saying the page has
           not been written, which is the right default for a front page.
           An extra paragraph on the reporting form is different: the reader
           there is filing an account of something that happened to them, and an
           empty paragraph or a note to the operator both cost them attention
           they came to spend elsewhere.

           Only slots the markup hid are touched, so this cannot un-hide
           anything else on a page. */
        if(el.hasAttribute('hidden') || el.dataset.copyOptional==='1'){
          el.dataset.copyOptional='1';
          el.hidden=!written;
        }
      });
    }).catch(function(){});
}

function initApp(){ initAppNow(); }

function initAppNow(){
  // Before anything routes, so a visitor landing straight on /submit gets
  // a built form first time rather than an empty one.
  cardify();
  initAttach();
  initStandards();
  initLegalText();
  initSiteCopy();
  initIntakeGate();
  checkSession(function(){
    if(!routeFromPath()){
      history.replaceState({},'','/');
      showPane('home',{noPush:true});
    }
  });
}
// THE ADDRESSES THAT WORK WITHOUT THE PASSWORD: a list's form, a logbook's
// filing form, and the old volunteer addresses that now lead to a list.
// WHETHER THE THING BEHIND ONE IS ACTUALLY OPEN is the server's decision —
// a list or logbook an administrator did not open answers 401 locked, and
// the page puts the password back. So guessing an address shows nothing.
var OPEN_LIST = /^\/list\/([a-z0-9][a-z0-9-]{0,62})$/;
var OPEN_FILE = /^\/file\/([a-z0-9][a-z0-9-]{0,62})$/;
var OPEN_CONFIRM = /^\/r\/confirm\/([^\/]+)$/;
function isOpenPath(){
  var p=location.pathname.replace(/\/+$/,'') || '/';
  return OPEN_LIST.test(p) || OPEN_FILE.test(p) || OPEN_CONFIRM.test(p) || isOldVolunteerPath(p);
}

// One page, and no menu around it. The rest of the app needs API calls the
// gate would refuse, so offering links to it would only produce a site that
// looks broken.
function openWhileLocked(){
  document.getElementById('site-lock').classList.remove('on');
  document.body.classList.add('gated-open');
  var p=location.pathname.replace(/\/+$/,'') || '/';
  if(isOldVolunteerPath(p)){ history.replaceState({},'','/list/volunteer'); p='/list/volunteer'; }
  var m=p.match(OPEN_LIST);
  if(m){ showListForm(m[1],{noPush:true}); return; }
  var f=p.match(OPEN_FILE);
  if(f){ openFileForm(f[1]); return; }
  // The confirmation link of a report filed without the password. The token
  // is the secret; the server lets this one call through.
  var c=p.match(OPEN_CONFIRM);
  if(c){ showConfirm(decodeURIComponent(c[1])); return; }
  relock();
}

/* What the password page offers somebody without the password: whatever an
   administrator set to show there. Links are plain addresses — following one
   reloads into openWhileLocked above, the same path a shared link takes. */
function renderDoors(){
  var box=document.getElementById('site-lock-doors');
  if(!box) return;
  fetch('/api/doors').then(function(r){ return r.ok?r.json():[]; }).then(function(list){
    if(!Array.isArray(list)||!list.length){ box.hidden=true; box.innerHTML=''; return; }
    box.innerHTML='<p>No password? You can still:</p><ul>'+list.map(function(d){
      return '<li><a href="'+esc(d.href)+'">'+esc(d.title)+'</a></li>';
    }).join('')+'</ul>';
    box.hidden=false;
  }).catch(function(){ box.hidden=true; });
}

// Leaving the one open page puts the password back. Every pane is in the
// DOM from the first byte, so without this, going Back from the form left
// the whole site on screen — the API refused it its data, but About, the
// privacy policy and every other word on the site were readable, which is
// most of what the gate is there to hold back.
// Locked, whether we are currently showing the password or the one page in
// front of it. Both count: Back and Forward move between them, and the
// answer has to be the same in both directions.
function isGated(){
  var lock = document.getElementById('site-lock');
  return document.body.classList.contains('gated-open')
    || (lock && lock.classList.contains('on'));
}

function relock(){
  document.body.classList.remove('gated-open');
  clearActivePanes();
  document.getElementById('site-lock').classList.add('on');
  renderDoors();
}

/* ---------- the boot gate ----------

   `class="booting"` is on <html> in the shipped markup and keeps the site's
   writing and its name invisible until the answer below has arrived. Two
   faults shared one cause: every pane is in the DOM from the first byte, so
   a locked deployment showed the whole page for a blip, and the name is a
   literal in the markup, so a renamed deployment said ReportLog and then
   corrected itself.

   IT MUST COME OFF ON EVERY PATH. A boot gate that can stick is a blank
   site, which is worse than the flash it replaces — so it comes off in the
   `finally`-shaped tail of the call, in the `catch`, and on a watchdog for
   the case where the call neither resolves nor rejects (a captive portal, a
   proxy holding the socket open). Whichever fires first wins; the class is
   only ever removed, so running twice is free.

   The lock screen and the setup wizard are deliberately NOT behind it: both
   are switched on by this same answer, so neither has anything to flash, and
   hiding them would leave a locked deployment blank for the length of the
   call rather than for none of it. */
function booted(){ document.documentElement.classList.remove('booting'); }
/* The module graph linked and is running — read by boot-guard.js, the one
   classic script, which repairs a page whose modules never got this far. */
document.documentElement.setAttribute('data-modules','1');
var BOOT_WATCHDOG_MS=4000;
setTimeout(booted, BOOT_WATCHDOG_MS);

function checkSiteAccess(){
  fetch('/api/site-access/status').then(function(r){ return r.json(); }).then(function(d){
    applyLook(d);
    applyBrand(d);
    applyDevMode(d);
    applyVersion(d);
    if(d.locked){
      // A confirmation link in somebody's inbox has to work whether or not
      // they have the password, or the email leads to a password prompt.
      if(isOpenPath()){ openWhileLocked(); return; }
      // Through relock rather than just switching the overlay on, so a
      // locked page is in one state however it got there. The overlay is
      // opaque and covers the viewport, but leaving a pane active behind it
      // means the gate is relying on a z-index, and it should not have to.
      relock();
    } else {
      document.getElementById('site-lock').classList.remove('on');
      afterUnlock();
    }
  })
    /* Both arms, and after the branch above rather than before it: the page
       is revealed once it is in the state the answer asked for, not while it
       is still being put into it. A failed call leaves the shipped markup —
       the default name, the site's own writing — which is what this page
       showed before the gate existed, and is the honest thing to show when
       the server cannot say otherwise. */
    .then(booted, booted);
}

export {
  checkSiteAccess, initApp, initLegalText, initSiteCopy, isGated, isOpenPath,
  openWhileLocked, relock,
};
