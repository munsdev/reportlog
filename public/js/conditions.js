/**
 * When a question is asked — the browser's half.
 *
 * THIS IS A SECOND IMPLEMENTATION OF src/conditions.js AND THAT IS A
 * PROBLEM THE SUITE SOLVES RATHER THAN ONE THE CODE AVOIDS. There is no
 * build step here by design, and nginx serves `public/` directly, so a
 * module under `src/` cannot be imported by a page without either a bundler
 * or a route — and a new top-level route silently does not exist in
 * production until somebody adds a location block.
 *
 * So the logic is written twice, and `scripts/selftest.js` imports BOTH
 * files and runs the same table of cases through each, asserting they agree
 * answer for answer. If they ever disagree the unit suite goes red, which is
 * the only version of "do not let these drift" that is worth anything.
 *
 * Keep this file pure: no DOM, no fetch, no imports. The suite loads it in
 * Node, where `document` does not exist.
 *
 * The server's copy is the one that decides what gets sealed. This one
 * decides what a person is shown. When they disagree the server wins, and a
 * reporter has been shown a question whose answer is then dropped — which is
 * exactly the bug the equivalence test exists to make impossible.
 */

var YES = 'yes';
var NO = 'no';

/**
 * Is this condition satisfied by the answers given so far?
 *
 * `answers` is a plain object of NORMALIZED answers, in the shapes the form
 * produces and the server agrees to: a boolean for a yes/no question, a
 * string for choose-one and place, an array for choose-any.
 *
 * AN UNANSWERED CONTROLLING QUESTION MEANS NOT SHOWN, matching the server.
 * Somebody who has not yet reached the question that decides this one has
 * not asked for it, and defaulting to shown would put a question in front of
 * people it was written to spare.
 */
function conditionMet(condition, answers){
  if(!condition) return true;
  var given = answers ? answers[condition.field] : undefined;
  if(given===undefined||given===null) return false;
  if(typeof given==='boolean') return condition.in.indexOf(given?YES:NO)!==-1;
  if(Array.isArray(given)) {
    return given.some(function(v){ return condition.in.indexOf(v)!==-1; });
  }
  return condition.in.indexOf(given)!==-1;
}

export {
  NO, YES, conditionMet,
};
