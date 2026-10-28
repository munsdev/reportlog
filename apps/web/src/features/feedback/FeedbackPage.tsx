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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import { call } from '../../lib/api.ts';
import { Choice, Choices } from '../../mockup/Choice.tsx';
import { Chip } from '../../mockup/Chip.tsx';
import { Empty } from '../../mockup/Empty.tsx';
import { ErrorLine } from '../../mockup/ErrorLine.tsx';
import { AreaField, TextField } from '@/mockup/Field.tsx';
import { Panel } from '@/mockup/Panel.tsx';
import { Saved } from '../../mockup/Saved.tsx';
import { Btn } from '@/mockup/Btn.tsx';
import { Tbl } from '../../mockup/Tbl.tsx';
import { FeedbackTabs } from './FeedbackTabs.tsx';
import { feedbackListQuery, feedbackQuery } from './queries.ts';
import { IssueLine, StatusChip, pageNameFor, when } from './words.tsx';

export function FeedbackPage({ from }: { from?: string | undefined }) {
  return (
    <StaffPage
      title="Feedback"
      lede="Tell the people building this what is broken or confusing. This is about the site itself, not about any report."
      tabs={<FeedbackTabs />}
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
    <Panel title="File something new">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          file.mutate();
        }}
      >
        {about ? (
          <p>
            <Chip>About: {pageNameFor(about) ?? about}</Chip>{' '}
            <Btn
              sm
              flat
              look="ghost"
              onClick={() => {
                setAbout(undefined);
              }}
            >
              Not about this page
            </Btn>
          </p>
        ) : null}
        <span className="lbl">What kind of feedback is it?</span>
        <Choices>
          {FEEDBACK_TYPES.map((t) => (
            <Choice
              key={t}
              name="fk"
              checked={type === t}
              onChange={() => {
                setType(t);
              }}
            >
              {FEEDBACK_TYPE_LABELS[t]}
            </Choice>
          ))}
        </Choices>
        <span className="lbl">How much does it get in your way?</span>
        <Choices>
          {FEEDBACK_SEVERITIES.map((s) => (
            <Choice
              key={s}
              name="fw"
              checked={severity === s}
              onChange={() => {
                setSeverity(s);
              }}
            >
              {FEEDBACK_SEVERITY_LABELS[s]}
            </Choice>
          ))}
        </Choices>
        <TextField
          label="A title"
          help="A few words someone could recognise it by."
          value={title}
          maxLength={MAX_FEEDBACK_TITLE}
          onChange={(e) => {
            setTitle(e.target.value);
          }}
        />
        <AreaField
          label="What happened?"
          help="What you did, what you expected, and what happened instead. The screen you came from and your browser are sent with it."
          value={body}
          maxLength={MAX_FEEDBACK_BODY}
          onChange={(e) => {
            setBody(e.target.value);
          }}
        />
        <TextField
          label="A report’s reference, if it is about one (optional)"
          value={ref}
          maxLength={60}
          onChange={(e) => {
            setRef(e.target.value);
          }}
        />
        <ErrorLine error={file.error} />
        {file.isSuccess ? (
          <Saved>
            <b>Filed as #{String(file.data.id)}. Thank you.</b> You will get an email when somebody
            changes its status.
          </Saved>
        ) : null}
        <Btn sm flat look="ink" type="submit" disabled={file.isPending}>
          File it
        </Btn>
      </form>
    </Panel>
  );
}

function Issues() {
  const list = useQuery(feedbackListQuery);
  const [openId, setOpenId] = useState<number | null>(null);
  if (list.isPending) return <p role="status">Loading what has been filed…</p>;
  if (list.isError) return <ErrorLine error={list.error} />;
  return (
    <>
      <h2 className="h-sec">What has been filed</h2>
      <p className="m">Newest first, so a duplicate is seen before it is filed.</p>
      {list.data.issues.length === 0 ? (
        <Empty title="Nothing filed yet">What testers file appears here, newest first.</Empty>
      ) : (
        <Tbl
          cols={['#', 'What', 'State']}
          widths="60px 1fr auto"
          rows={list.data.issues.map((issue) => ({
            key: issue.id,
            cells: [
              String(issue.id),
              <>
                {issue.title}
                <IssueLine issue={issue} />
                <Btn
                  sm
                  flat
                  look="ghost"
                  aria-expanded={openId === issue.id}
                  onClick={() => {
                    setOpenId(openId === issue.id ? null : issue.id);
                  }}
                >
                  {openId === issue.id ? 'Close' : 'Read it'}
                </Btn>
              </>,
              <StatusChip status={issue.status} />,
            ],
          }))}
        />
      )}
      {openId !== null ? (
        <Panel
          title={`#${String(openId)} ${list.data.issues.find((i) => i.id === openId)?.title ?? ''}`}
        >
          <IssueDetail id={openId} />
        </Panel>
      ) : null}
    </>
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
  if (detail.isError) return <ErrorLine error={detail.error} />;
  const d = detail.data;
  return (
    <>
      <p style={{ whiteSpace: 'pre-wrap' }}>{d.body}</p>
      {d.related_ref ? <p className="m">About report {d.related_ref}.</p> : null}
      {d.changes.length ? (
        <>
          <h3>Replies</h3>
          {d.changes.map((c) => (
            <div key={c.created_at}>
              <p className="m">
                {when(c.created_at)}: now <b>{FEEDBACK_STATUS_LABELS[c.status]}</b>
              </p>
              <p style={{ whiteSpace: 'pre-wrap' }}>{c.note}</p>
            </div>
          ))}
        </>
      ) : null}
      <h3>Comments</h3>
      {d.comments.length === 0 ? <p className="m">No comments yet.</p> : null}
      {d.comments.map((c, i) => (
        <div key={`${c.created_at}-${String(i)}`}>
          <p className="m">
            {c.mine ? 'You' : c.author}, {when(c.created_at)}
          </p>
          <p style={{ whiteSpace: 'pre-wrap' }}>{c.body}</p>
        </div>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <AreaField
          label="Add a comment"
          help="Comments cannot be changed afterwards."
          rows={3}
          value={comment}
          onChange={(e) => {
            setComment(e.target.value);
          }}
        />
        <ErrorLine error={add.error} />
        <Btn sm flat type="submit" disabled={add.isPending}>
          Add the comment
        </Btn>
      </form>
    </>
  );
}
