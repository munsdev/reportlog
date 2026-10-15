## What this changes

<!-- One or two sentences. What was wrong or missing, and what this does
     about it. Plain language — this gets read by people deciding whether
     to trust the change, not only by people reading the diff. -->

## The hashed object

ReportLog's whole claim is that a report, once filed, cannot be silently
altered. That claim lives in one place: the object that gets canonicalized
and hashed in `src/reportCore.js`, and rebuilt in `src/verify.js`.

Tick one:

- [ ] **This change does not touch the hashed object.** No key added,
      removed, renamed or made conditional differently; no change to how a
      value is normalized before hashing.
- [ ] **This change does touch it**, and I have said so below and explained
      why every report already filed still verifies unchanged.
- [ ] **I am not sure.** Say so — this is a fine answer and a reviewer will
      work it out with you. It is much cheaper than guessing.

<!-- If you ticked the second box, explain here. The rule that makes most
     additions safe: a key is written into the hashed object ONLY when it
     applies, so an absent key costs nothing. Making an optional field
     unconditional changes the fingerprint of every report ever filed. -->

## Tests

- [ ] `npm test` passes
- [ ] The browser suite passes, or this change cannot affect it (say which)
- [ ] Where this fixes a bug, there is a test that fails without the fix

<!-- A rule in prose is not a check. If you found something the tests let
     through, the test is part of the fix. -->

## Sign-off

- [ ] My commits are signed off (`git commit -s`) under the Developer
      Certificate of Origin — https://developercertificate.org/

## Anything a reviewer should know

<!-- Decisions you made that could reasonably have gone another way, things
     you were unsure about, anything you deliberately left out of scope. -->
