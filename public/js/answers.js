/* answers.js — A report's answers as a person reads them, and the HTML
 * escaper every render goes through.
 *
 * Lifted out of the one <script> public/index.html used to carry, in the
 * order it was in. docs/frontend-files.md has the whole map.
 */

/* ---------- a logbook's questions, for drawing its reports ----------
   A report row carries its answers under their keys, not the questions. The
   words live on the logbook, and a launched logbook's words never change, so
   they are fetched once per logbook and kept for the rest of the visit. Every
   surface that draws reports — the board, a permalink, My Reports, the
   moderator queue — asks for the logbooks its rows name before drawing. */
var LB_QCACHE={};
function questionsFor(rows){
  var want={};
  (rows||[]).forEach(function(r){
    var s=r&&r.logbook_slug;
    if(s&&!LB_QCACHE[s]) want[s]=true;
  });
  return Promise.all(Object.keys(want).map(function(slug){
    return fetch('/api/logbooks/'+encodeURIComponent(slug))
      .then(function(r){ return r.ok?r.json():null; })
      .then(function(l){ LB_QCACHE[slug]=(l&&Array.isArray(l.fields))?l:{fields:[]}; })
      .catch(function(){ LB_QCACHE[slug]={fields:[]}; });
  })).then(function(){ return rows; });
}
/* One sealed answer as a person reads it. */
function answerText(v){
  if(Array.isArray(v)) return v.join(', ');
  if(v===true) return 'Yes';
  if(v===false) return 'No';
  return String(v);
}
/* A report's answers, in its logbook's order, under the words of each
   question. A key with no question to name it is shown under the key turned
   back into words rather than dropped — there should be none, because a
   launched logbook's questions are never removed. */
function answersHtml(r){
  var answers=(r.answers&&typeof r.answers==='object'&&!Array.isArray(r.answers))?r.answers:{};
  var q=(LB_QCACHE[r.logbook_slug]||{}).fields||[];
  var seen={};
  var rows=[];
  q.forEach(function(f){
    if(answers[f.key]===undefined) return;
    seen[f.key]=true;
    rows.push({label:f.label,value:answerText(answers[f.key]),long:f.kind==='long_text'});
  });
  Object.keys(answers).forEach(function(k){
    if(seen[k]) return;
    var t=String(k).replace(/_/g,' ');
    rows.push({label:t.charAt(0).toUpperCase()+t.slice(1),value:answerText(answers[k])});
  });
  if(!rows.length) return '<div class="answers"><span class="form_help">No answers recorded.</span></div>';
  return '<div class="answers">'+rows.map(function(x){
    return x.long
      ? '<div class="txt"><b>'+esc(x.label)+'</b><br>'+esc(x.value)+'</div>'
      : '<span class="ans"><b>'+esc(x.label)+'</b> '+esc(x.value)+'</span>';
  }).join('')+'</div>';
}
/* A logbook's questions as plain controls inside a dialog — the correction
   dialog and a coordinator's entry — filled in with `answers` when given.
   Not the reporter's one-question cards: a dialog is laid out as a whole.
   Returns a function that reads the answers back, in the shape the server
   takes, with an unanswered question left out rather than sent empty. */
function qBuild(box,fields,prefix,answers){
  answers=answers||{};
  box.innerHTML='';
  var getters={};
  fields.forEach(function(f,n){
    var id=prefix+'-'+f.key;
    var opts=(f.settings&&Array.isArray(f.settings.options))?f.settings.options:[];
    var have=answers[f.key];
    var wrap=document.createElement('div'); wrap.className='modal_field';
    var lab=document.createElement('label'); lab.className='form_label'; lab.setAttribute('for',id);
    lab.textContent=f.label;
    if(!f.required){ var o=document.createElement('span'); o.className='opt-req'; o.textContent=' optional'; lab.appendChild(o); }
    wrap.appendChild(lab);
    if(f.help){ var h=document.createElement('span'); h.className='form_help'; h.textContent=f.help; wrap.appendChild(h); }
    var el;
    if(f.kind==='choice_many'){
      el=document.createElement('div'); el.className='cxcats'; el.id=id;
      opts.forEach(function(opt,i){
        var l=document.createElement('label'); l.className='cxcat';
        var cb=document.createElement('input'); cb.type='checkbox'; cb.value=opt;
        cb.checked=Array.isArray(have)&&have.indexOf(opt)>=0;
        var sp=document.createElement('span'); sp.textContent=opt;
        l.appendChild(cb); l.appendChild(sp); el.appendChild(l);
      });
      getters[f.key]=function(){
        return [].slice.call(el.querySelectorAll('input:checked')).map(function(c){ return c.value; });
      };
    } else if(f.kind==='choice_one'||isBoolKind(f.kind)||(f.kind==='place'&&opts.length&&!(f.settings||{}).allowOther)){
      el=document.createElement('select'); el.id=id; el.className='form_select';
      var list=isBoolKind(f.kind)?[['yes','Yes'],['no','No']]:opts.map(function(x){ return [x,x]; });
      el.appendChild(new Option('Choose one',''));
      list.forEach(function(x){ el.appendChild(new Option(x[1],x[0])); });
      el.value=isBoolKind(f.kind)?(have===true?'yes':(have===false?'no':'')):(have||'');
      getters[f.key]=function(){ return el.value; };
    } else if(f.kind==='long_text'){
      el=document.createElement('textarea'); el.id=id; el.className='form_textarea'; el.value=have||'';
      getters[f.key]=function(){ return el.value; };
    } else {
      var types={date:'date',time:'time',datetime:'datetime-local',number:'number',email:'email',url:'url'};
      el=document.createElement('input'); el.type=types[f.kind]||'text'; el.id=id; el.className='form_input';
      if(f.kind==='datetime'&&have){
        var d=new Date(have);
        if(!isNaN(d.getTime())){
          var pad=function(v){ return String(v).padStart(2,'0'); };
          el.value=d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes());
        }
        getters[f.key]=function(){ return el.value?new Date(el.value).toISOString():''; };
      } else {
        el.value=(have===undefined||have===null)?'':String(have).slice(0,f.kind==='time'?5:undefined);
        getters[f.key]=function(){ return el.value; };
      }
    }
    wrap.appendChild(el);
    box.appendChild(wrap);
  });
  return function(){
    var out={};
    Object.keys(getters).forEach(function(k){
      var v=getters[k]();
      if(v===undefined||v===null||v===''||(Array.isArray(v)&&!v.length)) return;
      out[k]=v;
    });
    return out;
  };
}

/* When a report arrived, on its card. There is no built-in "when it
   happened": that is a question a logbook asks, and its answer is with the
   others. */
function whenText(r){
  var d=String(r.received_at||'').slice(0,10);
  return d?('Filed '+d):'';
}

function esc(s){return (s||'').replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}

/* THE QUESTIONS THAT SEAL A BOOLEAN, named once.

   A plain yes/no and the evidence declaration store the same thing, so
   every control that draws one draws the other: the correction editor's
   select, the board's filter and the form's own tiles. Three `||` chains
   is three places for the second kind to be forgotten in, and the one that
   gets forgotten shows an operator a filter that silently matches nothing. */
function isBoolKind(kind){
  return kind === 'yes_no' || kind === 'evidence_declaration';
}

export {
  LB_QCACHE, answerText, answersHtml, esc, isBoolKind, qBuild, questionsFor, whenText,
};
