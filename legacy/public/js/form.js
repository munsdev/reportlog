/* form.js — Submitting, and the machinery of the one-question-per-card
 * form.
 *
 * Lifted out of the one <script> public/index.html used to carry, in the
 * order it was in. docs/frontend-files.md has the whole map.
 */

import { ATT, attRemoveAll } from './attachments.js';
import {
  LB_GETTERS, LOGBOOK, LOGBOOKS, buildReview, choiceTiles, filesBusy, reviewIncomplete,
} from './form-logbook.js';

/* ---------- submit ---------- */
var form=document.getElementById('rform'), btn=document.getElementById('submitbtn');
function looksLikeEmail(s){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s||''); }

/* The send button is live only when the report is whole: a logbook chosen,
   every question it requires answered, and the spine — somewhere to reach
   the reporter, and their consent. Nothing else is built in. */
function checkValid(){
  var spine = looksLikeEmail(document.getElementById('rEmail').value.trim()) &&
    document.getElementById('consent').checked;
  var ok = spine && Boolean(LOGBOOK) && LOGBOOK.fields.every(function(f){
    if(!f.required) return true;
    var v=LB_GETTERS[f.key]?LB_GETTERS[f.key]():undefined;
    return !(v===undefined||v===null||v===''||(Array.isArray(v)&&!v.length));
  });
  btn.disabled=!ok;
}
form.addEventListener('input',checkValid);
form.addEventListener('change',checkValid);

/* ---------- card form ---------- */
// One card asks one question. You answer it and the card advances. Nothing
// on the card in front of you ever changes underneath you — no field
// appears because of something you just tapped, no section unfolds, no
// layout shifts under your thumb. If an answer leads somewhere else, that
// somewhere else is the NEXT card.
//
// EVERY REPORT IS FILED THROUGH A LOGBOOK, and the questions are the
// logbook's. What is fixed here is only what every report has however it was
// asked: which logbook, files if that logbook takes them, whether it may be
// published, and an address and consent on the last card. The logbook's own
// question cards are spliced in right after the chooser — see lbBuildCards.

function cardChecked(id){
  var el=document.getElementById(id);
  return Boolean(el&&el.checked);
}
var cardHasFiles=null;
// Set when a Change link on the review card sent you back to fix something,
// so answering it returns you there instead of walking you forward through
// every remaining card again.

/* Whether the chosen logbook takes files, and this site can store them.
   Both switches: the logbook's own, and the site's storage. */
function lbTakesFiles(){ return Boolean(LOGBOOK&&LOGBOOK.acceptsFiles&&ATT.enabled); }

// build: makes the card's own control.
// when: whether this card applies at all. A card that does not apply is
//   skipped in both directions; it is never shown empty or disabled.
// valid: what is wrong with the answer, or null. Shown when somebody tries
//   to move on.
// settled / sub / next / title: the card's wording and its progress-bar
//   bookkeeping.
//
// `holds` IS A COMMENT, NOT A MECHANISM, and it is labelled as one because
// its predecessor was not. It used to be called `take` and was documented as
// "selectors whose fields move onto this card, in order" — and NOTHING HAS
// EVER READ IT. The cards are static markup in public/index.html keyed by
// `data-card`, and the fields are already inside the right ones; this list
// only records which, so somebody reading the step order can see what is on
// each card without opening the HTML.
//
// It read as the thing that decided card contents, which made moving a field
// between cards look like a one-line edit here. It is not: it is a change to
// the markup. Renamed rather than deleted because the information is worth
// having, and left here rather than moved because this is where somebody
// looks for it.
//
// Exposed deliberately, and only this. The browser suite counts the card
// panes in the markup against this list, so that a card added to one and not
// the other fails loudly.
var STEPS=[
  // Everything that introduces the form lives here and nowhere else: the
  // title, the explanation, and the get-help-now notice.
  {id:'intro',holds:['header','.note'],next:'Start a report',
   build:function(card){
     var p=document.createElement('p');
     p.className='introlen';
     // No count: how many questions there are is the logbook's, and a number
     // here would be wrong for every logbook but one.
     p.textContent='A few questions, one at a time. How many depends on what '
       +'you are reporting. Most people take a few minutes.';
     card.appendChild(p);
     return function(){ return true; };
   }},

  /* WHICH LOGBOOK. Asked only when more than one is open; with exactly one,
     that one is used and this card never appears. NO `build` HERE: the list
     has not arrived when the cards are built, so lbLoadOpen fills the choices
     in when it lands. */
  {id:'logbook',title:'What are you reporting?',
   when:function(){ return LOGBOOKS.length>1; },
   valid:function(){ return LOGBOOK?null:'Please choose one.'; }},

  /* The logbook's own questions are spliced in here. */

  /* WHERE TO REACH THEM, ON A LOGBOOK THAT TAKES FILES — before the upload
     cards rather than on the last one.

     THE REASON IS THE QUOTA, NOT THE ORDERING. Staging is keyed on this
     address (migration 045), and a free draft token is what the old
     per-draft quota could be walked around with. So the address has to be
     collected before a byte is staged, which means before this card.

     The cost was accepted deliberately: an email asked earlier is
     an email some people will not give, and this is the card where a reporter
     who was willing to describe what happened may stop. That is why it is
     asked only where it buys something — on a logbook that takes no files
     the field stays where it was, on the send card.

     THE FIELD IS MOVED, NOT COPIED. One question has one input; see
     lbPlaceContact and the markup note on the card. */
  {id:'contact',title:'Where can we reach you?',
   sub:'We send a link to confirm the report is really from you. Nothing is submitted until you click it.',
   when:lbTakesFiles,
   // Until a logbook is chosen nobody knows whether this card is in the
   // walk, so the progress bar keeps room for it — same as the evidence
   // cards below.
   settled:function(){ return Boolean(LOGBOOK); },
   valid:function(){
     // Checked HERE as well as on the send card, because from here on the
     // address is what the upload endpoint will be keyed on: walking past
     // this with a typo means every file is refused two cards later, for a
     // reason that would appear to be about the file.
     var el=document.getElementById('rEmail');
     return looksLikeEmail(el?el.value.trim():'')
       ? null : 'Please enter an email address we can reach you at.';
   }},

  {id:'evidence-ask',title:'Do you have a photo or video?',
   when:lbTakesFiles,
   // Until a logbook is chosen nobody knows whether this will be asked, so
   // the progress bar keeps room for it.
   settled:function(){ return Boolean(LOGBOOK); },
   build:function(card){
     return choiceTiles(card,'hasfiles',[
       ['no','No',''],
       ['yes','Yes','Location and device data is removed from anything published.']
     ],function(v){
       cardHasFiles=(v==='yes');
       if(!cardHasFiles && typeof attRemoveAll==='function' && ATT.files.length) attRemoveAll();
     });
   },
   valid:function(picked){ return picked?null:'Please choose one.'; }},

  {id:'evidence',title:'Add your files',
   // No "wait for Ready" any more: nothing is checked during filing, so
   // there is nothing on this card to wait for past the upload itself.
   sub:'They upload as you go. You can keep filling the form in.',
   when:function(){ return lbTakesFiles() && cardHasFiles===true; },holds:['#attach-block'],
   settled:function(){ return cardHasFiles!==null; },
   valid:function(){ return null; }},

  {id:'publish',title:'Should this report be published?',
   build:function(card){
     // Only the container. The wording comes from the server and is written
     // in by fillPublishCard when it arrives.
     var slot=document.createElement('div');
     slot.id='publish-slot';
     var wait=document.createElement('p');
     wait.className='form_help';
     wait.textContent='Loading this question.';
     slot.appendChild(wait);
     card.appendChild(slot);
     fillPublishCard();
     return function(){ return cardMayPublish; };
   },
   // Deliberately never an error. The question is optional and the card says
   // what not answering means.
   valid:function(){ return null; }},

  {id:'send',title:'Check your answers',
   sub:"Nothing is sent until you confirm by email — check it over first.",
   build:buildReview,holds:['#rEmail','#consent','details.about'],next:'Send report',
   valid:function(){
     // Only the upload itself, never the checking. Send is what releases
     // these files to the worker, and a file whose bytes never finished
     // arriving is one the worker refuses — so this wait is the difference
     // between a reporter having attached their photograph and not. See
     // FILE_BUSY in form-logbook.js.
     if(filesBusy()) return 'One of your files is still uploading — give it a moment.';
     if(reviewIncomplete()) return 'Something above has not been answered yet.';
     if(!looksLikeEmail(document.getElementById('rEmail').value.trim()))
       return 'Please enter an email address we can reach you at.';
     if(!document.getElementById('consent').checked) return 'Please confirm the statement above.';
     if(!consentCard) return 'The publication question has not loaded yet. Go back a card and return.';
     return null;
   }}
];

window.STEPS = STEPS;

/**
 * A row of tiles where choosing one IS the answer.
 *
 * Each tile is a real radio input with a label on top of it, not a button.
 * That is what makes a screen reader announce "2 of 5" and arrow keys move
 * between the options — a row of styled buttons looks the same and offers
 * neither. A row entry of ['grp', 'Heading'] is a subheading rather than a
 * choice.
 *
 * Choosing never reveals anything on this card. If the answer changes what
 * gets asked, that happens on the next card.
 */
/**
 * The publication card's wording, fetched rather than written here.
 *
 * The server digests the exact text it sends and seals that digest beside
 * the answer, so the page must not hold a second copy that can drift. Same
 * reason /api/uploads/config serves the attachment limits.
 */
// Always the general variant here. The coordinator wording belongs to the
// intake path, which is a different route and a different form.
var consentCard=null, cardMayPublish=null;

/**
 * Fill the publication card from the fetched wording.
 *
 * Separate from build() because every card is built ONCE at load, while the
 * text arrives over the network. Building and filling in the same step would
 * leave whichever lost the race showing "loading" for the rest of the
 * session — including on the printed paper form, which is built from the
 * same pass and is the version offline reporters answer.
 */
function fillPublishCard(){
  var slot=document.getElementById('publish-slot');
  if(!slot||!consentCard) return;
  slot.innerHTML='';
  consentCard.body.forEach(function(t){
    var p=document.createElement('p'); p.textContent=t; slot.appendChild(p);
  });
  // Set apart from the body on purpose: a person needs to know they can walk
  // past this BEFORE they act. Finding out afterwards is being handled, not
  // being offered a choice.
  var opt=document.createElement('p');
  opt.className='form_help optional-note';
  opt.textContent=consentCard.optionality;
  slot.appendChild(opt);
  var card=slot.closest('.card');
  if(card&&!card.querySelector('.pick')){
    choiceTiles(card,'maypublish',[
      ['yes',consentCard.options.yes,''],
      ['no',consentCard.options.no,'']
    ],function(v){ cardMayPublish=(v==='yes'); });
  }
}

function loadConsentText(){
  return fetch('/api/reports/consent-text')
    .then(function(r){ return r.ok?r.json():null; })
    .then(function(d){ consentCard=d; fillPublishCard(); return d; })
    .catch(function(){ return null; });
}
loadConsentText();

export {
  STEPS, btn, cardMayPublish, checkValid, consentCard, form, lbTakesFiles,
};
