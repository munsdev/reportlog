/**
 * What a journalist sees on a report beyond the public page (decision 81):
 * the moderators' note and Sources links. Text only: a link is something to
 * copy into a browser on purpose, never an anchor, because this site never
 * fetches or opens one.
 */
import type { DeskReport } from '@reportlog/contracts';
import { CopyableLink } from '../journalists/Desk.tsx';

export function JournalistExtras({ extras }: { extras: DeskReport | null | undefined }) {
  if (!extras || (!extras.note && !extras.sources.length)) return null;
  return (
    <section aria-label="For journalists" className="paper" data-journalist-extras>
      <p className="quiet">For journalists · not public</p>
      {extras.note ? <p className="whitespace-pre-wrap">{extras.note}</p> : null}
      {extras.sources.map((s) => (
        <div key={s.url}>
          <p className="m">
            {s.title}
            {s.publisher ? `, ${s.publisher}` : ''}
            {s.published_on ? `, ${s.published_on}` : ''}
          </p>
          <CopyableLink url={s.url} />
        </div>
      ))}
    </section>
  );
}
