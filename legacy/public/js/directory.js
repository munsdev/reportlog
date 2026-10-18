/* directory.js — Invitations, and the Alliance listing.
 *
 * Lifted out of the one <script> public/index.html used to carry, in the
 * order it was in. docs/frontend-files.md has the whole map.
 */

import { loadOrgMembers, orgCurrent } from './roles.js';

/* ---------- invitations ---------- */
var orgInviteMeta=null;

function renderRoleNote(){
  var note=document.getElementById('org-invite-rolenote');
  var role=document.getElementById('org-invite-role').value;
  if(!orgInviteMeta){ note.textContent=''; return; }
  var d=(orgInviteMeta.roles||{})[role];
  var lines=[];
  if(d) lines.push('A '+d.label.toLowerCase()+' can: '+d.can.join(' '));
  /* Said BEFORE they press send, not after. A manager who learns only from
     the result that nothing was emailed has already told the person. */
  if(role==='manager' && orgInviteMeta.managerInvitesNeedApproval){
    lines.push('Inviting another manager is a leadership grant, so an administrator '
      +'has to approve it. Nothing is emailed until they do.');
  }
  note.textContent=lines.join(' ');
}
document.getElementById('org-invite-role').addEventListener('change',renderRoleNote);

function loadOrgInvites(){
  fetch('/api/orgs/'+orgCurrent+'/invitations')
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(d){
      if(!d) return;
      orgInviteMeta=d;
      renderRoleNote();
      var box=document.getElementById('org-invites');
      if(!d.invitations.length){ box.innerHTML='<div class="empty_component">None waiting.</div>'; return; }
      box.innerHTML='';
      d.invitations.forEach(function(i){
        var card=document.createElement('div'); card.className='rc-card';
        var who=document.createElement('div'); who.className='who';
        var b=document.createElement('b'); b.textContent=i.email; who.appendChild(b);
        var meta=document.createElement('div'); meta.className='meta';

        /* "invited 3 days ago, not yet accepted" is the whole point of this
           list: without it a manager cannot tell a wrong address from a
           person who has not got round to it. */
        var bits=[i.role];
        if(i.status==='awaiting_approval') bits.push('waiting for an administrator to approve');
        else if(i.expired) bits.push('expired');
        else bits.push('not yet accepted');
        if(i.last_sent_at||i.created_at){
          var when=new Date(i.last_sent_at||i.created_at);
          var days=Math.floor((Date.now()-when.getTime())/86400000);
          bits.push(days<1?'sent today':days===1?'sent yesterday':'sent '+days+' days ago');
        }
        meta.textContent=bits.join(' · ');
        who.appendChild(meta);
        card.appendChild(who);

        if(i.status==='pending'){
          var rs=document.createElement('button');
          rs.textContent='Resend'; rs.setAttribute('data-resend',i.email);
          card.appendChild(rs);
        }
        var rm=document.createElement('button');
        rm.textContent='Withdraw'; rm.setAttribute('data-revoke',i.email);
        card.appendChild(rm);
        box.appendChild(card);
      });

      box.querySelectorAll('[data-resend]').forEach(function(btn){
        btn.addEventListener('click',function(){
          inviteAction('POST','/invitations/'+encodeURIComponent(btn.getAttribute('data-resend'))+'/resend');
        });
      });
      box.querySelectorAll('[data-revoke]').forEach(function(btn){
        btn.addEventListener('click',function(){
          inviteAction('DELETE','/invitations/'+encodeURIComponent(btn.getAttribute('data-revoke')));
        });
      });
    });
}

function inviteAction(method,path){
  var err=document.getElementById('org-err'); err.classList.remove('on');
  fetch('/api/orgs/'+orgCurrent+path,{method:method})
    .then(function(r){ return r.json().then(function(d){ return {ok:r.ok,d:d}; }); })
    .then(function(res){
      if(!res.ok){ err.textContent=res.d.error||'Something went wrong'; err.classList.add('on'); return; }
      loadOrgInvites();
    });
}

document.getElementById('org-invite-btn').addEventListener('click',function(){
  var err=document.getElementById('org-err'); err.classList.remove('on');
  var st=document.getElementById('org-invite-status'); st.textContent='';
  var email=document.getElementById('org-invite-email').value.trim();
  var role=document.getElementById('org-invite-role').value;
  if(!email){ err.textContent='Enter an email address.'; err.classList.add('on'); return; }
  fetch('/api/orgs/'+orgCurrent+'/invitations',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email:email,role:role})})
    .then(function(r){ return r.json().then(function(d){ return {ok:r.ok,d:d}; }); })
    .then(function(res){
      if(!res.ok){ err.textContent=res.d.error||'Something went wrong'; err.classList.add('on'); return; }
      document.getElementById('org-invite-email').value='';
      st.textContent=res.d.awaitingApproval ? res.d.message
        : (res.d.emailed ? 'Invitation sent to '+email+'.'
          : 'Invitation created. This site cannot send email yet, so the link is in the server log.');
      loadOrgInvites();
    });
});

document.getElementById('org-save-btn').addEventListener('click',function(){
  fetch('/api/orgs/'+orgCurrent+'/details',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({details:document.getElementById('org-details').value})}).then(loadOrgMembers);
});

/* ---------- the Alliance listing ---------- */
/* Every word on this panel comes from the server. The list of what appears,
   the disclaimer, and the note about what opting out does NOT do are all
   served beside the current state, so the sentence somebody reads while
   deciding is the same one the directory is built from and the two cannot
   drift apart. */
function loadOrgListing(){
  fetch('/api/orgs/'+orgCurrent+'/listing')
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(d){
      if(!d) return;
      document.getElementById('org-listing-title').textContent=d.directoryName||'Participating organizations';
      document.getElementById('org-listing-disclaimer').textContent=d.disclaimer||'';
      document.getElementById('org-listed').checked=!!d.listed;
      document.getElementById('org-listing-optout').textContent=d.whatOptingOutDoesNotDo||'';

      var ul=document.getElementById('org-listing-what');
      ul.innerHTML='';
      (d.whatAppears||[]).forEach(function(line){
        var li=document.createElement('li'); li.textContent=line; ul.appendChild(li);
      });

      /* The count is shown as it stands rather than described in the
         abstract. "47 people" is a different decision to agree to than
         "your member count", and it is the one actually being made. */
      document.getElementById('org-listed-sub').textContent=
        'Right now that would be '+d.memberCount+
        (d.memberCount===1?' person.':' people.');

      document.getElementById('org-listing-status').textContent=d.listed
        ? (d.joined ? 'Listed since '+new Date(d.joined).toLocaleDateString(undefined,
            {year:'numeric',month:'long',day:'numeric'})+'.' : 'Listed.')
        : 'Not listed. Nothing about this organization appears in the directory.';
    });
}

document.getElementById('org-listing-save').addEventListener('click',function(){
  var err=document.getElementById('org-listing-err'); err.classList.remove('on');
  fetch('/api/orgs/'+orgCurrent+'/listing',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({listed:document.getElementById('org-listed').checked})})
    .then(function(r){ return r.json().then(function(d){ return {ok:r.ok,d:d}; }); })
    .then(function(res){
      if(!res.ok){ err.textContent=res.d.error||'Something went wrong'; err.classList.add('on'); return; }
      loadOrgListing();
    });
});

export {
  loadOrgInvites, loadOrgListing,
};
