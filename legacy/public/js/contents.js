/* contents.js — The contents strips: About's, and the guide's.
 *
 * Lifted out of the one <script> public/index.html used to carry, in the
 * order it was in. docs/frontend-files.md has the whole map.
 */

import { esc } from './answers.js';
import { brand, showPane } from './nav.js';

/* ---------- About: the contents strip ---------- */
// One index across both parts. In the source document those were a single
// forty-screen scroll; here they are separate panes, so an entry in part
// two switches pane first and then scrolls. That is strictly kinder than
// making somebody scroll past nine sections to reach the tenth.
var ABTOC_EXTRA = [
  ['how',   '/how', '',     'How to use {}'],
  ['about', null,   'docs', 'Documents'],
];

// One place that knows how far down the sticky furniture reaches. Both
// indexes and the /about/technical redirect scroll through it, so a change
// to the bars cannot leave one of the three landing behind them.
function stickyStack(){
  var tabs=document.querySelector('.tabs');
  var strip=document.querySelector('.pane.active .abtoc');
  return (tabs?tabs.offsetHeight:52) + (strip && !strip.hidden ? strip.offsetHeight : 0) + 8;
}
function scrollToSection(id){
  var el=document.getElementById(id);
  if(!el) return;
  var y=el.getBoundingClientRect().top + window.scrollY - stickyStack();
  window.scrollTo({top:Math.max(0,y),behavior:'auto'});
  // The heading is what a screen reader should land on, not the strip.
  el.setAttribute('tabindex','-1');
  try{ el.focus({preventScroll:true}); }catch(e){ el.focus(); }
}

function abtocBuild(){
  var lists = {
    everyone: document.getElementById('abtoc-list-1'),
    geeks:    document.getElementById('abtoc-list-2'),
    extra:    document.getElementById('abtoc-list-3'),
  };
  if(!lists.everyone) return;
  [lists.everyone, lists.geeks, lists.extra].forEach(function(l){ l.innerHTML=''; });

  // Read from the document rather than a second list kept in step by hand.
  // A section added to the markup appears here without anybody remembering
  // to add it, which is the only version of this that stays correct.
  // One document, so one pass. The parts are told apart by where the seam
  // falls rather than by which pane they live in — there is only one pane
  // now, which is the whole point of merging them.
  var seam = document.getElementById('ab-part-two');
  [document.getElementById('about-everyone')].forEach(function(root){
    if(!root) return;
    root.querySelectorAll('section[data-abnav]').forEach(function(sec){
      var pane = (seam && (sec.compareDocumentPosition(seam) & Node.DOCUMENT_POSITION_PRECEDING))
        ? 'geeks' : 'everyone';
      var heading = sec.querySelector('h2');
      if(!heading) return;
      var parts = sectionParts(sec);
      var num = parts.num || '\u2014';
      var name = parts.name;
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '#' + sec.id;
      a.dataset.target = sec.id;
      a.innerHTML = '<span class="n">'+esc(num)+'</span>'+esc(name || heading.textContent.trim());
      li.appendChild(a);
      lists[pane].appendChild(li);
    });
  });

  ABTOC_EXTRA.forEach(function(row){
    // The changelog is not offered here at all — it is gated, and an index
    // entry that refuses you is worse than no entry.
    var li = document.createElement('li');
    var a = document.createElement('a');
    a.href = row[1] || '#';
    a.dataset.nav = row[0];
    a.dataset.sub = row[2] || '';
    a.innerHTML = '<span class="n">·</span>'+esc(brand(row[3]));
    li.appendChild(a);
    lists.extra.appendChild(li);
  });
}

function abtocClose(){
  var btn=document.getElementById('abtoc-btn'), menu=document.getElementById('abtoc-menu');
  if(!btn) return;
  menu.hidden = true;
  btn.setAttribute('aria-expanded','false');
}

// The strip only belongs on the two long sections. "How to use ReportLog" and
// Documents are short enough to read without an index, and a contents
// button listing somewhere you already are reads as broken.
function abtocSync(which){
  var strip = document.getElementById('abtoc');
  if(!strip) return;
  // The document gets the index. Documents and the changelog are short
  // enough to read without one, and a contents button listing where you
  // already are reads as broken.
  strip.hidden = (which !== 'everyone');
  abtocMeasureNav();
  abtocClose();
  abtocLabel();
}

// Which section the reader is actually in: the last one whose top has
// passed under the bars. Measured rather than assumed, because both bars
// are sticky and their combined height is what the text is hiding behind.
// Which section the reader is actually in: the last one whose top has
// passed under the bars. Works for either document — About's sections
// carry data-abnav, the guide's carry data-hownav — so there is one
// implementation rather than two that have to agree.
// "07 \u00b7 Who can do what" -> the number and the name, kept apart so the
// number can be set in mono and the name in the display face. One reader,
// used by both indexes and both bar labels, so they cannot drift.
function sectionParts(sec){
  if(!sec) return null;
  var eyebrow = sec.querySelector('.ab-eyebrow');
  var raw = eyebrow ? eyebrow.textContent.trim() : '';
  var bits = raw.split('\u00b7');
  var name = bits.length > 1 ? bits.slice(1).join('\u00b7').trim() : raw;
  if(!name){
    var h = sec.querySelector('h2');
    name = h ? h.textContent.trim() : '';
  }
  return { num: bits.length > 1 ? bits[0].trim() : '', name: name };
}

// The bar says what the dropdown says. Writing the number here rather than
// dropping it means the thing you navigated by is still on screen once you
// have arrived.
function sectionLabel(txt, sec){
  var parts = sectionParts(sec);
  var html = parts && parts.name
    ? (parts.num ? '<span class="n">'+esc(parts.num)+'</span>' : '') + '<span class="nm">'+esc(parts.name)+'</span>'
    : '<span class="nm">Contents</span>';
  if(txt.innerHTML !== html) txt.innerHTML = html;
}

function currentSection(root, attr){
  if(!root) return null;
  var line = stickyStack() + 4;
  var found = null;
  root.querySelectorAll('section['+attr+']').forEach(function(sec){
    if(sec.getBoundingClientRect().top <= line) found = sec;
  });
  return found;
}
function abtocCurrent(){
  var shown = document.getElementById('about-everyone');
  if(!shown || shown.hidden) return null;
  return currentSection(shown, 'data-abnav');
}

function abtocLabel(){
  var txt = document.getElementById('abtoc-txt');
  if(!txt) return;
  var sec = abtocCurrent();
  sectionLabel(txt, sec);
  var id = sec ? sec.id : null;
  document.querySelectorAll('#abtoc-menu a').forEach(function(a){
    if(id && a.dataset.target === id) a.setAttribute('aria-current','true');
    else a.removeAttribute('aria-current');
  });
}

// Measured, not guessed. The nav's height moves with the safe-area inset
// on a notched phone, and a hardcoded offset leaves either a gap or an
// overlap on exactly the devices most people read this on.
function abtocMeasureNav(){
  var tabs = document.querySelector('.tabs');
  if(!tabs) return;
  var nav = tabs.offsetHeight;
  document.documentElement.style.setProperty('--navh', nav + 'px');
  // Everything that scrolls to a position has to clear both bars: anchor
  // links, in-page Find, and the browser restoring where you were when you
  // press Back. One value, set from what is actually on screen.
  var strip = document.getElementById('abtoc');
  var stack = nav + (strip && !strip.hidden ? strip.offsetHeight : 0) + 8;
  document.documentElement.style.setProperty('--stickyh', stack + 'px');
}

(function initAbtoc(){
  var btn = document.getElementById('abtoc-btn');
  var menu = document.getElementById('abtoc-menu');
  if(!btn || !menu) return;
  abtocBuild();
  abtocMeasureNav();

  btn.addEventListener('click', function(e){
    e.stopPropagation();
    var open = btn.getAttribute('aria-expanded') === 'true';
    menu.hidden = open;
    btn.setAttribute('aria-expanded', open ? 'false' : 'true');
  });

  menu.addEventListener('click', function(e){
    var a = e.target.closest('a');
    if(!a) return;
    e.preventDefault();
    abtocClose();
    var target = a.dataset.target;
    // A section of this document: scroll. Both parts live in one pane now,
    // so there is nothing to switch first.
    if(target){ scrollToSection(target); abtocLabel(); return; }
    // Somewhere else entirely.
    showPane(a.dataset.nav, a.dataset.sub ? {sub:a.dataset.sub} : undefined);
    window.scrollTo({top:0});
  });

  document.addEventListener('click', function(e){
    if(btn.getAttribute('aria-expanded') !== 'true') return;
    if(!menu.contains(e.target) && e.target !== btn && !btn.contains(e.target)) abtocClose();
  });
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' && btn.getAttribute('aria-expanded') === 'true'){ abtocClose(); btn.focus(); }
  });

  var ticking = false;
  window.addEventListener('scroll', function(){
    if(ticking) return;
    ticking = true;
    window.requestAnimationFrame(function(){ abtocLabel(); ticking = false; });
  }, {passive:true});
  window.addEventListener('resize', function(){ abtocMeasureNav(); abtocLabel(); });
})();

/* ---------- the guide's own contents strip ---------- */
// The same machinery as About's, pointed at the other document. Kept as a
// second small init rather than a generalised one: two indexes over two
// documents is less code than one index that has to be told which document
// it is looking at on every call.
(function initHowToc(){
  var btn = document.getElementById('howtoc-btn');
  var menu = document.getElementById('howtoc-menu');
  var list = document.getElementById('howtoc-list');
  var txt = document.getElementById('howtoc-txt');
  var root = document.getElementById('how-doc');
  if(!btn || !menu || !list || !root) return;

  root.querySelectorAll('section[data-hownav]').forEach(function(sec){
    var heading = sec.querySelector('h2');
    if(!heading) return;
    var parts = sectionParts(sec);
    var num = parts.num || '\u2014';
    var name = parts.name;
    var li = document.createElement('li');
    var a = document.createElement('a');
    a.href = '#' + sec.id;
    a.dataset.target = sec.id;
    a.innerHTML = '<span class="n">'+esc(num)+'</span>'+esc(name);
    li.appendChild(a);
    list.appendChild(li);
  });

  function close(){ menu.hidden = true; btn.setAttribute('aria-expanded','false'); }
  function label(){
    var sec = currentSection(root, 'data-hownav');
    sectionLabel(txt, sec);
    var id = sec ? sec.id : null;
    list.querySelectorAll('a').forEach(function(a){
      if(id && a.dataset.target === id) a.setAttribute('aria-current','true');
      else a.removeAttribute('aria-current');
    });
  }
  window.howtocLabel = label;

  btn.addEventListener('click', function(e){
    e.stopPropagation();
    var open = btn.getAttribute('aria-expanded') === 'true';
    menu.hidden = open;
    btn.setAttribute('aria-expanded', open ? 'false' : 'true');
  });
  menu.addEventListener('click', function(e){
    var a = e.target.closest('a');
    if(!a) return;
    e.preventDefault();
    close();
    scrollToSection(a.dataset.target);
    label();
  });
  document.addEventListener('click', function(e){
    if(btn.getAttribute('aria-expanded') !== 'true') return;
    if(!menu.contains(e.target) && e.target !== btn && !btn.contains(e.target)) close();
  });
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' && btn.getAttribute('aria-expanded') === 'true'){ close(); btn.focus(); }
  });
  var ticking = false;
  window.addEventListener('scroll', function(){
    if(ticking) return;
    ticking = true;
    window.requestAnimationFrame(function(){
      if(document.getElementById('pane-how').classList.contains('active')) label();
      ticking = false;
    });
  }, {passive:true});
})();

export {
  abtocBuild, abtocSync, scrollToSection,
};
