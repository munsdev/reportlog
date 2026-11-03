/**
 * The link blocklist (K13), in the Safety group. It was the foot of the Links
 * page; links are now judged where they appear (LinkVerdict.tsx), and this
 * stays a page of its own because it is about addresses nobody has sent yet.
 *
 * Keyed hashes, so the list cannot show what it blocks: only how and why.
 */
import {
  LINK_REASONS,
  UNBLOCK_REASONS,
  addToBlocklist,
  getBlocklist,
  removeFromBlocklist,
} from '@reportlog/contracts';
import type { BlockKind, BlocklistEntry, LinkReason, UnblockReason } from '@reportlog/contracts';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Btn } from '../../mockup/Btn.tsx';
import { Field, Input, Label, Select } from '@/mockup/Field.tsx';
import { Problem } from '../../mockup/Notice.tsx';
import { Panel } from '@/mockup/Panel.tsx';
import { Tbl } from '../../mockup/Tbl.tsx';
import { StaffPage } from '../nav/StaffPage.tsx';
import { call } from '../../lib/api.ts';
import { Hotlines } from './LinkVerdict.tsx';

const blocklistQuery = () =>
  queryOptions({
    queryKey: ['link-checks', 'blocklist'],
    queryFn: ({ signal }) => call(getBlocklist, { signal }),
  });

const when = (iso: string) => new Date(iso).toLocaleString();

/** A stored category in words; one the screen does not know is shown as stored. */
const reasonLabel = (r: string) =>
  Object.hasOwn(LINK_REASONS, r) ? LINK_REASONS[r as LinkReason] : r;

export function BlocklistPage() {
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
    <StaffPage
      title="Link blocklist"
      lede="A link that matches is erased the moment it arrives: never kept, never shown. The list keeps only a keyed fingerprint of each address or site, so nobody, here or in a backup, can read back what is on it."
    >
      <Hotlines />
      <Panel title="Block an address or a site">
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
      </Panel>
      <Panel title="Blocked">
        {query.isError ? <Problem>{query.error.message}</Problem> : null}
        {query.data ? (
          query.data.entries.length ? (
            <Tbl
              cols={['Blocked', 'Why', '']}
              widths="1fr 1fr auto"
              rows={query.data.entries.map((e) => ({
                key: e.id,
                cells: [
                  e.kind === 'address' ? 'An exact address' : 'A whole site',
                  `${reasonLabel(e.reason_category)} · added by ${e.added_by} on ${when(e.created_at)}`,
                  <Unblock key="u" entry={e} />,
                ],
              }))}
            />
          ) : (
            <p>Nothing is blocked.</p>
          )
        ) : null}
      </Panel>
    </StaffPage>
  );
}

function Unblock({ entry }: { entry: BlocklistEntry }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState<UnblockReason | ''>('');
  const remove = useMutation({
    mutationFn: () => call(removeFromBlocklist, { params: { id: entry.id }, body: { reason } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['link-checks', 'blocklist'] });
    },
  });
  return (
    <>
      <span className="acts">
        <label className="select">
          <span className="vh">Why take it off</span>
          <select
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
          look="ghost"
          disabled={!reason || remove.isPending}
          onClick={() => {
            remove.mutate();
          }}
        >
          Take it off
        </Btn>
      </span>
      {remove.isError ? <Problem>{remove.error.message}</Problem> : null}
    </>
  );
}
