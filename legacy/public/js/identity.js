/* identity.js — The deployment's own look and its own name, applied to the
 * page before anything renders.
 *
 * Lifted out of the one <script> public/index.html used to carry, in the
 * order it was in. docs/frontend-files.md has the whole map.
 */

import { abtocBuild } from './contents.js';

/* The deployment's own name. Replaced by applyBrand() from the server's
   answer before anything renders; the literal here is only what a page
   shows if that call never lands. The SOFTWARE is ReportLog either way and
   the footer says so. */
var SITE_TITLE='ReportLog';
var SOFTWARE_NAME='ReportLog';

/* ---------- the deployment's look ----------

   Applied to <html>, not <body>, and from the same call that carries the
   name — the first one every page makes — so the lock screen is themed too
   and nothing paints one way and then repaints.

   An unknown or missing name leaves the attribute off entirely, which is
   the shipped palette. The server already refuses to return a name it has
   no CSS for; this is the second half of the same care, because a
   `data-theme` naming nothing would give a page with no colours at all
   rather than the default ones. */
function applyLook(d){
  var L=(d&&d.look)||{};
  /* Set on <html>, from the same call that carries the name — the first one
     every page makes — so the lock screen wears it too and nothing paints
     one way and then repaints.

     An axis at its shipped value has its attribute REMOVED rather than set,
     so the default look is the plain stylesheet with no attribute selectors
     in play at all. That also means an axis whose value the page has no CSS
     for can never leave the page unstyled: the server refuses to return one,
     and this would fall back to the default even if it did. */
  var el=document.documentElement;
  [['palette',L.palette,'flint'],
   ['theme',L.theme,'signal']].forEach(function(a){
    if(a[1]&&a[1]!==a[2]) el.setAttribute('data-'+a[0],a[1]);
    else el.removeAttribute('data-'+a[0]);
  });
}

/* The name in up to three tones, drawn from the runs the server already
   split.

   The page never parses a name and never knows the quote convention: it is
   handed an ordered list of runs, each with its own mark — '' for the plain
   part, 'a' for the first accent, 'b' for the second — and puts each in its
   own span. A name with no marks arrives as a single plain run, so there is
   no special case here for the ordinary name.

   Built with createTextNode rather than innerHTML, because the name comes
   from a database and an operator who types a < should get a < and not
   markup. */
function paintBrand(el, brand, plain){
  el.textContent='';
  var parts=brand&&brand.parts;
  if(!parts||!parts.length){ el.textContent=plain; return; }
  parts.forEach(function(part){
    if(!part||!part.text) return;
    if(!part.mark){ el.appendChild(document.createTextNode(part.text)); return; }
    var n=document.createElement('span');
    n.className=part.mark;
    n.appendChild(document.createTextNode(part.text));
    el.appendChild(n);
  });
}

/* ---------- the deployment's name ---------- */
/* One place where the brand is applied, driven by what the server says.
   Everything it touches is marked in the markup — data-brand for a bare
   label, data-brand-phrase for a sentence with the name inside it — so
   adding a header later means adding an attribute, not editing this. */
/* THREE ATTRIBUTES, AND THE THIRD IS THE ONE THAT IS EASY TO FORGET.

   `data-brand`        — this element IS the name. Painted with the runs.
   `data-brand-phrase` — a sentence with `{}` where the name goes.
   `data-software-text`— prose in which the word "ReportLog" is CORRECT and
                         must survive a rename: the software talking about
                         itself. Nothing paints it; it is a marker.

   The third exists because `npm test` greps the shipped markup for a bare
   "ReportLog" outside a brand element, and About says "ReportLog" a great
   many times on purpose. Without a positive marker for software-speaking
   prose, the only way to keep that check green is to widen it until it
   catches nothing, and a check that has been muted is worse than no check.
   Mark the prose instead. */
function applyBrand(d){
  /* The plain name — accent marks stripped. A browser tab, a mail subject
     and a sentence with the name inside it all want words, not markup. */
  var brand=d&&d.brand;
  var name=(brand&&typeof brand.plain==='string'&&brand.plain)
    ||((d&&d.siteName)||SITE_TITLE);
  if(d&&d.software) SOFTWARE_NAME=d.software;
  SITE_TITLE=name;

  /* Only rewrite the title if nothing has set a more specific one. Pane
     routing sets "Standards · <site>" and friends, and clobbering that
     here would drop the reader back to a bare site name. */
  if(!document.title||document.title===SOFTWARE_NAME) document.title=name;

  /* The accent marks are presentation and never part of the name, so
     everything that wants words gets the plain one and only the rendered
     brand gets the halves. */
  document.querySelectorAll('[data-brand]').forEach(function(el){
    paintBrand(el, d&&d.brand, name);
  });
  document.querySelectorAll('[data-brand-phrase]').forEach(function(el){
    var tpl=el.getAttribute('data-brand-phrase');
    /* textContent, not innerHTML: the name comes from the database and an
       operator who types a < should get a < and not markup. The one
       template carrying an arrow uses the character rather than an entity
       for the same reason. */
    el.textContent=tpl.split('{}').join(name).replace(/&rarr;/g,'\u2192');
  });

  /* The About contents strip is built by a parse-time IIFE, so it was
     rendered before the server answered and resolved brand() against the
     default. Rebuilding is cheap and idempotent, and it is the honest fix:
     anything generated before the name is known has to be regenerated
     after, not patched in place. */
  if(typeof abtocBuild==='function') abtocBuild();

  /* The software's own name keeps its two-tone treatment in the two places
     that were drawn with it: the bar at the top of every page and the lock
     screen. A deployment that HAS renamed itself gets its own name and its
     own marks, painted by the loop above like everything else.

     Why this is a special case rather than a marked default: the stored
     name is plain text an operator typed, and `ReportLog` typed by hand
     should look the same as `ReportLog` by default. Marking the default
     string instead would mean the software's name rendered differently
     depending on whether somebody had entered it, which is worse. */
  if(name===SOFTWARE_NAME){
    document.querySelectorAll('.brand,#lock-brand').forEach(function(el){
      el.textContent='';
      el.appendChild(document.createTextNode('Report'));
      var a=document.createElement('span'); a.className='a';
      a.appendChild(document.createTextNode('Log'));
      el.appendChild(a);
    });
  }
}

export {
  SITE_TITLE, SOFTWARE_NAME, applyBrand, applyLook, paintBrand,
};
