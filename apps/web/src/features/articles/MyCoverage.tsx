/**
 * A journalist's coverage profile (decision 84): how they are credited, the
 * articles they linked, and the form to link another.
 *
 * Every article waits for a moderator before anybody else sees it. Listed,
 * once approved it goes on the public coverage list beside the reports and
 * on the maps; not listed, it stays here. The journalist can change that, or
 * remove an article, at any time.
 */
import {
  addMyArticle,
  removeMyArticle,
  setMyArticleListed,
  setMyByline,
} from '@reportlog/contracts';
import type { ArticleBody, MyArticle, MyCoverage } from '@reportlog/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Btn } from '@/mockup/Btn.tsx';
import { Chip } from '@/mockup/Chip.tsx';
import { CheckBox, TextField } from '@/mockup/Field.tsx';
import { ErrorNote, Note, Waiting } from '@/mockup/Note.tsx';
import { call } from '../../lib/api.ts';
import { PublicPage } from '../site-pages/PublicPage.tsx';
import { useJournalistAccess } from '../journalists/access.ts';
import { useMe } from '../identity/session.ts';
import { LinkCard } from './LinkCard.tsx';
import { PlacePicker, type Where } from './PlacePicker.tsx';
import { myCoverageQuery } from './queries.ts';

const NOWHERE: Where = { national: false, international: false, places: [] };

export function MyCoveragePage() {
  const me = useMe();
  const access = useJournalistAccess();
  const title = 'Your coverage';
  if (me.isPending || access === 'loading') {
    return (
      <PublicPage title={title} width="prose">
        <p role="status">Loading…</p>
      </PublicPage>
    );
  }
  if (access !== 'yes') {
    return (
      <PublicPage title={title} width="prose">
        <p>
          Linking your articles is for journalists with access. Apply, or finish what is missing,
          from <Link to="/desk">the journalist door</Link>.
        </p>
      </PublicPage>
    );
  }
  return (
    <PublicPage
      title={title}
      width="prose"
      lede="Link articles you wrote about events reports describe. A moderator looks at each one first. Then, if you choose, it appears on the public coverage list beside the reports and on the maps, in the places you name."
    >
      <MyCoverageBody />
    </PublicPage>
  );
}

function MyCoverageBody() {
  const client = useQueryClient();
  const state = useQuery(myCoverageQuery);
  const keep = (data: MyCoverage) => {
    client.setQueryData(myCoverageQuery.queryKey, data);
    void client.invalidateQueries({ queryKey: ['coverage', 'list'] });
    void client.invalidateQueries({ queryKey: ['coverage', 'counts'] });
  };
  if (state.isPending) return <Waiting>Loading your coverage…</Waiting>;
  if (state.isError) return <ErrorNote error={state.error} />;
  return (
    <div className="form-stack">
      <BylineForm data={state.data} onSaved={keep} />
      <AddArticle onSaved={keep} />
      <section className="grid gap-3" aria-labelledby="your-articles">
        <h2 id="your-articles" className="h-sec">
          Your articles
        </h2>
        {state.data.articles.length === 0 ? (
          <p className="muted">None linked yet.</p>
        ) : (
          state.data.articles.map((a) => <OwnArticle key={a.id} article={a} onSaved={keep} />)
        )}
      </section>
    </div>
  );
}

function BylineForm({ data, onSaved }: { data: MyCoverage; onSaved: (d: MyCoverage) => void }) {
  const [name, setName] = useState(data.byline?.name ?? '');
  const [outlet, setOutlet] = useState(data.byline?.outlet ?? '');
  const save = useMutation({
    mutationFn: () => call(setMyByline, { body: { name, ...(outlet.trim() ? { outlet } : {}) } }),
    onSuccess: onSaved,
  });
  return (
    <form
      className="grid gap-3"
      aria-labelledby="byline-h"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <h2 id="byline-h" className="h-sec">
        How you are credited
      </h2>
      <p className="muted">
        Shown with your listed articles. This is public, unlike the name and outlet you gave when
        you applied.
      </p>
      <TextField
        label="Name"
        value={name}
        required
        maxLength={120}
        onChange={(e) => {
          setName(e.target.value);
        }}
      />
      <TextField
        label="Outlet"
        help="Optional."
        value={outlet}
        maxLength={160}
        onChange={(e) => {
          setOutlet(e.target.value);
        }}
      />
      <ErrorNote error={save.error} />
      {save.isSuccess ? <Note>Saved.</Note> : null}
      <div className="btn-row">
        <Btn type="submit" look="ink" busy={save.isPending} busyLabel="Saving…">
          Save
        </Btn>
      </div>
    </form>
  );
}

function AddArticle({ onSaved }: { onSaved: (d: MyCoverage) => void }) {
  const [url, setUrl] = useState('');
  const [day, setDay] = useState('');
  const [where, setWhere] = useState<Where>(NOWHERE);
  const [listed, setListed] = useState(true);
  const [sent, setSent] = useState(false);
  const add = useMutation({
    mutationFn: () => {
      const body: ArticleBody = {
        url,
        ...(day ? { happened_on: day } : {}),
        ...where,
        listed,
      };
      return call(addMyArticle, { body });
    },
    onSuccess: (data) => {
      onSaved(data);
      setUrl('');
      setDay('');
      setWhere(NOWHERE);
      setListed(true);
      setSent(true);
    },
  });
  const nowhere = !where.national && !where.international && where.places.length === 0;
  return (
    <form
      className="grid gap-4"
      aria-labelledby="add-h"
      onSubmit={(e) => {
        e.preventDefault();
        add.mutate();
      }}
    >
      <h2 id="add-h" className="h-sec">
        Link an article
      </h2>
      <TextField
        label="Address of the article"
        type="url"
        inputMode="url"
        placeholder="https://"
        required
        value={url}
        onChange={(e) => {
          setUrl(e.target.value);
          // Typing a new address puts the last "Linked" away.
          if (e.target.value) setSent(false);
        }}
      />
      <TextField
        label="When did it happen?"
        help="The day of the events it reports, if there is one."
        type="date"
        value={day}
        onChange={(e) => {
          setDay(e.target.value);
        }}
      />
      <PlacePicker value={where} onChange={setWhere} />
      <CheckBox
        checked={listed}
        onChange={(e) => {
          setListed(e.target.checked);
        }}
      >
        Show it on the public coverage list and the maps, with my name, once a moderator approves it
      </CheckBox>
      <ErrorNote error={add.error} />
      {sent ? <Note>Linked. It is waiting for a moderator.</Note> : null}
      <div className="btn-row">
        <Btn
          type="submit"
          look="go"
          disabled={!url || nowhere}
          busy={add.isPending}
          busyLabel="Linking…"
        >
          Link it
        </Btn>
      </div>
      {nowhere && url ? <p className="m">Say where it is about first.</p> : null}
    </form>
  );
}

const REVIEW: Record<MyArticle['review'], { kind: 'ok' | 'wait' | 'off'; label: string }> = {
  waiting: { kind: 'wait', label: 'Waiting for a moderator' },
  approved: { kind: 'ok', label: 'Approved' },
  declined: { kind: 'off', label: 'Not approved' },
};

function OwnArticle({
  article,
  onSaved,
}: {
  article: MyArticle;
  onSaved: (d: MyCoverage) => void;
}) {
  const listed = useMutation({
    mutationFn: (on: boolean) =>
      call(setMyArticleListed, { params: { id: article.id }, body: { listed: on } }),
    onSuccess: onSaved,
  });
  const remove = useMutation({
    mutationFn: () => call(removeMyArticle, { params: { id: article.id } }),
    onSuccess: onSaved,
  });
  const r = REVIEW[article.review];
  const where =
    article.review === 'approved'
      ? article.listed
        ? 'On the public list and the maps.'
        : 'On your profile only.'
      : article.listed
        ? 'Goes on the public list and the maps once approved.'
        : 'Stays on your profile only.';
  return (
    <LinkCard article={article}>
      <p className="flex flex-wrap items-center gap-2">
        <Chip kind={r.kind}>{r.label}</Chip>
        <span className="m">{where}</span>
      </p>
      {article.review_note ? (
        <p className="m">Moderator&rsquo;s note: {article.review_note}</p>
      ) : null}
      <ErrorNote error={listed.error ?? remove.error} />
      <div className="btn-row">
        <Btn
          sm
          busy={listed.isPending}
          onClick={() => {
            listed.mutate(!article.listed);
          }}
        >
          {article.listed ? 'Keep it to my profile' : 'Show it publicly'}
        </Btn>
        <Btn
          sm
          look="bad"
          busy={remove.isPending}
          onClick={() => {
            if (window.confirm('Remove this article? It is deleted, not hidden.')) remove.mutate();
          }}
        >
          Remove
        </Btn>
      </div>
    </LinkCard>
  );
}
