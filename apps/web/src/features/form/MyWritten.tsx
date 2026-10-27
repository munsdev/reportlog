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
import { call } from '@/lib/api.ts';
import { SmBtn as Btn } from '../../mockup/SmBtn.tsx';
import { Check } from '../../mockup/Choices.tsx';
import { ErrorLine } from '../../mockup/ErrorLine.tsx';
import { Note } from '../../mockup/Note.tsx';
import { Panel } from '../../mockup/Panel.tsx';
import { Switch } from '../../mockup/Switch.tsx';
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
  if (outcome === 'redacted') {
    return `A moderator wrote a note for journalists${at ? ` on ${day(at)}` : ''}. Your own words are not passed on, only parts the note quotes.`;
  }
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
    <Panel title="What you wrote · not published">
      {written.texts.map((t) => (
        <div key={t.field_key}>
          <p style={{ whiteSpace: 'pre-wrap' }}>{t.text}</p>
          <p className="m">{checkLine(t.outcome, t.checked_at)}</p>
        </div>
      ))}
      {written.links.length ? (
        <>
          <p className="m">
            {written.links.length === 1 ? '1 link' : `${String(written.links.length)} links`}:{' '}
            {written.links.map((l, i) => (
              <span key={`${l.field_key}-${l.url}`}>
                {i > 0 ? ', ' : ''}
                {/* Text, not an anchor: this site never opens a link. */}
                <span className="mono">{l.url}</span>
              </span>
            ))}
          </p>
          {written.links.map((l) => (
            <p className="m" key={`c-${l.field_key}-${l.url}`}>
              {checkLine(l.outcome, l.checked_at)}
            </p>
          ))}
        </>
      ) : null}
      {anything ? (
        <Switch
          title="Vetted journalists may read it"
          sub="Only after a moderator has checked it. You can turn this off any time."
          // Read back from the server, never trusted from the click.
          on={written.shared}
          disabled={share.isPending}
          onChange={(on) => {
            share.mutate(on);
          }}
        />
      ) : null}
      <ErrorLine error={share.error} />
      {written.erased.map((e) => (
        <Note key={`${e.kind}-${e.field_key}-${e.erased_at}`}>
          <b>{e.kind === 'private_text' ? 'Written account erased' : 'Link erased'}</b>{' '}
          {new Date(e.erased_at).toLocaleString()}. It is gone; this marker stays.
        </Note>
      ))}
      {anything ? (
        <>
          <h3>Erase what you wrote</h3>
          <p className="muted">
            The words and links are deleted. The record keeps a marker that something was erased,
            and when.
          </p>
          <Check
            checked={sure}
            onChange={(e) => {
              setSure(e.target.checked);
            }}
          >
            I understand this cannot be undone.
          </Check>
          <ErrorLine error={erase.error} />
          <Btn
            kind="bad"
            disabled={!sure || erase.isPending}
            onClick={() => {
              erase.mutate();
            }}
          >
            Erase what I wrote
          </Btn>
        </>
      ) : null}
    </Panel>
  );
}
