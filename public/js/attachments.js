/* attachments.js — Uploading files, the public gallery, and a moderator's
 * review of what was uploaded.
 *
 * Lifted out of the one <script> public/index.html used to carry, in the
 * order it was in. docs/frontend-files.md has the whole map.
 */

import { esc } from './answers.js';
import { REASON_REPORTER_SEES, openReason } from './session.js';

/* ---------- attachments ---------- */
// The whole block is inert unless GET /api/uploads/config answers, which it
// only does when the server has the feature switched on and storage
// configured. Nothing below runs, and the form field stays hidden, otherwise.
var ATT={enabled:false,cfg:null,draft:null,files:[],timer:null};
/* WHICH LOGBOOK IS BEING FILED TO, so the per-logbook caps apply (migration
   037). Module state and not a global: the suite allows exactly two things
   on `window` and this is not one of them. form-logbook.js sets it when a
   logbook is chosen. */
var ATT_LOGBOOK='';
function attSetLogbook(slug){
  ATT_LOGBOOK=slug||'';
  /* Re-read the limits, because they belong to the logbook now. The page
     keeps no copy of a cap of its own, so this is the only thing that has to
     happen when the choice changes. */
  if(ATT.enabled) attLoadConfig();
}

function attClock(sec){
  sec=Number(sec)||0;
  return Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0');
}
function attSize(n){
  n=Number(n)||0;
  return n<1048576 ? (Math.round(n/1024)+' KB') : ((n/1048576).toFixed(1)+' MB');
}

/* The limits are per logbook since migration 037, so the config is re-read
   when a logbook is chosen. One source of truth: the page never keeps its own
   copy of a cap, so a logbook capped at one file says one file on the card
   rather than letting somebody pick four and refusing the second. */
function attConfigUrl(){
  return '/api/uploads/config'+(ATT_LOGBOOK?('?logbook='+encodeURIComponent(ATT_LOGBOOK)):'');
}

/* READ ONLY, and safe to call again. The limits are per logbook now, so this
   runs once at startup and again whenever a logbook is chosen. It binds
   nothing: a listener attached here would bind once per logbook change. */
function attLoadConfig(){
  return fetch(attConfigUrl()).then(function(r){ return r.ok?r.json():null; }).then(function(d){
    if(!d||!d.enabled) return;
    ATT.enabled=true; ATT.cfg=d;
    var vid=d.maxVideoBytes?(' · video up to '+Math.floor(d.maxVideoBytes/1048576)+' MB, '+Math.round(d.maxVideoSeconds/60)+' min'):'';
    /* "1 files max" reads as a bug, and a one-file form is a deliberate
       setting rather than a tight default, so it is said in words. */
    var files=d.maxFiles===1?'one file only':(d.maxFiles+' files max');
    var cap=document.getElementById('attach-cap');
    if(cap) cap.textContent=
      'Photos up to '+Math.floor(d.maxImageBytes/1048576)+' MB'+vid+' · '+files;
  }).catch(function(){});
}

function initAttach(){
  return attLoadConfig().then(function(){
    if(!ATT.enabled) return;
    // Not revealed here: the evidence question decides whether the file
    // box is on screen at all, and showing it now would put it in front of
    // someone who has not said they have a file.
    var clear=document.getElementById('attach-clear-btn');
    if(clear) clear.addEventListener('click',attRemoveAll);
  });
}

function attDraft(){
  if(ATT.draft) return Promise.resolve(ATT.draft);
  return fetch('/api/uploads/draft',{method:'POST'})
    .then(function(r){ return r.json(); })
    .then(function(d){ ATT.draft=d.draft_token; return ATT.draft; });
}

function attErr(msg){
  var e=document.getElementById('attach-err');
  if(!msg){ e.classList.remove('on'); return; }
  e.textContent=msg; e.classList.add('on');
}

// Wording is deliberately about what the reporter needs to know, not what
// the pipeline is doing: "Checking" rather than "queued for clamdscan".
// 'Added' for a file that has arrived and not been looked at, which during
// filing is now every file: nothing is checked until Send is pressed, so
// 'Checking' would have described work that is not happening and left the
// reporter watching a word that never changed. 'pending' is a PUT the
// server was never told finished, so 'Uploading' is the honest word for it.
var ATT_LABEL={uploading:'Uploading',uploaded:'Added',pending:'Uploading',
  processing:'Processing',
  clean:'Ready',infected:'Rejected',unreadable:"Couldn't be read",
  // 'rejected' now means we turned the file away — renaming a PDF to .jpg
  // lands here. It used to also mean "the reporter removed it", which is
  // why the label said 'Removed' and why a real refusal looked like
  // something the reporter had done to themselves.
  rejected:"Not accepted",withdrawn:'Removed',expired:'Expired',failed:'Upload failed'};

/* The address the quota is keyed on. One input, wherever the card engine
   has put it — see lbPlaceContact. Trimmed but not validated here: what
   counts as an address is the server's call, and a second opinion in the
   client is a second thing to keep level with it. */
function attContactEmail(){
  var el=document.getElementById('rEmail');
  return el?el.value.trim():'';
}

function attRender(){
  var ul=document.getElementById('attach-list');
  ul.innerHTML='';
  ATT.files.forEach(function(f){
    var li=document.createElement('li');
    var bad=['infected','unreadable','rejected','expired','failed'];
    var cls=(f.status==='clean')?'ok':(bad.indexOf(f.status)>=0?'bad':'');
    li.innerHTML='<span class="nm">'+esc(f.name)+'</span>'+
      '<span class="sz">'+attSize(f.size)+'</span>'+
      (f.status==='uploading'?'<span class="attbar"><i data-pct="'+(f.pct||0)+'"></i></span>':'')+
      '<span class="stt '+cls+'">'+esc(ATT_LABEL[f.status]||f.status)+
        // Why it was turned away, in the words the worker recorded. The
        // reporter has always been told the outcome; this tells them the
        // reason, which is the part they can act on.
        (cls==='bad'&&f.detail?('<small>'+esc(f.detail)+'</small>'):'')+'</span>';
    var rm=document.createElement('button');
    rm.type='button'; rm.className='rm'; rm.textContent='Remove';
    rm.addEventListener('click',function(){ attRemove(f); });
    li.appendChild(rm);
    ul.appendChild(li);
  });
  // Through the CSSOM: a style attribute in this markup is refused by the policy.
  ul.querySelectorAll('.attbar i').forEach(function(i){ i.style.width=i.getAttribute('data-pct')+'%'; });
  document.getElementById('attach-clear').hidden=!ATT.files.length;
}

function attRemove(f){
  ATT.files=ATT.files.filter(function(x){ return x!==f; });
  attRender();
  attDiscard(f);
}

// Tell the server to drop one staged file. Separated from attRemove so a
// backout can reuse it without touching the list twice.
function attDiscard(f){
  if(!f.slot || !ATT.draft) return;
  fetch('/api/uploads/'+encodeURIComponent(f.slot)+'?draft_token='+encodeURIComponent(ATT.draft),
    {method:'DELETE'}).catch(function(){});
}

// Backing out of attaching anything. Someone who uploads a file and then
// changes their mind should not have to remove them one at a time and hope
// they got them all — the whole point is that nothing of theirs is left
// staged. Every file goes, including ones still uploading.
function attRemoveAll(){
  var going=ATT.files.slice();
  ATT.files=[];
  if(ATT.timer){ clearInterval(ATT.timer); ATT.timer=null; }
  attErr('');
  attRender();
  going.forEach(attDiscard);
}

// One pass over the server's view of the staged files. Separated from the
// polling loop so the review card can ask for a fresh answer on its own
// schedule — somebody waiting to press Send is watching that line, and
// four seconds is a long time to watch it say "Checking".
function attRefresh(){
  if(!ATT.draft) return Promise.resolve();
  return fetch('/api/uploads/status?draft_token='+encodeURIComponent(ATT.draft))
    .then(function(r){ return r.ok?r.json():[]; })
    .then(function(rows){
      rows.forEach(function(row){
        var f=ATT.files.filter(function(x){ return x.slot===row.slot_token; })[0];
        // Never overwrite 'uploading': that is the browser's own state and
        // the server has not seen the bytes yet.
        if(f && f.status!=='uploading'){ f.status=row.status; f.detail=row.status_detail; }
      });
      attRender();
    }).catch(function(){});
}

function attPoll(){
  if(ATT.timer||!ATT.draft) return;
  ATT.timer=setInterval(function(){
    var waiting=ATT.files.some(function(f){ return f.status==='uploaded'||f.status==='pending'; });
    if(!waiting){ clearInterval(ATT.timer); ATT.timer=null; return; }
    attRefresh();
  },4000);
}

function attIsVideo(t){ return String(t||'').indexOf('video/')===0; }
function attAdd(file){
  if(ATT.files.length>=ATT.cfg.maxFiles){ attErr('You can attach at most '+ATT.cfg.maxFiles+' files.'); return; }
  var cap=attIsVideo(file.type)?ATT.cfg.maxVideoBytes:ATT.cfg.maxImageBytes;
  if(file.size>cap){
    attErr('"'+file.name+'" is larger than the '+Math.floor(cap/1048576)+' MB limit for '+(attIsVideo(file.type)?'video':'photos')+'.');
    return;
  }
  attErr('');
  var entry={name:file.name,size:file.size,status:'uploading',pct:0,slot:null};
  ATT.files.push(entry);
  attRender();

  attDraft().then(function(draft){
    return fetch('/api/uploads',{method:'POST',headers:{'Content-Type':'application/json'},
      /* WHICH LOGBOOK, so the server applies that logbook's caps rather
         than the site's. Sent as the slug and resolved server-side: the
         cap must not be something the client gets to choose, and the first
         upload in a draft fixes it for the rest. */
      /* AND THE ADDRESS, which keys the staging quota across drafts
         (migration 045). The contact card comes before the upload cards on
         every logbook that takes files, so by the time this runs the field
         is filled in; the server refuses the slot if it is not, rather than
         accepting one it cannot count. Read from the DOM at send time
         instead of being passed in, so a correction on the review card is
         the address the next file is counted against. */
      body:JSON.stringify({draft_token:draft,name:file.name,type:file.type,size:file.size,
        logbook:ATT_LOGBOOK,email:attContactEmail()})})
      .then(function(r){ return r.json().then(function(d){ return {ok:r.ok,d:d}; }); });
  }).then(function(res){
    if(!res.ok){ entry.status='failed'; attErr(res.d.error||'Could not start the upload.'); attRender(); return; }
    entry.slot=res.d.slot_token;
    // XHR rather than fetch: this is the one place a progress bar is worth
    // having, and fetch still can't report upload progress.
    var xhr=new XMLHttpRequest();
    xhr.open('PUT',res.d.upload_url,true);
    xhr.setRequestHeader('Content-Type',file.type);
    xhr.upload.onprogress=function(e){
      if(e.lengthComputable){ entry.pct=Math.round((e.loaded/e.total)*100); attRender(); }
    };
    xhr.onload=function(){
      if(xhr.status>=200&&xhr.status<300){
        entry.status='uploaded';
        attRender();
        fetch('/api/uploads/'+encodeURIComponent(entry.slot)+'/complete',
          {method:'POST',headers:{'Content-Type':'application/json'},
           body:JSON.stringify({draft_token:ATT.draft})}).catch(function(){});
        attPoll();
      } else {
        entry.status='failed';
        attErr('Upload failed. Check your connection and try again.');
        attRender();
      }
    };
    xhr.onerror=function(){ entry.status='failed'; attErr('Upload failed — the connection dropped.'); attRender(); };
    xhr.send(file);
  }).catch(function(){ entry.status='failed'; attRender(); });
}

if(document.getElementById('attach-input')){
  document.getElementById('attach-input').addEventListener('change',function(){
    var files=Array.prototype.slice.call(this.files||[]);
    files.forEach(attAdd);
    this.value='';
  });
}
// Called from initApp rather than here: it needs the card-form flag (which
// decides whether the file box is revealed at all) and it hits an endpoint
// behind the site-access gate, so running it at parse time was doing both
// too early.

/* ---------- attachments: public gallery ---------- */
// Loaded on demand rather than with the board: a card showing counts is
// enough to scan, and nobody's photographs should be pulled into a browser
// cache just because someone scrolled past.
function toggleMedia(id){
  var el=document.getElementById('media-'+id);
  if(!el) return;
  if(el.classList.contains('on')){ el.classList.remove('on'); el.innerHTML=''; return; }
  el.classList.add('on');
  el.innerHTML='<span class="cap">Loading…</span>';
  fetch('/api/reports/'+encodeURIComponent(id)+'/attachments')
    .then(function(r){ return r.ok?r.json():[]; })
    .then(function(list){
      if(!list.length){ el.innerHTML='<span class="cap">No published photos on this report.</span>'; return; }
      el.innerHTML='<div class="attgal">'+list.map(function(a){
        var base='/api/reports/'+encodeURIComponent(id)+'/attachments/'+encodeURIComponent(a.id);
        var cap='<figcaption>'+esc(a.alt_text||'')+
          (a.duration_seconds?(' · '+attClock(a.duration_seconds)):'')+
          '<br>sha256 '+esc(String(a.sha256).slice(0,16))+'…</figcaption>';
        if(a.kind==='video'){
          // preload="none" so scrolling past a report never pulls down a
          // video nobody asked to watch.
          return '<figure><video controls preload="none" playsinline'+
            (a.has_poster?(' poster="'+base+'/poster"'):'')+
            ' src="'+base+'/file" aria-label="'+esc(a.alt_text||'Video attached to this report')+'"></video>'+cap+'</figure>';
        }
        return '<figure><img src="'+base+'/file" alt="'+esc(a.alt_text||'')+'" loading="lazy">'+cap+'</figure>';
      }).join('')+'</div>';
    }).catch(function(){ el.innerHTML='<span class="cap">Could not load photos.</span>'; });
}

/* ---------- attachments: moderator review ---------- */
var ovlMedia=document.getElementById('ovl-media'), mediaCb=null;
function openMediaPublish(cb){
  document.getElementById('media-alt').value='';
  document.getElementById('media-text').value='';
  document.getElementById('media-err').classList.remove('on');
  mediaCb=cb;
  ovlMedia.classList.add('on');
}
document.getElementById('media-cancel').addEventListener('click',function(){ ovlMedia.classList.remove('on'); });
document.getElementById('media-go').addEventListener('click',function(){
  var alt=document.getElementById('media-alt').value.trim();
  var text=document.getElementById('media-text').value.trim();
  var err=document.getElementById('media-err');
  if(alt.length<3){ err.textContent='Alt text is required to publish.'; err.classList.add('on'); return; }
  if(!text){ err.textContent='A reason is required.'; err.classList.add('on'); return; }
  ovlMedia.classList.remove('on');
  mediaCb && mediaCb(alt,text);
});

function modMediaAct(attId, publication, altText, comment, id){
  fetch('/api/moderators/attachments/'+encodeURIComponent(attId)+'/publication',
    {method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({publication:publication,alt_text:altText,comment:comment})})
    .then(function(r){ return r.json().then(function(d){ return {ok:r.ok,d:d}; }); })
    .then(function(res){
      if(!res.ok){ alert(res.d.error||'That did not work.'); return; }
      var el=document.getElementById('attmod-'+id);
      el.classList.remove('on');
      toggleModMedia(id);
    });
}

function toggleModMedia(id){
  var el=document.getElementById('attmod-'+id);
  if(!el) return;
  if(el.classList.contains('on')){ el.classList.remove('on'); el.innerHTML=''; return; }
  el.classList.add('on');
  el.innerHTML='Loading…';
  fetch('/api/moderators/reports/'+encodeURIComponent(id)+'/attachments')
    .then(function(r){ return r.ok?r.json():[]; })
    .then(function(list){
      if(!list.length){ el.innerHTML='<span class="who">No files on this report.</span>'; return; }
      el.innerHTML=list.map(function(a){
        var pill=a.publication==='published'?'<span class="pill pub">published</span>'
          :(a.publication==='refused'?'<span class="pill ref">refused</span>':'<span class="pill">withheld</span>');
        var erased=a.dek_destroyed_at?'<span class="pill ref">erased</span>':'';
        return '<div class="row" data-att="'+esc(a.id)+'">'+
          '<span class="who">'+esc(a.original_name||'(unnamed)')+'<br>'+
            esc(a.media_type)+
            (a.rendition_media_type&&a.rendition_media_type!==a.media_type
              ? (' → '+esc(a.rendition_media_type)) : '')+
            ' · '+attSize(a.byte_size)+
            (a.duration_seconds?(' · '+attClock(a.duration_seconds)):'')+
            ' · scan: '+esc(a.scan_status)+'<br>'+
            'sha256 '+esc(a.sha256)+'</span>'+
          '<span>'+pill+' '+erased+'</span>'+
          '<span>'+
            (a.recoverable?'<button data-attview="'+esc(a.id)+'">View original</button> ':'')+
            (a.recoverable?'<button data-attrend="'+esc(a.id)+'">Preview public copy</button> ':'')+
            (a.recoverable&&a.publication!=='published'?'<button data-attpub="'+esc(a.id)+'">Publish</button> ':'')+
            (a.publication!=='refused'?'<button data-attref="'+esc(a.id)+'">Refuse</button>':'')+
          '</span>'+
          '<div class="prevbox" id="attprev-'+esc(a.id)+'"></div>'+
        '</div>';
      }).join('');

      // Opening either preview is an audited request, so it is always a
      // deliberate click and never a page-load side effect.
      //
      // Both buttons share one box, so the box has to remember which
      // variant is in it. Clicking the same button again closes it;
      // clicking the other one swaps straight over. Testing for "is the box
      // empty" instead meant switching from the original to the public copy
      // took two clicks — the first only cleared the original — which read
      // as the button being broken.
      function showPreview(box,row,variant,label,src){
        var type=variant==='original'?row.media_type:(row.rendition_media_type||row.media_type);
        box.innerHTML=String(type).indexOf('video/')===0
          ? '<video class="prev" controls preload="metadata" playsinline src="'+src+'" aria-label="'+label+'"></video>'
          : '<img class="prev" alt="'+label+'" src="'+src+'">';
      }
      function bindPreview(attr, variant, label){
        el.querySelectorAll('['+attr+']').forEach(function(b){
          b.addEventListener('click',function(){
            var aid=b.getAttribute(attr);
            var box=document.getElementById('attprev-'+aid);
            if(box.getAttribute('data-variant')===variant){
              box.innerHTML=''; box.removeAttribute('data-variant'); return;
            }
            box.setAttribute('data-variant',variant);
            var row=list.filter(function(x){ return String(x.id)===String(aid); })[0]||{};
            var base='/api/moderators/attachments/'+encodeURIComponent(aid)+'/'+variant;
            if(variant!=='original'){
              // The cleaned copy: logged, but not a disclosure of anything
              // the reporter gave us, so no reason is asked for.
              showPreview(box,row,variant,label,base);
              return;
            }
            // The original still carries where the photo was taken and on
            // what device. Opening it needs a reason, recorded first, and
            // the reporter reads that reason.
            box.innerHTML='<span class="who">Waiting for a reason…</span>';
            openReason('Why do you need the untouched original of this file?',function(reason){
              box.innerHTML='<span class="who">Opening…</span>';
              fetch('/api/moderators/attachments/'+encodeURIComponent(aid)+'/view-grant',
                {method:'POST',headers:{'Content-Type':'application/json'},
                 body:JSON.stringify({reason:reason})})
                .then(function(r){ return r.json(); })
                .then(function(d){
                  if(!d.token){ box.innerHTML='<span class="who">'+esc(d.error||'Could not open that.')+'</span>'; return; }
                  showPreview(box,row,variant,label,base+'?grant='+encodeURIComponent(d.token));
                })
                .catch(function(){ box.innerHTML='<span class="who">Could not open that.</span>'; });
            },{note:REASON_REPORTER_SEES,minLength:10});
          });
        });
      }
      bindPreview('data-attview','original','Original, unpublished');
      bindPreview('data-attrend','rendition','The copy that would be published');
      el.querySelectorAll('[data-attpub]').forEach(function(b){
        b.addEventListener('click',function(){
          var aid=b.getAttribute('data-attpub');
          openMediaPublish(function(alt,comment){ modMediaAct(aid,'published',alt,comment,id); });
        });
      });
      el.querySelectorAll('[data-attref]').forEach(function(b){
        b.addEventListener('click',function(){
          var aid=b.getAttribute('data-attref');
          openReason('Why refuse this file?',function(comment){ modMediaAct(aid,'refused','',comment,id); });
        });
      });
    }).catch(function(){ el.innerHTML='<span class="who">Could not load files.</span>'; });
}

// Delegated, so the two attachment buttons work on every surface that
// renders a report card — the board, a permalink, My Reports and the
// moderator queue — without each render function having to know about them.
document.addEventListener('click',function(e){
  var t=e.target;
  if(!t||t.tagName!=='BUTTON') return;
  if(t.hasAttribute('data-media')){ toggleMedia(t.getAttribute('data-media')); }
  else if(t.hasAttribute('data-modmedia')){ toggleModMedia(t.getAttribute('data-modmedia')); }
});

export {
  ATT, ATT_LABEL, attRefresh, attRemoveAll, attRender, attSetLogbook, initAttach,
};
