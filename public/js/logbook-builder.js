/* logbook-builder.js — Building a logbook, and the one-way door of
 * launching it.
 *
 * Lifted out of the one <script> public/index.html used to carry, in the
 * order it was in. docs/frontend-files.md has the whole map.
 */

import { esc } from './answers.js';
import {
  renderLook, renderPolicies, renderSiteAccess, renderSiteCopy,
} from './admin-look.js';
import {
  renderAccessLog, renderAttachments, renderDevMode, renderIdentity, renderIntakeSwitch,
  renderLegal, renderPublication, renderReviewKeywords,
  renderUploadLimits,
  LIM_BAD_NUMBER, limClearBody, limFill, limRead,
} from './admin-settings.js';
import { renderOwnership, renderRolesAdmin } from './roles.js';
import { renderUpdates } from './admin-updates.js';
import { renderLists } from './admin-lists.js';
import { renderMaps } from './admin-maps.js';
import { renderOps } from './admin-translog.js';

/* ---- the logbook builder ------------------------------------------
   A logbook is one named intake with its own questions. Nothing here knows
   what a date or a place is FOR — it knows that `date` is a type and that a
   field may be marked filterable, and the operator decides the rest. */
var LB_TYPES = [];
var lbEditing = null;

function lbErr(id, msg){
  var e=document.getElementById(id);
  if(!e) return;
  e.textContent=msg||''; e.classList.toggle('on', !!msg);
}

function lbStateWords(l){
  if(l.state==='draft') return 'Draft — still being written, and not visible to anybody.';
  if(l.state==='scheduled') return 'Launched, opening ' + (l.opens_at?new Date(l.opens_at).toLocaleString():'soon') + '.';
  if(l.state==='open') return 'Open, and taking reports' + (l.closes_at?(' until '+new Date(l.closes_at).toLocaleString()):'') + '.';
  return 'Closed. Reports already filed stay published and stay checkable.';
}

function renderLogbooks(){
  var box=document.getElementById('lb-list');
  if(!box) return;
  fetch('/api/admin/logbooks').then(function(r){ return r.json(); }).then(function(list){
    if(list.error) return;
    if(!list.length){ box.innerHTML='<div class="empty_component">No logbooks yet.</div>'; return; }
    /* THE WHOLE TILE OPENS IT, and it is a button rather than a card with a
       link in the corner.

       It used to be a row with one small text button reading "Questions", which
       was wrong twice over: it was the smallest thing on the row when it is the
       only thing anybody comes to the row to do, and it named a part of what
       lies behind it. Opening a logbook is where you edit its questions AND its
       schedule, freeze its uploads, launch it, close it and download its chain.

       One <button> wrapping the lot, so the hit target is the tile and the
       keyboard gets one stop per logbook instead of a row of them. */
    box.innerHTML=list.map(function(l){
      var files = l.accepts_files
        ? (l.files_frozen_at ? 'takes files &mdash; frozen' : 'takes files')
        : 'no files';
      /* Counted by the list query rather than by fetching every logbook's
         fields: the list is the one screen that wants all of them at once. */
      var n = (typeof l.question_count === 'number') ? l.question_count : null;
      return '<button type="button" class="lb-tile" data-lb-open="'+esc(String(l.id))+'">'+
        '<span class="lb-tile-head"><b>'+esc(l.title)+'</b>'+
          '<span class="lp-chip lb-tile-state">'+esc(l.state)+'</span></span>'+
        '<span class="lb-tile-sub">'+esc(lbStateWords(l))+'</span>'+
        '<span class="lb-tile-meta">/'+esc(l.slug)+
          (n===null?'':' &middot; '+n+' question'+(n===1?'':'s'))+
          ' &middot; '+files+'</span>'+
        '<span class="lb-tile-go">Open this logbook &rarr;</span>'+
        '</button>';
    }).join('');
  }).catch(function(){});
}

function lbKindHelp(){
  var sel=document.getElementById('lb-field-kind');
  var t=LB_TYPES.filter(function(x){ return x.id===sel.value; })[0];
  document.getElementById('lb-kind-help').textContent = t ? t.description : '';
  /* Only the list types need a list. Showing the box for a date field is
     how a form asks a question nobody can answer. */
  var wantsOptions = sel.value==='choice_one' || sel.value==='choice_many' || sel.value==='place';
  document.getElementById('lb-field-options-wrap').hidden = !wantsOptions;
  var f=document.getElementById('lb-field-filterable');
  f.disabled = !(t && t.filterable);
  if(f.disabled) f.checked=false;
  /* AN UPLOAD QUESTION CANNOT BE CONDITIONAL YET, and the control goes away
     rather than refusing after the press. Its card is not one of the cards
     built from the questions — a logbook takes files if it asks for them at
     all, and the two evidence cards are drawn from that — so a condition
     would be sealed into the record and applied to nobody. src/conditions.js
     says what would have to change. */
  lbRenderWhen();
}

/* THE QUESTIONS A CONDITION CAN BE ASKED ABOUT, for the picker.

   Only the ones already added, and only kinds whose answers come from a
   fixed list — a condition over free prose would mean the question
   appearing and disappearing as somebody typed, and `place` lets a reporter
   type anything, so a set they can add to is not a fixed question.
   src/conditions.js refuses both; this keeps them out of the menu so an
   operator never has to meet the refusal.

   Kept here so the picker and the server agree on what is offerable. The
   server is still the one that decides. */
var LB_WHEN_KINDS = {yes_no:1, choice_one:1, choice_many:1, evidence_declaration:1};
var LB_FIELDS = [];

function lbWhenTargets(){
  return LB_FIELDS.filter(function(f){ return LB_WHEN_KINDS[f.kind]; });
}

/* Repopulate the "ask it only when" picker from the questions this logbook
   already has. Hidden entirely when there is nothing to depend on yet,
   because an empty dropdown reads as something broken. */
function lbRenderWhen(){
  var wrap=document.getElementById('lb-field-when-wrap');
  var sel=document.getElementById('lb-field-when');
  if(!wrap||!sel) return;
  var targets=lbWhenTargets();
  var kind=(document.getElementById('lb-field-kind')||{}).value;
  wrap.hidden = !targets.length || kind==='file';
  var keep=sel.value;
  sel.innerHTML='<option value="">Always \u2014 ask everybody</option>'+
    targets.map(function(f){
      return '<option value="'+esc(f.key)+'">'+esc(f.label)+'</option>';
    }).join('');
  if(keep) sel.value=keep;
  lbRenderWhenValues();
}

/* The answers that bring the new question up. A yes/no question offers yes
   and no; a list offers its own choices. Checkboxes rather than a second
   dropdown, because "any of these" is the thing being expressed. */
function lbRenderWhenValues(){
  var sel=document.getElementById('lb-field-when');
  var box=document.getElementById('lb-field-when-values');
  var host=document.getElementById('lb-field-when-options');
  if(!sel||!box||!host) return;
  var target=LB_FIELDS.filter(function(f){ return f.key===sel.value; })[0];
  box.hidden=!target;
  if(!target){ host.innerHTML=''; return; }
  /* The declaration seals the same boolean a yes/no does, so it offers the
     same two answers. Without it here the picker would show the question
     and then offer nothing to tick, which reads as broken. */
  var values = (target.kind==='yes_no'||target.kind==='evidence_declaration')
    ? ['yes','no']
    : ((target.settings&&target.settings.options)||[]);
  host.innerHTML=values.map(function(v){
    return '<label class="choice_item"><input class="choice_input" type="checkbox"'+
      ' data-lb-when-value="'+esc(v)+'"><span class="choice_text">'+
      '<span class="choice_title">'+esc(v==='yes'?'Yes':(v==='no'?'No':v))+'</span>'+
      '</span></label>';
  }).join('');
}

/* What to send, or undefined for "always". Undefined and not null, because
   the server reads an absent key as "no condition" and this control is the
   only thing that ever sets one. */
function lbWhenBody(){
  var sel=document.getElementById('lb-field-when');
  if(!sel||!sel.value) return undefined;
  var picked=[].slice.call(
    document.querySelectorAll('#lb-field-when-options [data-lb-when-value]:checked'))
    .map(function(i){ return i.getAttribute('data-lb-when-value'); });
  if(!picked.length) return undefined;
  return {field:sel.value, in:picked};
}

/* THIS LOGBOOK'S OWN UPLOAD LIMITS, narrower than the site's and never
   wider. The boxes, the megabyte conversion and "an empty box means
   inherit" are the same code the site panel uses — see limFill in
   admin-settings.js. What differs is which layer the boxes own.

   AT MODULE SCOPE because renderLogbookFields calls it, and it is the
   editor's own render that knows whether this logbook asks for files at
   all. Inside wireLogbookBuilder it was a ReferenceError the moment
   somebody opened a logbook with an upload question. */
function limRoot(){ return document.getElementById('lb-limits-wrap'); }

function renderLogbookLimits(id){
  var st=document.getElementById('lblim-state');
  fetch('/api/admin/logbooks/'+encodeURIComponent(id)+'/limits')
    .then(function(r){ return r.json(); }).then(function(d){
      if(d.error){ st.textContent=d.error; return; }
      var set=limFill(limRoot(), d.limits, 'logbook');
      st.textContent = set===0
        ? 'This logbook sets none of its own, so the site’s numbers apply.'
        : set+' of 8 set on this logbook; the rest come from the site.';
      if(d.filesFrozen){
        st.textContent += ' Uploads are frozen here, so none of this is'
          + ' being applied to anything right now.';
      }
    }).catch(function(){ st.textContent='Could not read this logbook’s limits.'; });
}

function renderLogbookFields(){
  if(!lbEditing) return;
  fetch('/api/admin/logbooks/'+encodeURIComponent(lbEditing)).then(function(r){ return r.json(); })
    .then(function(l){
      if(l.error) return;
      document.getElementById('lb-edit-title').textContent=l.title;
      document.getElementById('lb-edit-state').textContent=lbStateWords(l);
      /* WHETHER THIS LOGBOOK TAKES FILES IS NOT A CONTROL HERE. It is
         whether the questions below include an upload one, so it is reported
         rather than set — and the freeze, which IS a control, is only offered
         where there is something to freeze. */
      var asks=!!l.accepts_files, frozenFiles=!!l.files_frozen_at;
      document.getElementById('lb-files-state').innerHTML = asks
        ? (frozenFiles
          ? '<b>Uploads are frozen.</b> This logbook asks for files and is'
            +' refusing new ones. Nothing already filed or published is hidden.'
          : 'This logbook <b>takes files</b>, because it asks for them below.'
            +' Only while the site has somewhere to put them &mdash; see Reports.')
        : 'This logbook takes <b>no files</b>. Add a &ldquo;Photos, video or'
          +' documents&rdquo; question below to ask for them.';
      document.getElementById('lb-freeze-wrap').hidden=!asks;
      document.getElementById('lb-freeze').hidden=frozenFiles;
      document.getElementById('lb-unfreeze').hidden=!frozenFiles;
      /* Limits only where there is something to limit. Nine boxes on a
         logbook that asks for no files govern nothing, and saying so beats
         letting somebody tune them for an afternoon. */
      document.getElementById('lb-limits-wrap').hidden=!asks;
      if(asks) renderLogbookLimits(l.id);
      var base='/api/admin/logbooks/'+encodeURIComponent(l.id);
      document.getElementById('lb-dl-file').href=base+'/file';
      // A chain exists from launch. A draft has nothing to download.
      var chain=document.getElementById('lb-dl-chain');
      chain.href=base+'/chain';
      chain.hidden=!l.launched_at;
      /* A launched logbook's questions are fixed. Say WHY, on the screen,
         rather than leaving somebody to discover it from a refusal. */
      var frozen=!!l.launched_at;
      var fz=document.getElementById('lb-frozen');
      fz.hidden=!frozen;
      fz.innerHTML=frozen?'<b>These questions are fixed.</b> They were settled '+
        'when this logbook launched. None of them can be reworded, removed, '+
        'reordered or made compulsory now &mdash; that is what makes an answer '+
        'worth anything, because a question that could be reworded afterwards '+
        'would leave every answer to it meaning something nobody can check.'+
        '<br><b>You can still add a new optional question.</b> A report filed '+
        'before it existed simply carries no answer to it, and goes on '+
        'verifying exactly as it did.':'';

      /* NOT hidden when frozen any more. The add-a-question form is the one
         thing a launched logbook may still use, and hiding it would make the
         paragraph above a lie. */
      document.getElementById('lb-edit-body').hidden=false;

      /* Compulsory is the part that cannot survive launch: the reports
         already filed never answered it and never will, so the form would
         be claiming an answer the archive does not hold. */
      var req=document.getElementById('lb-field-required');
      req.disabled=frozen;
      if(frozen) req.checked=false;
      var reqNote=document.getElementById('lb-required-note');
      if(reqNote) reqNote.hidden=!frozen;

      /* A draft with no questions cannot launch, and saying so where the
         button would be beats a refusal after the press. */
      var lw=document.getElementById('lb-launch-wrap');
      lw.hidden=frozen;
      var btn=document.getElementById('lb-launch');
      btn.disabled=!l.fields.length;
      btn.textContent=l.fields.length
        ? 'Launch this logbook'
        : 'Add a question before launching';

      /* The picker's menu is the questions this logbook already has, so it
         is refreshed from the same response that draws them. */
      LB_FIELDS=l.fields||[];
      lbRenderWhen();

      var box=document.getElementById('lb-fields');
      if(!l.fields.length){ box.innerHTML='<div class="empty_component">No questions yet.</div>'; }
      else box.innerHTML=l.fields.map(function(f,i){
        var bits=[];
        if(f.required) bits.push('needed');
        if(f.filterable) bits.push('filter');
        if(f.shown_when) bits.push('sometimes');
        /* SAID IN WORDS, not as a chip only. An operator checking a form
           has to be able to read back what they wrote, and "sometimes" on
           its own does not say when. */
        var whenLine='';
        if(f.shown_when){
          var on=l.fields.filter(function(x){ return x.key===f.shown_when.field; })[0];
          var vals=(f.shown_when.in||[]).map(function(v){
            return v==='yes'?'yes':(v==='no'?'no':'\u201c'+v+'\u201d');
          }).join(' or ');
          whenLine='<div class="text-size-small text-color-muted margin-bottom margin-xsmall">'+
            'Asked only when \u201c'+esc(on?on.label:f.shown_when.field)+'\u201d is '+
            esc(vals)+'.</div>';
        }
        return '<div class="rc-card"><div class="who"><b>'+esc(f.label)+'</b>'+
          '<span class="lp-chip">'+esc(f.kind)+'</span>'+
          (bits.length?'<span class="lp-chip">'+esc(bits.join(' · '))+'</span>':'')+'</div>'+
          '<div class="text-size-small text-color-muted margin-bottom margin-xsmall">answered under <code>'+esc(f.key)+'</code></div>'+
          whenLine+
          (frozen?'':'<div class="actions">'+
            (i>0?'<button data-lb-up="'+esc(String(f.id))+'">Up</button>':'')+
            '<button data-lb-del="'+esc(String(f.id))+'">Remove</button></div>')+
          '</div>';
      }).join('');

      var toLocal=function(v){ return v? new Date(v).toISOString().slice(0,16) : ''; };
      document.getElementById('lb-opens').value=toLocal(l.opens_at);
      document.getElementById('lb-closes').value=toLocal(l.closes_at);
      document.getElementById('lb-close-toggle').textContent =
        l.closed_at ? 'Reopen it' : 'Close it';
      document.getElementById('lb-outside').value=l.outside_access||'closed';
      document.getElementById('lb-outside-link').innerHTML='Its own filing form: <a class="linkish" href="/file/'+
        esc(l.slug)+'" target="_blank" rel="noopener">/file/'+esc(l.slug)+'</a>';
    }).catch(function(){});
}

/* The editor OPENS IN PLACE OF the list, not under it. Under it, a click on
   "Questions" filled boxes that were already on screen and nothing seemed to
   happen. data-closed keeps the tab switcher from reopening whichever half
   is shut. */
function lbShowEditor(on){
  ['panel-logbook-edit','panel-logbook-when'].forEach(function(id){
    var el=document.getElementById(id);
    el.toggleAttribute('data-closed',!on); el.hidden=!on;
  });
  ['panel-logbooks'].forEach(function(id){
    var el=document.getElementById(id);
    el.toggleAttribute('data-closed',on); el.hidden=on;
  });
  var top=document.getElementById(on?'panel-logbook-edit':'panel-logbooks');
  if(top&&top.scrollIntoView) top.scrollIntoView({block:'start'});
}

function openLogbook(id){
  lbEditing=id;
  /* Cleared first, so the previous logbook's questions are never on screen
     under this one's name while it loads. */
  document.getElementById('lb-edit-title').textContent='Loading…';
  document.getElementById('lb-fields').innerHTML='<div class="empty_component">Loading&hellip;</div>';
  lbShowEditor(true);
  renderLogbookFields();
}

function closeLogbook(){
  lbEditing=null;
  lbShowEditor(false);
}

document.addEventListener('click',function(e){
  var t=e.target;
  if(!t||!t.getAttribute) return;
  /* closest, NOT e.target. The logbook tile is a button with spans inside it,
     so a click lands on a span and reads no attribute at all — which is a tile
     that looks clickable and does nothing. */
  var tile=t.closest&&t.closest('[data-lb-open]');
  if(tile){ openLogbook(tile.getAttribute('data-lb-open')); return; }
  var del=t.getAttribute('data-lb-del');
  if(del&&lbEditing){
    fetch('/api/admin/logbooks/'+encodeURIComponent(lbEditing)+'/fields/'+encodeURIComponent(del),
      {method:'DELETE'}).then(function(r){ return r.json(); }).then(function(out){
        lbErr('lb-field-err', out.error); renderLogbookFields();
      });
    return;
  }
  var up=t.getAttribute('data-lb-up');
  if(up&&lbEditing){
    /* Reorder by sending the whole order, so a half-applied move cannot be
       left behind. The server writes it in one statement. */
    fetch('/api/admin/logbooks/'+encodeURIComponent(lbEditing)).then(function(r){ return r.json(); })
      .then(function(l){
        var ids=l.fields.map(function(f){ return f.id; });
        var i=ids.indexOf(Number(up)); if(i<1) return;
        ids.splice(i-1,0,ids.splice(i,1)[0]);
        return fetch('/api/admin/logbooks/'+encodeURIComponent(lbEditing)+'/fields/order',
          {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:ids})});
      }).then(renderLogbookFields);
  }
});

function wireLogbookBuilder(){
  var create=document.getElementById('lb-create');
  if(!create) return;

  /* LAUNCH. Confirmed by typing the title rather than by pressing OK: this
     is the only action on the page that cannot be undone, and a confirm
     dialog is the thing everybody presses without reading. Typing the name
     of the thing is the same protection the chain reset uses. */
  document.getElementById('lb-launch').addEventListener('click',function(){
    if(!lbEditing) return;
    var title=(document.getElementById('lb-edit-title').textContent||'').trim();
    var typed=prompt('Launching “'+title+'” fixes its questions for good.\n\n'
      +'There is no going back: after this you can add a new optional question '
      +'and close the logbook, but nothing can be reworded, removed, reordered '
      +'or made compulsory.\n\nType the logbook\u2019s title to launch it:');
    if(typed===null) return;
    if(typed.trim()!==title){
      lbErr('lb-field-err','That did not match the title, so nothing was launched.');
      return;
    }
    fetch('/api/admin/logbooks/'+encodeURIComponent(lbEditing)+'/launch',{method:'POST'})
      .then(function(r){ return r.json(); })
      .then(function(out){
        lbErr('lb-field-err', out.error);
        renderLogbookFields(); renderLogbooks();
      });
  });

  /* DELETE A DRAFT. Confirmed by typing the title, the same way launching
     is, and for the same reason: this is the other action on the page that
     cannot be undone. A plain confirm dialog is the thing everybody
     presses without reading.
     The button is inside lb-launch-wrap, which is already hidden once the
     logbook is launched — so it is not shown for a logbook the server
     would refuse anyway. The server refuses regardless; the screen not
     offering it is a courtesy, never the check. */
  document.getElementById('lb-delete').addEventListener('click',function(){
    if(!lbEditing) return;
    var title=(document.getElementById('lb-edit-title').textContent||'').trim();
    var typed=prompt('Deleting “'+title+'” removes it and its questions.\n\n'
      +'It has never been launched, so it holds no reports and is on no anchor — '
      +'nothing published depends on it.\n\nType the logbook\u2019s title to delete it:');
    if(typed===null) return;
    if(typed.trim()!==title){
      lbErr('lb-delete-err','That did not match the title, so nothing was deleted.');
      return;
    }
    fetch('/api/admin/logbooks/'+encodeURIComponent(lbEditing),{method:'DELETE'})
      .then(function(r){ return r.json().then(function(d){ return {ok:r.ok,d:d}; }); })
      .then(function(res){
        if(!res.ok){ lbErr('lb-delete-err', res.d.error||'That could not be deleted.'); return; }
        closeLogbook();
        renderLogbooks();
      });
  });

  /* ---- making a logbook: two steps ---------------------------------

     THE QUESTION SET FIRST, THE NAME SECOND, because that is the order the
     decisions actually come in and only the first one is hard. The old form
     asked for a name above the list and offered no starting point at all —
     the shipped question sets existed, but only the first-run wizard ever
     offered them, once, so a deployment's second logbook started from a blank
     page whether or not that was what anybody wanted.

     A starting point supplies QUESTIONS ONLY. It writes no site setting: a
     deployment makes logbooks for years, and adding one must not rewrite the
     settings of a site that has been running for months. That is the whole
     difference between this and the first-run templates.

     NOTHING AUTO-ADVANCES. Choosing a starting point selects it; Continue
     moves. Same rule as the reporting form — nothing on the card in front of
     somebody changes underneath them. */
  var nlbChoice='none';
  var nlbPoints=[];

  function nlbStep(n){
    document.getElementById('nlb-step-1').hidden = n!==1;
    document.getElementById('nlb-step-2').hidden = n!==2;
    /* The file upload belongs to step one: it is a third way to answer
       "where do these questions come from", not a thing you do after naming. */
    document.getElementById('nlb-upload').hidden = n!==1;
    document.getElementById('nlb-title').textContent =
      n===1 ? 'Start from' : 'Name this logbook';
  }

  function nlbRenderPoints(){
    var box=document.getElementById('nlb-points');
    /* "Start from nothing" is FIRST and selected by default. A list whose
       first entry is a shipped question set reads as though one of them is
       expected; an operator building their own should not have to scroll past
       three suggestions to find the plain option. */
    var rows=[{id:'none',title:'Start from nothing',
      blurb:'An empty logbook. You add every question yourself.',
      questions:null}].concat(nlbPoints);
    box.innerHTML=rows.map(function(p){
      var id='nlb-p-'+esc(p.id);
      var what=p.questions===null ? 'No questions yet'
        : (p.questions+' question'+(p.questions===1?'':'s')
           +(p.typed?'':', all of them choices')
           +(p.takesFiles?', and a place for files':''));
      /* <b> and <small>, which is exactly what .picktile already styles — the
         reporting form's choice tiles are these. A new class here would be a
         second look for the same control. */
      return '<label class="pick plain"><input type="radio" name="nlb-point" id="'+id+'"'+
        ' value="'+esc(p.id)+'"'+(p.id===nlbChoice?' checked':'')+'>'+
        '<span class="picktile"><b>'+esc(p.title)+'</b>'+
        (p.blurb?'<small>'+esc(p.blurb)+'</small>':'')+
        '<small>'+esc(what)+'</small></span></label>';
    }).join('');
  }

  function nlbOpen(){
    nlbChoice='none';
    document.getElementById('lb-new-title').value='';
    document.getElementById('lb-new-slug').value='';
    lbErr('nlb-err-1',''); lbErr('nlb-err-2','');
    nlbStep(1);
    document.getElementById('ovl-newlogbook').classList.add('on');
    /* Fetched on open rather than at start-up: it is three files read off
       disk, and an operator who never makes a logbook should never ask. */
    fetch('/api/admin/logbooks/starting-points').then(function(r){ return r.json(); })
      .then(function(d){ nlbPoints=Array.isArray(d)?d:[]; nlbRenderPoints(); })
      .catch(function(){ nlbPoints=[]; nlbRenderPoints(); });
  }
  function nlbClose(){ document.getElementById('ovl-newlogbook').classList.remove('on'); }

  document.getElementById('lb-new').addEventListener('click', nlbOpen);
  document.getElementById('nlb-cancel-1').addEventListener('click', nlbClose);
  document.getElementById('nlb-cancel-2').addEventListener('click', nlbClose);
  document.getElementById('nlb-back').addEventListener('click',function(){ nlbStep(1); });
  document.getElementById('nlb-points').addEventListener('change',function(e){
    if(e.target && e.target.name==='nlb-point') nlbChoice=e.target.value;
  });
  document.getElementById('nlb-go-1').addEventListener('click',function(){
    var chosen=nlbPoints.filter(function(p){ return p.id===nlbChoice; })[0];
    /* Said on the second card, so somebody naming it can still see what they
       picked without going back for it. */
    document.getElementById('nlb-chosen').textContent = chosen
      ? 'Starting from “'+chosen.title+'”. Every question is yours to change '
        +'until you launch it.'
      : 'Starting from nothing. You add every question yourself.';
    /* The title is prefilled from the starting point, because a set called
       "Election incidents" is a reasonable name for a logbook of them — and
       it is a suggestion in an editable box, not a decision. */
    if(chosen && !document.getElementById('lb-new-title').value){
      document.getElementById('lb-new-title').value=chosen.title;
    }
    nlbStep(2);
    document.getElementById('lb-new-title').focus();
  });

  create.addEventListener('click',function(){
    var title=document.getElementById('lb-new-title').value.trim();
    var slug=document.getElementById('lb-new-slug').value.trim();
    /* Said rather than doing nothing. The old version returned silently on an
       empty title, so the button looked broken. */
    if(!title){ lbErr('nlb-err-2','Give it a title.'); return; }
    fetch('/api/admin/logbooks',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({title:title,slug:slug||undefined,
        startingPoint:nlbChoice==='none'?undefined:nlbChoice})})
      .then(function(r){ return r.json(); }).then(function(out){
        if(out.error){ lbErr('nlb-err-2', out.error); return; }
        lbErr('nlb-err-2',''); lbErr('lb-err','');
        nlbClose();
        /* Straight into the builder: the next thing anybody does is look at
           the questions, whether they chose a starting point or not. */
        renderLogbooks(); openLogbook(out.id);
      });
  });

  document.getElementById('lb-field-kind').addEventListener('change', lbKindHelp);
  /* Choosing which question decides this one redraws the answers to tick.
     Nothing else on the card changes, so this does not break the rule
     against a card rearranging itself under somebody — it is the operator's
     own builder, not a reporter's form. */
  document.getElementById('lb-field-when').addEventListener('change', lbRenderWhenValues);

  /* The freeze. Asked for before it happens, because it stops reporters
     part-way through attaching something and there is no way for them to be
     told why. Taking it off again needs no confirming: it restores what the
     questions already say. */
  function setFilesFrozen(frozen){
    if(!lbEditing) return;
    fetch('/api/admin/logbooks/'+encodeURIComponent(lbEditing)+'/files/freeze',
      {method:'POST',headers:{'Content-Type':'application/json'},
       body:JSON.stringify({frozen:frozen})})
      .then(function(r){ return r.json(); }).then(function(out){
        lbErr('lb-field-err', out.error); renderLogbookFields();
      });
  }
  /* THIS LOGBOOK'S OWN UPLOAD LIMITS, narrower than the site's and never
     wider. The boxes, the megabyte conversion and "an empty box means
     inherit" are the same code the site panel uses — see limFill in
     admin-settings.js. What differs is which layer the boxes own. */
  function postLogbookLimits(body){
    if(!lbEditing) return;
    lbErr('lblim-err','');
    fetch('/api/admin/logbooks/'+encodeURIComponent(lbEditing)+'/limits',
      {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
      .then(function(r){ return r.json().then(function(d){ return {ok:r.ok,d:d}; }); })
      .then(function(res){
        if(!res.ok){ lbErr('lblim-err', res.d.error||'Something went wrong'); return; }
        renderLogbookLimits(lbEditing);
      })
      .catch(function(){ lbErr('lblim-err','Could not save the limits.'); });
  }

  document.getElementById('lblim-save').addEventListener('click',function(){
    var read=limRead(limRoot());
    if(read.bad){ lbErr('lblim-err', LIM_BAD_NUMBER); read.bad.focus(); return; }
    postLogbookLimits(read.body);
  });
  document.getElementById('lblim-reset').addEventListener('click',function(){
    postLogbookLimits(limClearBody(limRoot()));
  });

  document.getElementById('lb-freeze').addEventListener('click',function(){
    if(!confirm('Freeze uploads on this logbook?\n\nIt goes on asking for files'
      +' and refuses new ones, so somebody part-way through attaching something'
      +' will be stopped. Nothing already filed or published is hidden, and you'
      +' can take the freeze off at any time.')) return;
    setFilesFrozen(true);
  });
  document.getElementById('lb-unfreeze').addEventListener('click',function(){
    setFilesFrozen(false);
  });

  /* UPLOAD A LOGBOOK FILE. Read in the browser and sent as JSON; the server
     checks it and makes a draft, then the editor opens on it so the next
     thing somebody sees is what they uploaded. */
  document.getElementById('lb-file').addEventListener('change',function(){
    var input=this, f=input.files&&input.files[0];
    if(!f) return;
    var reader=new FileReader();
    reader.onload=function(){
      var parsed;
      /* ERRORS GO WHERE THE CONTROL IS. This input moved inside the wizard,
         and `lb-err` is on the panel behind it — so a bad file used to report
         itself onto a covered element and the upload looked like it had done
         nothing at all. */
      try { parsed=JSON.parse(String(reader.result)); }
      catch(e){ lbErr('nlb-err-1','That file is not JSON, so it is not a logbook file.'); input.value=''; return; }
      fetch('/api/admin/logbooks/from-file',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({file:parsed})})
        .then(function(r){ return r.json(); }).then(function(out){
          input.value='';
          if(out.error){ lbErr('nlb-err-1', out.error); return; }
          lbErr('nlb-err-1',''); lbErr('lb-err','');
          /* And the wizard closes on success, for the same reason the other
             two ways out of it do: openLogbook puts the builder on screen
             underneath, and leaving the modal over it means the next thing an
             operator sees is the dialog they have finished with. */
          nlbClose();
          renderLogbooks(); openLogbook(out.id);
        });
    };
    reader.readAsText(f);
  });

  document.getElementById('lb-field-add').addEventListener('click',function(){
    if(!lbEditing) return;
    var kind=document.getElementById('lb-field-kind').value;
    var label=document.getElementById('lb-field-label').value.trim();
    if(!label){ lbErr('lb-field-err','Say what to ask.'); return; }
    var opts=document.getElementById('lb-field-options').value
      .split('\n').map(function(x){ return x.trim(); }).filter(Boolean);
    var body={kind:kind,label:label,
      required:document.getElementById('lb-field-required').checked,
      filterable:document.getElementById('lb-field-filterable').checked};
    if(opts.length) body.settings={options:opts};
    /* Only when one was chosen. An absent key means "always asked", which
       is what every question carried before this control existed. */
    var when=lbWhenBody();
    if(when) body.shown_when=when;
    fetch('/api/admin/logbooks/'+encodeURIComponent(lbEditing)+'/fields',
      {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
      .then(function(r){ return r.json(); }).then(function(out){
        if(out.error){ lbErr('lb-field-err', out.error); return; }
        lbErr('lb-field-err','');
        document.getElementById('lb-field-label').value='';
        document.getElementById('lb-field-options').value='';
        document.getElementById('lb-field-required').checked=false;
        document.getElementById('lb-field-filterable').checked=false;
        /* Back to "always". Leaving the condition set is how somebody adds
           three questions and finds two of them conditional by accident. */
        var when=document.getElementById('lb-field-when');
        if(when) when.value='';
        lbRenderWhenValues();
        renderLogbookFields();
      });
  });

  document.getElementById('lb-schedule-save').addEventListener('click',function(){
    if(!lbEditing) return;
    var o=document.getElementById('lb-opens').value;
    var c=document.getElementById('lb-closes').value;
    fetch('/api/admin/logbooks/'+encodeURIComponent(lbEditing)+'/schedule',
      {method:'POST',headers:{'Content-Type':'application/json'},
       body:JSON.stringify({opensAt:o?new Date(o).toISOString():null,
                            closesAt:c?new Date(c).toISOString():null})})
      .then(function(r){ return r.json(); }).then(function(out){
        lbErr('lb-sched-err', out.error); renderLogbookFields(); renderLogbooks();
      });
  });

  document.getElementById('lb-close-toggle').addEventListener('click',function(){
    if(!lbEditing) return;
    var closing=this.textContent.indexOf('Close')===0;
    fetch('/api/admin/logbooks/'+encodeURIComponent(lbEditing)+'/closed',
      {method:'POST',headers:{'Content-Type':'application/json'},
       body:JSON.stringify({closed:closing})})
      .then(function(){ renderLogbookFields(); renderLogbooks(); });
  });

  document.getElementById('lb-outside').addEventListener('change',function(){
    if(!lbEditing) return;
    fetch('/api/admin/logbooks/'+encodeURIComponent(lbEditing)+'/outside',
      {method:'POST',headers:{'Content-Type':'application/json'},
       body:JSON.stringify({outsideAccess:this.value})})
      .then(function(r){ return r.json(); }).then(function(out){
        lbErr('lb-outside-err', out.error); renderLogbookFields();
      });
  });

  document.getElementById('lb-edit-done').addEventListener('click',closeLogbook);
  document.getElementById('lb-edit-back').addEventListener('click',closeLogbook);
}

/* The markup above this script is already in the document, so wiring at
   load is safe and keeps every listener in one place. */
wireLogbookBuilder();

function renderAdmin(){
  /* The type menu is the catalogue the software offers, fetched rather than
     restated here — a second copy is how a dropdown ends up offering a type
     the server does not have. */
  if(!LB_TYPES.length){
    fetch('/api/admin/logbooks/field-types').then(function(r){ return r.json(); })
      .then(function(list){
        if(!Array.isArray(list)) return;
        LB_TYPES=list;
        var sel=document.getElementById('lb-field-kind');
        if(sel){ sel.innerHTML=list.map(function(t){
          return '<option value="'+esc(t.id)+'">'+esc(t.label)+'</option>'; }).join('');
          lbKindHelp(); }
      }).catch(function(){});
  }
  renderLogbooks();
  renderLists();
  renderMaps();
  renderOps();

  renderOwnership();
  renderSiteAccess();
  renderIdentity();
  renderSiteCopy();
  renderPolicies();
  renderLook();
  renderIntakeSwitch();
  renderPublication();
  renderAttachments();
  renderUploadLimits();
  renderReviewKeywords();
  renderLegal();
  renderDevMode();
  renderAccessLog();
  renderUpdates();
}

/* Everything on the Access pane is behind
   requireRole(['admin','access_manager']) in src/routes/orgs.js, so both
   roles render the whole page and neither is shown a panel it cannot use. */
function renderAccess(){
  renderRolesAdmin();
}

export {
  renderAccess, renderAdmin, renderLogbooks,
};
