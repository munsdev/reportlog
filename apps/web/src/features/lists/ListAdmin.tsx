/**
 * Every list, and making one.
 *
 * THE CONTAINER IS THE FIRST QUESTION. A general form builder invites an
 * operator to build the wrong thing: to collect first-hand accounts in a list,
 * unsealed and erased on a timer, because the list builder was right there.
 * So making a list starts by asking, in plain words, whether what people send
 * has to be permanent and checkable, and a yes sends the operator to the
 * logbooks. Nobody should reach a list by default.
 */
import { roleSatisfies } from '@reportlog/access';
import { createList } from '@reportlog/contracts';
import type { ListDetail } from '@reportlog/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Alert } from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card } from '../../components/ui/card.tsx';
import { Chip } from '../../components/ui/chip.tsx';
import { Empty } from '../../components/ui/empty.tsx';
import { Field, FieldDescription, FieldError } from '../../components/ui/field.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import { RadioGroup, RadioOption } from '../../components/ui/radio-group.tsx';
import { useMe } from '../identity/session.ts';
import { SignInPrompt } from '../identity/SignInPrompt.tsx';
import { call } from '../../lib/api.ts';
import { listsQuery } from './queries.ts';
import { VISIBILITY } from './words.ts';

/**
 * Review is for moderators AND administrators (admin does not imply
 * moderator, so both are named). Courtesy, not security: the server refuses
 * the same people on every review route.
 */
export function ReviewersOnly({ children }: { children: ReactNode }) {
  const me = useMe();
  const { pathname } = useLocation();
  if (me.isPending) return <p role="status">Loading…</p>;
  if (!me.data?.signedIn) return <SignInPrompt next={pathname} />;
  const role = me.data.role;
  if (!roleSatisfies(role, 'moderator') && !roleSatisfies(role, 'admin')) {
    return (
      <section className="space-y-3">
        <h1 className="font-display text-2xl font-bold">Not for this account</h1>
        <p>Only a moderator or an administrator can open this page. Ask one if you need to.</p>
      </section>
    );
  }
  return <>{children}</>;
}

export function ListAdmin() {
  const query = useQuery(listsQuery());
  const [making, setMaking] = useState(false);
  const make = (
    <Button
      aria-expanded={making}
      onClick={() => {
        setMaking(!making);
      }}
    >
      Make a list
    </Button>
  );
  return (
    <StaffPage
      title="Lists"
      lede="A list is a form whose entries are not sealed or chained. Its personal half is deleted on a timer, a moderator approves entries in bulk, and only counts are ever published."
      // One "Make" button at a time: an empty page carries it in its empty state.
      actions={making || query.data?.lists.length === 0 ? null : make}
    >
      <p className="text-ink-alt">
        Entries are approved under{' '}
        <Link to="/lists/review" className="underline underline-offset-4">
          Review entries
        </Link>
        ; one person’s entries across every list are under{' '}
        <Link to="/lists/search" className="underline underline-offset-4">
          Find somebody's entries
        </Link>
        .
      </p>

      {making ? (
        <NewList
          onCancel={() => {
            setMaking(false);
          }}
        />
      ) : null}

      {query.isPending ? <p role="status">Reading the lists…</p> : null}
      {query.isError ? <Alert tone="serious">{query.error.message}</Alert> : null}
      {query.isSuccess ? (
        query.data.lists.length === 0 ? (
          making ? null : (
            <Empty title="No lists yet">
              Make one for links, check-ins or messages.
              <span className="mt-3 flex justify-center">{make}</span>
            </Empty>
          )
        ) : (
          <ul className="flex flex-col gap-3" aria-label="Lists">
            {query.data.lists.map((l) => (
              <li key={l.id}>
                <Card className="gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-lg font-bold">{l.title}</span>
                      <Chip tone="tag">{VISIBILITY[l.visibility].label}</Chip>
                      <Chip tone={l.accepting ? 'tag' : 'open'}>
                        {l.accepting ? 'Taking entries' : 'Not taking entries'}
                      </Chip>
                    </span>
                    <span className="font-mono text-sm break-all text-muted">
                      /list/{l.slug} · {String(l.received)} received · {String(l.waiting)} waiting
                      for review
                    </span>
                  </div>
                  <div className="shrink-0">
                    <Button asChild variant="secondary">
                      <Link to="/lists/$id" params={{ id: l.id }} aria-label={`Open ${l.title}`}>
                        Open
                      </Link>
                    </Button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </StaffPage>
  );
}

function NewList({ onCancel }: { onCancel: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const lists = useQuery(listsQuery());
  const [permanent, setPermanent] = useState('');
  const [template, setTemplate] = useState('');
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const make = useMutation({
    mutationFn: () =>
      call(createList, {
        body: {
          template,
          ...(title.trim() ? { title: title.trim() } : {}),
          ...(slug.trim() ? { slug: slug.trim() } : {}),
        },
      }),
    onSuccess: async (made: ListDetail) => {
      await qc.invalidateQueries({ queryKey: listsQuery().queryKey });
      await navigate({ to: '/lists/$id', params: { id: made.id } });
    },
  });
  const chosen = lists.data?.templates.find((t) => t.slug === template);

  return (
    <Card heading="Make a list">
      <div>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            make.mutate();
          }}
        >
          <Field>
            <Label>Does what people send need to be permanent and checkable?</Label>
            <FieldDescription>
              First-hand accounts of something that happened usually do. A list keeps nothing
              permanently except links and choices, and seals nothing.
            </FieldDescription>
            <RadioGroup value={permanent} onValueChange={setPermanent}>
              <RadioOption
                value="yes"
                label="Yes, it has to be permanent and checkable"
                hint="Then it belongs in a logbook: every report fingerprinted and chained."
              />
              <RadioOption
                value="no"
                label="No: links, check-ins or messages"
                hint="A list. Its personal half is deleted on a timer."
              />
            </RadioGroup>
          </Field>

          {permanent === 'yes' ? (
            <Alert title="Make a logbook instead">
              <Link to="/logbooks" className="underline">
                Go to the logbooks
              </Link>
              . A logbook seals every report and keeps it for good, which is what a record of
              something that happened needs.
            </Alert>
          ) : null}

          {permanent === 'no' ? (
            <>
              <Field>
                <Label>Start from</Label>
                <RadioGroup value={template} onValueChange={setTemplate}>
                  {(lists.data?.templates ?? []).map((t) => (
                    <RadioOption
                      key={t.slug}
                      value={t.slug}
                      label={t.title}
                      hint={`${t.blurb ?? ''} Asks: ${t.questions.join('; ')}. ${
                        t.requires_email
                          ? 'People who write something are asked for an email address.'
                          : 'Asks nobody for an email address.'
                      }`}
                    />
                  ))}
                </RadioGroup>
              </Field>
              <Field>
                <Label optional>Title</Label>
                <FieldDescription>
                  {chosen
                    ? `Leave empty to call it “${chosen.title}”.`
                    : 'What the list is called.'}
                </FieldDescription>
                <Input
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                  }}
                />
              </Field>
              <Field>
                <Label optional>Web address</Label>
                <FieldDescription>
                  {`The form will be at /list/${slug.trim() || (chosen?.slug ?? '…')}. Lowercase letters, numbers and hyphens.`}
                </FieldDescription>
                <Input
                  value={slug}
                  onChange={(e) => {
                    setSlug(e.target.value);
                  }}
                  className="font-mono"
                />
                <FieldError>{make.error?.message}</FieldError>
              </Field>
              <p className="text-sm text-ink-alt">
                A new list starts hidden. Nobody outside sees it until you make it listed.
              </p>
              <Button type="submit" disabled={!template || make.isPending}>
                Make the list
              </Button>
            </>
          ) : null}
          <div>
            <Button type="button" variant="quiet" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </Card>
  );
}
