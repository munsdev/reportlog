/**
 * Edit the front page's headline block (decision 79): which of the two
 * layouts it wears, its headline and its introduction. Saving is live at
 * once; Undo puts back the save before (twenty are kept). The page's other
 * parts keep their own editor.
 */
import { blockText, setPageBlocks, undoPageBlocks } from '@reportlog/contracts';
import type { Block, PageEditorState } from '@reportlog/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { Field, FieldDescription } from '@/components/ui/field.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import { call } from '@/lib/api.ts';
import { pageEditorQuery } from './queries.ts';

const HERO_ID = 'hero';

export function HeroEditor({ onDone }: { onDone: () => void }) {
  const q = useQuery(pageEditorQuery('home'));
  if (q.isError) {
    return <Alert tone="serious" title="The headline could not be opened for editing." />;
  }
  if (!q.data) return <p role="status">Opening the editor…</p>;
  return <Form state={q.data} onDone={onDone} />;
}

function Form({ state, onDone }: { state: PageEditorState; onDone: () => void }) {
  const client = useQueryClient();
  const hero = state.blocks.find((b) => b.type === 'hero');
  const [variant, setVariant] = useState(hero?.variant ?? 'action');
  const [headline, setHeadline] = useState(hero ? blockText(hero, 'headline') : '');
  const [text, setText] = useState(
    hero ? blockText(hero, hero.variant === 'info' ? 'body' : 'line') : '',
  );
  const [note, setNote] = useState<string | null>(null);
  const [canUndo, setCanUndo] = useState(state.can_undo);

  const arrived = (next: PageEditorState) => {
    setCanUndo(next.can_undo);
    void client.invalidateQueries({ queryKey: ['page-blocks', 'home'] });
    void client.invalidateQueries({ queryKey: ['page-editor', 'home'] });
  };
  const save = useMutation({
    mutationFn: () => {
      const block: Block = {
        id: hero?.id ?? HERO_ID,
        type: 'hero',
        variant,
        shown: true,
        // Both texts are kept, so switching layout back and forth loses nothing.
        fields:
          variant === 'info'
            ? { ...hero?.fields, headline, body: text }
            : { ...hero?.fields, headline, line: text },
      };
      return call(setPageBlocks, {
        params: { page: 'home' },
        body: { blocks: [block, ...state.blocks.filter((b) => b.type !== 'hero')] },
      });
    },
    onSuccess: (next) => {
      arrived(next);
      setNote('Saved. It is live.');
    },
    onError: (e) => {
      setNote(e.message);
    },
  });
  const undo = useMutation({
    mutationFn: () => call(undoPageBlocks, { params: { page: 'home' } }),
    onSuccess: (next) => {
      arrived(next);
      const h = next.blocks.find((b) => b.type === 'hero');
      setVariant(h?.variant ?? 'action');
      setHeadline(h ? blockText(h, 'headline') : '');
      setText(h ? blockText(h, h.variant === 'info' ? 'body' : 'line') : '');
      setNote('Put back as it was before the last save.');
    },
    onError: (e) => {
      setNote(e.message);
    },
  });

  return (
    <Card heading="Edit the headline">
      <div className="flex flex-col gap-4">
        <Field>
          <Label>Layout</Label>
          <select
            aria-label="Layout"
            value={variant}
            onChange={(e) => {
              setVariant(e.target.value);
            }}
            className="min-h-11 rounded-control border border-line bg-surface px-3"
          >
            <option value="action">Action: headline and big buttons</option>
            <option value="info">Info: longer introduction, quieter buttons</option>
          </select>
        </Field>
        <Field>
          <Label>Headline</Label>
          <Input
            value={headline}
            onChange={(e) => {
              setHeadline(e.target.value);
            }}
          />
        </Field>
        <Field>
          <Label>{variant === 'info' ? 'Introduction' : 'One line under it'}</Label>
          <Textarea
            rows={variant === 'info' ? 6 : 3}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
            }}
          />
          {variant === 'info' ? (
            <FieldDescription>
              Blank line between paragraphs; **bold**; [link text](/path or https://…).
            </FieldDescription>
          ) : null}
        </Field>
        {note ? <p role="status">{note}</p> : null}
        <div className="flex flex-wrap gap-3">
          <Button
            disabled={save.isPending || !headline.trim()}
            onClick={() => {
              save.mutate();
            }}
          >
            Save
          </Button>
          <Button
            variant="secondary"
            disabled={!canUndo || undo.isPending}
            onClick={() => {
              undo.mutate();
            }}
          >
            Undo last save
          </Button>
          <Button variant="secondary" onClick={onDone}>
            Close
          </Button>
        </div>
      </div>
    </Card>
  );
}
