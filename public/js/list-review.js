/* list-review.js — Approving list entries in bulk, on the Moderators page.
 *
 * NOTHING IS COUNTED PUBLICLY UNTIL A MODERATOR APPROVES IT. The difference
 * from a report is the unit: a page of entries is skimmed and approved
 * together. So the page puts in front of the reviewer the two things they
 * cannot see row by row — the site every link goes to, with unfamiliar ones
 * marked, and how many entries came from one source.
 *
 * APPROVE AND REJECT SEND THE IDS ON SCREEN, never "everything waiting",
 * so an entry that arrived after the page was drawn is not approved unseen.
 */

import { esc } from './answers.js';

var LR = { queues: [], current: null, page: null };

function el(id){ return document.getElementById(id); }
function say(msg){ var e=el('lr-msg'); if(e) e.textContent=msg||''; }

function renderListReview(){
  var panel=el('lr-panel');
  if(!panel) return;
  fetch('/api/list-review').then(function(r){ return r.ok?r.json():null; }).then(function(q){
    /* No lists, or no right to see them: the panel stays out of the way. */
    if(!Array.isArray(q)||!q.length){ panel.hidden=true; return; }
    panel.hidden=false;
    LR.queues=q;
    var sel=el('lr-list');
    var keep=LR.current||String((q.filter(function(x){ return x.waiting; })[0]||q[0]).id);
    sel.innerHTML=q.map(function(x){
      return '<option value="'+esc(String(x.id))+'">'+esc(x.title)+
        (x.waiting?(' — '+x.waiting+' waiting'):'')+'</option>';
    }).join('');
    sel.value=keep;
    LR.current=sel.value;
    loadPage();
  }).catch(function(){});
}

function answerText(v){
  if(Array.isArray(v)) return v.join(', ');
  if(v===true) return 'Yes';
  if(v===false) return 'No';
  return String(v);
}

function loadPage(){
  if(!LR.current) return;
  var state=el('lr-state').value;
  fetch('/api/list-review/'+encodeURIComponent(LR.current)+'?state='+encodeURIComponent(state))
    .then(function(r){ return r.ok?r.json():null; }).then(function(p){
      if(!p) return;
      LR.page=p;
      drawPage(p);
    }).catch(function(){});
}

function drawPage(p){
  var labels={};
  p.fields.forEach(function(f){ labels[f.key]=f.label; });
  var box=el('lr-entries');
  var c=p.clusters;
  var notes=[];
  if(c.repeatedSubmitters){
    notes.push('<b>'+c.entriesFromRepeatedSubmitters.length+' of these came from '+c.repeatedSubmitters+
      ' source'+(c.repeatedSubmitters===1?'':'s')+' sending more than once</b> (the most from one: '+c.largestRepeatedSubmitter+
      '). One person pressing a button many times looks like this.');
  }
  var busy=(c.busiestMinutes||[])[0];
  if(busy&&busy.count>2){
    notes.push('The busiest minute had '+busy.count+' entries ('+esc(new Date(busy.minute+':00Z').toLocaleString())+
      '). A burst from many places is usually a mention somewhere; from one source, see above.');
  }
  el('lr-clusters').innerHTML=notes.join(' ');

  if(!p.entries.length){
    box.innerHTML='<div class="empty_component">Nothing here.</div>';
    el('lr-actions').hidden=true;
    return;
  }
  var repeated={};
  (c.entriesFromRepeatedSubmitters||[]).forEach(function(id){ repeated[id]=1; });
  /* Shown on every view: a rejected entry can still be approved, and the
     reverse. Only going back to "waiting" is impossible. */
  el('lr-actions').hidden=false;
  box.innerHTML=p.entries.map(function(e){
    var rows=[];
    (e.links||[]).forEach(function(l){
      rows.push('<li><span class="lp-chip'+(l.knownHost?'':' lr-unknown')+'">'+esc(l.host)+
        (l.knownHost?'':' &middot; unfamiliar')+'</span> <a class="linkish" href="'+esc(l.urlRaw)+
        '" target="_blank" rel="noopener noreferrer nofollow">'+esc(l.urlRaw)+'</a></li>');
    });
    Object.keys(e.answers||{}).forEach(function(k){
      var f=p.fields.filter(function(x){ return x.key===k; })[0];
      if(f&&f.kind==='url') return;
      rows.push('<li><b>'+esc(labels[k]||k)+':</b> '+esc(answerText(e.answers[k]))+'</li>');
    });
    Object.keys(e.erasableAnswers||{}).forEach(function(k){
      rows.push('<li><b>'+esc(labels[k]||k)+':</b> '+esc(answerText(e.erasableAnswers[k]))+
        ' <span class="text-color-muted">(deleted on the timer)</span></li>');
    });
    if(e.erased) rows.push('<li class="text-color-muted">What this person wrote has been deleted.</li>');
    return '<label class="lr-entry">'+
      '<input type="checkbox" class="lr-tick" value="'+esc(String(e.id))+'" aria-label="Entry '+esc(String(e.id))+'">'+
      '<span class="lr-body"><span class="text-size-small text-color-muted">'+esc(new Date(e.createdAt).toLocaleString())+
        (repeated[e.id]?' &middot; <b>same source as others here</b>':'')+
        (e.hasEmail?' &middot; left an email address':'')+
        ' &middot; '+esc(e.reviewState)+'</span>'+
      '<ul class="lr-answers">'+rows.join('')+'</ul></span></label>';
  }).join('');
}

function ticked(){
  return [].slice.call(document.querySelectorAll('#lr-entries .lr-tick:checked'))
    .map(function(c){ return Number(c.value); });
}

function decide(state){
  var ids=ticked();
  if(!ids.length){ say('Tick the entries first.'); return; }
  fetch('/api/list-review/'+encodeURIComponent(LR.current)+'/review', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({ state:state, ids:ids }),
  }).then(function(r){ return r.json().then(function(b){ return {ok:r.ok,b:b}; }); }).then(function(x){
    if(!x.ok){ say(x.b.error||'That did not work.'); return; }
    say((state==='approved'?'Approved ':'Rejected ')+x.b.changed+'.');
    renderListReview();
  }).catch(function(){ say('That did not work.'); });
}

function wireListReview(){
  if(!el('lr-panel')) return;
  el('lr-list').addEventListener('change', function(){ LR.current=el('lr-list').value; say(''); loadPage(); });
  el('lr-state').addEventListener('change', function(){ say(''); loadPage(); });
  el('lr-all').addEventListener('click', function(){
    document.querySelectorAll('#lr-entries .lr-tick').forEach(function(c){ c.checked=true; });
  });
  el('lr-approve').addEventListener('click', function(){ decide('approved'); });
  el('lr-reject').addEventListener('click', function(){ decide('rejected'); });
}
wireListReview();

export {
  renderListReview,
};
