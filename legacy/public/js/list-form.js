/* list-form.js — A list's form, one question per card, and the front-page
 * buttons that lead to the ones that are open.
 *
 * AN ENTRY IS NOT A REPORT. There is no consent card and no question about
 * publication, because nothing anybody writes here is published — at most,
 * counts of the fixed-answer questions are. The form says so on its first
 * card rather than in a policy nobody opens.
 *
 * THE ADDRESS CARD appears only on a form where people can write something,
 * and asks for an address only from somebody who did. Somebody sending a
 * link and two choices has handed over nothing personal and is not asked to
 * hand over an address to protect it. The server decides that from what
 * actually arrived; this card only says it in advance.
 *
 * One card asks one question, and nothing on it changes underneath the
 * person reading it. No auto-advance on selection.
 */

import { esc } from './answers.js';
import { showPane, setTitle } from './nav.js';
import { relock } from './gate.js';

var LF = { list:null, cards:[], at:0, getters:{}, started:0 };
/* Kept in step with PERSONAL_KINDS in src/lists/fields.js — only to word
   the address card. The server decides. */
var PERSONAL = { short_text:1, long_text:1, email:1, place:1 };

function el(id){ return document.getElementById(id); }
function err(msg){ var e=el('lf-err'); e.textContent=msg||''; e.classList.toggle('on', !!msg); }

/* ---- the front page ----------------------------------------------------
 *
 * `renderHomeLists` IS GONE, and it is named here so nobody looks for it.
 * It drew a button per open list into `#home-lists`, which was the half of
 * the front page that worked: a list got its own button while a logbook was
 * behind a generic "Submit a Report" that led to a page asking which one.
 * Both are now one ordered list drawn by home-buttons.js, from one endpoint
 * that knows about both formats. The `data-list-open` delegation below is
 * unchanged and still what opens a list, wherever its button was drawn.
 */

/* ---- the form ---------------------------------------------------------- */

function showListForm(slug, opts){
  opts=opts||{};
  showPane('list',{noPush:true});
  if(!opts.noPush && location.pathname!=='/list/'+slug) history.pushState({},'','/list/'+encodeURIComponent(slug));
  el('lf-form').hidden=true;
  el('lf-done').hidden=true;
  el('lf-closed').hidden=true;
  el('lf-title').textContent=' ';
  el('lf-blurb').textContent='';
  err('');
  fetch('/api/lists/'+encodeURIComponent(slug)).then(function(r){
    /* LOCKED: this list is not one an administrator opened without the
       password. Put the password back rather than say "not found" — the
       answer is the same one every other address behind it gives. */
    if(r.status===401) return r.json().catch(function(){ return {}; }).then(function(b){
      if(b&&b.locked){ relock(); return undefined; }
      return null;
    });
    return r.ok ? r.json() : null;
  }).then(function(list){
    if(list===undefined) return;
    if(!list){
      el('lf-title').textContent='Not found';
      showClosed('There is no form at this address.');
      setTitle('Not found');
      return;
    }
    LF.list=list;
    el('lf-title').textContent=list.title;
    el('lf-blurb').textContent=list.blurb||'';
    setTitle(list.title);
    if(!list.accepting){
      showClosed(list.opensAt && new Date(list.opensAt)>new Date()
        ? 'This form opens on '+new Date(list.opensAt).toLocaleString()+'.'
        : 'This form is not taking anything at the moment.');
      return;
    }
    build(list);
  }).catch(function(){ showClosed('The form could not be loaded. Check your connection and try again.'); });
}

function showClosed(msg){
  var c=el('lf-closed'); c.hidden=false; c.textContent=msg;
}

function card(stepId){
  var c=document.createElement('div');
  c.className='card';
  c.setAttribute('data-card', stepId);
  c.setAttribute('role','group');
  c.setAttribute('tabindex','-1');
  el('lf-cards').appendChild(c);
  return c;
}

function heading(c, key, label, help, required){
  var head=document.createElement('div');
  head.innerHTML='<h2 id="lfq-'+esc(key)+'">'+esc(label)+'</h2>'+
    (help?('<p class="cardsub">'+esc(help)+'</p>'):'')+
    (required?'':'<p class="cardsub">Optional.</p>');
  c.appendChild(head);
}

function tiles(c, key, rows){
  var pick=document.createElement('div');
  pick.className='pick plain';
  pick.setAttribute('role','radiogroup');
  pick.setAttribute('aria-labelledby','lfq-'+key);
  rows.forEach(function(r,i){
    var id='lf-'+key+'-'+i;
    var input=document.createElement('input');
    input.type='radio'; input.name='lf-'+key; input.value=r[0]; input.id=id;
    input.addEventListener('change', function(){ err(''); });
    var label=document.createElement('label');
    label.className='picktile'; label.setAttribute('for',id);
    label.innerHTML='<b>'+esc(r[1])+'</b>';
    pick.appendChild(input); pick.appendChild(label);
  });
  c.appendChild(pick);
  return function(){ var x=pick.querySelector('input:checked'); return x?x.value:undefined; };
}

function input(c, key, type, attrs){
  var i=document.createElement(type==='textarea'?'textarea':'input');
  if(type!=='textarea') i.type=type;
  i.className=type==='textarea'?'form_textarea':'form_input';
  i.setAttribute('aria-labelledby','lfq-'+key);
  Object.keys(attrs||{}).forEach(function(k){ i.setAttribute(k, attrs[k]); });
  i.addEventListener('input', function(){ err(''); });
  c.appendChild(i);
  return i;
}

/* One control per kind. Returns a getter for the value to send. */
function control(c, f){
  if(f.kind==='url'){
    var wrap=document.createElement('div');
    c.appendChild(wrap);
    var boxes=[];
    var add=function(){
      var i=input(wrap, f.key, 'url', { inputmode:'url', autocomplete:'off', spellcheck:'false', placeholder:'https://' });
      if(boxes.length) i.setAttribute('aria-label','Another link');
      boxes.push(i);
      more.hidden = boxes.length>=f.maxValues;
      return i;
    };
    var more=document.createElement('button');
    more.type='button'; more.className='button is-quiet is-small';
    more.textContent='Add another link';
    more.addEventListener('click', function(){ add().focus(); });
    add();
    c.appendChild(more);
    more.hidden = f.maxValues<=1;
    return function(){
      var v=boxes.map(function(b){ return b.value.trim(); }).filter(Boolean);
      if(f.maxValues>1) return v.length?v:undefined;
      return v[0];
    };
  }
  if(f.kind==='yes_no') return tiles(c, f.key, [['yes','Yes'],['no','No']]);
  if((f.kind==='choice_one'||f.kind==='place') && f.options.length && !f.allowOther){
    return tiles(c, f.key, f.options.map(function(o){ return [o,o]; }));
  }
  if(f.kind==='choice_many'){
    var group=document.createElement('div');
    group.className='ticks'; group.setAttribute('role','group');
    group.setAttribute('aria-labelledby','lfq-'+f.key);
    f.options.forEach(function(o,i){
      var l=document.createElement('label'); l.className='choice_item';
      var cb=document.createElement('input');
      cb.type='checkbox'; cb.value=o; cb.className='choice_input'; cb.id='lf-'+f.key+'-'+i;
      var sp=document.createElement('span'); sp.className='choice_text'; sp.textContent=o;
      l.appendChild(cb); l.appendChild(sp); group.appendChild(l);
    });
    c.appendChild(group);
    return function(){
      var v=[].slice.call(group.querySelectorAll('input:checked')).map(function(x){ return x.value; });
      return v.length?v:undefined;
    };
  }
  if(f.kind==='long_text'){
    var ta=input(c, f.key, 'textarea', { maxlength:'1000' });
    return function(){ return ta.value.trim()||undefined; };
  }
  var types={ number:'number', date:'date', time:'time', datetime:'datetime-local', email:'email' };
  var i=input(c, f.key, types[f.kind]||'text', f.kind==='short_text'||f.kind==='place'?{ maxlength:'200' }:{});
  if(f.kind==='datetime') return function(){ return i.value?new Date(i.value).toISOString():undefined; };
  return function(){ return i.value.trim()||undefined; };
}

function build(list){
  el('lf-cards').innerHTML='';
  LF.cards=[]; LF.getters={}; LF.at=0; LF.started=Date.now();
  el('lf-website').value='';

  /* The first card says what happens to what is sent, in words — and WHY an
     address is asked, which depends on the form:
       always + reply  a way to reach the site (volunteering, contact): the
                       address is how they reply.
       always + erase  everybody must type something, so everybody's words
                       need a way to be deleted.
       if-written      only somebody who writes something is asked.
       never           nothing here is about a person. */
  var intro=card('intro-list');
  var days=list.personalDays;
  var gone=(days?('after '+days+' days'):'when you ask')+', or sooner if you use the link we email you';
  var addressLine={
    always: list.emailReason==='reply'
      ? 'This form asks for your email address, so whoever runs this site can reply. What you write and your address are deleted '+gone+'.'
      : 'This form asks for your email address, so you can have what you send deleted. What you write and your address are deleted '+gone+'.',
    'if-written': 'Writing anything is up to you. If you do, you will be asked for an email address, so you can have it deleted; it is deleted '+gone+'. Links and choices are kept.',
    never: 'Nothing here asks about you, and no email address is needed.',
  }[list.emailWhen||'never'];
  intro.innerHTML='<h2>Before you start</h2>'+
    '<p class="cardsub">Nothing you send here is published. A moderator reads it, and at most a count of the answers is ever made public.</p>'+
    '<p class="cardsub">'+esc(addressLine)+'</p>';
  LF.cards.push({ el:intro, valid:function(){ return null; } });

  list.fields.forEach(function(f){
    var c=card('lf-'+f.key);
    heading(c, f.key, f.label, f.help, f.required);
    if(f.erased) {
      var note=document.createElement('p'); note.className='cardsub';
      note.textContent='Deleted after '+(days?days+' days':'you ask')+', with your email address.';
      c.appendChild(note);
    }
    LF.getters[f.key]=control(c, f);
    LF.cards.push({ el:c, key:f.key, valid:function(){
      if(!f.required) return null;
      var v=LF.getters[f.key]();
      return v===undefined||v===''?'An answer is needed here.':null;
    }});
  });

  if(list.asksEmail){
    var always=list.emailWhen==='always';
    var reply=list.emailReason==='reply';
    var ec=card('lf-email');
    heading(ec, 'email', 'Your email address', null, always);
    var why=document.createElement('p'); why.className='cardsub'; why.id='lf-email-why';
    ec.appendChild(why);
    var em=input(ec, 'email', 'email', { autocomplete:'email', inputmode:'email' });
    em.id='lf-email';
    /* On a form that exists to reach the site, sending it IS asking for a
       reply, so there is no box to tick. Elsewhere a reply is a separate
       permission, off unless given. */
    if(!reply){
      var lab=document.createElement('label'); lab.className='choice_item';
      lab.innerHTML='<input class="choice_input" type="checkbox" id="lf-consent"><span class="choice_text"><span class="choice_title">You may write back to me about this</span><span class="choice_note">Only about what you sent. Not a newsletter, and not passed to anybody.</span></span>';
      ec.appendChild(lab);
    }
    LF.getters.__email=function(){ return em.value.trim()||undefined; };
    LF.getters.__consent=function(){ return reply || Boolean(el('lf-consent')&&el('lf-consent').checked); };
    LF.cards.push({ el:ec, onShow:function(){
      why.textContent = always
        ? (reply
          ? 'So whoever runs this site can reply. We also email you a link that deletes what you sent, and your address with it.'
          : 'We email you a link that deletes what you sent, and your address with it.')
        : (wrote()
          ? 'Needed, because you wrote something: we email you a link that deletes it, and your address with it.'
          : 'Not needed \u2014 you have not written anything. Leave it empty unless you want a reply.');
    }, valid:function(){
      var v=LF.getters.__email();
      if(always&&!v) return 'This form needs your email address.';
      if(!always&&wrote()&&!v) return 'Because you wrote something, we need an email address to send you the link that deletes it. Or go back and remove what you wrote.';
      if(v&&!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(v)) return 'That does not look like an email address.';
      return null;
    }});
  }

  el('lf-form').hidden=false;
  show(0);
}

/* Whether anything personal was answered — the same test the server makes. */
function wrote(){
  return LF.list.fields.some(function(f){
    return PERSONAL[f.kind] && LF.getters[f.key] && LF.getters[f.key]()!==undefined;
  });
}

function show(i){
  LF.at=i;
  LF.cards.forEach(function(c,n){ c.el.classList.toggle('on', n===i); });
  var cur=LF.cards[i];
  if(cur.onShow) cur.onShow();
  el('lf-back').hidden = i===0;
  var last = i===LF.cards.length-1;
  el('lf-next').textContent = i===0 ? 'Start' : (last ? 'Send' : 'Next');
  err('');
  cur.el.focus({ preventScroll:true });
  window.scrollTo(0,0);
}

function answers(){
  var out={};
  LF.list.fields.forEach(function(f){
    var v=LF.getters[f.key]();
    if(v!==undefined) out[f.key]=v;
  });
  return out;
}

function send(){
  var btn=el('lf-next');
  btn.disabled=true;
  var email=LF.getters.__email?LF.getters.__email():undefined;
  fetch('/api/lists/'+encodeURIComponent(LF.list.slug)+'/entries', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      answers:answers(),
      email: email||null,
      email_consent: LF.getters.__consent ? LF.getters.__consent() : false,
      website: el('lf-website').value,
      elapsed_ms: Date.now()-LF.started,
    }),
  }).then(function(r){ return r.json().catch(function(){ return {}; }).then(function(b){ return { ok:r.ok, b:b }; }); })
    .then(function(x){
      btn.disabled=false;
      if(!x.ok){
        /* Take the person to the question the server named, and say why. */
        var at=-1;
        if(x.b.key) LF.cards.forEach(function(c,n){ if(c.key===x.b.key) at=n; });
        if(x.b.key==='email') at=LF.cards.length-1;
        if(at>=0) show(at);
        err(x.b.error||'That could not be sent.');
        return;
      }
      done(x.b);
    }).catch(function(){ btn.disabled=false; err('That could not be sent. Check your connection and try again.'); });
}

function done(b){
  el('lf-form').hidden=true;
  var d=el('lf-done'); d.hidden=false;
  d.innerHTML='<div class="panel_component is-raised"><h2 class="heading-style-h4">Sent. Thank you.</h2>'+
    (b.erasable
      ? (b.erasureMailed
        ? '<p class="text-size-small">We have emailed you a link that deletes what you wrote. Keep it if you might want to use it.</p>'
        : '<p class="text-size-small">We could not email you the link to delete what you wrote. If you want it deleted, get in touch with whoever runs this site.</p>')
      : '')+
    '<button type="button" class="button is-secondary is-small margin-top margin-tiny" id="lf-again">Send another</button></div>';
  el('lf-again').addEventListener('click', function(){ showListForm(LF.list.slug,{noPush:true}); });
  window.scrollTo(0,0);
}

function wireListForm(){
  if(!el('lf-form')) return;
  el('lf-next').addEventListener('click', function(){
    var problem=LF.cards[LF.at].valid();
    if(problem){ err(problem); return; }
    if(LF.at===LF.cards.length-1){ send(); return; }
    show(LF.at+1);
  });
  el('lf-back').addEventListener('click', function(){ if(LF.at>0) show(LF.at-1); });
  /* Enter in a text box must not submit the form behind the cards. */
  el('lf-form').addEventListener('submit', function(e){ e.preventDefault(); });
  document.addEventListener('click', function(e){
    var a=e.target.closest&&e.target.closest('[data-list-open]');
    if(!a) return;
    e.preventDefault();
    showListForm(a.getAttribute('data-list-open'));
  });
}
wireListForm();

export {
  showListForm,
};
