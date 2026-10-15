/* admin-look.js — The admin pane: starting points, the words on the site's
 * pages, the look and its live preview, the staff portal, and
 * sub-navigation.
 *
 * Lifted out of the one <script> public/index.html used to carry, in the
 * order it was in. docs/frontend-files.md has the whole map.
 */

import { esc } from './answers.js';
import { showPane } from './nav.js';
import {
  renderAttachments, renderIdentity, renderIntakeSwitch, renderPublication,
} from './admin-settings.js';
import { renderLogbooks } from './logbook-builder.js';
import { myDesks } from './feedback.js';
import { initSiteCopy } from './gate.js';
import { SITE_TITLE, SOFTWARE_NAME, applyBrand, applyLook } from './identity.js';
import { initEditors, mayLeave } from './admin-editors.js';
import { isGated } from './gate.js';

/* ---------- admin ---------- */
function renderSiteAccess(){
  fetch('/api/admin/site-access').then(function(r){ return r.json(); }).then(function(d){
    document.getElementById('site-access-enabled').checked=!!d.enabled;
    /* The rule, stated before anybody types, in the server's own number. */
    document.getElementById('site-access-pw-rule').textContent=
      'At least '+(d.minPassword||8)+' characters. Nothing else is required — this'
      +' keeps the site off the open internet, it is not a vault.';
    document.getElementById('site-access-status').textContent=
      (d.enabled?'Password gate is on. ':'Password gate is off — the site is open. ')+
      (d.hasPassword?'A password is set.':'No password set yet.');
  });
}
document.getElementById('site-access-save').addEventListener('click',function(){
  var err=document.getElementById('site-access-err'); err.classList.remove('on');
  var body={ enabled: document.getElementById('site-access-enabled').checked };
  var pw=document.getElementById('site-access-pw').value;
  var pw2=document.getElementById('site-access-pw2').value;
  /* Caught here so the answer is immediate, and caught again at the server,
     which is what actually makes it true. A blank field means "keep the
     current password" and is not an attempt to set one. */
  if(pw || pw2){
    if(pw!==pw2){
      err.textContent='The two passwords do not match'; err.classList.add('on'); return;
    }
    body.password=pw; body.passwordConfirm=pw2;
  }
  fetch('/api/admin/site-access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
    .then(function(r){ return r.json().then(function(d){ return {ok:r.ok,d:d}; }); })
    .then(function(res){
      if(!res.ok){ err.textContent=res.d.error||'Something went wrong'; err.classList.add('on'); return; }
      document.getElementById('site-access-pw').value='';
      document.getElementById('site-access-pw2').value='';
      renderSiteAccess();
    });
});
/* ---------- what this site says ---------- */
/* WHERE THE WORDS ARE, not a place to edit them.

   This panel used to be five fields in a column with none of the page they
   belong to in sight. A headline is short or long relative to what sits under
   it; a lede reads as a front page's voice or it does not. Neither judgement
   survives being made in a form, which is why every wording change had to be
   made twice — once here and once after looking at the result.

   AND THE ON-PAGE EDITOR ALREADY EXISTED: the "Edit content" button in the
   corner of every page puts a pencil on each [data-copy] element and opens the
   same slot in a dialog (editPens/editOpen in feedback.js). This panel was a
   SECOND editor for the same five slots, which is why one of them could be
   saved here and look wrong there.

   So the boxes are gone and the pencils are the only way. This lists what is
   editable, says which of it is still the shipped wording, and takes you to the
   page it is on — because otherwise nothing on the admin page would tell an
   operator the words are theirs at all.

   Grouped by page, in the order the slots are declared, which is the order
   they appear down each page. */
var COPY_PAGE_NAMES = { home:'Front page', about:'About', standards:'Standards' };

function renderSiteCopy(){
  var box=document.getElementById('copy-where');
  if(!box) return;
  fetch('/api/admin/copy').then(function(r){ return r.json(); }).then(function(d){
    var slots=d.slots||[];
    if(!slots.length){ box.innerHTML='<div class="empty_component">Nothing to write.</div>'; return; }
    var pages=[];
    slots.forEach(function(s){ if(pages.indexOf(s.page)<0) pages.push(s.page); });
    box.innerHTML=pages.map(function(page){
      var mine=slots.filter(function(s){ return s.page===page; });
      return '<p class="lab form_label-sep">'+esc(COPY_PAGE_NAMES[page]||page)+'</p>'+
        mine.map(function(s){
          return '<div class="rc-card"><div class="who"><b>'+esc(s.label)+'</b>'+
            (s.written?'':' <span class="opt-req">still the shipped wording</span>')+
            '<br><span class="opt-req">'+esc(s.help)+'</span></div></div>';
        }).join('')+
        '<button class="button is-secondary is-small" data-copy-goto="'+esc(page)+'">'+
        'Open '+esc((COPY_PAGE_NAMES[page]||page).toLowerCase())+' to edit</button>';
    }).join('');
  });
}

/* The policies a deployment publishes that are not the imprint or the privacy
   policy — found under Legal, written on their own pages like everything else.
   Same data, filtered; a second fetch shape would be a second thing to keep
   true. */
function renderPolicies(){
  var box=document.getElementById('legal-policies');
  if(!box) return;
  fetch('/api/admin/copy').then(function(r){ return r.json(); }).then(function(d){
    var mine=(d.slots||[]).filter(function(s){ return s.policy; });
    if(!mine.length){ box.innerHTML='<div class="empty_component">None yet.</div>'; return; }
    box.innerHTML=mine.map(function(s){
      return '<div class="rc-card"><div class="who"><b>'+esc(s.label)+'</b>'+
        (s.written?' <span class="opt-req">published</span>'
                  :' <span class="opt-req">not written yet</span>')+
        '<br><span class="opt-req">'+esc(s.help)+'</span></div>'+
        '<button data-copy-goto="'+esc(s.page)+'">Open it</button></div>';
    }).join('');
  });
}

/* Delegated once, for both panels. Show-and-hide, never a route: the gate
   depends on popstate never routing while the site is locked. */
document.addEventListener('click',function(e){
  var page=e.target.getAttribute&&e.target.getAttribute('data-copy-goto');
  if(!page) return;
  showPane(page);
});

/* ---------- how this site looks ---------- */
/* ---------- how this site looks ----------

   Three dials, and the preview is the point. A radio button cannot answer
   "what will my site look like", and saving in order to find out is the
   wrong way round — so turning a dial repaints the whole page immediately
   and `Undo` puts the saved look back. Nothing is written until Save.

   The preview is built from the site's own components rather than from
   colour swatches: a row of chips tells an operator nothing about whether
   their site will be readable, and readable is the only question. */
var LOOK_SAVED = null;
var LOOK_CAT = null;

/* ---- the look preview -------------------------------------------------
   ONE BUILDER, THREE CONSUMERS: the admin panel, the first-run wizard, and
   the staff portal's style tab. Written once because a preview that
   disagrees with itself between two screens is worse than no preview, and
   because the wizard's copy has to work before anything is saved.

   The frames are ordinary elements carrying data-palette and data-theme.
   Everything inside inherits the tokens, so repainting is two attribute
   writes and no re-render. */

function lpMiniature(){
  /* Enough of a page to answer the question and no more: the bar with the
     name in it, a heading and lede at their real size against the theme's
     real measure, the buttons, a report card with the two status colours,
     a form field, and the footer. */
  return '<div class="lp-nav">'
    +   '<span class="lp-navlinks"><span>Report</span><span>Board</span><span>About</span></span>'
    +   '<span class="lp-brand"></span>'
    + '</div>'
    + '<div class="lp-wrap">'
    +   '<div class="lp-h1">A record of what happened.</div>'
    +   '<p class="lp-lede">File a report. A moderator reads it before anyone else '
    +     'does. Once it is filed nobody can quietly change it.</p>'
    +   '<div class="lp-btns"><span class="lp-btn p">Report</span>'
    +     '<span class="lp-btn s">The board</span><span class="lp-btn s">Check a report</span></div>'
    +   '<div class="lp-card">'
    +     '<div class="lp-ref">RL-2026-0184</div>'
    +     '<div class="lp-cardh">Polling place opened late</div>'
    +     '<p class="lp-body">Doors were shut until 08:40. Around thirty people '
    +       'waited outside; some left before voting.</p>'
    +     '<span class="lp-chip lp-confirmed">Confirmed</span>'
    +     '<span class="lp-chip lp-serious">Serious</span>'
    +     '<span class="lp-chip lp-open">Open</span>'
    +   '</div>'
    +   '<div class="lp-field"><span class="lp-lab">What happened</span>'
    +     '<div class="lp-input">Tell us in your own words</div></div>'
    + '</div>'
    + '<div class="lp-foot">Powered by ReportLog</div>';
}

function lpBuild(el){
  if(!el || el.getAttribute('data-built')) return;
  el.innerHTML =
      '<figure class="lp-frame lp-desktop"><div class="lp-screen">'
    +   '<div class="lp-page">'+lpMiniature()+'</div>'
    + '</div><figcaption>Desktop</figcaption></figure>'
    + '<figure class="lp-frame lp-phone"><div class="lp-screen">'
    +   '<div class="lp-page">'+lpMiniature()+'</div>'
    + '</div><figcaption>Phone</figcaption></figure>';
  el.setAttribute('data-built','1');
}

/* Paint the frames. `name` is optional and defaults to whatever the page
   currently believes it is called — the wizard passes the name being typed
   on the screen before it, which has not been saved yet. */
function lpPaint(el, palette, theme, name){
  if(!el) return;
  lpBuild(el);
  var n = (name===undefined||name===null||name==='') ? SITE_TITLE : name;
  el.querySelectorAll('.lp-page').forEach(function(pg){
    /* An axis at its shipped value still gets the attribute here, unlike on
       <html>: a frame has to say what it is showing even when that is the
       default, or it would inherit whatever the page around it is set to
       and stop being a preview of anything. */
    pg.setAttribute('data-palette', palette||'flint');
    pg.setAttribute('data-theme', theme||'signal');
  });
  el.querySelectorAll('.lp-brand').forEach(function(b){
    /* The same two-tone rule the real brand follows: the software's own
       name keeps its accent, a deployment's name is drawn as typed. */
    b.textContent='';
    if(n===SOFTWARE_NAME){
      b.appendChild(document.createTextNode('Report'));
      var a=document.createElement('span'); a.className='a';
      a.appendChild(document.createTextNode('Log'));
      b.appendChild(a);
    } else {
      b.appendChild(document.createTextNode(n));
    }
  });
}

/* ---- the staff portal -------------------------------------------------
   THE STYLE TAB IS GENERATED, NOT WRITTEN, and that is the whole idea. A
   comms person opens a design tool and needs the hex. On ReportLog the
   palette is the OPERATOR'S choice out of eighteen, so a style guide typed
   into this page would be wrong on every deployment except the one it was
   typed on — including deployments nobody here will ever see.

   So it reads the resolved look and prints what is actually in force. It is
   the third consumer of the preview built for the admin panel, which is why
   that was written once rather than three times. */

var PORTAL_TABS = [
  ['start','Start here'],
  ['voice','Voice and style'],
  ['comms','Comms and social'],
  ['orgs','Coordinators and organizations'],
  ['dev','Developers and operators'],
  ['moderation','Moderation'],
  ['safety','Safety and discretion'],
  ['releases','Release notes'],
];

/* Which tab opens first, from this person's desks. Display only: a desk
   never hides a tab. The server holds the same mapping in src/desks.js and
   the suite checks every desk lands on a tab that exists; this is the
   client's half and it falls back to the first tab rather than to nothing. */
var DESK_OPENS_ON = {
  lead_dev:'dev', dev:'dev', accessibility:'dev', testing:'dev',
  moderating:'moderation', policy:'moderation',
  group:'orgs', translation:'voice', design:'voice', outreach:'comms',
};
function portalOpeningTab(){
  var mine=myDesks();
  for(var i=0;i<mine.length;i++){ if(DESK_OPENS_ON[mine[i]]) return DESK_OPENS_ON[mine[i]]; }
  return 'start';
}

/* The swatches. Read off the RENDERED page rather than from a table, so
   they cannot disagree with what a visitor is actually looking at — the
   same reason the manifest parses its colours out of the stylesheet. */
var PORTAL_SWATCHES = [
  ['--color--background',      'Page'],
  ['--color--surface',         'Card'],
  ['--color--text',            'Text'],
  ['--color--text-muted',      'Muted text'],
  ['--color--action',          'Action'],
  ['--color--background-deep', 'Nav and deep surfaces'],
  ['--color--status-serious',  'Serious'],
  ['--color--status-confirmed','Confirmed'],
];

function portalStyle(){
  var cs=getComputedStyle(document.documentElement);
  var box=document.getElementById('portal-swatches');
  if(box){
    box.innerHTML=PORTAL_SWATCHES.map(function(row){
      var v=(cs.getPropertyValue(row[0])||'').trim();
      if(!v) return '';
      return '<div class="sw"><span class="chip" data-bg="'+esc(v)+'"></span>'+
        '<span class="nm">'+esc(row[1])+'</span><code>'+esc(v.toUpperCase())+'</code></div>';
    }).join('');
    // Applied here, not written as a style attribute in the string above:
    // setting a property through the CSSOM is allowed under `style-src-attr
    // 'none'` and an attribute in markup is not.
    box.querySelectorAll('.chip[data-bg]').forEach(function(c){ c.style.background=c.getAttribute('data-bg'); });
  }
  /* The real families, resolved, so it names the font that is actually
     rendering rather than the first name in a stack we hope is installed. */
  var line=document.getElementById('portal-typeline');
  if(line){
    var head=(cs.getPropertyValue('--cond')||'').trim().split(',')[0].replace(/['"]/g,'');
    var body=(cs.getPropertyValue('--sans')||'').trim().split(',')[0].replace(/['"]/g,'');
    var mono=(cs.getPropertyValue('--mono')||'').trim().split(',')[0].replace(/['"]/g,'');
    var wide=(cs.getPropertyValue('--page-max')||'').trim();
    line.textContent='Headings '+head+' · body '+body+' · monospace '+mono+
      ' · the page runs to '+wide+' wide.';
  }
}

function renderPortal(){
  var nav=document.getElementById('portal-subnav');
  if(nav && !nav.getAttribute('data-built')){
    nav.innerHTML=PORTAL_TABS.map(function(t){
      return '<button type="button" class="tabs_button" data-portalsec="'+esc(t[0])+'">'+esc(t[1])+'</button>';
    }).join('');
    nav.setAttribute('data-built','1');
    wireSubnav('portal-subnav','portalsec');
    /* Land on the desk's tab AFTER wiring, which opens the first one. */
    var want=portalOpeningTab();
    var btn=nav.querySelector('[data-portalsec="'+want+'"]');
    if(btn) btn.click();
  }
  /* The look can change under somebody with the portal open, so this is
     recomputed on every visit rather than built once. */
  lpPaint(document.getElementById('portal-preview'),
    document.documentElement.getAttribute('data-palette')||'flint',
    document.documentElement.getAttribute('data-theme')||'signal');
  portalStyle();

  var rel=document.getElementById('portal-releases');
  if(rel && !rel.getAttribute('data-built')){
    /* The changelog lives on the About page and is the single copy. Rather
       than duplicate it here and let the two drift, point at it. */
    rel.innerHTML='<p>The full changelog is on the About page. '+
      '<a href="/about/changelog" data-nav="about" data-sub="changelog">Open it</a>.</p>';
    rel.setAttribute('data-built','1');
  }
}

/* ---- sub-navigation ---------------------------------------------------
   One function for every pane that has sections.

   IT PUSHES HISTORY NOW, and the reason is the phone. Changing tab changed
   what was on the screen and touched no history, so Back left the admin
   screen entirely instead of going to the tab before it — and on a phone
   Back is the primary way people move, so the app read as throwing away
   their place.

   THE TRAP IS THE GATE, and it is the reason this was avoided for so long:
   every pane is in the DOM from the first byte, so the lock screen is all
   that stands between a visitor and the site's writing, and a history entry
   that routes past it is a hole. Two things keep that true:

     - nothing is pushed while the site is gated. A locked page's history
       stays the two states it has always been, the open page and the
       password.
     - the entry carries `subnav` and NO new path, and the handler in
       routes.js reads it only AFTER its own `isGated()` branch has had its
       say. So on a locked page these entries are inert even if one is
       somehow in the stack.

   The section is not in the URL, so a section still cannot be linked to.
   That is unchanged and deliberate: a real address per tab would be a
   second router, which is the thing the gate cannot afford. */
var SUBNAVS = {};

function wireSubnav(navId, attr){
  var nav=document.getElementById(navId);
  if(!nav) return;
  var pane=nav.closest('.pane');
  SUBNAVS[navId]=function(sec){ show(sec); };
  function show(sec){
    nav.querySelectorAll('[data-'+attr+']').forEach(function(b){
      var on = b.getAttribute('data-'+attr)===sec;
      /* aria-current rather than a class: the state a screen reader is told
         and the state that is painted are then the same fact. */
      if(on) b.setAttribute('aria-current','true'); else b.removeAttribute('aria-current');
    });
    CURRENT[navId]=sec;
    pane.querySelectorAll('[data-sec]').forEach(function(el){
      /* data-closed marks a panel that belongs to the section but waits to be
         opened, like the logbook editor. Showing the section must not open
         it: that drew an empty editor, for no logbook, under the list. */
      el.hidden = el.getAttribute('data-sec')!==sec || el.hasAttribute('data-closed');
    });
  }
  nav.querySelectorAll('[data-'+attr+']').forEach(function(b){
    b.addEventListener('click',function(){
      var sec=b.getAttribute('data-'+attr);
      if(sec===CURRENT[navId]) return;
      /* ONE EDITOR ACROSS THE WHOLE SCREEN, so changing tab is leaving it.
         A warning, and then it goes — staying is what Cancel on the dialog
         means. admin-editors.js owns the question; asking it here as well
         would be a second idea of what dirty means. */
      if(!mayLeave()) return;
      /* THE SECTION BEING LEFT, READ BEFORE IT IS LEFT. show() moves
         CURRENT to the new one, so tagging the old entry afterwards tagged
         it with the section being opened — and Back then "restored" the tab
         it was already on, which is the same as doing nothing. */
      var leaving=CURRENT[navId];
      show(sec);
      pushSubnav(navId,sec,leaving);
    });
  });
  var first=nav.querySelector('[data-'+attr+']');
  if(first) show(first.getAttribute('data-'+attr));
}

/* Which section each strip is showing. Kept so a click on the tab already
   open pushes nothing — otherwise Back would walk through a pile of
   entries that all look the same. */
var CURRENT = {};

function pushSubnav(navId, sec, leaving){
  /* NOT WHILE GATED. See the note above the function. */
  if(isGated()) return;
  if(!window.history || !history.pushState) return;
  var path=location.pathname+location.search;
  /* THE ENTRY BEING LEFT IS TAGGED FIRST, and without this Back did not
     work: the pane's own entry (pushed by showPane, with no section in it)
     said only "the admin page", so popping to it left the strip showing
     whatever tab it was on. The tag is what the section was when it was
     left, so Back restores it — including a portal tab chosen by somebody's
     desk rather than the first one in the strip.

     Existing keys are kept. The entry may be carrying something else's
     state, and replacing rather than merging would throw it away. */
  var here=history.state||{};
  if(!here.subnav && leaving){
    try{
      history.replaceState(Object.assign({},here,{subnav:{nav:navId,sec:leaving}}),'',path);
    }catch(e){ /* a browser refusing replaceState is not worth failing a click over */ }
  }
  /* The same path, deliberately: this is a position within a pane and not
     an address. */
  history.pushState({subnav:{nav:navId,sec:sec}},'',path);
}

/* Back and forward, called from the popstate handler in routes.js — after
   its own gate branch, which is what keeps these entries inert on a locked
   page. Unknown strip or unknown section: nothing happens, which is the
   right answer for an entry from an older release. */
function showSubnavSection(navId, sec){
  var fn=SUBNAVS[navId];
  if(!fn) return false;
  var nav=document.getElementById(navId);
  if(!nav || !nav.querySelector('[data-adminsec="'+sec+'"],[data-portalsec="'+sec+'"]')) return false;
  /* ONLY WHILE ITS OWN PANE IS THE ONE SHOWING. Because the pane's entry is
     tagged with a section, arriving at that entry from somewhere else is a
     PANE change that happens to carry one — and claiming it here would set
     a tab and never route, leaving the previous pane on screen. Letting it
     fall through to routeFromPath is the whole of the fix. */
  var pane=nav.closest('.pane');
  if(!pane || !pane.classList.contains('active')) return false;
  /* The same warning Back gets everywhere else. Declining leaves the
     editor alone; routes.js puts the history entry back. */
  if(!mayLeave()) return 'blocked';
  fn(sec);
  return true;
}
/* Back and forward arrive as an event from routes.js, dispatched after its
   own gate branch has had its say. */
document.addEventListener('subnav-pop',function(e){
  var d=e.detail||{};
  var got=showSubnavSection(d.nav,d.sec);
  if(got==='blocked'){ d.blocked=true; d.handled=true; return; }
  if(got) d.handled=true;
});
wireSubnav('admin-subnav','adminsec');

function lookPreviewNow(){
  var palette=document.getElementById('look-palette').value;
  var theme=document.getElementById('look-theme').value;
  /* The frames only. This used to call applyLook as well, so moving a dial
     repainted the whole site underneath the person moving it — which made
     the two looks being compared impossible to compare, because one of them
     had already become the thing being compared against. The live site
     changes in one place now: the Apply button below. */
  lpPaint(document.getElementById('look-preview'), palette, theme);
  lookStatus();
}

/* Which of the two looks is on the site, and which is only in the frames.
   Without this the panel gives no sign that a chosen palette has not been
   applied, which is the one thing this arrangement can get wrong. */
function lookStatus(){
  var el=document.getElementById('look-status');
  if(!el||!LOOK_SAVED) return;
  var applied=lookLabel('palettes',LOOK_SAVED.palette)+' · '+lookLabel('themes',LOOK_SAVED.theme);
  var same=document.getElementById('look-palette').value===LOOK_SAVED.palette
        && document.getElementById('look-theme').value===LOOK_SAVED.theme;
  el.textContent=same
    ? 'The site is showing '+applied+'.'
    : 'Preview only — the site is still showing '+applied+'.';
}

function renderLook(){
  fetch('/api/admin/look').then(function(r){ return r.json(); }).then(function(d){
    /* A response that is not the catalogue — a 401 on a page an admin has
       not signed into yet, an error body — must leave the panel alone
       rather than throw. Reading d.look.palette off an error object threw a
       TypeError that took every later panel on the page down with it, which
       is how one unauthenticated fetch turned into a blank settings page. */
    if(!d || !d.look) return;
    LOOK_SAVED = d.look; LOOK_CAT = d;
    var fill=function(id, items, chosen){
      var sel=document.getElementById(id);
      sel.innerHTML=items.map(function(i){
        return '<option value="'+esc(i.id)+'"'+(i.id===chosen?' selected':'')+'>'+
          esc(i.label)+(i.dark?' — dark':'')+'</option>';
      }).join('');
    };
    fill('look-palette', d.palettes||[], d.look.palette);
    fill('look-theme',   d.themes||[],   d.look.theme);
    lpPaint(document.getElementById('look-preview'), d.look.palette, d.look.theme);
    lookNotes();
    lookStatus();
  });
}
function lookLabel(kind, id){
  return ((LOOK_CAT&&LOOK_CAT[kind]||[]).find(function(x){ return x.id===id; })||{}).label||id;
}
function lookNotes(){
  [['palette','palettes'],['theme','themes']].forEach(function(a){
    var id=document.getElementById('look-'+a[0]).value;
    var item=((LOOK_CAT&&LOOK_CAT[a[1]]||[]).find(function(x){ return x.id===id; })||{});
    document.getElementById('look-'+a[0]+'-note').textContent=item.description||'';
  });
}
['look-palette','look-theme'].forEach(function(id){
  document.getElementById(id).addEventListener('change',function(){
    lookPreviewNow(); lookNotes();
  });
});
document.getElementById('look-revert').addEventListener('click',function(){
  if(!LOOK_SAVED) return;
  /* Nothing to undo on the site any more — this puts the dials and the
     frames back to what the site is already showing. */
  document.getElementById('look-palette').value=LOOK_SAVED.palette;
  document.getElementById('look-theme').value=LOOK_SAVED.theme;
  lpPaint(document.getElementById('look-preview'), LOOK_SAVED.palette, LOOK_SAVED.theme);
  lookNotes(); lookStatus();
});
document.getElementById('look-save').addEventListener('click',function(){
  var err=document.getElementById('look-err'); err.classList.remove('on');
  fetch('/api/admin/look',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      palette:document.getElementById('look-palette').value,
      theme:document.getElementById('look-theme').value,
    })})
    .then(function(r){ return r.json().then(function(d){ return {ok:r.ok,d:d}; }); })
    .then(function(res){
      if(!res.ok){ err.textContent=res.d.error||'Something went wrong'; err.classList.add('on'); return; }
      applyLook({look:res.d.look});
      renderLook();
    });
});

export {
  lpPaint, renderLook, renderPolicies, renderPortal, renderSiteAccess, renderSiteCopy,
  showSubnavSection,
};
