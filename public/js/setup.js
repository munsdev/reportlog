/* setup.js — First-run setup, and lifting the curtain.
 *
 * Lifted out of the one <script> public/index.html used to carry, in the
 * order it was in. docs/frontend-files.md has the whole map.
 */

import { esc } from './answers.js';
import { lpPaint } from './admin-look.js';
import { initApp } from './gate.js';
import { applyLook, paintBrand } from './identity.js';

/* ---- first-run setup ------------------------------------------------- */
/* The curtain is lifted. Before the site itself, one more question: does
   this deployment have an owner yet? A fresh install does not, and the
   person who just typed the password is the one being handed it.

   A failed status check falls through to the app rather than to the
   wizard. Guessing "needs setup" when we cannot tell would put a
   mint-an-admin form in front of somebody on a site that already has one;
   guessing the other way costs a visit to the settings page. */
function afterUnlock(){
  fetch('/api/setup/status')
    .then(function(r){ return r.json(); })
    .then(function(d){ if(d && d.needed){ startSetup(d.hasAdmin, d.minPassword); } else { initApp(); } })
    .catch(function(){ initApp(); });
}

/* The wizard's screen order lives in the DOM and nowhere else. A list
   written out here as well was wrong the first time a screen was inserted:
   setupStep(4) showed screen five and the wizard silently skipped a
   question. */
function setupSteps(){ return document.querySelectorAll('#setup .step'); }
var SETUP_AT = 1;

/* Screens one and two mint the administrator and the server refuses to
   replay them, so Back is offered from three on. Everything from the
   starting point onward is an idempotent settings write and can be
   revisited as often as somebody likes. */
var SETUP_FIRST_REVISITABLE = 3;

function setupStep(n){
  var steps=setupSteps();
  SETUP_AT=n;
  steps.forEach(function(el,i){ el.classList.toggle('on', i === n - 1); });

  document.getElementById('setup-progress').textContent='Step '+n+' of '+steps.length;
  document.getElementById('setup-bar').style.width=Math.round(n/steps.length*100)+'%';
  document.getElementById('setup-back').hidden = n <= SETUP_FIRST_REVISITABLE;

  /* The first field on a screen, focused, so the wizard can be typed
     through without reaching for the mouse on every screen. Not on the
     first screen, where stealing focus before somebody has read the page
     is worse than not having it. */
  if(n>1){
    var f=steps[n-1].querySelector('input:not([type=radio]),select');
    if(f) try{ f.focus({preventScroll:true}); }catch(e){}
  }
}
function setupBack(){
  if(SETUP_AT>SETUP_FIRST_REVISITABLE) setupStep(SETUP_AT-1);
}
function setupErr(id,msg){
  var e=document.getElementById(id);
  e.textContent=msg||''; e.classList.toggle('on', !!msg);
}

/* Selecting a choice highlights it and does NOT advance the screen. The
   same rule the curtain decision follows: the page must not move under
   somebody who is still reading it. */
function setupSyncChoice(yesId,noId){
  document.getElementById(yesId+'-l').classList
    .toggle('sel', document.getElementById(yesId).checked);
  document.getElementById(noId+'-l').classList
    .toggle('sel', document.getElementById(noId).checked);
}
function setupChoice(yesId,noId){
  var sync=function(){ setupSyncChoice(yesId,noId); };
  document.getElementById(yesId).addEventListener('change',sync);
  document.getElementById(noId).addEventListener('change',sync);
}

/* The name, drawn the way the site will draw it, as it is typed.

   The quote convention is easier to show than to explain, and this is the
   showing: type Report"Log" and the second half turns gold under your
   hands, and Munich'Log' turns it grey instead.

   PORTED FROM src/look.js parseBrand AND HELD TO IT BY THE SUITE. Two
   implementations of one rule is how they come to disagree, so the tests
   run the same table of names through both and require the same answer. If
   you change one of these, change the other. */
function setupParseBrand(raw){
  var name=String(raw==null?'':raw);
  var MARK={'"':'a',"'":'b'};
  var scan=function(active){
    var parts=[],buf='',open=null;
    var push=function(text,mark){ if(text) parts.push({text:text,mark:mark}); };
    for(var i=0;i<name.length;i++){
      var ch=name.charAt(i);
      if(open===null&&active.indexOf(ch)>=0){ push(buf,''); buf=''; open=ch; }
      else if(open===ch){ push(buf,MARK[ch]); buf=''; open=null; }
      else buf+=ch;
    }
    if(open!==null) return null;
    push(buf,'');
    return parts;
  };
  var parts=scan('"\'')||scan('"')||scan("'")
    ||[{text:name.split('"').join('').split("'").join(''),mark:''}];
  /* A name that is nothing but marks leaves no runs at all. One empty run
     rather than none, so no caller has to check. */
  return parts.length?parts:[{text:'',mark:''}];
}
function setupBrand(raw){
  var parts=setupParseBrand(raw);
  var plain=parts.map(function(p){ return p.text; }).join('');
  return {parts:parts,plain:plain,marked:parts.some(function(p){ return !!p.mark; })};
}
function setupNamePreview(){
  var raw=document.getElementById('setup-name').value.trim();
  var el=document.getElementById('setup-name-preview');
  var b=setupBrand(raw||'ReportLog');
  paintBrand(el, b, b.plain);
  /* The preview card on the look screen carries the name too, so the two
     stay in step while somebody flips back and forth. */
  document.querySelectorAll('#setup [data-brand]').forEach(function(n){
    paintBrand(n, b, b.plain);
  });
}

/* What the deployment is set to right now, put into the screens before
   they are shown. The point is that the wizard ASKS rather than assumes,
   not that it arrives blank: each of these has a working default, and a
   screen showing what would happen anyway is a screen somebody can answer.

   A failure leaves the shipped markup's own defaults in place and does not
   stop the wizard. Not being able to read a setting is not a reason to
   refuse to hand a deployment over. */
function setupPrefill(){
  /* THE STARTING-POINT CATALOGUE, and the reason it lives here.

     /api/admin/templates is admin-only, like every other route this wizard
     writes through. It used to be fetched once when the wizard started —
     which on a fresh install is BEFORE screens one and two have minted the
     administrator, so it answered 401, the list stayed empty, and screen
     three offered Continue and Skip with nothing to choose between them.
     That is exactly what happened on the first real run.

     setupPrefill is called after verify-code and on a resumed wizard, which
     are the two moments an administrator's session is known to exist. */
  fetch('/api/admin/templates').then(function(r){ return r.ok?r.json():null; })
    .then(function(d){
      var box=document.getElementById('setup-template-choices');
      var note=document.getElementById('setup-tpl-none');
      if(!d || !(d.templates||[]).length){
        /* Say so rather than showing an empty gap. A screen offering a
           choice with nothing in it reads as broken, which it is. */
        box.innerHTML='';
        note.hidden=false;
        return;
      }
      note.hidden=true;
      box.innerHTML=(d.templates||[]).map(function(t){
        return '<label class="choice" id="setup-tpl-'+esc(t.id)+'-l">'+
          '<input type="radio" name="setup-tpl" value="'+esc(t.id)+'" id="setup-tpl-'+esc(t.id)+'">'+
          '<span class="t">'+esc(t.label)+'</span>'+
          '<p class="d">'+esc(t.description)+
          (t.sets&&t.sets.length
            ? '<br><br>'+t.sets.map(function(x){ return '&middot; '+esc(x); }).join('<br>')
            : '')+
          '</p></label>';
      }).join('');
      box.addEventListener('change',function(){
        (d.templates||[]).forEach(function(t){
          var el=document.getElementById('setup-tpl-'+t.id);
          if(el) document.getElementById('setup-tpl-'+t.id+'-l').classList.toggle('sel', el.checked);
        });
      });
    }).catch(function(){
      document.getElementById('setup-tpl-none').hidden=false;
    });

  /* ONLY WHEN THE FIELD IS EMPTY. This runs on a resumed wizard, where filling
     it from what was stored is the whole point — and it used to run mid-wizard
     too, where writing the stored value back over the box clears a name that
     has been typed but not yet saved. Empty means "nobody has answered this on
     screen yet", which is exactly when the stored value should win. */
  fetch('/api/admin/identity').then(function(r){ return r.ok?r.json():null; })
    .then(function(d){
      if(!d) return;
      var f=document.getElementById('setup-name');
      if(!f.value){ f.value=d.stored||''; setupNamePreview(); }
    }).catch(function(){});

  fetch('/api/admin/look').then(function(r){ return r.ok?r.json():null; })
    .then(function(d){
      if(!d) return;
      var fill=function(id, items, chosen){
        var sel=document.getElementById(id);
        sel.innerHTML=(items||[]).map(function(i){
          return '<option value="'+esc(i.id)+'"'+(i.id===chosen?' selected':'')+'>'+
            esc(i.label)+(i.dark?' — dark':'')+'</option>';
        }).join('');
      };
      fill('setup-palette', d.palettes, d.look.palette);
      fill('setup-theme',   d.themes,   d.look.theme);
      lpPaint(document.getElementById('setup-look-preview'), d.look.palette, d.look.theme,
        (document.getElementById('setup-name').value||'').trim());
    }).catch(function(){});

  fetch('/api/admin/publication').then(function(r){ return r.ok?r.json():null; })
    .then(function(d){
      if(!d) return;
      document.getElementById(d.publicArchive?'setup-pub-yes':'setup-pub-no').checked=true;
      setupSyncChoice('setup-pub-yes','setup-pub-no');
    }).catch(function(){});

  fetch('/api/admin/attachments').then(function(r){ return r.ok?r.json():null; })
    .then(function(d){
      if(!d) return;
      document.getElementById(d.enabled?'setup-att-yes':'setup-att-no').checked=true;
      setupSyncChoice('setup-att-yes','setup-att-no');
      if(!d.storageConfigured){
        var n=document.getElementById('setup-att-nostorage');
        n.textContent='This deployment has no object storage configured yet, so'
          +' nothing can be attached whatever you answer here. Saying yes records'
          +' the decision; the uploads start working once storage is set up in .env.';
        n.hidden=false;
      }
    }).catch(function(){});
}

/* hasAdmin means the owner was minted and the tab was reloaded before the
   wizard finished. Restarting at step 1 would put the operator in front of
   two screens the server now refuses, so resume where they actually are. */
function startSetup(hasAdmin, minPassword){
  document.getElementById('setup').classList.add('on');
  setupStep(hasAdmin ? SETUP_FIRST_REVISITABLE : 1);
  if(hasAdmin) setupPrefill();

  document.getElementById('setup-back').addEventListener('click',setupBack);

  /* Enter moves on, from any single-line field. Eight screens of clicking
     a button that is already the only thing to do is eight clicks nobody
     needed to make. */
  document.getElementById('setup').addEventListener('keydown',function(e){
    if(e.key!=='Enter') return;
    var t=e.target;
    if(!t||t.tagName!=='INPUT'||t.type==='radio') return;
    e.preventDefault();
    var go=setupSteps()[SETUP_AT-1].querySelector('.button.is-full:not(.is-secondary)');
    if(go) go.click();
  });

  document.getElementById('setup-pw-rule').textContent=
    'At least '+(minPassword||8)+' characters. Nothing else is required — this'
    +' keeps the site off the open internet, it is not a vault.';

  var email='';

  document.getElementById('setup-s1-go').addEventListener('click',function(){
    setupErr('setup-s1-err','');
    email=document.getElementById('setup-email').value.trim();
    if(!email){ setupErr('setup-s1-err','Enter an email address'); return; }
    fetch('/api/setup/request-code',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email:email})})
      .then(function(r){ return r.json().then(function(d){ return {ok:r.ok,d:d}; }); })
      .then(function(res){
        if(!res.ok){ setupErr('setup-s1-err',res.d.error||'That did not work'); return; }
        document.getElementById('setup-s2-sub').textContent = res.d.emailed
          ? 'Sent to ' + email + '. It expires in ten minutes.'
          : 'This deployment cannot send email yet, so the code was written to the'
            + ' server log instead. Whoever installed it can read it out.';
        setupStep(2);
      });
  });

  document.getElementById('setup-s2-go').addEventListener('click',function(){
    setupErr('setup-s2-err','');
    var code=document.getElementById('setup-code').value.trim();
    if(!code){ setupErr('setup-s2-err','Enter the code'); return; }
    fetch('/api/setup/verify-code',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email:email,code:code})})
      .then(function(r){ return r.json().then(function(d){ return {ok:r.ok,d:d}; }); })
      .then(function(res){
        if(!res.ok){ setupErr('setup-s2-err',res.d.error||'That code did not work'); return; }
        setupPrefill();
        setupStep(3);
      });
  });

  /* Saved through the ordinary admin routes rather than through setup-only
     ones. By this point the person holds an administrator's session, so
     these are the same calls the settings panels make, under the same
     validation. A second route onto one setting is a second place for it
     to be wrong.

     Each screen writes its own answer before moving on, so a tab closed
     halfway does not lose the ones already given — and so Back is safe:
     going back shows what was saved, not what was typed.

     A screen that cannot save does not advance. Silently carrying on would
     hand somebody a deployment configured the way they did not choose,
     with the wizard reporting that it had asked. */
  function setupSave(url, body, errId, onDone){
    fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(body)})
      .then(function(r){ return r.json().then(function(d){ return {ok:r.ok,d:d}; }); })
      .then(function(res){
        if(!res.ok){ setupErr(errId,(res.d&&res.d.error)||'That could not be saved'); return; }
        onDone();
      })
      .catch(function(){ setupErr(errId,'That could not be saved'); });
  }

  /* Step three: the starting point. Applied BEFORE the screens that follow,
     so the name, look and switch screens show what it just set and can be
     changed rather than being announced afterwards.

     The catalogue itself is fetched by setupPrefill, NOT here — see the
     note there. Fetching it at wizard start asked an admin-only route
     before the administrator existed. */

  /* STEP THREE: THE NAME, AND IT IS REQUIRED.

     It was the fourth screen and it said "leave blank to use ReportLog", so
     the easiest thing to do was nothing and a deployment went live named after
     the software. It is the first real decision now — every page, the browser
     tab, the lock screen and every email carry it — and blank is refused here
     rather than quietly meaning the default.

     The route still understands an empty string as "back to the shipped
     default", which is what the Site settings page uses to undo a name. Only
     the wizard insists, because only the wizard is the one moment a deployment
     has no name at all. */
  document.getElementById('setup-name').addEventListener('input',setupNamePreview);
  setupNamePreview();
  document.getElementById('setup-s3-go').addEventListener('click',function(){
    setupErr('setup-s3-err','');
    var name=document.getElementById('setup-name').value.trim();
    if(!name){ setupErr('setup-s3-err','Give this archive a name.'); return; }
    setupSave('/api/admin/identity',{siteName:name},'setup-s3-err',function(){ setupStep(4); });
  });

  /* Step four: the starting point.

     AFTER THE NAME, which is why no shipped template sets `siteName` any more:
     one of them cleared it, and from here that would wipe what was typed on
     the screen before. src/templates.js says so where the key would go. */
  document.getElementById('setup-s4-go').addEventListener('click',function(){
    setupErr('setup-s4-err','');
    var picked=document.querySelector('#setup-template-choices input:checked');
    if(!picked){ setupErr('setup-s4-err','Choose one, or skip'); return; }
    /* NO setupPrefill() HERE ANY MORE. It used to run so the name and look
       screens would show what the template had just set — but the name is
       answered on the screen BEFORE this one now, and no template sets a name
       or a look at all. All it did was refetch the identity and write it back
       over the field, which on a slow or stale read means the name somebody
       typed thirty seconds ago quietly reverts. */
    setupSave('/api/admin/templates',{template:picked.value},'setup-s4-err',function(){
      setupStep(5);
    });
  });
  document.getElementById('setup-s4-skip').addEventListener('click',function(){
    setupErr('setup-s4-err','');
    setupStep(5);
  });

  /* Steps five and six: two switches, asked as a choice rather than a
     checkbox, because a checkbox on a setup screen cannot tell "left
     alone" from "decided against". Both arrive preselected at what the
     software would do anyway, and both screens say which that is — unlike
     the password decision, where no default is offered on purpose. */
  setupChoice('setup-pub-yes','setup-pub-no');
  setupChoice('setup-att-yes','setup-att-no');

  document.getElementById('setup-s5-go').addEventListener('click',function(){
    setupErr('setup-s5-err','');
    var yes=document.getElementById('setup-pub-yes').checked;
    var no=document.getElementById('setup-pub-no').checked;
    if(!yes&&!no){ setupErr('setup-s5-err','Choose one'); return; }
    setupSave('/api/admin/publication',{publicArchive:yes},'setup-s5-err',function(){ setupStep(6); });
  });

  document.getElementById('setup-s6-go').addEventListener('click',function(){
    setupErr('setup-s6-err','');
    var yes=document.getElementById('setup-att-yes').checked;
    var no=document.getElementById('setup-att-no').checked;
    if(!yes&&!no){ setupErr('setup-s6-err','Choose one'); return; }
    setupSave('/api/admin/attachments',{enabled:yes},'setup-s6-err',function(){
      setupStep(7);
      /* Repaint on ARRIVAL, not only at prefill. The catalogue is fetched
         before the name screen, so a preview painted then still carries the
         old name — and showing somebody else's name is the one thing this
         screen is late in the wizard specifically to avoid. */
      setupLookNow();
    });
  });

  /* Step seven: the look. Late on purpose — by here the site has a name, so
     the preview shows theirs.

     THE FRAMES ONLY, matching the admin panel. This used to repaint the
     whole page behind the card on every change, which put the two looks
     being compared into the same place: by the time you looked at the
     second one, the thing you were comparing it against had already become
     it. The site takes the choice when the button below is pressed, which
     is also when it is saved — one moment, one decision. */
  function setupLookNow(){
    var palette=document.getElementById('setup-palette').value;
    var theme=document.getElementById('setup-theme').value;
    /* The name typed on the screen before this one, which is saved by the
       time we are here but has not necessarily reached SITE_TITLE yet. */
    var typed=(document.getElementById('setup-name').value||'').trim();
    lpPaint(document.getElementById('setup-look-preview'), palette, theme, typed);
  }
  ['setup-palette','setup-theme'].forEach(function(id){
    document.getElementById(id).addEventListener('change',setupLookNow);
  });
  document.getElementById('setup-s7-go').addEventListener('click',function(){
    setupErr('setup-s7-err','');
    var palette=document.getElementById('setup-palette').value;
    var theme=document.getElementById('setup-theme').value;
    setupSave('/api/admin/look',{ palette: palette, theme: theme },'setup-s7-err',function(){
      /* AFTER the save, not before it. Painting first would leave somebody
         looking at a look the deployment does not have if the save failed —
         which is the same lie the preview-only change was made to stop. */
      applyLook({ look: { palette: palette, theme: theme } });
      setupStep(8);
    });
  });

  /* Selecting a choice reveals the field that choice needs and nothing
     else — it does not advance the screen. Rule 10. */
  var keep=document.getElementById('setup-keep');
  var change=document.getElementById('setup-change');
  function syncChoice(){
    document.getElementById('setup-pw-wrap').hidden = !change.checked;
    document.getElementById('setup-keep-l').classList.toggle('sel', keep.checked);
    document.getElementById('setup-change-l').classList.toggle('sel', change.checked);
  }
  keep.addEventListener('change',syncChoice);
  change.addEventListener('change',syncChoice);

  document.getElementById('setup-s8-go').addEventListener('click',function(){
    setupErr('setup-s8-err','');
    /* No default and no skip. A decision that was never made is not a
       decision to keep. */
    if(!keep.checked && !change.checked){
      setupErr('setup-s8-err','Choose whether to keep the password or set a new one');
      return;
    }
    var body={decision: change.checked ? 'change' : 'keep'};
    if(change.checked){
      var pw=document.getElementById('setup-pw').value;
      var pw2=document.getElementById('setup-pw2').value;
      /* A mistype here locks the operator out of the deployment they were
         just handed, with the installer's password already dead. Caught on
         the screen, and caught again at the server. */
      if(pw!==pw2){ setupErr('setup-s8-err','The two passwords do not match'); return; }
      body.password=pw; body.passwordConfirm=pw2;
    }
    fetch('/api/setup/curtain',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(body)})
      .then(function(r){ return r.json().then(function(d){ return {ok:r.ok,d:d}; }); })
      .then(function(res){
        if(!res.ok){ setupErr('setup-s8-err',res.d.error||'That did not work'); return; }
        document.getElementById('setup').classList.remove('on');
        initApp();
      });
  });
}
function trySiteUnlock(){
  var pw=document.getElementById('site-lock-pw').value;
  var err=document.getElementById('site-lock-err'); err.classList.remove('on');
  fetch('/api/site-access/unlock',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pw})})
    .then(function(r){ return r.json().then(function(d){ return {ok:r.ok,d:d}; }); })
    .then(function(res){
      if(!res.ok){ err.textContent=res.d.error||'Incorrect password'; err.classList.add('on'); return; }
      document.getElementById('site-lock').classList.remove('on');
      document.getElementById('site-lock-pw').value='';
      afterUnlock();
    });
}
document.getElementById('site-lock-go').addEventListener('click',trySiteUnlock);
document.getElementById('site-lock-pw').addEventListener('keydown',function(e){ if(e.key==='Enter') trySiteUnlock(); });

export {
  afterUnlock, setupBrand,
};
