/* board.js — The public board: a report card wherever it is drawn, the
 * filter popovers, and printing under section 1746.
 *
 * Lifted out of the one <script> public/index.html used to carry, in the
 * order it was in. docs/frontend-files.md has the whole map.
 */

import {
  LB_QCACHE, answerText, answersHtml, esc, isBoolKind, questionsFor, whenText,
} from './answers.js';
import { applyNavCounts, setReportCount } from './session.js';
import { SITE_TITLE } from './identity.js';

/* ---------- shared report card rendering ---------- */
// Two axes, not one. Hue separates "somebody should look at this now"
// (crimson) from everything else; fill and weight separate the rest. That
// is what keeps these apart in greyscale and under every kind of colour
// blindness — and it is why adding a fourth hue for a fourth level would
// make the set harder to read, not easier.
// Class names, not colours: a style attribute in markup this script writes is
// exactly what `style-src-attr` refuses. The colours are in panels.css.
var sevColor={note:'tone-note',irregularity:'tone-ink',serious:'tone-crimson',systemic:'tone-crimson'};
var SEV_LABELS={note:'note',irregularity:'irregularity',serious:'serious',systemic:'systemic'};
// A report nobody has rated has no severity at all. It reads as muted, so
// it can never be mistaken for a moderator having decided it was minor.
var SEV_UNRATED_COLOR='tone-note';
var SEV_UNRATED_LABEL='not yet assessed';
// Mirrors INTAKE_METHOD_LABELS in src/taxonomy.js.
var INTAKE_LABELS={paper:'From a paper form',phone:'From a phone call',
  in_person:'Taken in person',email:'From an email or message',other:'Collected another way'};
function sevTone(v){ return sevColor[v]||SEV_UNRATED_COLOR; }
function sevLabel(v){ return v?(SEV_LABELS[v]||v):SEV_UNRATED_LABEL; }

/* THE VERACITY CHIP IS GONE, and this is the screen it mattered most on. A
   card reading "Likely true" over an account that names somebody by role,
   place and time was this archive asserting a fact about that person in two
   words, in a coloured badge, to the public. src/taxonomy.js has the
   reasoning; an editorial note replaces it.

   The labels are kept for ONE caller — the figures table in moderate.js,
   which renders the frozen by_veracity breakdown /api/v1/stats still
   publishes to honour its stability promise. Nothing else may use them. */
var VERACITY_LABELS={pending:'Pending review',proven_false:'Proven false',
  likely_false:'Likely false',undetermined:'Reviewed — undetermined',
  likely_true:'Likely true',proven_true:'Proven true'};
function corroborationLabel(n){
  return (n && n > 1) ? (n+' independent accounts') : 'Single account';
}
// What a reader needs to weigh an account beyond its answers: how many
// independent accounts exist, and where it came through if a coordinator
// filed it. NOT what we think is true — that verdict is withdrawn, and this
// is where it used to be printed.
function provenanceHtml(r){
  var bits=[];
  if(r.corroboration_count!==undefined){
    var n=r.corroboration_count;
    var cc=(n>1)?'tone-verify':'tone-muted';
    bits.push('<span class="pv '+cc+'">'+esc(corroborationLabel(n))+'</span>');
  }
  // Where an account came through, when it did not come from the person it
  // happened to. The organization is named; the individual who typed it in
  // is not, and never is.
  if(r.third_party && r.filed_via){
    bits.push('<span class="pv strong">'+esc('Filed via '+r.filed_via)+'</span>');
    if(r.intake_method) bits.push('<span class="pv">'+esc(INTAKE_LABELS[r.intake_method]||r.intake_method)+'</span>');
  }
  return bits.length?('<div class="prov">'+bits.join('')+'</div>'):'';
}
// Says what was submitted AND what survived review. "3 photos, 1 published"
// is more honest than either number on its own, and matches the same
// commitment the public numbers page already makes about what's withheld.
function attachmentLabel(r){
  var n=r.attachment_count||0, p=r.attachment_published_count||0;
  if(!n) return '';
  if(p===n) return plural(n,'photo');
  if(!p) return plural(n,'photo')+', under review';
  return plural(n,'photo')+', '+p+' published';
}
function reportCardHtml(r, opts){
  opts = opts || {};
  var when=whenText(r);
  var actions=[];
  if(opts.print) actions.push('<button data-print="'+esc(r.id)+'">Print / sign PDF</button>');
  if(opts.restrict) actions.push('<button data-restrict="'+esc(r.id)+'">View restricted info</button>');
  if(opts.review){
    actions.push('<button data-status="valid" data-thread="'+esc(r.thread_id||'')+'">Mark Valid</button>');
    actions.push('<button data-status="unknown" data-thread="'+esc(r.thread_id||'')+'">Mark Unknown</button>');
    actions.push('<button data-status="invalid" data-thread="'+esc(r.thread_id||'')+'">Mark Invalid</button>');
  }
  if(opts.review){
    actions.push('<button data-severity="'+esc(r.thread_id||'')+'">Set severity</button>');
    /* Only where the logbook uses notes. An operator who turned the feature
       off should not have the control in front of their moderators, and a
       button whose route answers 409 is worse than no button. */
    if(r.editorial_notes_enabled){
      actions.push('<button data-note="'+esc(r.thread_id||'')+'">'+
        (r.editorial_note?'Revise the note':'Write a note')+'</button>');
    }
    actions.push('<button data-incident="'+esc(r.thread_id||'')+'">Link corroboration</button>');
    /* "I have read it" is NOT the same press as "this may be published".
       A flag that cleared itself on Publish would make the queue a record
       of what was published rather than of what was read. */
    if(r.needs_review){
      actions.push('<button data-reviewed="'+esc(r.thread_id||'')+'">I have read this</button>');
    }
    /* ASKING FOR THE EVIDENCE THEY SAID THEY HAD. Offered only where both
       halves are true — the report declared something AND the reporter
       permits being asked — because a button whose route answers 409 is
       worse than no button, and the permission is theirs to give. */
    if(r.evidence_askable){
      actions.push('<button data-askevidence="'+esc(r.thread_id||'')+'">'+
        (r.evidence_open?'Withdraw the request':'Ask for the evidence')+'</button>');
    }
  }
  if(opts.staffWithdraw && !r.withdrawn) actions.push('<button data-staffwithdraw="'+esc(r.thread_id||'')+'">Withdraw</button>');
  if(opts.restore) actions.push('<button data-restore="'+esc(r.thread_id||'')+'">Restore</button>');
  if(r.attachment_published_count) actions.push('<button data-media="'+esc(r.id)+'">'+(opts.review?'View published photos':'View photos')+'</button>');
  if(opts.review && r.attachment_count) actions.push('<button data-modmedia="'+esc(r.id)+'">Review photos ('+r.attachment_count+')</button>');
  if(opts.correct) actions.push('<button data-correct="'+esc(r.thread_id)+'">File a correction</button>');
  if(opts.selfWithdraw && !r.withdrawn) actions.push('<button data-withdraw="'+esc(r.thread_id)+'">Withdraw</button>');
  if(opts.selfWithdraw && r.erasable) actions.push('<button data-erase="'+esc(r.thread_id)+'">Erase my details</button>');
  // The stripe on the leading edge repeats what the chips already say, so
  // state is readable while scanning a long list. It never carries the
  // meaning on its own — the chip says it in words either way.
  var stripe = (r.severity==='serious'||r.severity==='systemic') ? ' is-serious'
    : (r.moderation_status==='valid' ? ' is-confirmed'
    : (r.severity ? ' is-review' : ''));
  return '<div class="rcard'+stripe+'">'+
    '<div class="top">'+
      (r.logbook_title?'<span class="cat">'+esc(r.logbook_title)+'</span>':'')+
      '<span class="sev '+sevTone(r.severity)+'">'+esc(sevLabel(r.severity))+'</span>'+
      (r.moderation_status?'<span class="sev">'+esc(r.moderation_status)+'</span>':'')+
      (r.withdrawn?'<span class="sev">withdrawn</span>':'')+
      '<span class="when">'+esc(when)+'</span>'+
    '</div>'+
    answersHtml(r)+
    reviewFlagHtml(r, opts)+
    evidenceHtml(r, opts)+
    editorialNoteHtml(r)+
    provenanceHtml(r)+
    '<div class="meta">'+esc(r.id)+
      (r.attachment_count?' · '+attachmentLabel(r):'')+'</div>'+
    (opts.permissions?permissionsHtml(r):'')+
    (actions.length?'<div class="actions">'+actions.join('')+'</div>':'')+
    (opts.restrict?'<div class="restricted" id="restricted-'+esc(r.id)+'"></div>':'')+
    (r.attachment_count&&opts.review?'<div class="attmod" id="attmod-'+esc(r.id)+'"></div>':'')+
    (r.attachment_published_count?'<div id="media-'+esc(r.id)+'"></div>':'')+
  '</div>';
}

/* WHAT THIS REPORT SAID IT HAD, and where asking for it stands.

   STAFF ONLY. A reader has no business knowing that somebody holds footage
   they have not sent — that is a fact about a person, not about the report,
   and publishing it would put a target on them.

   THE TWO HALVES ARE REPORTED SEPARATELY because they come from two places
   and a moderator needs to know which one is missing: the declaration is
   sealed into the report and will never change, the permission is the
   reporter's and can be taken back at any moment. "Cannot ask" is not an
   answer somebody can act on; "they have not agreed to be asked" is. */
function evidenceHtml(r, opts){
  if(!(opts && opts.review)) return '';
  if(!r.evidence_declared && !r.evidence_open) return '';
  var lines=[];
  if(r.evidence_declared){
    lines.push('<p>This report <b>said it had</b> photos, video, audio or documents. '
      +'Nothing was uploaded — that answer is sealed into the record and is not a file.</p>');
    (r.evidence_described||[]).forEach(function(d){
      lines.push('<p><b>'+esc(d.label)+'</b> — '+esc(d.value)+'</p>');
    });
  }
  if(r.evidence_open){
    var until=r.evidence_open.expires_at
      ? new Date(r.evidence_open.expires_at).toLocaleDateString() : '';
    lines.push('<p><b>A request is open.</b> '+esc(r.evidence_open.asked_by||'Somebody')
      +' asked on '+esc(new Date(r.evidence_open.asked_at).toLocaleDateString())+''
      +(until?(', and the link stops working on '+esc(until)):'')+'.</p>');
  } else if(r.evidence_declared && !r.evidence_permitted){
    lines.push('<p>They have <b>not agreed to be asked</b> for it, or have taken that '
      +'back. Only they can give that, from their own page — there is no route '
      +'here that grants it on their behalf.</p>');
  }
  return '<div class="rflag"><div class="rflag_by">Evidence</div>'+lines.join('')+'</div>';
}

/* A SECOND READ ASKED FOR, and the words that asked.

   STAFF ONLY. Never rendered on the public board — a reader seeing "this
   report mentions a weapon" would read it as a finding about the report,
   which is precisely what a flag is not. It is offered where the flag is
   acted on and nowhere else.

   THE TERMS, not a count. A moderator who can see that something fired but
   not WHAT fired has to repeat the triage from scratch, which is most of
   the work the flag was supposed to save. It is also how an operator
   notices a term firing on half of what arrives and goes and cuts it.

   AND IT SAYS WHAT IT IS NOT, on the card, every time. A marker that only
   says "flagged" gets read as a severity within a week. */
function reviewFlagHtml(r, opts){
  if(!r.needs_review || !(opts && opts.review)) return '';
  var terms=(r.review_terms||[]).map(function(t){
    return '<span class="pv">'+esc(t)+'</span>';
  }).join('');
  return '<div class="rflag">'+
    '<div class="rflag_by">Flagged for a second read</div>'+
    '<p>Something in the words of this report matches the list under '+
    '<b>Reports</b> in the settings. That is all this means — not a '+
    'severity, not a finding, and nothing about anybody named here.</p>'+
    (terms?'<div class="prov">'+terms+'</div>':'')+
  '</div>';
}

/* THE ARCHIVE'S OWN STATEMENT, where it made one.

   SET APART FROM THE ANSWERS, visibly, because it is not the reporter's
   account and must never read as part of it. The reporter said what they
   saw; this is what the archive established, checked or could not establish,
   and conflating the two would put words in somebody's mouth.

   UNDER A HOUSE BYLINE. No author is served to the public — the server does
   not select the column — so there is nothing here to print even by
   accident.

   AND A REVISION SAYS SO. A note silently on its third version is the
   archive editing its own published statement without admitting it. */
function editorialNoteHtml(r){
  var n=r.editorial_note;
  if(!n) return '';
  if(n.state&&n.state!=='published'){
    /* The note is marked rather than missing. Silent removal is the thing
       this archive exists to prevent, and that applies to our own material:
       a reader must be able to see that something was said and then held. */
    return '<div class="enote is-held">'+
      '<div class="enote_by">Editorial note</div>'+
      '<p>'+esc(n.notice||'This note is not currently published.')+'</p></div>';
  }
  var links=(r.editorial_links||[]).map(function(l){
    return '<li><a href="'+esc(l.url)+'" rel="noopener noreferrer nofollow" target="_blank">'+
      esc(l.title)+'</a>'+(l.publisher?' &middot; '+esc(l.publisher):'')+'</li>';
  }).join('');
  return '<div class="enote">'+
    '<div class="enote_by">Editorial note'+
      (n.revised?' <span class="enote_rev">revised</span>':'')+'</div>'+
    '<p>'+esc(n.body||'').replace(/\n{2,}/g,'</p><p>').replace(/\n/g,'<br>')+'</p>'+
    (links?'<ul class="enote_links">'+links+'</ul>':'')+
  '</div>';
}

/* ---------- the two permissions a reporter can take back ----------
   Drawn in My Reports only, because only the reporter may change them: a
   moderator granting one on somebody's behalf would record the operator's
   decision under the reporter's name.

   NOT the publication answer given at filing. That one is sealed into the
   report and cannot be changed by anybody, which is why it is stated here as
   a fact and not offered as a control. These two sit under it and are
   ongoing. */
function permissionsHtml(r){
  var p = r.permissions || {};
  var t = r.thread_id;
  function row(key, label, help){
    var id = 'perm-'+key+'-'+esc(t);
    return '<label class="choice_item" for="'+id+'">'+
      '<input class="choice_input" type="checkbox" id="'+id+'" data-perm="'+key+'" data-perm-thread="'+esc(t)+'"'+
        (p[key]?' checked':'')+'>'+
      '<span class="choice_text"><span class="choice_title">'+esc(label)+'</span><span class="choice_note">'+esc(help)+'</span></span>'+
    '</label>';
  }
  return '<div class="perms">'+
    '<div class="form_help">'+(r.may_publish===true
      ? 'You said at filing that this report may be published. That answer is sealed into the record and cannot be changed here.'
      : (r.may_publish===false
        ? 'You said at filing that this report may not be published. That answer is sealed into the record and cannot be changed here.'
        : 'You were not asked at filing whether this report may be published.'))+'</div>'+
    row('contact_passing', 'Somebody may be given my contact details to follow up',
        'Only if a moderator judges the request genuine. You can switch this off at any time.')+
    row('attachment_publication', 'The files I attached may be published',
        'Separate from the report itself. Switching this off takes any published file back down.')+
    /* THE THIRD GRANT, and the one that is not about what is already here.
       Offered on every report rather than only where a logbook asked the
       declaration: somebody who did not say they had anything at filing may
       still have found something since, and a permission they cannot give
       is a permission nobody can act on. */
    row('evidence_request', 'A moderator may ask me for photos, video or documents',
        'Only an invitation to be asked. Nothing is uploaded now, you can say no '
        + 'to any request, and switching this off stops them asking at all.')+
    '<div class="formstatus" id="perm-status-'+esc(t)+'"></div>'+
  '</div>';
}

/* ---------- live report board (public) ---------- */
/* ---------- shared filter-popover plumbing ---------- */
// Filters live in a popover, so an active one is invisible until you open
// it. The button carries a count of what's currently narrowing the view,
// which is the whole reason a hidden filter is safe to use here.
function countActive(f,defaults){
  var n=0;
  Object.keys(defaults).forEach(function(k){ if(String(f[k]||'')!==String(defaults[k]||'')) n++; });
  return n;
}
function updateFilterBtn(id,n){
  var b=document.getElementById(id);
  b.innerHTML='Filter'+(n?'<span class="fcount">'+n+'</span>':'');
  b.classList.toggle('active',n>0);
}
function plural(n,word){ return n+' '+word+(n===1?'':'s'); }

var DASH_DEFAULTS={severity:'',sort:'newest',logbook:''};
var dashF={severity:'',sort:'newest',logbook:''};
/* key -> value, one per filterable question of the chosen logbook. Kept
   apart from dashF because which keys exist depends on which logbook is
   chosen, and countActive compares against a fixed set of defaults. */
var dashAnswers={};
/* The logbook catalogue, fetched once. Empty on a deployment with none,
   and the whole control stays hidden. */
var DASH_LOGBOOKS=[];

/* PREFILTERING FROM A LINK.
 *
 * The board has built a querystring for its own API since it was written,
 * and never read one — so a filtered board was something you could reach by
 * clicking but not by sharing. `/board?logbook=polling&a.where=US-CA` now
 * opens narrowed, which is what makes a heat map's "show these reports"
 * link work and what lets an operator put a prepared view in a newsletter.
 *
 * ONLY THE FILTERS THE BOARD ALREADY HAS, and this is the whole security
 * of it: every key below is one a reader can already set from the panel, so
 * a link can reach no state a reader could not reach by clicking. There is
 * deliberately no key for a date range, a location or anything else the
 * board does not offer — nothing is filterable unless an operator said so,
 * and a query parameter is not an operator.
 *
 * VALUES ARE CHECKED AGAINST THE PAGE'S OWN OPTIONS rather than a list
 * written here, because a list written here is a second copy of the
 * vocabulary that drifts the first time somebody adds a sort order. A value
 * that is not an option is dropped, not corrected: silently filtering by
 * something adjacent to what a link asked for is worse than ignoring it.
 */
var dashSeeded=false;
function optionExists(id,value){
  var sel=document.getElementById(id);
  if(!sel) return false;
  return Array.prototype.some.call(sel.options,function(o){ return o.value===value; });
}
function seedDashFromUrl(){
  if(dashSeeded) return;
  dashSeeded=true;
  var url=new URLSearchParams(window.location.search);
  if(!url.toString()) return;

  var q=url.get('q');
  // renderDash reads the box rather than a variable, so the box IS the state.
  if(q) document.getElementById('f-q').value=q.slice(0,200);

  var sev=url.get('severity');
  if(sev&&optionExists('f-sev',sev)) dashF.severity=sev;
  var sort=url.get('sort');
  if(sort&&optionExists('f-sort',sort)) dashF.sort=sort;

  /* The logbook list is fetched, so at this moment the select may hold
     nothing to check against — hence a shape check for this one. A slug
     that does not exist narrows the board to nothing and says "no reports",
     which is the same answer a real-but-empty logbook gives, and is
     honest. */
  var lb=url.get('logbook');
  if(lb&&/^[a-z0-9][a-z0-9-]{0,62}$/.test(lb)) dashF.logbook=lb;

  url.forEach(function(v,k){
    if(k.indexOf('a.')!==0||!v) return;
    var key=k.slice(2);
    // The same shape a question's key is minted with. An answer filter on a
    // question that does not exist is simply a filter nothing matches.
    if(/^[a-z][a-z0-9_]{0,62}$/.test(key)) dashAnswers[key]=String(v).slice(0,200);
  });
}

function renderDash(){
  seedDashFromUrl();
  var qs=new URLSearchParams();
  var dq=document.getElementById('f-q').value.trim();
  if(dq) qs.set('q', dq);
  if(dashF.severity) qs.set('severity', dashF.severity);
  if(dashF.sort!=='newest') qs.set('sort', dashF.sort);
  if(dashF.logbook) qs.set('logbook', dashF.logbook);
  Object.keys(dashAnswers).forEach(function(k){
    if(dashAnswers[k]) qs.set('a.'+k, dashAnswers[k]);
  });
  // CSV export keeps sharing the filter clause server-side, so a download
  // is always exactly what's on screen — search and dates included.
  document.getElementById('csv-link').href='/api/reports/export.csv?'+qs.toString();
  updateFilterBtn('dash-filter-btn',
    countActive(dashF,DASH_DEFAULTS)+
    Object.keys(dashAnswers).filter(function(k){ return dashAnswers[k]; }).length);
  fetch('/api/reports?'+qs.toString()).then(function(r){ return r.json(); })
  .then(questionsFor).then(function(list){
    setReportCount(list.length);
    applyNavCounts();
    var books=new Set(list.map(function(r){ return r.logbook_slug; })).size;
    var serious=list.filter(function(r){return r.severity==='serious'||r.severity==='systemic'}).length;
    document.getElementById('dash-summary').textContent=
      plural(list.length,'report')+' · '+plural(books,'logbook')+' · '+serious+' serious+';

    var box=document.getElementById('list');
    if(!list.length){
      box.innerHTML='<div class="empty_component">'+
        ((dq||countActive(dashF,DASH_DEFAULTS)
          ||Object.keys(dashAnswers).some(function(k){ return dashAnswers[k]; }))
          ?'No reports match that.':'No reports yet.')+'</div>';
      return;
    }
    box.innerHTML=list.map(function(r){ return reportCardHtml(r,{}); }).join('');
  });
}
var dashSearchTimer=null;
document.getElementById('f-q').addEventListener('input',function(){
  clearTimeout(dashSearchTimer);
  dashSearchTimer=setTimeout(renderDash,300);
});
document.getElementById('dash-filter-btn').addEventListener('click',function(){
  document.getElementById('f-logbook').value=dashF.logbook;
  dashRenderAnswerFilters();
  document.getElementById('f-sev').value=dashF.severity;
  document.getElementById('f-sort').value=dashF.sort;
  document.getElementById('ovl-dashfilter').classList.add('on');
});
document.getElementById('dashf-cancel').addEventListener('click',function(){
  document.getElementById('ovl-dashfilter').classList.remove('on');
});
document.getElementById('dashf-clear').addEventListener('click',function(){
  dashF={severity:'',sort:'newest',logbook:''};
  // Clear all means all of them. A generated filter left behind would keep
  // narrowing the board from a panel that says nothing is narrowing it.
  dashAnswers={};
  document.getElementById('f-logbook').value='';
  document.getElementById('f-answers').innerHTML='';
  document.getElementById('ovl-dashfilter').classList.remove('on');
  renderDash();
});
document.getElementById('dashf-go').addEventListener('click',function(){
  dashF={
    severity:document.getElementById('f-sev').value,
    sort:document.getElementById('f-sort').value,
    logbook:document.getElementById('f-logbook').value
  };
  dashAnswers={};
  document.querySelectorAll('#f-answers [data-answer-key]').forEach(function(el){
    var v=(el.value||'').trim();
    if(v) dashAnswers[el.getAttribute('data-answer-key')]=v;
  });
  document.getElementById('ovl-dashfilter').classList.remove('on');
  renderDash();
});

/**
 * The generated filters: one control per question the operator marked
 * filterable on the chosen logbook.
 *
 * NOTHING IS FILTERABLE UNLESS SOMEBODY SAID SO, and there is no built-in
 * date or location filter to fall back on. That is the whole design: a
 * deployment gets the filters it asked for rather than the ones this
 * software guessed it would want.
 */
function dashRenderAnswerFilters(){
  var box=document.getElementById('f-answers');
  if(!box) return;
  var slug=document.getElementById('f-logbook').value;
  // "Any" means there is no one field set to generate from. Clearing rather
  // than leaving the old controls up: a filter for a question the chosen
  // logbook does not ask is a control that can only ever return nothing.
  if(!slug){ box.innerHTML=''; dashAnswers={}; return; }

  fetch('/api/logbooks/'+encodeURIComponent(slug))
    .then(function(r){ return r.json(); })
    .then(function(l){
      var fields=(l&&Array.isArray(l.filters))?l.filters:[];
      if(!fields.length){
        box.innerHTML='<p class="form_help">This logbook has no questions marked '+
          'as filters, so there is nothing to narrow it by here. Search still '+
          'reads what it was answered.</p>';
        return;
      }
      box.innerHTML=fields.map(function(f){
        var id='f-ans-'+f.key;
        var opts=(f.settings&&Array.isArray(f.settings.options))?f.settings.options:[];
        var control;
        if(isBoolKind(f.kind)){
          control='<select class="form_select" id="'+esc(id)+'" data-answer-key="'+esc(f.key)+'">'+
            '<option value="">Any</option><option value="true">Yes</option>'+
            '<option value="false">No</option></select>';
        } else if(f.kind==='location'&&f.places){
          /* A PICKER WITH NAMES OVER CODES. The sealed answer is `US-AZ`,
             which is what the filter has to send — but a text box asking a
             reader to type a code is a filter nobody can use, and a select
             of raw codes is barely better. The list arrives with the
             question, so this is the same list the form offered. */
          var pl=f.places;
          var place=function(p){
            return '<option value="'+esc(p.code)+'">'+esc(p.name)+'</option>';
          };
          control='<select class="form_select" id="'+esc(id)+'" data-answer-key="'+esc(f.key)+'">'+
            '<option value="">Any</option>'+
            (pl.subdivisions||[]).map(place).join('')+
            (pl.countries||[]).map(place).join('')+
            '</select>';
        } else if(opts.length){
          control='<select class="form_select" id="'+esc(id)+'" data-answer-key="'+esc(f.key)+'">'+
            '<option value="">Any</option>'+
            opts.map(function(o){ return '<option value="'+esc(o)+'">'+esc(o)+'</option>'; }).join('')+
            '</select>';
        } else {
          control='<input class="form_input" type="'+(f.kind==='number'?'number':'text')+'" id="'+esc(id)+'"'+
            ' data-answer-key="'+esc(f.key)+'" placeholder="Any">';
        }
        return '<div class="modal_field"><label class="form_label" for="'+esc(id)+'">'+esc(f.label)+
          '</label>'+control+'</div>';
      }).join('');
      // Put back whatever was applied, so reopening the panel shows what is
      // narrowing the board rather than an empty form.
      Object.keys(dashAnswers).forEach(function(k){
        var el=box.querySelector('[data-answer-key="'+k+'"]');
        if(el) el.value=dashAnswers[k];
      });
    })
    .catch(function(){ box.innerHTML=''; });
}

/** The logbooks this deployment has, for the board's filter. */
function dashLoadLogbooks(){
  var wrap=document.getElementById('f-logbook-wrap');
  if(!wrap) return;
  /* CLOSED ONES TOO. A logbook is closed when its work is finished, and
     that is precisely when somebody wants to read what was filed to it. */
  fetch('/api/logbooks?include=closed').then(function(r){ return r.json(); })
    .then(function(list){
      DASH_LOGBOOKS=Array.isArray(list)?list:[];
      if(!DASH_LOGBOOKS.length) return;   // stays hidden
      var sel=document.getElementById('f-logbook');
      DASH_LOGBOOKS.forEach(function(l){
        var o=document.createElement('option');
        o.value=l.slug;
        // Said on the option rather than left to be discovered: a closed
        // logbook's reports are still here and still readable.
        o.textContent=l.title+(l.state==='closed'?' (closed)':'');
        sel.appendChild(o);
      });
      wrap.hidden=false;
      sel.addEventListener('change',dashRenderAnswerFilters);
    })
    .catch(function(){});
}
dashLoadLogbooks();

/* ---------- print / § 1746 (My Reports only — own submissions) ---------- */
var ovlP=document.getElementById('ovl-print'), curPrintReport=null;
function openPrint(r){ curPrintReport=r; ovlP.classList.add('on'); }
document.getElementById('pf-cancel').addEventListener('click',function(){ ovlP.classList.remove('on'); });
document.getElementById('pf-go').addEventListener('click',function(){
  var r=curPrintReport; if(!r) return;
  var name=document.getElementById('pf-name').value.trim()||'________________________';
  var place=document.getElementById('pf-place').value.trim()||'________________________';
  var loc=(document.querySelector('input[name="pf-loc"]:checked')||{}).value||'in';
  var IN="I declare under penalty of perjury that the foregoing is true and correct.";
  var OUT="I declare under penalty of perjury under the laws of the United States of America that the foregoing is true and correct.";
  var declText=(loc==='out')?OUT:IN;
  var when=whenText(r);
  var today=new Date().toISOString().slice(0,10);
  // Tells the print rules that a specific report is being printed, so the
  // page hides itself behind the statement. Cleared on the way out, or a
  // later attempt to print the blank form would come out empty.
  document.body.classList.add('printing-report');
  document.getElementById('printsheet').innerHTML=
    '<div class="ps-h">'+esc(SITE_TITLE)+' — Witness Statement</div>'+
    '<div class="ps-row"><div class="k">Reference</div><div>'+esc(r.id)+'</div></div>'+
    '<div class="ps-row"><div class="k">Logbook</div><div>'+esc(r.logbook_title||r.logbook_slug||'')+'</div></div>'+
    '<div class="ps-row"><div class="k">Filed</div><div>'+esc(when)+'</div></div>'+
    // The report is its answers, each under the question the reporter read,
    // in the logbook's order.
    ((LB_QCACHE[r.logbook_slug]||{}).fields||[]).filter(function(f){
      return r.answers&&r.answers[f.key]!==undefined;
    }).map(function(f){
      return f.kind==='long_text'
        ? '<div class="ps-row"><div class="k">'+esc(f.label)+'</div><div></div></div>'+
          '<div class="ps-narr">'+esc(answerText(r.answers[f.key]))+'</div>'
        : '<div class="ps-row"><div class="k">'+esc(f.label)+'</div><div>'+esc(answerText(r.answers[f.key]))+'</div></div>';
    }).join('')+
    '<div class="ps-instr"><b>What to do with this document</b><ol>'+
      '<li>Review every detail above for accuracy before signing.</li>'+
      '<li>Sign and date in the space below.</li>'+
      '<li>Keep this document — it is your sworn declaration and may be used as evidence.</li>'+
      '<li>If contacted by legal counsel or a rights organization, provide this document along with your reference number, <b>'+esc(r.id)+'</b>.</li>'+
    '</ol></div>'+
    '<div class="ps-decl">Declaration under 28 U.S.C. § 1746<br><br>'+declText+'<br><br>Executed on: ______________________&nbsp;&nbsp;&nbsp; At: '+esc(place)+'</div>'+
    '<div class="ps-sig"><div>Signature — '+esc(name)+'</div><div>Date</div></div>'+
    '<div class="ps-integrity">This declaration reflects a specific, sealed version of this record (chain hash below), cryptographically chained to every report filed before it in the same logbook. Printed '+esc(today)+'.<br>Chain hash: '+esc(r.chain_hash)+'</div>';
  ovlP.classList.remove('on');
  setTimeout(function(){ window.print(); }, 80);
  // Once the dialog is done with, the page goes back to printing itself.
  window.addEventListener('afterprint',function(){
    document.body.classList.remove('printing-report');
  },{once:true});
});

export {
  VERACITY_LABELS, countActive, editorialNoteHtml, openPrint, plural, renderDash,
  reportCardHtml,
  updateFilterBtn,
};
