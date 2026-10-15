/* form-logbook.js — Logbooks on the reporting form: the spine every report
 * is asked, a logbook's own questions, and the review card.
 *
 * Lifted out of the one <script> public/index.html used to carry, in the
 * order it was in. docs/frontend-files.md has the whole map.
 */

import { esc, isBoolKind } from './answers.js';
import { conditionMet } from './conditions.js';
import { PANE_TITLES, navProgress, setTitle, showPane } from './nav.js';
import { relock } from './gate.js';
import { ATT, ATT_LABEL, attRefresh, attRender, attSetLogbook } from './attachments.js';
import {
  STEPS, btn, cardMayPublish, checkValid, consentCard, form, lbTakesFiles,
} from './form.js';

var reviewReturn=false;

/* ==================================================================
   LOGBOOKS ON THE REPORTING FORM

   A logbook is the form. Every report is filed through one, and its
   questions are the report: the software asks nothing of its own beyond
   the spine — files if the logbook takes them, the publication answer, an
   address and consent.

   ONE CARD ENGINE. A logbook's questions are spliced into STEPS right after
   the chooser, so they walk the same progress bar, Back button, review card
   and one-question-per-card rule as everything else.
   ================================================================== */

/* The open logbooks, fetched once when the form initialises. */
var LOGBOOKS=[];
/* The chosen one, with its fields. Null until one is chosen. */
var LOGBOOK=null;
/* key -> function returning the raw answer, one per generated card. */
var LB_GETTERS={};
/* The steps and cards this file generated, so choosing again can undo them. */
var LB_STEP_IDS=[];

/* WHICH QUESTIONS ARE BEING ASKED, AND WHAT HAS BEEN ANSWERED — in one
   walk, in the operator's order, because the two decide each other.

   A question carrying `shown_when` is asked only when an earlier answer
   satisfies it, and visibility cascades: question 5 may depend on 3, which
   depends on 1, and a 3 that is not asked has no answer, so 5 is not asked
   either. Walking forward and testing each condition against the answers
   gathered SO FAR is what makes one pass enough — and the server refusing
   forward references (src/conditions.js) is what makes it correct rather
   than merely convenient.

   src/answers.js does exactly this on the server, over the same conditions,
   and `scripts/selftest.js` runs one table of cases through both copies of
   conditionMet to assert they cannot drift. The server is the one that
   decides what gets sealed; this one decides what somebody is shown. */
function lbWalk(){
  var answers={};
  var shown={};
  if(!LOGBOOK||!LOGBOOK.fields) return {answers:answers,shown:shown};
  LOGBOOK.fields.forEach(function(f){
    /* No card, no answer, so no visibility to decide. */
    if(f.kind==='file') return;
    var ask=!f.shown_when||conditionMet(f.shown_when,answers);
    shown[f.key]=ask;
    if(!ask) return;
    var g=LB_GETTERS[f.key];
    if(!g) return;
    var v=g();
    if(v===undefined||v===null||v===''||(Array.isArray(v)&&!v.length)) return;
    answers[f.key]=v;
  });
  return {answers:answers,shown:shown};
}

/* What gets sent, and what the review card lists.

   A QUESTION THAT WAS NOT ASKED CONTRIBUTES NOTHING, even if its control
   still holds something typed before an earlier answer changed. The server
   drops such an answer anyway; dropping it here as well means the review
   card, the leave-this-page guard and the payload all say the same thing as
   the record will. */
function lbAnswersNow(){
  return lbWalk().answers;
}

/* Is this question being asked right now? Unknown keys read as asked, so a
   field with no condition is never accidentally hidden. */
function lbShown(key){
  return lbWalk().shown[key]!==false;
}

/** One control per field type. Returns a getter for the raw value to send. */
function lbControl(card,f){
  var id='lbf-'+f.key;
  var settings=f.settings||{};
  var options=Array.isArray(settings.options)?settings.options:[];
  var mk=function(tag,attrs){
    var el=document.createElement(tag);
    Object.keys(attrs||{}).forEach(function(k){ el.setAttribute(k,attrs[k]); });
    return el;
  };
  var simple=function(el){
    el.id=id; el.className=el.tagName==='SELECT'?'form_select':(el.tagName==='TEXTAREA'?'form_textarea':'form_input');
    el.setAttribute('aria-labelledby','lbq-'+f.key);
    card.appendChild(el);
    el.addEventListener('input',function(){ cardErr(''); });
    return function(){ return el.value; };
  };

  if(f.kind==='long_text'){
    var ta=document.createElement('textarea');
    ta.setAttribute('maxlength',String(settings.maxLength||5000));
    return simple(ta);
  }
  /* THE DECLARATION DRAWS THE SAME CARD AS A YES/NO, because it seals the
     same boolean. Its own branch rather than `||` on the line below, so the
     tile labels can say what is being answered: "Yes" alone on a card
     asking whether somebody has footage reads as agreeing to send it, and
     the whole point of this question is that nothing is uploaded. */
  if(f.kind==='evidence_declaration'){
    var dpicked=null;
    choiceTiles(card,'lb-'+f.key,[
      ['yes','Yes, I have something'],
      ['no','No, I do not'],
    ],function(v){ dpicked=v; });
    return function(){ return dpicked; };
  }
  if(f.kind==='yes_no'){
    /* Tiles, like every other either/or on this form. A checkbox cannot
       tell "no" from "did not answer", and this field can be either. */
    var picked=null;
    choiceTiles(card,'lb-'+f.key,[['yes','Yes'],['no','No']],function(v){ picked=v; });
    return function(){ return picked; };
  }
  if(f.kind==='choice_one'||(f.kind==='place'&&options.length&&!settings.allowOther)){
    var chosen=null;
    choiceTiles(card,'lb-'+f.key,options.map(function(o){ return [o,o]; }),
      function(v){ chosen=v; });
    return function(){ return chosen; };
  }
  /* A PICKER, BECAUSE THE SERVER TAKES A CODE AND NOTHING ELSE.
     A location answer is sealed as `US-AZ` or `DE`, and a name is
     deliberately never accepted in its place — sealing a guess for
     "Arizona" would hide a bug in the archive. So a text box here would
     have been a question every answer to which was refused, which is
     precisely what happened until this existed: the kind fell through to
     the plain input at the bottom of this function.
     Grouped, because a scope of `both` otherwise files Arizona between
     Argentina and Armenia. The list comes with the question
     (src/routes/logbooks.js) so filing needs no second request. */
  if(f.kind==='location'){
    var places=f.places||{subdivisions:[],countries:[]};
    var sel=document.createElement('select');
    sel.className='form_select';
    sel.id=id;
    sel.setAttribute('aria-labelledby','lbq-'+f.key);
    var none=document.createElement('option');
    none.value=''; none.textContent='Choose a place';
    sel.appendChild(none);
    [['United States',places.subdivisions],['Countries',places.countries]]
      .forEach(function(pair){
        if(!pair[1]||!pair[1].length) return;
        var host=sel;
        // One group only matters when there are two; a single <optgroup>
        // is a heading over the whole list saying nothing.
        if(places.subdivisions.length&&places.countries.length){
          host=document.createElement('optgroup');
          host.label=pair[0];
          sel.appendChild(host);
        }
        pair[1].forEach(function(p){
          var o=document.createElement('option');
          o.value=p.code;
          // The NAME is what somebody reads and the CODE is what is
          // sealed. Showing the code too would invite a reporter to think
          // it means something to them.
          o.textContent=p.name;
          host.appendChild(o);
        });
      });
    sel.addEventListener('change',function(){ cardErr(''); });
    card.appendChild(sel);
    return function(){ return sel.value; };
  }
  if(f.kind==='choice_many'){
    var wrap=document.createElement('div');
    wrap.className='ticks';
    wrap.setAttribute('role','group');
    wrap.setAttribute('aria-labelledby','lbq-'+f.key);
    options.forEach(function(o,i){
      var l=document.createElement('label');
      l.className='choice_item';
      var cb=document.createElement('input');
      cb.type='checkbox'; cb.value=o; cb.id=id+'-'+i; cb.className='choice_input';
      var sp=document.createElement('span'); sp.textContent=o; sp.className='choice_text';
      l.appendChild(cb); l.appendChild(sp);
      l.addEventListener('change',function(){ cardErr(''); });
      wrap.appendChild(l);
    });
    card.appendChild(wrap);
    return function(){
      /* The ORDER SENT IS THE SCREEN'S, which is the operator's. The server
         sorts into the operator's order too, so this only has to avoid
         inventing one of its own. */
      return [].slice.call(wrap.querySelectorAll('input:checked'))
        .map(function(c){ return c.value; });
    };
  }
  var types={date:'date',time:'time',datetime:'datetime-local',
    number:'number',email:'email',url:'url'};
  var input=mk('input',{type:types[f.kind]||'text'});
  if(f.kind==='number'){
    if(settings.min!==null&&settings.min!==undefined) input.setAttribute('min',settings.min);
    if(settings.max!==null&&settings.max!==undefined) input.setAttribute('max',settings.max);
  }
  if(f.kind==='short_text'||f.kind==='place'){
    input.setAttribute('maxlength',String(settings.maxLength||200));
  }
  var get=simple(input);
  if(f.kind==='datetime'){
    /* A datetime-local reads as the reporter's own clock. The server keeps
       UTC so the answer means the same thing read anywhere, and converting
       here rather than there keeps the browser's timezone out of the seal's
       reasoning. */
    return function(){ var v=input.value; return v?new Date(v).toISOString():''; };
  }
  return get;
}

/**
 * Build the cards for a logbook's questions, and splice them into STEPS.
 *
 * STEPS and cardEls are index-parallel — showCard toggles cardEls[n] for
 * STEPS[n] — so they are spliced together or neither.
 */
function lbBuildCards(logbook){
  lbClearCards();
  if(!logbook) return;
  var at=-1;
  for(var i=0;i<STEPS.length;i++) if(STEPS[i].id==='logbook'){ at=i; break; }
  if(at<0) return;

  var host=document.getElementById('rcards');
  /* COUNTED SEPARATELY FROM THE LOOP INDEX, because not every field becomes a
     card. An upload question is a question the operator places among the
     others, but the control it asks for is the two evidence cards the form
     already has — so it contributes no card of its own and must not leave a
     gap in the splice positions. Using the forEach index here would insert the
     next question one slot too far along and put the cards out of order. */
  var n=-1;
  logbook.fields.forEach(function(f){
    /* THE UPLOAD QUESTION HAS NO CARD OF ITS OWN. Its presence is what makes
       the logbook take files at all — the server has already resolved that
       into `acceptsFiles`, which is what the evidence cards are gated on — so
       building a control for it here would draw a second, text-shaped place to
       put a photo.

       Its POSITION among the questions is not honoured yet: the evidence cards
       sit after all of them, where they already were. Moving them would mean
       reordering two fixed steps inside arrays that showCard reads in
       lockstep, on every logbook change, and the gain is which screen the
       upload appears on rather than whether it appears. Worth doing; not worth
       doing carelessly. */
    if(f.kind==='file') return;
    n+=1;
    var stepId='lbf-'+f.key;
    var card=document.createElement('div');
    card.className='card';
    card.setAttribute('data-card',stepId);
    card.setAttribute('role','group');
    card.setAttribute('tabindex','-1');
    var head=document.createElement('div');
    // The heading IS the question, so it is what names the control below it
    // for a screen reader — see lbControl.
    head.innerHTML='<h2 id="lbq-'+esc(f.key)+'">'+esc(f.label)+'</h2>'+
      (f.help?('<p class="cardsub">'+esc(f.help)+'</p>'):'')+
      (f.required?'':'<p class="cardsub">Optional.</p>');
    card.appendChild(head);
    host.appendChild(card);

    LB_GETTERS[f.key]=lbControl(card,f);
    LB_STEP_IDS.push(stepId);

    STEPS.splice(at+1+n,0,{
      id:stepId,
      /* Only while this logbook is the chosen one — choosing another rebuilds
         from scratch, so a stale step can never be reachable — and only when
         this question is being asked at all. */
      when:(function(field){
        return function(){
          return LOGBOOK && LOGBOOK.slug===logbook.slug && lbShown(field.key);
        };
      })(f),
      /* For the progress bar only: has the answer that decides this card been
         given yet? A question nobody has ruled out still counts towards how
         much is left, which is what stops the bar lurching backwards when an
         answer turns one on. An unconditional card is settled always. */
      settled:(function(field){
        return function(){
          if(!field.shown_when) return true;
          return lbWalk().answers[field.shown_when.field]!==undefined;
        };
      })(f),
      valid:(function(field){
        return function(){
          if(!field.required) return null;
          /* REQUIRED MEANS REQUIRED OF THE PEOPLE ASKED IT. A hidden
             question's answer is never sealed, so demanding one would make
             the card unpassable for exactly the people its condition was
             written to spare. The server takes the same view. */
          if(!lbShown(field.key)) return null;
          var v=LB_GETTERS[field.key]?LB_GETTERS[field.key]():undefined;
          var empty=v===undefined||v===null||v===''||(Array.isArray(v)&&!v.length);
          return empty?'An answer is needed here.':null;
        };
      })(f),
    });
    cardEls.splice(at+1+n,0,card);
  });
}

function lbClearCards(){
  LB_STEP_IDS.forEach(function(id){
    for(var i=STEPS.length-1;i>=0;i--){
      if(STEPS[i].id===id){ STEPS.splice(i,1); cardEls.splice(i,1); break; }
    }
    var el=document.querySelector('#rcards [data-card="'+id+'"]');
    if(el&&el.parentNode) el.parentNode.removeChild(el);
  });
  LB_STEP_IDS=[];
  LB_GETTERS={};
}

function choiceTiles(card,name,rows,apply){
  var pick=document.createElement('div');
  // Options that are all one-liners go full width — two short answers in
  // two columns are thin, hard to hit and read as an afterthought.
  var described=rows.some(function(r){ return r[0]!=='grp'&&r[2]; });
  pick.className='pick'+(described?'':' plain');
  pick.setAttribute('role','radiogroup');
  var heading=card.querySelector('h2');
  if(heading) pick.setAttribute('aria-label',heading.textContent);
  rows.forEach(function(r,i){
    if(r[0]==='grp'){
      var h=document.createElement('div');
      h.className='pgrp'; h.textContent=r[1];
      pick.appendChild(h);
      return;
    }
    var id='pick-'+name+'-'+i;
    var input=document.createElement('input');
    input.type='radio'; input.name='pick-'+name; input.value=r[0]; input.id=id;
    var label=document.createElement('label');
    label.className='picktile'; label.setAttribute('for',id);
    label.innerHTML='<b>'+esc(r[1])+'</b>'+(r[2]?('<small>'+esc(r[2])+'</small>'):'');
    input.addEventListener('change',function(){
      apply(input.value);
      cardErr('');
    });
    pick.appendChild(input);
    pick.appendChild(label);
  });
  card.appendChild(pick);
  return function picked(){ return pick.querySelector('input:checked')!==null; };
}

/**
 * "Check your answers" — the whole report, laid out before it is sent.
 *
 * Every row is tappable and takes you to the card that set it; fixing it
 * brings you straight back here rather than walking you forward through
 * everything again. That is the standard pattern for this kind of form and
 * it is the reason the summary is worth having: a summary you cannot act
 * on is just a wall of text at the end.
 *
 * It also holds the file list, which is the part that changes something
 * real. Until now a report could be sent while a photo was still being
 * checked, and the reporter was told afterwards which files had been left
 * out. Showing the state here, and refusing to send until it settles,
 * turns "sorry, your photo did not make it" into "wait ten seconds".
 */
// What the reporter actually tapped, in the words they read. The tiles own
// their own radio group and mirror the answer into the original hidden
// controls; reading those back would show the old markup's phrasing, which
// is not what was on screen.
// The value chosen in a tile group, or null if nothing is chosen yet.
function pickedValue(name){
  var el=document.querySelector('input[name="pick-'+name+'"]:checked');
  return el?el.value:null;
}

function pickedLabel(name){
  var el=document.querySelector('input[name="pick-'+name+'"]:checked');
  if(!el) return null;
  var label=el.nextElementSibling;
  var b=label&&label.querySelector('b');
  return b?b.textContent.trim():null;
}

/* The review card's rows: which logbook, each of its questions in its own
   order and in the words the reporter read, then files and publication.
   Only questions the reporter was actually put appear here. */
function summaryRows(){
  if(!LOGBOOK) return [{step:'logbook',label:'Reporting to',value:null}];
  var rows=[];
  if(LOGBOOKS.length>1) rows.push({step:'logbook',label:'Reporting to',value:LOGBOOK.title});
  LOGBOOK.fields.forEach(function(f){
    /* The upload question has no card and no answer of its own, so it has no
       row: the files row below is the one that reports it, and it says what
       the reporter actually chose rather than showing an empty question. */
    if(f.kind==='file') return;
    /* AND NEITHER DOES A QUESTION THAT WAS NOT ASKED. Listing it with a
       dash would tell somebody they had left something blank when they were
       never put the question — and listing it with a stale answer would
       show them words that are not going to be sealed. */
    if(!lbShown(f.key)) return;
    var raw=LB_GETTERS[f.key]?LB_GETTERS[f.key]():undefined;
    var shown;
    if(Array.isArray(raw)) shown=raw.join(', ');
    else if(isBoolKind(f.kind)&&raw) shown=(raw==='yes'?'Yes':'No');
    else if(f.kind==='datetime'&&raw){
      /* The getter hands back UTC, because that is what gets sealed. A
         reporter checking their own answers should see the moment they
         typed, in their own clock. */
      var d=new Date(raw);
      shown=isNaN(d.getTime())?raw:(d.toLocaleDateString(undefined,
        {year:'numeric',month:'short',day:'numeric'})+' at '+
        d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'}));
    }
    else if(f.kind==='location'&&raw){
      /* THE NAME, NOT THE CODE. `US-AZ` is what gets sealed and it is the
         right thing to seal, but this row exists for a reporter checking
         their own answer before it becomes permanent — and a code is not
         something they can check. The name comes from the list that
         arrived with the question, so this needs no lookup of its own;
         an unknown code falls back to itself rather than to nothing. */
      var pl=f.places||{subdivisions:[],countries:[]};
      var hit=[].concat(pl.subdivisions||[],pl.countries||[])
        .find(function(p){ return p.code===raw; });
      shown=hit?hit.name:raw;
    }
    else shown=raw;
    rows.push({step:'lbf-'+f.key,label:f.label,
      value:(shown===undefined||shown===null||shown==='')?null:String(shown),
      long:f.kind==='long_text',
      // An unanswered optional question reads as "—", not as a red
      // "Not answered": nothing is wrong.
      optional:!f.required});
  });
  /* THE ADDRESS GETS A ROW ONLY WHERE IT WAS ASKED ON ITS OWN CARD — a
     logbook that takes files. On one that does not, the field is sitting on
     this very card a few lines down, and a summary row offering to send
     somebody to the card they are already on is a Change link that goes
     nowhere. */
  if(lbTakesFiles()){
    var em=document.getElementById('rEmail');
    var ev=em?em.value.trim():'';
    rows.push({step:'contact',label:'Email',value:ev||null});
    rows.push({step:'evidence-ask',label:'Photos or video',value:pickedLabel('hasfiles')});
  }
  rows.push({step:'publish',label:'Published if approved',
    value:cardMayPublish===true?'Yes, it may be published'
      :'No, keep it out of the public archive'});
  return rows.map(function(r){
    if(r.value===null&&r.optional) r.value='—';
    return r;
  });
}

/* Files whose BYTES ARE NOT THERE YET, which is the only remaining reason
   the report cannot go.

   THE READY GATE IS GONE AND THIS IS WHAT IS LEFT OF IT. It used to include
   'uploaded' and 'processing' as well, so a reporter sat on the last card
   until a phone video had finished re-encoding. Nothing is re-encoded during
   filing any more — the worker does not touch a file until Send is pressed
   (migration 045, `releaseDraft`) — so there is nothing on the form to wait
   for.

   WAITING FOR THE UPLOAD ITSELF STAYS, and deleting it would have been the
   bug the spec warned about: Send releases these slots to the worker, and a
   slot whose object never finished arriving is one the worker marks
   unreadable. That is a file the reporter watched upload and does not get.
   This wait is bounded by their own connection, not by a transcode.

   'pending' is a slot the server made whose PUT it has not been told
   finished, so the bytes may be short. */
var FILE_BUSY=['uploading','pending'];
function filesBusy(){
  return ATT.enabled && ATT.files.some(function(f){ return FILE_BUSY.indexOf(f.status)>=0; });
}
function reviewIncomplete(){
  return summaryRows().some(function(r){ return !r.optional && !r.value; });
}

function buildReview(card){
  var box=document.createElement('div');
  box.className='review'; box.id='review-box';
  /* Under the card's heading and above everything else on it: the summary is
     what this card is for.

     NOT "before the email field", which is what this used to look for. The
     email field is only on this card when the logbook takes no files
     (lbPlaceContact), and on a logbook that does, looking for it found
     nothing and the summary was appended — landing under the consent box and
     the fold-out, at the bottom of the thing somebody is meant to read
     first. So the anchor is the heading, which is always there: buildCards
     prepends an h2 and an optional p.cardsub, and the summary goes directly
     after them. */
  var at=null;
  for(var i=0;i<card.children.length;i++){
    var c=card.children[i];
    var isHead=c.tagName==='H2'||(c.tagName==='P'&&c.classList.contains('cardsub'));
    if(!isHead){ at=c; break; }
  }
  if(at) card.insertBefore(box,at); else card.appendChild(box);
  return function(){ return true; };
}

var reviewTimer=null;
function renderReview(){
  var box=document.getElementById('review-box');
  if(!box) return;
  var html=summaryRows().map(function(r){
    var val=r.value
      ? '<span class="rv'+(r.long?' rlong':'')+'">'+esc(r.value)+'</span>'
      : '<span class="rv rmissing">Not answered</span>';
    return '<button type="button" class="rrow" data-step="'+esc(r.step)+'">'+
      '<span class="rk">'+esc(r.label)+'</span>'+val+'<span class="redit">Change</span></button>';
  }).join('');

  if(ATT.enabled && ATT.files.length){
    html+='<div class="rfiles"><span class="rk">Files</span>'+
      ATT.files.map(function(f){
        var busy=FILE_BUSY.indexOf(f.status)>=0;
        var ok=f.status==='clean';
        var cls=ok?'fok':(busy?'fbusy':'fbad');
        /* 'Added' rather than 'Ready' for a file that has arrived and not
           been checked, which during filing is now every file: checking
           happens after Send. Claiming 'Ready' would promise a verdict
           nothing has reached yet. */
        var word=ok?'Ready':(busy?(ATT_LABEL[f.status]||f.status)+'…':(ATT_LABEL[f.status]||f.status));
        return '<span class="rfile '+cls+'">'+esc(f.name)+' <b>'+esc(word)+'</b></span>';
      }).join('')+
      '<button type="button" class="rrow rfileedit" data-step="evidence-ask">'+
        '<span class="redit">Change files</span></button></div>';
  }

  var warn='';
  if(filesBusy()) warn='<div class="rwarn">Still uploading. The report can go as soon as your files have finished arriving.</div>';
  else if(reviewIncomplete()) warn='<div class="rwarn">Something above has not been answered. Tap it to fix.</div>';
  box.innerHTML=warn+html;

  box.querySelectorAll('[data-step]').forEach(function(b){
    b.addEventListener('click',function(){
      var id=b.getAttribute('data-step');
      for(var i=0;i<STEPS.length;i++){
        if(STEPS[i].id===id){ reviewReturn=true; showCard(i); return; }
      }
    });
  });

  // Uploads finish on their own, so keep the panel live rather than making
  // someone leave and come back to find out. Only while something is still
  // arriving: nothing else changes during filing now, so a timer past that
  // would poll a list that cannot move.
  clearTimeout(reviewTimer);
  if(filesBusy()){
    reviewTimer=setTimeout(function(){ attRefresh().then(renderReview); },1500);
  }
}

function fieldFor(sel){
  // A leading ! means "this exact node", not the field wrapper around it.
  // The multi-state grid is nested INSIDE the single-state field's wrapper,
  // so climbing to .closest('.form_field-wrapper') would hand the same element to two cards
  // and the second would silently steal it from the first.
  var exact=sel.charAt(0)==='!';
  if(exact) sel=sel.slice(1);
  var el=document.querySelector('#pane-submit '+sel);
  if(!el) return null;
  if(exact) return el;
  return el.closest('.form_field-wrapper')||el.closest('label.choice_item')||el;
}

var cardIdx=0, cardEls=[], cardPicked={};

function cardErr(msg){
  var e=document.getElementById('carderr');
  if(!msg){ e.classList.remove('on'); return; }
  e.textContent=msg; e.classList.add('on');
}

// Whether the answer that decides a conditional card has been given yet.
//
// Used only by the progress bar, to tell "this question is off" from "we
// do not know yet". A question nobody has ruled out still counts towards
// how much is left, which is what stops the bar from lurching backwards
// when an answer turns one on.
function stepSettled(i){
  var settled=STEPS[i].settled;
  return settled ? settled() : true;
}

// Whether a conditional card is being asked at all, by id — the review
// only lists questions the reporter was actually put.
function stepShown(id){
  for(var i=0;i<STEPS.length;i++) if(STEPS[i].id===id) return stepApplies(i);
  return false;
}
function stepApplies(i){
  var w=STEPS[i].when;
  return !w||w();
}
function nextIndex(from){
  for(var i=from+1;i<STEPS.length;i++) if(stepApplies(i)) return i;
  return -1;
}
function prevIndex(from){
  for(var i=from-1;i>=0;i--) if(stepApplies(i)) return i;
  return -1;
}

/** Choosing a logbook, which builds its question cards. */
function lbChoose(slug){
  if(!slug) return;
  var already=LOGBOOK&&LOGBOOK.slug===slug;
  if(already) return;
  return fetch('/api/logbooks/'+encodeURIComponent(slug))
    .then(function(r){ return r.json(); })
    .then(function(l){
      if(!l||l.error||!Array.isArray(l.fields)) return;
      LOGBOOK=l;
      /* The upload caps belong to the logbook since migration 037, so the
         attachment layer is told which one before anything can be attached.
         It re-reads its own limits; this file keeps no copy of a cap. */
      attSetLogbook(l.slug);
      lbBuildCards(l);
      // After the cards exist and before anything is shown: whether this
      // logbook takes files is what decides where the address is asked.
      lbPlaceContact();
      checkValid();
    })
    .catch(function(){});
}

/**
 * Put the email field on the card this logbook asks it from.
 *
 * ONE INPUT, MOVED. A logbook that takes files asks for the address before
 * the upload cards, because the staging quota is keyed on it (migration
 * 045) and a byte must not be staged before it is known. A logbook that
 * takes none asks for it where it always did, on the send card, because
 * moving it earlier there would cost a reporter and buy nothing.
 *
 * A SECOND COPY WOULD BE A SECOND ANSWER. Everything that reads the address
 * — checkValid, the send card, the submit payload, the upload slot — reads
 * `#rEmail`, so there is exactly one of it and it travels.
 *
 * The move happens on logbook choice, which is before either card can be
 * on screen, so nothing changes under anybody: rule 10 is about the card in
 * front of you, and neither of these is yet.
 */
function lbPlaceContact(){
  var el=document.getElementById('rEmail');
  var field=el&&el.closest('.form_field-wrapper');
  if(!field) return;
  var want=document.querySelector('#rcards [data-card="'+(lbTakesFiles()?'contact':'send')+'"]');
  if(!want||field.parentNode===want) return;
  /* Appended on the contact card, which holds nothing else; on the send
     card it goes above the consent box, where it was. The review summary
     finds its own place either way — see buildReview. */
  if(want.getAttribute('data-card')==='send'){
    var consent=want.querySelector('#consent');
    var at=consent?(consent.closest('.choice_item')||consent):null;
    if(at) want.insertBefore(field,at); else want.appendChild(field);
  } else {
    want.appendChild(field);
  }
}

/** The logbooks open for reports right now. */
function lbLoadOpen(){
  /* A FORM FOR ONE LOGBOOK, at /file/<slug>. It asks for that one and
     never for the list: the list of logbooks is behind the password, and
     somebody filing without it is only ever shown the one they were sent. */
  if(FIXED_SLUG){
    return fetch('/api/logbooks/'+encodeURIComponent(FIXED_SLUG))
      .then(function(r){
        if(r.status===401){ relock(); return null; }
        return r.ok?r.json():null;
      })
      .then(function(l){
        LOGBOOKS=(l&&!l.error&&l.accepting)?[{slug:l.slug,title:l.title,blurb:l.blurb,questions:(l.fields||[]).length}]:[];
      })
      .catch(function(){ LOGBOOKS=[]; });
  }
  return fetch('/api/logbooks').then(function(r){ return r.json(); })
    .then(function(list){ LOGBOOKS=Array.isArray(list)?list:[]; })
    .catch(function(){ LOGBOOKS=[]; });
}

/* Set by openFileForm. Null means the ordinary form, which offers every
   open logbook. */
var FIXED_SLUG=null;

/**
 * The filing form for one logbook, at /file/<slug> — what a link handed out
 * for one logbook opens, with or without the site password (migration 047).
 * Whether that logbook is actually open to somebody without the password is
 * the server's decision; if it is not, its answer is "locked" and the
 * password comes back.
 */
function openFileForm(slug){
  FIXED_SLUG=slug;
  /* The pane FIRST. If building the form ever throws, the visitor sees a
     broken form on the right page rather than being left, silently, on
     whatever page was showing — which is what a failure inside the gate's
     promise chain otherwise looks like, because nothing reports it. */
  showPane('submit',{noPush:true});
  if(!cardEls.length){
    cardify();                    // builds, then loads just this logbook
  } else {
    lbLoadOpen().then(function(){ if(LOGBOOKS.length) lbChoose(LOGBOOKS[0].slug); });
  }
}

function buildCards(){
  // The cards are already in the document — see the form markup. All this
  // does is give each one the heading and running order STEPS declares,
  // and run the builder for the ones whose content is generated.
  STEPS.forEach(function(step){
    var card=document.querySelector('#rcards [data-card="'+step.id+'"]');
    if(!card){
      // A step named in STEPS with no card to match it is a typo, and one
      // that would otherwise show up as a question silently missing from
      // the form. Say so rather than skipping it quietly.
      console.error('No card markup for step: '+step.id);
      return;
    }
    if(step.title||step.sub){
      var head=document.createElement('div');
      head.innerHTML=(step.title?('<h2>'+esc(step.title)+'</h2>'):'')+
        (step.sub?('<p class="cardsub">'+esc(step.sub)+'</p>'):'');
      // Before the fields, which are already sitting in the card.
      while(head.lastChild) card.insertBefore(head.lastChild,card.firstChild);
    }
    if(step.build) cardPicked[step.id]=step.build(card);
    cardEls.push(card);
  });
}

// Every card is a history entry, so the browser's Back button goes back one
// question — not out of the form, losing everything typed so far. That was
// the single most destructive thing about the old version: a reflexive Back
// on the last card threw the whole report away.
function showCard(i,opts){
  opts=opts||{};
  if(i<0||i>=STEPS.length) return;
  cardIdx=i;
  cardEls.forEach(function(c,n){ c.classList.toggle('on',n===cardIdx); });
  cardErr('');

  var hasPrev=prevIndex(cardIdx)>=0;
  document.getElementById('card-back').style.visibility=hasPrev?'visible':'hidden';

  // A bar, and no numbers.
  //
  // "Step 5 of 9" was a lie that corrected itself in public: three of the
  // questions only apply to some people and all three start switched off,
  // so the total could only ever GROW as you answered — 9 to 10 to 11 —
  // and the bar visibly retreated when a Change link reopened a branch. A
  // form that gets longer while you fill it in reads as a trap.
  //
  // The fix is not a cleverer number. A bar is allowed to be approximate
  // and a number is not: nobody measures a bar with a ruler, so it can say
  // "moving, roughly here" and never be wrong, where a number claims a
  // precision it does not have and reads as a fault when it changes. How
  // long the form is belongs on the start card, where it is a fixed
  // sentence somebody reads once while deciding whether to begin.
  var live=[],pos=0;
  for(var n=0;n<STEPS.length;n++){
    if(STEPS[n].id==='intro'||!stepApplies(n)) continue;
    live.push(n);
    if(n===cardIdx) pos=live.length;
  }
  // Measured against every question that could STILL be asked, rather than
  // the ones that apply right now. That total only ever falls — ruling a
  // branch out cannot bring it back — so on the way forward the bar only
  // ever advances, and it reaches the end exactly when you do.
  var ceiling=0;
  for(var c=0;c<STEPS.length;c++){
    if(STEPS[c].id==='intro') continue;
    if(stepApplies(c)||!stepSettled(c)) ceiling++;
  }
  // A logbook's questions are not in STEPS until it is chosen, so until then
  // room is kept for the longest one on offer. Choosing can then only ever
  // take questions away from the total, never add them — which is what keeps
  // the bar from jumping backwards at the moment somebody picks one.
  if(!LOGBOOK && LOGBOOKS.length){
    ceiling+=LOGBOOKS.reduce(function(m,l){ return Math.max(m,l.questions||0); },0);
  }
  // Nothing on the opening card: there is no progress through a page you
  // have not started, and a bar sitting at zero reads as a form you have
  // already failed rather than one you have not begun.
  var onIntro=STEPS[cardIdx].id==='intro';
  navProgress(onIntro?null:Math.round((pos/Math.max(ceiling,1))*100));

  var step=STEPS[cardIdx];
  // Which questions were being asked when this card opened. Compared on the
  // way out to tell whether the answer just opened a new one.
  cardShownApplicable=applicableIds();
  // Shown on every card, including the tap-to-advance ones. A tap still
  // moves you on without touching it, but it is the only route forward for
  // anyone using a keyboard, so it cannot be hidden.
  // The linear form's picker hides whichever state is already chosen in the
  // dropdown, to stop it being picked twice. Under cards the two are
  // alternatives, not a pair — so someone who chose Ohio, went back and
  // switched to "several states" must still find Ohio in the list.
  if(step.id==='states-many'){
    document.querySelectorAll('#state-more-grid label').forEach(function(l){ l.style.display=''; });
  }
  var next=document.getElementById('card-next');
  next.style.display='';
  next.textContent=step.next||'Next';
  next.parentNode.classList.toggle('first',step.id==='intro');

  if(step.id==='send') renderReview();

  // Each question names itself, so a screen reader announcing the page says
  // which one you are on, and a browser history entry is distinguishable
  // from the twelve either side of it.
  setTitle(step.title
    ? (step.title+' ('+(applicableIds().indexOf(step.id)+1)+' of '+applicableIds().length+')')
    : PANE_TITLES.submit);

  // The page does not reload between questions, so nothing would otherwise
  // tell a screen reader that the content changed. Focus moves to the card
  // itself, which reads its heading; preventScroll because showCard already
  // puts the page back to the top.
  try { cardEls[cardIdx].focus({ preventScroll: true }); }
  catch (e) { cardEls[cardIdx].focus(); }

  if(opts.push!==false){
    // Same care as cardify's replaceState: the entry a card pushes is the
    // address it is already on, query and all. See the note there.
    history.pushState({submitCard:cardIdx},'',location.pathname+location.search);
  }
  window.scrollTo(0,0);
}

// The next applicable question after `from` that has not been answered.
// Skips the review itself, whose own checks are about the whole report.
function firstIncompleteAfter(from){
  for(var i=from+1;i<STEPS.length;i++){
    if(STEPS[i].id==='send'||!stepApplies(i)) continue;
    var v=STEPS[i].valid;
    if(v&&v(cardPicked[STEPS[i].id]?cardPicked[STEPS[i].id]():undefined)) return i;
  }
  return -1;
}

// Which conditional cards apply right now. Compared before and after an
// answer to tell whether choosing opened a question that was not being
// asked a moment ago.
function applicableIds(){
  var out=[];
  for(var i=0;i<STEPS.length;i++) if(stepApplies(i)) out.push(STEPS[i].id);
  return out;
}
var cardShownApplicable=[];
function openedNewCard(before){
  var now=applicableIds();
  for(var i=0;i<now.length;i++) if(before.indexOf(now[i])<0) return true;
  return false;
}

function cardProblem(){
  var step=STEPS[cardIdx];
  if(!step.valid) return null;
  return step.valid(cardPicked[step.id]?cardPicked[step.id]():undefined);
}

function cardAdvance(){
  var problem=cardProblem();
  if(problem){ cardErr(problem); return; }
  // Answering can bring a card into play that was not being asked when this
  // one opened — saying yes to files opens the file card. Jumping back to
  // the review then skips the very card the reporter was trying to reach,
  // which is what "Change files" did: it landed on "do you have a photo?",
  // and yes sent you straight back with nothing added. If the answer opened
  // something up, walk forward into it instead of jumping.
  if(reviewReturn&&openedNewCard(cardShownApplicable)) reviewReturn=false;
  if(reviewReturn&&STEPS[cardIdx].id!=='send'){
    // Changing an answer can make a question apply that did not before —
    // choosing another logbook brings its own questions into play. Returning
    // straight to the review would skip them and leave a red "Not answered"
    // for the reporter to notice on their own, so stop at the first thing
    // that now needs one.
    var gap=firstIncompleteAfter(cardIdx);
    if(gap>=0){ showCard(gap); return; }
    reviewReturn=false;
    for(var n=0;n<STEPS.length;n++) if(STEPS[n].id==='send'){ showCard(n); return; }
  }
  var i=nextIndex(cardIdx);
  if(i<0){
    checkValid();
    form.dispatchEvent(new Event('submit',{cancelable:true}));
    return;
  }
  showCard(i);
}

function cardBack(){
  var i=prevIndex(cardIdx);
  if(i>=0) history.back();
}

// Builds once. The cards themselves are in the markup; this gives them
// their headings, generated content, and the wiring that moves between
// them.
function cardify(){
  if(cardEls.length) return;
  buildCards();
  document.getElementById('card-next').addEventListener('click',cardAdvance);
  document.getElementById('card-back').addEventListener('click',cardBack);
  showCard(0,{push:false});
  /* THE ADDRESS, WHOLE, AND NOT JUST ITS PATH.
     This runs at boot for every visitor, on every address — cardify() is
     called from gate.js before anything is routed. Written as
     `location.pathname` it REPLACED the address with its own path, which
     silently discarded the query string of whatever link somebody had
     followed. Nothing noticed for as long as nothing read a query; the
     first feature that did (a link that prefilters the board or opens a
     heat map on an area) found `location.search` already empty, and the
     symptom was a prefilter that did nothing rather than an error.
     The intent of this line is "same address, new history state", so the
     address has to survive it. */
  history.replaceState({submitCard:0},'',location.pathname+location.search);
  cardGuardUnload();
  /* AFTER the cards exist, and it does not block them: the opening card is
     what the reporter reads meanwhile. With one open logbook it is simply
     used, and the chooser never appears; with several, the chooser offers
     them. With none, the form is not shown at all — see the intake check. */
  lbLoadOpen().then(function(){
    if(LOGBOOKS.length===1){ lbChoose(LOGBOOKS[0].slug); return; }
    if(!LOGBOOKS.length) return;
    var card=document.querySelector('#rcards [data-card="logbook"]');
    if(!card||cardPicked.logbook) return;
    var rows=LOGBOOKS.map(function(l){ return [l.slug,l.title,l.blurb||'']; });
    cardPicked.logbook=choiceTiles(card,'logbook',rows,function(v){
      lbChoose(v);
      checkValid();
    });
  });
}

/**
 * Put the submit pane back to a blank form.
 *
 * Called both by "File another report" and on every arrival at the pane,
 * so somebody who sends a report, wanders to the board and comes back
 * gets a form rather than yesterday's confirmation. The form itself was
 * already reset at submit time; this is only about what is on screen.
 */
function resetSubmitPane(){
  var pane=document.getElementById('pane-submit');
  if(!pane || !pane.classList.contains('sent')) return;
  pane.classList.remove('sent');
  document.getElementById('receipt').classList.remove('on');
  if(typeof showCard==='function' && typeof STEPS!=='undefined'){
    showCard(0,{noPush:true});
  }
}
document.getElementById('receipt-again').addEventListener('click',function(){
  resetSubmitPane();
  window.scrollTo({top:0,behavior:'auto'});
});

// Leaving the page mid-report loses it. The browser's own dialog is the
// only thing that can interrupt that, and it is only allowed to appear if
// something was actually typed.
function cardGuardUnload(){
  window.addEventListener('beforeunload',function(e){
    if(!document.getElementById('rcards')) return;
    if(document.getElementById('receipt').classList.contains('on')) return;
    var typed=document.getElementById('rEmail').value.trim()
      ||Object.keys(lbAnswersNow()).length;
    if(!typed) return;
    e.preventDefault();
    e.returnValue='';
  });
}

form.addEventListener('submit',function(e){
  e.preventDefault();
  var errBox=document.getElementById('submit-err');
  errBox.classList.remove('on');
  if(!LOGBOOK){
    errBox.textContent='Choose what you are reporting first.';
    errBox.classList.add('on');
    return;
  }
  var body={
    logbook:LOGBOOK.slug,
    email:document.getElementById('rEmail').value.trim(),
    consent:document.getElementById('consent').checked,
    // Walking past the publication card is a real answer: they were asked,
    // and the card told them what not answering means.
    may_publish:cardMayPublish===true,
    may_publish_digest:consentCard?consentCard.digest:undefined
  };
  var answered=lbAnswersNow();
  // Absent, not {} — the same rule the seal follows.
  if(Object.keys(answered).length) body.answers=answered;
  // Only when files were actually attached, to a logbook that takes them.
  if(lbTakesFiles() && ATT.files.length) body.draft_token=ATT.draft;
  btn.disabled=true;
  fetch('/api/reports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
    .then(function(r){ return r.json().then(function(d){ return {ok:r.ok, d:d}; }); })
    .then(function(res){
      if(!res.ok){
        errBox.textContent=(res.d.errors||[res.d.error]).join('; ');
        errBox.classList.add('on');
        btn.disabled=false;
        return;
      }
      // Say where it went. "Check your email" is useless advice if the
      // address had a typo in it, and that is exactly when somebody needs
      // to see what they actually typed.
      var sentTo=(document.getElementById('rEmail')||{}).value||'';
      document.getElementById('receipt-email').textContent=sentTo;

      // The form does not survive its own submission. Resetting it in
      // place left an empty, still-walkable fourteen-card form on screen
      // with a notice underneath, which reads as a failure.
      document.getElementById('pane-submit').classList.add('sent');
      document.getElementById('receipt').classList.add('on');

      // The draft is spent: its files now belong to the staged submission.
      ATT.draft=null; ATT.files=[];
      if(ATT.timer){ clearInterval(ATT.timer); ATT.timer=null; }
      if(ATT.enabled) attRender();
      form.reset();
      checkValid();
      setTitle('Report sent — check your email');
      window.scrollTo({top:0,behavior:'auto'});
      document.getElementById('receipt').focus({preventScroll:true});
    })
    .catch(function(){ errBox.textContent='Network error — please try again.'; errBox.classList.add('on'); btn.disabled=false; });
});

export {
  LB_GETTERS, LOGBOOK, LOGBOOKS, buildReview, cardify, choiceTiles, filesBusy,
  openFileForm, resetSubmitPane, reviewIncomplete, showCard,
};
