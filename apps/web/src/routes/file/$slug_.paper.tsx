/**
 * A logbook's paper copy (features/paper/). A door like the form itself: it
 * reads only the logbook's form and the publication card, both calls a
 * door lets through, so it prints on a site behind its password too.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { publicLogbookQuery } from '@/features/form/FilingForm.tsx';
import { coordinatorCardQuery } from '@/features/intake/queries.ts';
import { PaperForm, PaperNotice } from '@/features/paper/PaperForm.tsx';
import { logbookSections } from '@/features/paper/paperQuestions.ts';

export const Route = createFileRoute('/file/$slug_/paper')({
  component: LogbookPaper,
});

function LogbookPaper() {
  const { slug } = Route.useParams();
  const logbook = useQuery(publicLogbookQuery(slug));
  // The coordinator's wording: a paper sheet is typed in through intake,
  // which seals this card's digest (features/intake/AccountDialog.tsx).
  const card = useQuery(coordinatorCardQuery);
  if (logbook.isPending || card.isPending) {
    return <PaperNotice>Loading the questions…</PaperNotice>;
  }
  if (logbook.isError) return <PaperNotice>There is no logbook at this address.</PaperNotice>;
  const l = logbook.data;
  return (
    <PaperForm
      kind="logbook"
      title={l.title}
      blurb={l.blurb}
      sections={logbookSections(l.fields)}
      onlineAt={`${window.location.host}/file/${l.slug}`}
      card={card.data}
      terms={l.publication_terms}
      version={l.form}
      asksFiles={l.asks_for_files}
    />
  );
}
