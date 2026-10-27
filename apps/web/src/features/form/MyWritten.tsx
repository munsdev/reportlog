/**
 * What the reporter wrote and linked, on their own report's page (W4, G5).
 *
 * It shows the words as the reporter wrote them, where each check stands, the
 * sharing switch (a permission the reporter can take back, so it is the
 * permission log's, `journalist_sharing`), and the erase. Erasing deletes the
 * words and links of every version; the record keeps a marker that something
 * was erased, and when.
 *
 * A CORRECTION STARTS FROM WHAT IS HERE (`heldRaw`): the server keeps exactly
 * what a correction sends, so a correction that did not carry the words along
 * would quietly drop them.
 */
import { eraseMyWritten, getMyWritten, setMyPermission } from '@reportlog/contracts';
import type { FormQuestion, MyWritten } from '@reportlog/contracts';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { CheckOption } from '@/components/ui/choice.tsx';
import { call } from '@/lib/api.ts';
import type { RawAnswers } from './walk.ts';

export const myWrittenQuery = (threadId: string) =>
  queryOptions({
    queryKey: ['mine', 'written', threadId],
    queryFn: ({ signal }) => call(getMyWritten, { params: { threadId }, signal }),
  });

/** The text and links, as the controls of a correction hold them. */
export function heldRaw(questions: readonly FormQuestion[], w: MyWritten): RawAnswers {
  const out: RawAnswers = {};
  for (const q of questions) {
    if (q.kind === 'private_text') {
      const t = w.texts.find((x) => x.field_key === q.key);
      if (t) out[q.key] = t.text;
    } else if (q.kind === 'private_link') {
      const links = w.links.filter((x) => x.field_key === q.key).map((x) => x.url);
      if (links.length) out[q.key] = links;
    }
  }
  return out;
}

const day = (iso: string) => new Date(iso).toLocaleDateString();

function checkLine(outcome: 'waiting' | 'checked' | 'redacted' | 'withheld', at: string | null) {
  if (outcome === 'waiting') return 'A moderator has not checked it yet.';
  if (outcome === 'withheld') return 'A moderator checked it. It will not be shown to journalists.';
  return `Checked by a moderator${at ? ` on ${day(at)}` : ''}.`;
}

export function WrittenPanel({
  threadId,
  written,
  onChanged,
}: {
  threadId: string;
  written: MyWritten;
  onChanged: () => Promise<void>;
}) {
  const client = useQueryClient();
  const [sure, setSure] = useState(false);
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['mine', 'written', threadId] });
    await onChanged();
  };
  const share = useMutation({
    mutationFn: (granted: boolean) =>
      call(setMyPermission, {
        params: { threadId },
        body: { permission: 'journalist_sharing', granted },
      }),
    onSuccess: refresh,
  });
  const erase = useMutation({
    mutationFn: () => call(eraseMyWritten, { params: { threadId }, body: { confirm: true } }),
    onSuccess: async () => {
      setSure(false);
      await refresh();
    },
  });
  const anything = written.texts.length > 0 || written.links.length > 0;
  if (!anything && !written.erased.length) return null;
  return (
    <Card heading="What you wrote · not published">
      {written.texts.map((t) => (
        <div key={t.field_key} className="flex flex-col gap-1">
          <p className="max-w-prose whitespace-pre-wrap">{t.text}</p>
          <p className="text-sm text-ink-alt">{checkLine(t.outcome, t.checked_at)}</p>
        </div>
      ))}
      {written.links.length ? (
        <div className="flex flex-col gap-1">
          <p className="text-sm text-ink-alt">
            {written.links.length === 1 ? '1 link' : `${String(written.links.length)} links`}:
          </p>
          <ul className="flex flex-col gap-1">
            {written.links.map((l) => (
              <li key={`${l.field_key}-${l.url}`}>
                {/* Text, not an anchor: this site never opens a link. */}
                <span className="font-mono break-all">{l.url}</span>
                <span className="block text-sm text-ink-alt">
                  {checkLine(l.outcome, l.checked_at)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {anything ? (
        <CheckOption
          id="mine-share"
          label="Vetted journalists may read it"
          hint="Only after a moderator has checked it. You can turn this off any time."
          // Read back from the server, never trusted from the click.
          checked={written.shared}
          disabled={share.isPending}
          onCheckedChange={(on) => {
            share.mutate(on === true);
          }}
        />
      ) : null}
      {share.isError ? <Alert tone="serious">{share.error.message}</Alert> : null}
      {written.erased.map((e) => (
        <Alert
          key={`${e.kind}-${e.field_key}-${e.erased_at}`}
          tone="note"
          title={e.kind === 'private_text' ? 'Written account erased' : 'Link erased'}
        >
          {new Date(e.erased_at).toLocaleString()}. It is gone; this marker stays.
        </Alert>
      ))}
      {anything ? (
        <section aria-labelledby="erase-written" className="flex flex-col gap-3">
          <h3 id="erase-written" className="font-semibold">
            Erase what you wrote
          </h3>
          <p className="text-ink-alt">
            The words and links are deleted. The record keeps a marker that something was erased,
            and when.
          </p>
          <CheckOption
            id="erase-written-sure"
            label="I understand this cannot be undone."
            checked={sure}
            onCheckedChange={(on) => {
              setSure(on === true);
            }}
          />
          {erase.isError ? <Alert tone="serious">{erase.error.message}</Alert> : null}
          <div>
            <Button
              type="button"
              variant="secondary"
              disabled={!sure || erase.isPending}
              onClick={() => {
                erase.mutate();
              }}
            >
              Erase what I wrote
            </Button>
          </div>
        </section>
      ) : null}
    </Card>
  );
}
