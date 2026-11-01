/**
 * A list's paper copy (features/paper/). A door like the list's form: it
 * reads only that form, the one call a list's door lets through.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { listFormQuery } from '@/features/lists/queries.ts';
import { PaperForm, PaperNotice } from '@/features/paper/PaperForm.tsx';
import { listSections } from '@/features/paper/paperQuestions.ts';

export const Route = createFileRoute('/list/$slug_/paper')({
  component: ListPaper,
});

function ListPaper() {
  const { slug } = Route.useParams();
  const form = useQuery(listFormQuery(slug));
  if (form.isPending) return <PaperNotice>Loading the questions…</PaperNotice>;
  if (form.isError) return <PaperNotice>There is no list at this address.</PaperNotice>;
  const f = form.data;
  return (
    <PaperForm
      kind="list"
      title={f.title}
      blurb={f.blurb}
      sections={listSections(f.fields)}
      onlineAt={`${window.location.host}/list/${f.slug}`}
      asksFiles={false}
    />
  );
}
