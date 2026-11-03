/**
 * One link's verdict, wherever the link appears: on a report's page and on a
 * list entry (docs/design/moderation-unified.md). It replaced the Links page.
 *
 * CHECKED ONCE FOR EVERY COPY. A verdict belongs to the link's group, one per
 * address (links/checks.ts): judging it here judges it in every report and tip
 * that sent it, now and later, and a link already judged anywhere shows that
 * verdict here. The same `checkLinkGroup` call the Links page made.
 *
 * A LINK IS TEXT, NEVER AN ANCHOR (K6, X1). Nothing here opens, previews or
 * fetches one. The only anchors are the two hotlines.
 *
 * "Illegal" erases every copy at once and cannot be undone, so it asks for the
 * category and for the hotline procedure to have been followed. Nothing else
 * asks for a reason.
 */
import {
  HOTLINES,
  LINK_COMMENT_WARNING,
  LINK_REASONS,
  MAX_LINK_COMMENT,
  checkLinkGroup,
  commentLinkGroup,
  getLinkGroupHistory,
} from '@reportlog/contracts';
import type { BlockKind, LinkOutcome, LinkReason } from '@reportlog/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Btn } from '../../mockup/Btn.tsx';
import { CheckBox, Field, FieldDescription, Label, Select, Textarea } from '@/mockup/Field.tsx';
import { Choice, Choices } from '@/mockup/Choice.tsx';
import { Problem } from '../../mockup/Notice.tsx';
import { call } from '../../lib/api.ts';

/** How a link stands, in the words a moderator reads. */
export const VERDICT_WORDS: Record<LinkOutcome | 'unchecked', string> = {
  unchecked: 'Not judged yet',
  checked: 'Passes: vetted journalists may see it',
  withheld: 'Withheld from journalists',
  illegal: 'Illegal: erased',
};

const CHOICES: Record<LinkOutcome, string> = {
  checked: 'Passes: vetted journalists may see it',
  withheld: 'Withheld: legal, but abusive, worthless or harassing. Journalists never see it',
  illegal: 'Illegal: erase every copy now',
};

const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '');

/** A stored category in words; one the screen does not know is shown as stored. */
const reasonLabel = (r: string | undefined) =>
  r && Object.hasOwn(LINK_REASONS, r) ? LINK_REASONS[r as LinkReason] : (r ?? '');

/** What a verdict changes: the queues' filters, both hubs, and the old check queue's cache. */
export function useLinkRefresh() {
  const qc = useQueryClient();
  return async () => {
    await qc.invalidateQueries({ queryKey: ['moderation'] });
    await qc.invalidateQueries({ queryKey: ['written'] });
    await qc.invalidateQueries({ queryKey: ['list-review'] });
  };
}

export interface LinkGroupRef {
  group_id: number;
  outcome: LinkOutcome | null;
  comment: string | null;
}

/**
 * The verdict line, and under it the way to judge the link (or judge it
 * again), its comment for journalists once it passes, and its history.
 */
export function LinkVerdict({ link, sources }: { link: LinkGroupRef; sources?: string }) {
  const [judging, setJudging] = useState(false);
  const erased = link.outcome === 'illegal';
  return (
    <div className="col">
      <p className="m">
        {VERDICT_WORDS[link.outcome ?? 'unchecked']}. {sources ?? ''}
        Judged once for every copy, wherever it was sent.
      </p>
      {erased ? null : (
        <>
          <div className="acts">
            <Btn
              sm
              flat
              aria-expanded={judging}
              onClick={() => {
                setJudging((j) => !j);
              }}
            >
              {link.outcome ? 'Judge it again' : 'Judge this link'}
            </Btn>
          </div>
          {judging ? (
            <JudgeForm
              groupId={link.group_id}
              onDone={() => {
                setJudging(false);
              }}
            />
          ) : null}
          {link.outcome === 'checked' ? <CommentForm link={link} /> : null}
        </>
      )}
      <History id={link.group_id} />
    </div>
  );
}

/**
 * X5: the procedure is outside the code; the form points at it whenever
 * "Illegal" is chosen.
 */
export function Hotlines() {
  return (
    <div className="panel quiet">
      <p>
        <b>If a link may be illegal</b>
      </p>
      <ol>
        <li>Do not download it, save it or send it to anybody.</li>
        <li>
          Report it to a hotline:{' '}
          {HOTLINES.map((h, i) => (
            <span key={h.url}>
              {i ? ' or ' : ''}
              <a href={h.url} target="_blank" rel="noopener noreferrer nofollow">
                {h.name}
              </a>
            </span>
          ))}
          .
        </li>
        <li>
          Then mark it illegal here. Every copy is erased, and you can block it from coming back.
        </li>
      </ol>
    </div>
  );
}

function JudgeForm({ groupId, onDone }: { groupId: number; onDone: () => void }) {
  const refresh = useLinkRefresh();
  const id = useId();
  const [outcome, setOutcome] = useState<LinkOutcome | ''>('');
  const [reason, setReason] = useState<LinkReason | ''>('');
  const [block, setBlock] = useState<BlockKind | ''>('');
  const [followed, setFollowed] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      call(checkLinkGroup, {
        params: { id: groupId },
        body: {
          outcome,
          ...(outcome === 'illegal' && reason ? { reason } : {}),
          ...(outcome === 'illegal' && block ? { block } : {}),
        },
      }),
    onSuccess: async () => {
      onDone();
      await refresh();
    },
  });
  const ready = outcome !== '' && (outcome !== 'illegal' || (reason !== '' && followed));
  return (
    <div className="col">
      <div role="radiogroup" aria-labelledby={`${id}-legend`}>
        <span className="lbl" id={`${id}-legend`}>
          Your verdict on this link
        </span>
        <Choices>
          {(Object.keys(CHOICES) as LinkOutcome[]).map((o) => (
            <Choice
              key={o}
              name={id}
              value={o}
              checked={outcome === o}
              onChange={() => {
                setOutcome(o);
              }}
            >
              {CHOICES[o]}
            </Choice>
          ))}
        </Choices>
      </div>
      {outcome === 'illegal' ? (
        <>
          <Hotlines />
          <Field controlId={`${id}-reason`}>
            <Label>Why it is illegal</Label>
            <Select
              value={reason}
              onChange={(e) => {
                setReason(e.target.value as LinkReason | '');
              }}
            >
              <option value="">Choose one</option>
              {(Object.keys(LINK_REASONS) as LinkReason[]).map((r) => (
                <option key={r} value={r}>
                  {LINK_REASONS[r]}
                </option>
              ))}
            </Select>
          </Field>
          <Field controlId={`${id}-block`}>
            <Label>Stop it coming back</Label>
            <Select
              value={block}
              onChange={(e) => {
                setBlock(e.target.value as BlockKind | '');
              }}
            >
              <option value="">Do not block it</option>
              <option value="address">Block this exact address</option>
              <option value="domain">Block its whole site, and every subdomain</option>
            </Select>
          </Field>
          <CheckBox
            id={`${id}-followed`}
            checked={followed}
            onChange={(e) => {
              setFollowed(e.target.checked);
            }}
          >
            I have followed the procedure above. Every copy will be erased and cannot be brought
            back.
          </CheckBox>
        </>
      ) : null}
      {save.isError ? <Problem>{save.error.message}</Problem> : null}
      <div className="acts">
        <Btn
          sm
          flat
          look="ink"
          disabled={!ready || save.isPending}
          onClick={() => {
            save.mutate();
          }}
        >
          {outcome === 'illegal' ? 'Erase every copy' : 'Record the verdict'}
        </Btn>
      </div>
    </div>
  );
}

function CommentForm({ link }: { link: LinkGroupRef }) {
  const refresh = useLinkRefresh();
  const [body, setBody] = useState(link.comment ?? '');
  const save = useMutation({
    mutationFn: () => call(commentLinkGroup, { params: { id: link.group_id }, body: { body } }),
    onSuccess: refresh,
  });
  const id = `comment-${String(link.group_id)}`;
  return (
    <Field controlId={id}>
      <Label>Comment for journalists</Label>
      <FieldDescription id={`${id}-warning`}>{LINK_COMMENT_WARNING}</FieldDescription>
      <Textarea
        rows={2}
        maxLength={MAX_LINK_COMMENT}
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
        }}
      />
      {save.isError ? <Problem>{save.error.message}</Problem> : null}
      {save.isSuccess ? <p role="status">Saved.</p> : null}
      <div className="acts">
        <Btn
          sm
          flat
          disabled={save.isPending || body.trim() === (link.comment ?? '')}
          onClick={() => {
            save.mutate();
          }}
        >
          Save the comment
        </Btn>
      </div>
    </Field>
  );
}

function History({ id }: { id: number }) {
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ['link-checks', 'history', id],
    queryFn: ({ signal }) => call(getLinkGroupHistory, { params: { id }, signal }),
    enabled: open,
  });
  return (
    <div className="col">
      <div className="acts">
        <Btn
          sm
          flat
          look="ghost"
          aria-expanded={open}
          onClick={() => {
            setOpen((o) => !o);
          }}
        >
          {open ? 'Hide the link’s history' : 'Show the link’s history'}
        </Btn>
      </div>
      {open && query.data ? (
        query.data.items.length ? (
          <div className="code" aria-label="History" role="group">
            {query.data.items
              .map(
                (it) =>
                  `${when(it.at)}, ${it.by}: ${
                    it.kind === 'check'
                      ? VERDICT_WORDS[it.outcome ?? 'unchecked']
                      : it.kind === 'erasure'
                        ? `erased ${String(it.erased ?? 0)} ${it.erased === 1 ? 'copy' : 'copies'} (${reasonLabel(it.reason_category)})`
                        : it.comment
                          ? `comment: “${it.comment}”`
                          : 'cleared the comment'
                  }`,
              )
              .join('\n')}
          </div>
        ) : (
          <p className="muted">Nothing decided yet.</p>
        )
      ) : null}
    </div>
  );
}
