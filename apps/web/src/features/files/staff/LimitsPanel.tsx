/**
 * "How big, how long, how many" (settings-and-admin.md §10): one layer of
 * file limits as a panel that shows what is set before it is opened.
 *
 * Closed, the eight limits and the kinds as names and values: what this
 * layer sets, "not set" in the second text colour where it sets nothing,
 * and, on a logbook, the site's number beside each. Open, the limits form
 * as it was (LimitsForm, with its own checks and its own Save, because a
 * number out of range is said beside its box before anything is sent).
 * A save closes the panel and says so in a toast.
 */
import type { FileLimitLayers } from '@reportlog/contracts';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '../../../components/ui/button.tsx';
import { Card } from '../../../components/ui/card.tsx';
import { KeyValueList } from '../../../components/ui/key-value-list.tsx';
import type { KeyValue } from '../../../components/ui/key-value-list.tsx';
import { useToast } from '../../../components/ui/toast.tsx';
import { LimitsForm } from './LimitsForm.tsx';
import type { Layer, LimitsBody } from './LimitsForm.tsx';
import { KIND_LABEL, LIMITS, toBox } from './words.ts';

export const LIMITS_TITLE = 'How big, how long, how many';

const unset = (words: ReactNode) => <span className="text-ink-alt">{words}</span>;

/** The closed panel's values, one per limit, then the kinds. */
export function limitsSummary(layers: FileLimitLayers, mine: Layer): KeyValue[] {
  const rows: KeyValue[] = LIMITS.map((l) => {
    const row = layers[l.key];
    const v = (n: number) => `${toBox(n, l.unit)} ${l.suffix}`;
    const own = mine === 'logbook' ? row.logbook : row.site;
    const under = mine === 'logbook' ? (row.site ?? row.shipped) : row.shipped;
    const underWords = mine === 'logbook' ? `the site’s ${v(under)}` : `${v(under)} as shipped`;
    return {
      key: l.label,
      value:
        own === null ? (
          unset(`not set · ${underWords}`)
        ) : (
          <>
            {v(own)}
            {mine === 'logbook' ? <> {unset(`· site ${v(under)}`)}</> : null}
          </>
        ),
    };
  });
  const own = mine === 'logbook' ? layers.kinds.logbook : layers.kinds.site;
  const kinds = (k: readonly string[]) =>
    k.length
      ? k.map((x) => KIND_LABEL[x as keyof typeof KIND_LABEL].toLowerCase()).join(', ')
      : 'none';
  rows.unshift({
    key: 'Kinds of file',
    value: own === null ? unset(`not set · ${kinds(layers.kinds.effective)}`) : kinds(own),
  });
  return rows;
}

export function LimitsPanel({
  layers,
  mine,
  onSave,
}: {
  layers: FileLimitLayers;
  mine: Layer;
  onSave: (body: LimitsBody) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  return (
    <Card
      heading={LIMITS_TITLE}
      className={open ? 'outline-2 outline-offset-2 outline-ink' : undefined}
    >
      {open ? (
        <LimitsForm
          layers={layers}
          mine={mine}
          onSave={onSave}
          onSaved={(text) => {
            setOpen(false);
            toast.show(text);
          }}
          onCancel={() => {
            setOpen(false);
          }}
        />
      ) : (
        <>
          <KeyValueList items={limitsSummary(layers, mine)} />
          <div>
            <Button
              variant="secondary"
              aria-label={`Edit ${LIMITS_TITLE}`}
              onClick={() => {
                setOpen(true);
              }}
            >
              Edit
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
