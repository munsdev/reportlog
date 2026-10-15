/* admin-lists.js — Making and changing lists, the second format.
 *
 * A list's rules live on the server (src/lists/), and this page decides
 * nothing that matters: it offers what the server will take and shows what
 * the server said. Every refusal that counts — a countable box beside free
 * text, an upload question, the address requirement — comes back from
 * PUT /api/admin/lists/:id/fields in words, and is shown as they came.
 *
 * WHAT THIS PAGE DOES DECIDE is the order things are asked in. Making a
 * list starts with which FORMAT, because a general form builder invites an
 * operator to collect firsthand accounts somewhere unsealed and sweepable
 * just because it was the builder on screen. docs/lists.md, "The risk that
 * runs the other way".
 */

import { esc } from './answers.js';

var LS = { lists: [], templates: [], kinds: [], personalDays: 90 };
var lsOpen = null;     // the list being edited, as the server last described it
var lsFields = [];     // the questions as edited on screen, not yet saved

/* Kept in step with AGGREGATABLE_KINDS and PERSONAL_KINDS in
   src/lists/fields.js — only to grey out a box the server would refuse. The
   server is still the one that decides. */
var COUNTABLE = { choice_one:1, choice_many:1, yes_no:1, number:1, date:1, time:1, datetime:1, place:1 };
var PERSONAL = { short_text:1, long_text:1, email:1, place:1 };
var HAS_OPTIONS = { choice_one:1, choice_many:1, place:1 };

function el(id){ return document.getElementById(id); }
function say(id, msg){
  var e=el(id); if(!e) return;
  e.textContent=msg||'';
  if(e.classList.contains('form_error')) e.classList.toggle('on', !!msg);
}
function api(path, opts){
  opts=opts||{};
  return fetch(path, {
    method: opts.method||'GET',
    headers: opts.body?{'Content-Type':'application/json'}:undefined,
    body: opts.body?JSON.stringify(opts.body):undefined,
  }).then(function(r){
    return r.json().catch(function(){ return {}; }).then(function(b){ return { ok:r.ok, status:r.status, body:b }; });
  });
}

function stateWords(l){
  var who = l.visibility==='listed' ? 'Listed'
    : l.visibility==='password' ? 'Team only' : 'Hidden';
  var open = l.closedAt ? 'not taking entries'
    : (l.accepting ? 'taking entries' : 'not open yet');
  return who+', '+open+'.';
}

function renderLists(){
  var box=el('ls-list');
  if(!box) return;
  api('/api/admin/lists').then(function(r){
    if(!r.ok) return;
    LS=r.body;
    renderTemplates();
    renderKinds();
    if(!LS.lists.length){ box.innerHTML='<div class="empty_component">No lists yet.</div>'; return; }
    box.innerHTML=LS.lists.map(function(l){
      var waiting = l.waiting ? (' &middot; <b>'+l.waiting+' waiting for review</b>') : '';
      return '<button type="button" class="lb-tile" data-ls-open="'+esc(String(l.id))+'">'+
        '<span class="lb-tile-head"><b>'+esc(l.title)+'</b>'+
          '<span class="lp-chip lb-tile-state">'+esc(l.visibility==='listed'?'listed':l.visibility==='password'?'team only':'hidden')+'</span></span>'+
        '<span class="lb-tile-sub">'+esc(stateWords(l))+'</span>'+
        '<span class="lb-tile-meta">/list/'+esc(l.slug)+' &middot; '+l.fields.length+' question'+(l.fields.length===1?'':'s')+
          ' &middot; '+l.received+' received'+waiting+'</span>'+
        '<span class="lb-tile-go">Open this list &rarr;</span>'+
        '</button>';
    }).join('');
  }).catch(function(){});
}

function renderTemplates(){
  var box=el('ls-templates');
  if(!box||box.getAttribute('data-built')) return;
  box.innerHTML=LS.templates.map(function(t,i){
    var id='ls-tpl-'+i;
    return '<input type="radio" name="ls-tpl" id="'+id+'" value="'+esc(t.slug)+'">'+
      '<label class="picktile" for="'+id+'"><b>'+esc(t.title)+'</b>'+
      '<small>'+esc(t.blurb||'')+' Asks: '+esc(t.questions.join(', '))+'.'+
      (t.requiresEmail?' Asks for an email address, because people can write on it.':' Asks for no email address.')+
      '</small></label>';
  }).join('');
  box.setAttribute('data-built','1');
  box.addEventListener('change', function(e){
    var t=LS.templates.filter(function(x){ return x.slug===e.target.value; })[0];
    if(!t) return;
    /* Prefilled, not imposed: the second check-in list needs another address. */
    var taken=LS.lists.some(function(l){ return l.slug===t.slug; });
    el('ls-new-title').value=t.title;
    el('ls-new-slug').value=taken?'':t.slug;
  });
}

function renderKinds(){
  var sel=el('ls-add-kind');
  if(!sel||sel.options.length) return;
  sel.innerHTML=LS.kinds.map(function(k){
    return '<option value="'+esc(k.id)+'">'+esc(k.label)+'</option>';
  }).join('');
}

/* ---- creating ---------------------------------------------------------- */

function wireCreate(){
  el('ls-new').addEventListener('click', function(){
    var box=el('ls-create'); box.hidden=!box.hidden;
  });
  document.querySelectorAll('input[name="ls-format"]').forEach(function(r){
    r.addEventListener('change', function(){
      el('ls-to-logbooks').hidden = r.value!=='logbook' || !r.checked;
      el('ls-create-list').hidden = r.value!=='list' || !r.checked;
    });
  });
  el('ls-go-logbooks').addEventListener('click', function(){
    var b=document.querySelector('[data-adminsec="logbooks"]'); if(b) b.click();
  });
  el('ls-create-go').addEventListener('click', function(){
    var picked=document.querySelector('input[name="ls-tpl"]:checked');
    if(!picked){ say('ls-err','Pick something to start from.'); return; }
    say('ls-err','');
    api('/api/admin/lists', { method:'POST', body:{
      template: picked.value,
      title: el('ls-new-title').value.trim(),
      slug: el('ls-new-slug').value.trim().toLowerCase(),
    }}).then(function(r){
      if(!r.ok){ say('ls-err', r.body.error||'That did not work.'); return; }
      el('ls-create').hidden=true;
      renderLists();
      openList(r.body.id);
    });
  });
}

/* ---- one list ---------------------------------------------------------- */

function showPanels(editing){
  el('panel-lists').hidden=editing;
  var ed=el('panel-list-edit');
  ed.hidden=!editing;
  /* data-closed is what keeps the subnav from opening an empty editor. */
  if(editing) ed.removeAttribute('data-closed'); else ed.setAttribute('data-closed','');
}

function openList(id){
  api('/api/admin/lists/'+encodeURIComponent(id)).then(function(r){
    if(!r.ok){ say('ls-err', r.body.error||'That list could not be opened.'); return; }
    lsOpen=r.body;
    lsFields=lsOpen.fields.map(function(f){ return Object.assign({}, f); });
    drawList();
    drawFields();
    drawCounts(lsOpen.summary);
    showPanels(true);
    window.scrollTo(0,0);
  });
}

function drawList(){
  var l=lsOpen;
  el('ls-edit-title').textContent=l.title;
  el('ls-edit-state').textContent=stateWords(l);
  var link=el('ls-edit-link');
  link.innerHTML='The form: <a class="linkish" href="/list/'+esc(l.slug)+'" target="_blank" rel="noopener">/list/'+esc(l.slug)+'</a>'+
    (l.visibility==='hidden'?' &mdash; only you can open it while it is hidden.':'');
  el('ls-visibility').value=l.visibility;
  el('ls-title').value=l.title;
  el('ls-blurb').value=l.blurb||'';
  el('ls-publish').checked=l.aggregatesPublished;
  el('ls-outside').value=l.outsideAccess||'closed';
  el('ls-email-mode').value=l.emailMode||'auto';
  el('ls-notify').checked=Boolean(l.notify);
  el('ls-notify-email').value=l.notifyPendingEmail||l.notifyEmail||'';
  el('ls-notify-email').placeholder=l.adminEmail||'the admin address';
  var going=l.notifyEmail||l.adminEmail;
  el('ls-notify-state').innerHTML=!l.notify ? 'Off.'
    : (going ? 'Going to <b>'+esc(going)+'</b>'+(l.notifyEmail?'':' (the admin address)')+'.' : '<b>Nowhere</b> — this site has no admin address set.')
      +(l.notifyPendingEmail ? ' Waiting for <b>'+esc(l.notifyPendingEmail)+'</b> to click the link we sent; until then, nothing goes to it.' : '');
  el('ls-close').hidden=Boolean(l.closedAt);
  el('ls-open').hidden=!l.closedAt;
  drawEmailRule();
}

/* THE ADDRESS RULE, in words, recomputed as questions are edited. It is
   derived — there is no box to tick — and saying why is what stops it
   reading as a setting somebody forgot to turn off. */
function drawEmailRule(){
  var personal=lsFields.filter(function(f){ return PERSONAL[f.kind] && f.retention!=='absent'; });
  var requiredPersonal=personal.filter(function(f){ return f.required; });
  var days=LS.personalDays;
  var gone = days ? ('deleted after '+days+' days') : 'kept until they ask for it to be deleted';
  var always=lsOpen&&lsOpen.emailMode==='required';
  var names=function(list){ return list.map(function(f){ return esc(f.label||f.key); }).join(', '); };
  el('ls-email-rule').innerHTML = always
    ? '<b>This form always asks for an email address</b>, because you set it to: people use it to reach you. What they write and their address are '+gone+', or sooner if they use the link they are emailed.'
    : requiredPersonal.length
      ? '<b>This form always asks for an email address</b>, because everybody has to answer '+names(requiredPersonal)+
        ', which is typed, and typed answers need a way to be deleted. What they write and their address are '+gone+'.'
      : personal.length
        ? '<b>This form asks for an email address only from somebody who writes something</b> ('+names(personal)+
          '), so they can have it deleted. What they write and their address are '+gone+', or sooner if they use the link they are emailed.'
        : '<b>This form asks for no email address.</b> Nothing on it is about a person, so there is nobody to write to and nothing to delete.';
}

function keyFrom(label, self){
  var base=String(label||'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,40);
  if(!/^[a-z0-9]/.test(base)) base='q_'+base;
  base=base.replace(/_+$/,'')||'q';
  var key=base, n=2;
  var taken=function(k){ return lsFields.some(function(f){ return f!==self && f.key===k; }); };
  while(taken(key)){ key=base+'_'+n; n+=1; }
  return key;
}

function kindLabel(kind){
  var k=LS.kinds.filter(function(x){ return x.id===kind; })[0];
  return k?k.label:kind;
}

function drawFields(){
  var box=el('ls-fields');
  box.innerHTML=lsFields.map(function(f,i){
    var id='lsf-'+i;
    var opts=f.options&&Array.isArray(f.options.options)?f.options.options:[];
    var countable=COUNTABLE[f.kind];
    return '<div class="ls-field" data-i="'+i+'">'+
      '<p class="ls-field-head"><b>'+(i+1)+'. '+esc(kindLabel(f.kind))+'</b>'+
        (f.id?'':' <span class="lp-chip">new</span>')+'</p>'+
      '<div class="form_field-wrapper"><label class="form_label" for="'+id+'-label">Question</label>'+
        '<input class="form_input" type="text" id="'+id+'-label" data-k="label" maxlength="200" value="'+esc(f.label||'')+'"></div>'+
      '<div class="form_field-wrapper"><label class="form_label" for="'+id+'-help">Help under it</label>'+
        '<input class="form_input" type="text" id="'+id+'-help" data-k="help" value="'+esc(f.help||'')+'"></div>'+
      (HAS_OPTIONS[f.kind]
        ? '<div class="form_field-wrapper"><label class="form_label" for="'+id+'-opts">Options, one per line</label>'+
          '<textarea class="form_textarea" id="'+id+'-opts" data-k="options">'+esc(opts.join('\n'))+'</textarea></div>'
        : '')+
      (f.kind==='url'
        ? '<div class="form_field-wrapper"><label class="form_label" for="'+id+'-max">How many links</label>'+
          '<input class="form_input" type="number" min="1" max="20" id="'+id+'-max" data-k="maxValues" value="'+esc(String(f.maxValues||1))+'"></div>'
        : '')+
      '<label class="choice_item"><input class="choice_input" type="checkbox" data-k="required"'+(f.required?' checked':'')+'>'+
        '<span class="choice_text"><span class="choice_title">Needs an answer</span></span></label>'+
      '<label class="choice_item"><input class="choice_input" type="checkbox" data-k="aggregatable"'+
        (f.aggregatable?' checked':'')+(countable?'':' disabled')+'>'+
        '<span class="choice_text"><span class="choice_title">Countable</span>'+
        '<span class="choice_note">'+(countable
          ? 'Its answers may be counted &mdash; and published, if counts are.'
          : 'Not possible: only a question with a fixed set of answers can be counted. A count over writing is the writing.')+
        '</span></span></label>'+
      (PERSONAL[f.kind]
        ? '<div class="form_field-wrapper"><label class="form_label" for="'+id+'-ret">How long the answer is kept</label>'+
          '<select class="form_select" id="'+id+'-ret" data-k="retention">'+
            '<option value="transient"'+(f.retention==='transient'?' selected':'')+'>Deleted on the timer, with the email address</option>'+
            '<option value="durable"'+(f.retention==='durable'?' selected':'')+'>Kept until the person asks for it to be deleted</option>'+
          '</select></div>'
        : '<p class="text-size-small text-color-muted">Kept. Nothing in it is about a person.</p>')+
      '<div class="row grouped">'+
        '<button type="button" class="button is-quiet is-small" data-act="up"'+(i===0?' disabled':'')+'>Move up</button>'+
        '<button type="button" class="button is-quiet is-small" data-act="down"'+(i===lsFields.length-1?' disabled':'')+'>Move down</button>'+
        '<button type="button" class="button is-quiet is-small" data-act="remove">Remove</button>'+
      '</div>'+
    '</div>';
  }).join('');
  drawEmailRule();
}

/* Read what is on screen back into lsFields, so moving a question does not
   lose an edit typed into another. */
function readFields(){
  document.querySelectorAll('#ls-fields .ls-field').forEach(function(row){
    var f=lsFields[Number(row.getAttribute('data-i'))];
    if(!f) return;
    row.querySelectorAll('[data-k]').forEach(function(c){
      var k=c.getAttribute('data-k');
      if(k==='required'||k==='aggregatable') f[k]=c.checked;
      else if(k==='options'){
        var list=c.value.split('\n').map(function(s){ return s.trim(); }).filter(Boolean);
        f.options={ options:list, allowOther:Boolean(f.options&&f.options.allowOther) };
      }
      else if(k==='maxValues') f.maxValues=Number(c.value)||1;
      else f[k]=c.value;
    });
  });
}

function wireFields(){
  el('ls-fields').addEventListener('click', function(e){
    var b=e.target.closest&&e.target.closest('[data-act]');
    if(!b) return;
    readFields();
    var i=Number(b.closest('.ls-field').getAttribute('data-i'));
    var act=b.getAttribute('data-act');
    if(act==='up'&&i>0){ var t=lsFields[i-1]; lsFields[i-1]=lsFields[i]; lsFields[i]=t; }
    if(act==='down'&&i<lsFields.length-1){ var u=lsFields[i+1]; lsFields[i+1]=lsFields[i]; lsFields[i]=u; }
    if(act==='remove') lsFields.splice(i,1);
    drawFields();
    say('ls-fields-msg','Not saved yet.');
  });
  el('ls-fields').addEventListener('change', function(){ readFields(); drawEmailRule(); say('ls-fields-msg','Not saved yet.'); });
  el('ls-add').addEventListener('click', function(){
    readFields();
    var kind=el('ls-add-kind').value;
    var label='New question';
    lsFields.push({
      id:null, key:keyFrom(kind, null), kind:kind, label:label, help:'', required:false,
      options: HAS_OPTIONS[kind]?{options:[],allowOther:false}:null,
      maxValues:1, aggregatable:false,
      retention: PERSONAL[kind]?'transient':'durable',
    });
    drawFields();
    say('ls-fields-msg','Not saved yet.');
    var rows=document.querySelectorAll('#ls-fields .ls-field');
    var last=rows[rows.length-1];
    if(last){ var inp=last.querySelector('[data-k="label"]'); if(inp){ inp.focus(); inp.select(); } }
  });
  el('ls-save-fields').addEventListener('click', function(){
    readFields();
    /* A NEW question's key comes from its wording, at the moment it is first
       saved — after that it is fixed, because its answers are filed under
       it. The server keeps an existing question's key whatever is sent. */
    lsFields.forEach(function(f){ if(!f.id) f.key=keyFrom(f.label, f); });
    say('ls-fields-err','');
    api('/api/admin/lists/'+lsOpen.id+'/fields', { method:'PUT', body:{ fields: lsFields } }).then(function(r){
      if(!r.ok){ say('ls-fields-err', r.body.error||'Those questions could not be saved.'); say('ls-fields-msg',''); return; }
      lsOpen=Object.assign({}, lsOpen, r.body);
      lsFields=r.body.fields.map(function(f){ return Object.assign({}, f); });
      drawFields();
      say('ls-fields-msg','Saved.');
      renderLists();
    });
  });
}

function wireSettings(){
  var patch=function(body, msg){
    say('ls-settings-msg','');
    return api('/api/admin/lists/'+lsOpen.id, { method:'PATCH', body:body }).then(function(r){
      if(!r.ok){ say('ls-settings-msg', r.body.error||'That did not save.'); return; }
      lsOpen=Object.assign({}, lsOpen, r.body);
      drawList();
      say('ls-settings-msg', msg+(r.body.confirmSent===true ? ' A link was emailed to the new address.'
        : r.body.confirmSent===false ? ' The link to the new address could not be emailed — check this site\u2019s email settings.' : ''));
      renderLists();
    });
  };
  el('ls-save-settings').addEventListener('click', function(){
    var body={
      visibility: el('ls-visibility').value,
      title: el('ls-title').value,
      blurb: el('ls-blurb').value,
      aggregatesPublished: el('ls-publish').checked,
      outsideAccess: el('ls-outside').value,
      emailMode: el('ls-email-mode').value,
      notify: el('ls-notify').checked,
    };
    /* Only when it changed: re-sending the same pending address would mail
       its owner a second link for nothing. */
    var want=el('ls-notify-email').value.trim().toLowerCase();
    var had=(lsOpen.notifyPendingEmail||lsOpen.notifyEmail||'').toLowerCase();
    if(want!==had) body.notifyEmail=want;
    patch(body, 'Saved.');
  });
  el('ls-close').addEventListener('click', function(){ patch({ closed:true }, 'It has stopped taking entries.'); });
  el('ls-open').addEventListener('click', function(){ patch({ closed:false }, 'It is taking entries again.'); });
  el('ls-delete').addEventListener('click', function(){
    if(!window.confirm('Delete '+lsOpen.title+'? This cannot be undone.')) return;
    api('/api/admin/lists/'+lsOpen.id, { method:'DELETE' }).then(function(r){
      if(!r.ok){ say('ls-settings-msg', r.body.error||'It could not be deleted.'); return; }
      lsOpen=null;
      showPanels(false);
      renderLists();
    });
  });
  el('ls-edit-back').addEventListener('click', function(){ showPanels(false); renderLists(); });
}

function drawCounts(s){
  var box=el('ls-counts');
  if(!s){ box.innerHTML=''; return; }
  var t=s.totals;
  var html='<p class="text-size-small"><b>'+t.received+'</b> received &middot; <b>'+t.approved+'</b> approved &middot; '+
    t.rejected+' rejected'+(t.lastEntry?(' &middot; last one '+esc(new Date(t.lastEntry).toLocaleString())):'')+'</p>';
  if(!s.fields.length){
    html+='<p class="text-size-small text-color-muted">No question is ticked countable, so there is nothing to break down.</p>';
  }
  s.fields.forEach(function(f){
    html+='<p class="text-size-small margin-top margin-tiny"><b>'+esc(f.label)+'</b></p>';
    if(!f.values.length){ html+='<p class="text-size-small text-color-muted">No answers yet.</p>'; return; }
    html+='<table class="ls-counts"><thead><tr><th>Answer</th><th>Received</th><th>Approved</th></tr></thead><tbody>'+
      f.values.map(function(v){
        return '<tr><td>'+esc(v.value)+'</td><td>'+v.received+'</td><td>'+v.approved+'</td></tr>';
      }).join('')+'</tbody></table>';
  });
  box.innerHTML=html;
}

function wireLists(){
  if(!el('panel-lists')) return;
  wireCreate();
  wireFields();
  wireSettings();
  el('ls-list').addEventListener('click', function(e){
    var t=e.target.closest&&e.target.closest('[data-ls-open]');
    if(t) openList(t.getAttribute('data-ls-open'));
  });
}
wireLists();

export {
  renderLists,
};
