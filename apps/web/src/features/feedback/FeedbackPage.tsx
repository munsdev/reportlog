/**
 * The tracker as a tester sees it: a form to file an issue, then every
 * tester's issues, newest first, so a duplicate is seen before it is filed
 * and "seeing this too" can be said in a comment.
 *
 * Authors are masked handles. What a tester wrote is never edited; the
 * administrator answers with a change of status and a note.
 */
import {
  FEEDBACK_SEVERITIES,
  FEEDBACK_SEVERITY_LABELS,
  FEEDBACK_STATUS_LABELS,
  FEEDBACK_TYPES,
  FEEDBACK_TYPE_LABELS,
  MAX_FEEDBACK_BODY,
  MAX_FEEDBACK_TITLE,
  commentOnFeedback,
  fileFeedback,
} from '@reportlog/contracts';
import type { FeedbackIssue } from '@reportlog/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card, CardContent } from '../../components/ui/card.tsx';
import { Chip } from '../../components/ui/chip.tsx';
import { Empty } from '../../components/ui/empty.tsx';
import { Field, FieldDescription } from '../../components/ui/field.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import { RadioGroup, RadioOption } from '../../components/ui/radio-group.tsx';
import { Textarea } from '../../components/ui/textarea.tsx';
import { call } from '../../lib/api.ts';
import { feedbackListQuery, feedbackQuery } from './queries.ts';
import { IssueLine, pageNameFor, when } from './words.tsx';

export function FeedbackPage({ from }: { from?: string | undefined }) {
  return (
    <StaffPage
      title="Feedback"
      lede="Tell the people building this what is broken or confusing. This is about the site itself, not about any report."
    >
      <FileForm from={from} />
      <Issues />
    </StaffPage>
  );
}

function FileForm({ from }: { from?: string | undefined }) {
  const client = useQueryClient();
  // Which screen it is about: the one the menu's link came from, until the
  // tester says it is not about that page.
  const [about, setAbout] = useState(from);
  const [type, setType] = useState('');
  const [severity, setSeverity] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [ref, setRef] = useState('');
  const file = useMutation({
    mutationFn: () =>
      call(fileFeedback, {
        body: {
          type,
          severity,
          title,
          body,
          ...(ref.trim() ? { related_ref: ref.trim() } : {}),
          context: {
            ...(about ? { page: about } : {}),
            viewport: `${String(window.innerWidth)}x${String(window.innerHeight)}`,
            browser: navigator.userAgent,
          },
        },
      }),
    onSuccess: () => {
      setTitle('');
      setBody('');
      setRef('');
      void client.invalidateQueries({ queryKey: ['feedback'] });
    },
  });

  return (
    <Card heading="File something new">
      <div>
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            file.mutate();
          }}
        >
          {about ? (
            <p className="flex flex-wrap items-center gap-2">
              <Chip tone="tag">About: {pageNameFor(about) ?? about}</Chip>
              <Button
                type="button"
                variant="quiet"
                onClick={() => {
                  setAbout(undefined);
                }}
              >
                Not about this page
              </Button>
            </p>
          ) : null}
          <Field>
            <Label>What kind of feedback is it?</Label>
            <RadioGroup value={type} onValueChange={setType} className="sm:grid sm:grid-cols-2">
              {FEEDBACK_TYPES.map((t) => (
                <RadioOption key={t} value={t} label={FEEDBACK_TYPE_LABELS[t]} />
              ))}
            </RadioGroup>
          </Field>
          <Field>
            <Label>How much does it get in your way?</Label>
            <RadioGroup
              value={severity}
              onValueChange={setSeverity}
              className="sm:grid sm:grid-cols-2"
            >
              {FEEDBACK_SEVERITIES.map((s) => (
                <RadioOption key={s} value={s} label={FEEDBACK_SEVERITY_LABELS[s]} />
              ))}
            </RadioGroup>
          </Field>
          <Field>
            <Label>A title</Label>
            <FieldDescription>A few words someone could recognise it by.</FieldDescription>
            <Input
              value={title}
              maxLength={MAX_FEEDBACK_TITLE}
              onChange={(e) => {
                setTitle(e.target.value);
              }}
            />
          </Field>
          <Field>
            <Label>What happened?</Label>
            <FieldDescription>
              What you did, what you expected, and what happened instead. The screen you came from
              and your browser are sent with it.
            </FieldDescription>
            <Textarea
              value={body}
              maxLength={MAX_FEEDBACK_BODY}
              onChange={(e) => {
                setBody(e.target.value);
              }}
            />
          </Field>
          <Field>
            <Label>A report’s reference, if it is about one (optional)</Label>
            <Input
              value={ref}
              className="font-mono"
              maxLength={60}
              onChange={(e) => {
                setRef(e.target.value);
              }}
            />
          </Field>
          {file.isError ? (
            <Alert tone="serious" title="That was not filed.">
              {file.error.message}
            </Alert>
          ) : null}
          {file.isSuccess ? (
            <Alert tone="done" title={`Filed as #${String(file.data.id)}. Thank you.`}>
              You will get an email when somebody changes its status.
            </Alert>
          ) : null}
          <div>
            <Button type="submit" disabled={file.isPending}>
              File it
            </Button>
          </div>
        </form>
      </div>
    </Card>
  );
}

function Issues() {
  const list = useQuery(feedbackListQuery);
  if (list.isPending) return <p role="status">Loading what has been filed…</p>;
  if (list.isError) {
    return (
      <Alert tone="serious" title="What has been filed could not be loaded.">
        {list.error.message}
      </Alert>
    );
  }
  return (
    <section className="flex flex-col gap-3" aria-labelledby="filed">
      <h2 id="filed" className="font-display text-xl font-bold">
        What has been filed
      </h2>
      <p className="text-sm text-ink-alt">
        Newest first, so a duplicate is seen before it is filed.
      </p>
      {list.data.issues.length === 0 ? (
        <Empty title="Nothing filed yet">What testers file appears here, newest first.</Empty>
      ) : null}
      <ul className="flex flex-col gap-3">
        {list.data.issues.map((issue) => (
          <li key={issue.id}>
            <IssueCard issue={issue} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function IssueCard({ issue }: { issue: FeedbackIssue }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardContent className="flex flex-col gap-2">
        <h3 className="font-display text-lg font-bold">{issue.title}</h3>
        <IssueLine issue={issue} />
        <div>
          <Button
            variant="quiet"

            aria-expanded={open}
            onClick={() => {
              setOpen(!open);
            }}
          >
            {open ? 'Close' : 'Read it'}
          </Button>
        </div>
        {open ? <IssueDetail id={issue.id} /> : null}
      </CardContent>
    </Card>
  );
}

function IssueDetail({ id }: { id: number }) {
  const client = useQueryClient();
  const detail = useQuery(feedbackQuery(id));
  const [comment, setComment] = useState('');
  const add = useMutation({
    mutationFn: () => call(commentOnFeedback, { params: { id }, body: { body: comment } }),
    onSuccess: (data) => {
      setComment('');
      client.setQueryData(feedbackQuery(id).queryKey, data);
      void client.invalidateQueries({ queryKey: feedbackListQuery.queryKey });
    },
  });
  if (detail.isPending) return <p role="status">Loading…</p>;
  if (detail.isError) return <p role="alert">{detail.error.message}</p>;
  const d = detail.data;
  return (
    <div className="flex flex-col gap-4">
      <p className="whitespace-pre-wrap">{d.body}</p>
      {d.related_ref ? <p className="text-sm">About report {d.related_ref}.</p> : null}
      {d.changes.length ? (
        <div className="flex flex-col gap-2">
          <h4 className="font-semibold">Replies</h4>
          <ol className="flex flex-col gap-2">
            {d.changes.map((c) => (
              <li key={c.created_at} className="border-l-4 border-line pl-3">
                <p className="text-sm text-ink-alt">
                  {when(c.created_at)}: now <strong>{FEEDBACK_STATUS_LABELS[c.status]}</strong>
                </p>
                <p className="whitespace-pre-wrap">{c.note}</p>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        <h4 className="font-semibold">Comments</h4>
        {d.comments.length === 0 ? <p className="text-sm">No comments yet.</p> : null}
        <ol className="flex flex-col gap-2">
          {d.comments.map((c, i) => (
            <li key={`${c.created_at}-${String(i)}`} className="border-l-4 border-line pl-3">
              <p className="text-sm text-ink-alt">
                {c.mine ? 'You' : c.author}, {when(c.created_at)}
              </p>
              <p className="whitespace-pre-wrap">{c.body}</p>
            </li>
          ))}
        </ol>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <Field>
            <Label>Add a comment</Label>
            <FieldDescription>Comments cannot be changed afterwards.</FieldDescription>
            <Textarea
              rows={3}
              value={comment}
              onChange={(e) => {
                setComment(e.target.value);
              }}
            />
          </Field>
          {add.isError ? <p role="alert">{add.error.message}</p> : null}
          <div>
            <Button type="submit" variant="secondary" disabled={add.isPending}>
              Add the comment
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
