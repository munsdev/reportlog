/**
 * The line that goes beside every number (P3): the sentence in
 * `NOT_A_SAMPLE`, which says these are reports people chose to file.
 *
 * ONE COMPONENT, ONE SOURCE. The words are `NOT_A_SAMPLE` in
 * @reportlog/contracts, served by the API with each set of figures; a figure
 * passes what it was sent as `line`, and the contract's own constant is used
 * only if a response is missing it. Nothing else on the website spells the
 * sentence out, so a page cannot show a number with a different version of
 * it. A page that shows a number renders this beside it, and the test beside
 * this file fails for any figure page that does not.
 */
import { NOT_A_SAMPLE } from '@reportlog/contracts';

export function NotASample({ line }: { line?: string | undefined }) {
  return (
    <p className="text-sm text-ink-alt" data-not-a-sample>
      {line === undefined || line === '' ? NOT_A_SAMPLE : line}
    </p>
  );
}
