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
import { Alert } from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card, CardContent } from '../../components/ui/card.tsx';
import { CheckOption } from '../../components/ui/choice.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';
import { Page } from '../../components/ui/page.tsx';
import { RadioGroup, RadioOption } from '../../components/ui/radio-group.tsx';
import { Select } from '../../components/ui/select.tsx';
import { Textarea } from '../../components/ui/textarea.tsx';
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

export function LinkChecksPage() {
  const [filter, setFilter] = useState<LinkFilter>('unchecked');
  const query = useQuery(groupsQuery(filter));
  return (
    <Page
      title="Check links"
      lede="Every link sent on a list, one entry per address however many tips sent it. A check covers every copy, and later copies too, except that an illegal link is erased and only the blocklist stops it coming back."
      actions={
        <Button asChild variant="secondary">
          <Link to="/lists/review">List entries</Link>
        </Button>
      }
    >
      <Hotlines />
      <div className="max-w-xs">
        <Label htmlFor="link-filter">Showing</Label>
        <Select
          id="link-filter"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value as LinkFilter);
          }}
        >
          {(Object.keys(LINK_OUTCOME) as LinkFilter[]).map((f) => (
            <option key={f} value={f}>
              {LINK_OUTCOME[f]}
            </option>
          ))}
        </Select>
      </div>
      {query.isPending ? <p role="status">Reading the links…</p> : null}
      {query.isError ? <Alert tone="serious">{query.error.message}</Alert> : null}
      {query.data ? (
        query.data.groups.length === 0 ? (
          <p>Nothing here.</p>
        ) : (
          <ul className="space-y-3" aria-label="Links">
            {query.data.groups.map((g) => (
              <li key={g.id}>
                <GroupCard group={g} />
              </li>
            ))}
          </ul>
        )
      ) : null}
      <Blocklist />
    </Page>
  );
}

/** X5: the procedure is outside the code; the screen points at it. */
function Hotlines() {
  return (
    <Alert title="If a link may be illegal" tone="serious">
      <ol className="list-decimal space-y-1 pl-5">
        <li>Do not download it, save it or send it to anybody.</li>
        <li>
          Report it to a hotline:{' '}
          {HOTLINES.map((h, i) => (
            <span key={h.url}>
              {i ? ' or ' : ''}
              <a
                href={h.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="underline"
              >
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
    </Alert>
  );
}

function GroupCard({ group }: { group: LinkGroup }) {
  const erased = group.outcome === 'illegal';
  return (
    <Card>
      <CardContent className="space-y-3 pt-4">
        <div>
          {group.url ? (
            <p className="break-all font-mono" data-testid="link-value">
              {group.url}
            </p>
          ) : (
            <p className="text-ink-alt">Erased. Nothing of the link is kept.</p>
          )}
          <p className="text-sm text-ink-alt">
            {group.host ? `${group.host} · ` : ''}
            {String(group.copies)} {group.copies === 1 ? 'copy' : 'copies'}
            {group.lists.length ? ` · from ${group.lists.map((l) => l.title).join(', ')}` : ''}
            {group.last_seen ? ` · last sent ${when(group.last_seen)}` : ''}
          </p>
          <p className="text-sm">
            {LINK_OUTCOME[group.outcome ?? 'unchecked']}
            {group.checked_by ? `, by ${group.checked_by} on ${when(group.checked_at)}` : ''}
          </p>
        </div>
        {erased ? null : (
          <>
            <CheckForm group={group} />
            <CommentForm group={group} />
          </>
        )}
        <History id={group.id} />
      </CardContent>
    </Card>
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
    <fieldset className="space-y-2">
      <legend className="font-semibold">Check this link</legend>
      <RadioGroup
        aria-label="Check this link"
        name={id}
        value={outcome}
        onValueChange={(v) => {
          setOutcome(v as LinkOutcome);
        }}
      >
        {(Object.keys(OUTCOME_CHOICES) as LinkOutcome[]).map((o) => (
          <RadioOption key={o} id={`${id}-${o}`} value={o} label={OUTCOME_CHOICES[o]} />
        ))}
      </RadioGroup>
      {outcome === 'illegal' ? (
        <div className="space-y-2 rounded-card border border-line p-3">
          <div>
            <Label htmlFor={`${id}-reason`}>Why it is illegal</Label>
            <Select
              id={`${id}-reason`}
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
          </div>
          <div>
            <Label htmlFor={`${id}-block`}>Stop it coming back</Label>
            <Select
              id={`${id}-block`}
              value={block}
              onChange={(e) => {
                setBlock(e.target.value as BlockKind | '');
              }}
            >
              <option value="">Do not block it</option>
              <option value="address">Block this exact address</option>
              <option value="domain">Block its whole site, and every subdomain</option>
            </Select>
          </div>
          <CheckOption
            id={`${id}-followed`}
            label="I have followed the procedure above. Every copy will be erased and cannot be brought back."
            checked={followed}
            onCheckedChange={(on) => {
              setFollowed(on === true);
            }}
          />
        </div>
      ) : null}
      {save.isError ? <Alert tone="serious">{save.error.message}</Alert> : null}
      <Button
        type="button"
        disabled={!ready || save.isPending}
        onClick={() => {
          save.mutate();
        }}
      >
        {outcome === 'illegal' ? 'Erase every copy' : 'Record the check'}
      </Button>
    </fieldset>
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
    <div className="space-y-1">
      <Label htmlFor={id}>Comment for journalists</Label>
      <p className="text-sm font-semibold" id={`${id}-warning`}>
        {LINK_COMMENT_WARNING}
      </p>
      <Textarea
        id={id}
        rows={2}
        maxLength={MAX_LINK_COMMENT}
        aria-describedby={`${id}-warning`}
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
        }}
      />
      {save.isError ? <Alert tone="serious">{save.error.message}</Alert> : null}
      {save.isSuccess ? <p role="status">Saved.</p> : null}
      <Button
        type="button"
        variant="secondary"

        disabled={save.isPending || body.trim() === (group.comment ?? '')}
        onClick={() => {
          save.mutate();
        }}
      >
        Save the comment
      </Button>
    </div>
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
    <div>
      <Button
        type="button"
        variant="quiet"

        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
        }}
      >
        {open ? 'Hide the history' : 'Show the history'}
      </Button>
      {open && query.data ? (
        query.data.items.length ? (
          <ul className="space-y-1 text-sm" aria-label="History">
            {query.data.items.map((it, i) => (
              <li key={`${it.at}-${String(i)}`}>
                {when(it.at)}, {it.by}:{' '}
                {it.kind === 'check'
                  ? LINK_OUTCOME[it.outcome ?? 'unchecked']
                  : it.kind === 'erasure'
                    ? `erased ${String(it.erased ?? 0)} ${it.erased === 1 ? 'copy' : 'copies'} (${reasonLabel(
                        it.reason_category,
                      )})`
                    : it.comment
                      ? `comment: “${it.comment}”`
                      : 'cleared the comment'}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm">Nothing decided yet.</p>
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
    <section className="space-y-3" aria-labelledby="blocklist-heading">
      <h2 id="blocklist-heading" className="font-display text-xl font-bold">
        Blocklist
      </h2>
      <p>
        A link that matches is erased the moment it arrives: never kept, never shown. The list keeps
        only a keyed fingerprint of each address or site, so nobody, here or in a backup, can read
        back what is on it.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="block-kind">Block</Label>
          <Select
            id="block-kind"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as BlockKind);
            }}
          >
            <option value="address">One exact address</option>
            <option value="domain">A whole site, with its subdomains</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="block-text">{kind === 'address' ? 'Address' : 'Site'}</Label>
          <Input
            id="block-text"
            autoComplete="off"
            spellCheck={false}
            placeholder={kind === 'address' ? 'https://' : 'example.com'}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
            }}
          />
        </div>
        <div>
          <Label htmlFor="block-reason">Why</Label>
          <Select
            id="block-reason"
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
        </div>
      </div>
      {add.isError ? <Alert tone="serious">{add.error.message}</Alert> : null}
      {add.isSuccess ? (
        <p role="status">{add.data.added ? 'Blocked.' : 'That was already blocked.'}</p>
      ) : null}
      <Button
        type="button"
        disabled={!text.trim() || !reason || add.isPending}
        onClick={() => {
          add.mutate();
        }}
      >
        Add to the blocklist
      </Button>
      {query.isError ? <Alert tone="serious">{query.error.message}</Alert> : null}
      {query.data ? (
        query.data.entries.length ? (
          <ul className="space-y-2" aria-label="Blocked">
            {query.data.entries.map((e) => (
              <li key={e.id}>
                <BlockRow entry={e} />
              </li>
            ))}
          </ul>
        ) : (
          <p>Nothing is blocked.</p>
        )
      ) : null}
    </section>
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
    <div className="flex flex-wrap items-end gap-3 rounded-card border border-line p-3 text-sm">
      <p className="grow">
        {entry.kind === 'address' ? 'An exact address' : 'A whole site'} ·{' '}
        {reasonLabel(entry.reason_category)} · added by {entry.added_by} on {when(entry.created_at)}
      </p>
      <div>
        <Label htmlFor={id}>Why take it off</Label>
        <Select
          id={id}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value as UnblockReason | '');
          }}
        >
          <option value="">Choose one</option>
          {(Object.keys(UNBLOCK_REASONS) as UnblockReason[]).map((r) => (
            <option key={r} value={r}>
              {UNBLOCK_REASONS[r]}
            </option>
          ))}
        </Select>
      </div>
      <Button
        type="button"
        variant="secondary"

        disabled={!reason || remove.isPending}
        onClick={() => {
          remove.mutate();
        }}
      >
        Take it off
      </Button>
      {remove.isError ? <Alert tone="serious">{remove.error.message}</Alert> : null}
    </div>
  );
}
