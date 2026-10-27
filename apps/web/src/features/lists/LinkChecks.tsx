/**
 * The link check (Plan D M3 to M6, K13, X5): one entry per distinct link,
 * from every tip that sent it, checked once for all of them.
 *
 * A LINK IS TEXT, NEVER AN ANCHOR (K6, X1). Nothing here opens, previews or
 * fetches one: a moderator copies it into a browser they chose, on purpose.
 * The only anchors on this page are the two hotlines.
 *
 * "Illegal" erases every copy at once and cannot be undone, so it asks for
 * the reason and for the hotline procedure to have been followed.
 */
import {
  HOTLINES,
  LINK_COMMENT_WARNING,
  LINK_REASONS,
  MAX_LINK_COMMENT,
  UNBLOCK_REASONS,
  addToBlocklist,
  checkLinkGroup,
  commentLinkGroup,
  getBlocklist,
  getLinkGroupHistory,
  listLinkGroups,
  removeFromBlocklist,
} from '@reportlog/contracts';
import type {
  BlockKind,
  BlocklistEntry,
  LinkFilter,
  LinkGroup,
  LinkOutcome,
  LinkReason,
  UnblockReason,
} from '@reportlog/contracts';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Btn } from '../../mockup/Btn.tsx';
import {
  CheckBox,
  Field,
  FieldDescription,
  Input,
  Label,
  Select,
  Textarea,
} from '@/mockup/Field.tsx';
import { Choice, Choices } from '@/mockup/Choice.tsx';
import { Empty } from '../../mockup/Empty.tsx';
import { Problem } from '../../mockup/Notice.tsx';
import { Panel } from '@/mockup/Panel.tsx';
import { Seg } from '../../mockup/Seg.tsx';
import { StaffPage } from '../nav/StaffPage.tsx';
import { call } from '../../lib/api.ts';
import { LINK_OUTCOME } from './words.ts';

const groupsQuery = (filter: LinkFilter) =>
  queryOptions({
    queryKey: ['link-checks', filter],
    queryFn: ({ signal }) => call(listLinkGroups, { query: { filter }, signal }),
  });

const blocklistQuery = () =>
  queryOptions({
    queryKey: ['link-checks', 'blocklist'],
    queryFn: ({ signal }) => call(getBlocklist, { signal }),
  });

const OUTCOME_CHOICES: Record<LinkOutcome, string> = {
  checked: 'Checked: vetted journalists may see it',
  withheld: 'Withheld: legal, but abusive, worthless or harassing. Journalists never see it',
  illegal: 'Illegal: erase every copy now',
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '');

/** A stored category in words; one the screen does not know is shown as stored. */
const reasonLabel = (r: string | undefined) =>
  r && Object.hasOwn(LINK_REASONS, r) ? LINK_REASONS[r as LinkReason] : (r ?? '');

/** The status buttons, as the queue's: one pressed at a time. */
const LINK_BUTTONS: { value: LinkFilter; label: string; counted: (n: number) => string }[] = [
  { value: 'unchecked', label: 'Waiting', counted: (n) => `${String(n)} waiting` },
  { value: 'checked', label: 'Passed', counted: (n) => `${String(n)} passed` },
  { value: 'withheld', label: 'Withheld', counted: (n) => `${String(n)} withheld` },
  { value: 'illegal', label: 'Illegal', counted: (n) => `${String(n)} illegal, erased` },
];

export function LinkChecksPage() {
  const [filter, setFilter] = useState<LinkFilter>('unchecked');
  const query = useQuery(groupsQuery(filter));
  const shown = query.data?.groups.length;
  return (
    <StaffPage
      title="Links"
      lede="Links from the tip line and from reports, one entry per address however many people sent it. Checked links reach vetted journalists; nothing here is published. A check covers every copy, and later ones too."
      actions={
        <Link className="btn sm flat" to="/lists/review">
          List entries
        </Link>
      }
    >
      <Seg
        label="Show links that are"
        options={LINK_BUTTONS.map((b) => ({
          key: b.value,
          label: b.label,
          pressed: filter === b.value,
          onClick: () => {
            setFilter(b.value);
          },
        }))}
      />
      <Hotlines />
      <p className="m">
        {[
          shown === undefined
            ? null
            : (LINK_BUTTONS.find((b) => b.value === filter)?.counted(shown) ?? null),
          LINK_OUTCOME[filter],
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {query.isPending ? <p role="status">Reading the links…</p> : null}
      {query.isError ? <Problem>{query.error.message}</Problem> : null}
      {query.data ? (
        query.data.groups.length === 0 ? (
          <Empty title={filter === 'unchecked' ? 'No link waiting' : 'Nothing here'}>
            {filter === 'unchecked'
              ? 'Links sent with tips and reports appear here until somebody checks them.'
              : 'No link has been given this outcome.'}
          </Empty>
        ) : (
          query.data.groups.map((g) => <GroupCard key={g.id} group={g} />)
        )
      ) : null}
      <Blocklist />
    </StaffPage>
  );
}

const GUIDANCE_READ = 'reportlog.links.guidance-read';

/** Whether this browser has read the guidance before. Storage can throw; then it has not. */
function guidanceRead(): boolean {
  try {
    return window.localStorage.getItem(GUIDANCE_READ) === 'yes';
  } catch {
    return false;
  }
}

/**
 * X5: the procedure is outside the code; the screen points at it. Open the
 * first time, and closed after that in this browser (remembered here only,
 * a convenience): it is one press away, never gone.
 */
function Hotlines() {
  const [open, setOpen] = useState(() => !guidanceRead());
  return (
    <details
      className="tech"
      open={open}
      onToggle={(e) => {
        const now = e.currentTarget.open;
        setOpen(now);
        if (!now) {
          try {
            window.localStorage.setItem(GUIDANCE_READ, 'yes');
          } catch {
            // Not remembered; it opens again next time, which is safe.
          }
        }
      }}
    >
      <summary>If a link may be illegal</summary>
      <div className="in" style={{ fontFamily: 'var(--rl-font-sans)', wordBreak: 'normal' }}>
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
    </details>
  );
}

function GroupCard({ group }: { group: LinkGroup }) {
  const erased = group.outcome === 'illegal';
  return (
    <article className="panel">
      {group.url ? (
        <p className="mono" style={{ wordBreak: 'break-all' }} data-testid="link-value">
          {group.url}
        </p>
      ) : (
        <p className="muted">Erased. Nothing of the link is kept.</p>
      )}
      <p className="m">
        {group.host ? <b>{group.host}</b> : null}
        {group.host ? ' · ' : ''}
        {group.first_seen ? `first ${when(group.first_seen)}` : ''}
        {group.last_seen ? ` · last ${when(group.last_seen)}` : ''}
      </p>
      {/* Tip and report copies of one address are ONE entry, and say so. */}
      <p className="m" data-testid="link-sources">
        {group.from_tips ? (
          <span className="st">
            {String(group.from_tips)} from {group.from_tips === 1 ? 'a tip' : 'tips'}
          </span>
        ) : null}{' '}
        {group.from_reports ? (
          <span className="st off">
            {String(group.from_reports)} from {group.from_reports === 1 ? 'a report' : 'reports'}
          </span>
        ) : null}
      </p>
      {group.lists.length || group.logbooks.length ? (
        <p className="m">
          from {[...group.lists, ...group.logbooks].map((l) => l.title).join(', ')}
        </p>
      ) : null}
      <p>
        {LINK_OUTCOME[group.outcome ?? 'unchecked']}
        {group.checked_by ? `, by ${group.checked_by} on ${when(group.checked_at)}` : ''}
      </p>
      {erased ? null : (
        <>
          <CheckForm group={group} />
          <CommentForm group={group} />
        </>
      )}
      <History id={group.id} />
    </article>
  );
}

function CheckForm({ group }: { group: LinkGroup }) {
  const qc = useQueryClient();
  const [outcome, setOutcome] = useState<LinkOutcome | ''>('');
  const [reason, setReason] = useState<LinkReason | ''>('');
  const [block, setBlock] = useState<BlockKind | ''>('');
  const [followed, setFollowed] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      call(checkLinkGroup, {
        params: { id: group.id },
        body: {
          outcome,
          ...(outcome === 'illegal' && reason ? { reason } : {}),
          ...(outcome === 'illegal' && block ? { block } : {}),
        },
      }),
    onSuccess: async () => {
      setOutcome('');
      await qc.invalidateQueries({ queryKey: ['link-checks'] });
      await qc.invalidateQueries({ queryKey: ['list-review'] });
    },
  });
  const id = `check-${String(group.id)}`;
  const ready = outcome !== '' && (outcome !== 'illegal' || (reason !== '' && followed));
  return (
    <>
      <div role="radiogroup" aria-labelledby={`${id}-legend`}>
        <span className="lbl" id={`${id}-legend`}>
          Check this link
        </span>
        <Choices>
          {(Object.keys(OUTCOME_CHOICES) as LinkOutcome[]).map((o) => (
            <Choice
              key={o}
              name={id}
              value={o}
              checked={outcome === o}
              onChange={() => {
                setOutcome(o);
              }}
            >
              {OUTCOME_CHOICES[o]}
            </Choice>
          ))}
        </Choices>
      </div>
      {outcome === 'illegal' ? (
        <>
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
          className={outcome === 'illegal' ? 'bad' : 'ink'}
          disabled={!ready || save.isPending}
          onClick={() => {
            save.mutate();
          }}
        >
          {outcome === 'illegal' ? 'Erase every copy' : 'Record the check'}
        </Btn>
      </div>
    </>
  );
}

function CommentForm({ group }: { group: LinkGroup }) {
  const qc = useQueryClient();
  const [body, setBody] = useState(group.comment ?? '');
  const save = useMutation({
    mutationFn: () => call(commentLinkGroup, { params: { id: group.id }, body: { body } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['link-checks'] });
    },
  });
  const id = `comment-${String(group.id)}`;
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
          disabled={save.isPending || body.trim() === (group.comment ?? '')}
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
          className="ghost"
          aria-expanded={open}
          onClick={() => {
            setOpen((o) => !o);
          }}
        >
          {open ? 'Hide the history' : 'Show the history'}
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
                      ? LINK_OUTCOME[it.outcome ?? 'unchecked']
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

/** K13. Keyed hashes, so the list cannot show what it blocks: only how and why. */
function Blocklist() {
  const qc = useQueryClient();
  const query = useQuery(blocklistQuery());
  const [kind, setKind] = useState<BlockKind>('address');
  const [text, setText] = useState('');
  const [reason, setReason] = useState<LinkReason | ''>('');
  const add = useMutation({
    mutationFn: () => call(addToBlocklist, { body: { kind, text, reason } }),
    onSuccess: async () => {
      setText('');
      await qc.invalidateQueries({ queryKey: ['link-checks', 'blocklist'] });
    },
  });
  return (
    <Panel title="Blocklist">
      <p>
        A link that matches is erased the moment it arrives: never kept, never shown. The list keeps
        only a keyed fingerprint of each address or site, so nobody, here or in a backup, can read
        back what is on it.
      </p>
      <div className="grid2 even">
        <Field controlId="block-kind">
          <Label>Block</Label>
          <Select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as BlockKind);
            }}
          >
            <option value="address">One exact address</option>
            <option value="domain">A whole site, with its subdomains</option>
          </Select>
        </Field>
        <Field controlId="block-text">
          <Label>{kind === 'address' ? 'Address' : 'Site'}</Label>
          <Input
            autoComplete="off"
            spellCheck={false}
            placeholder={kind === 'address' ? 'https://' : 'example.com'}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
            }}
          />
        </Field>
      </div>
      <Field controlId="block-reason">
        <Label>Why</Label>
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
      {add.isError ? <Problem>{add.error.message}</Problem> : null}
      {add.isSuccess ? (
        <p role="status">{add.data.added ? 'Blocked.' : 'That was already blocked.'}</p>
      ) : null}
      <div className="acts">
        <Btn
          sm
          flat
          disabled={!text.trim() || !reason || add.isPending}
          onClick={() => {
            add.mutate();
          }}
        >
          Add to the blocklist
        </Btn>
      </div>
      {query.isError ? <Problem>{query.error.message}</Problem> : null}
      {query.data ? (
        query.data.entries.length ? (
          <div className="rows tbl" role="list" aria-label="Blocked">
            <div className="row head" style={{ '--cols': '1fr 1fr auto' } as CSSProperties}>
              <span>Blocked</span>
              <span>Why</span>
              <span></span>
            </div>
            {query.data.entries.map((e) => (
              <BlockRow key={e.id} entry={e} />
            ))}
          </div>
        ) : (
          <p>Nothing is blocked.</p>
        )
      ) : null}
    </Panel>
  );
}

function BlockRow({ entry }: { entry: BlocklistEntry }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState<UnblockReason | ''>('');
  const remove = useMutation({
    mutationFn: () => call(removeFromBlocklist, { params: { id: entry.id }, body: { reason } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['link-checks', 'blocklist'] });
    },
  });
  const id = `unblock-${String(entry.id)}`;
  return (
    <div className="row" role="listitem" style={{ '--cols': '1fr 1fr auto' } as CSSProperties}>
      <span data-l="Blocked">{entry.kind === 'address' ? 'An exact address' : 'A whole site'}</span>
      <span data-l="Why">
        {reasonLabel(entry.reason_category)} · added by {entry.added_by} on {when(entry.created_at)}
      </span>
      <span data-l="">
        <span className="acts">
          <label className="select">
            <span className="vh">Why take it off</span>
            <select
              id={id}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value as UnblockReason | '');
              }}
            >
              <option value="">Why take it off?</option>
              {(Object.keys(UNBLOCK_REASONS) as UnblockReason[]).map((r) => (
                <option key={r} value={r}>
                  {UNBLOCK_REASONS[r]}
                </option>
              ))}
            </select>
          </label>
          <Btn
            sm
            flat
            className="ghost"
            disabled={!reason || remove.isPending}
            onClick={() => {
              remove.mutate();
            }}
          >
            Take it off
          </Btn>
        </span>
        {remove.isError ? <Problem>{remove.error.message}</Problem> : null}
      </span>
    </div>
  );
}
