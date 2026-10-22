/**
 * Look packs on the Look screen: what is installed, and (from stage 6) the
 * upload that adds more.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ "ADD LOOKS FROM A FILE" GOES HERE.                                   │
 * │ Thread E builds the upload (FilePicker, check(), Install with a      │
 * │ step-up, the installed packs with Remove). The lead wires it in at   │
 * │ merge by replacing `AddLooksFromAFile` below; nothing else on the    │
 * │ Look screen needs to change. Until then the panel lists the built-in │
 * │ pack and says nothing about uploading.                               │
 * └──────────────────────────────────────────────────────────────────────┘
 */
import { Card } from '@/components/ui/card.tsx';
import { KeyValueList } from '@/components/ui/key-value-list.tsx';
import { BUILT_IN, plural } from './looks.ts';

/** Thread E's upload panel. Nothing until it is merged. */
function AddLooksFromAFile() {
  return null;
}

export function LookPacks() {
  return (
    <Card heading="Look packs" data-slot="look-packs">
      <AddLooksFromAFile />
      <KeyValueList
        items={[
          {
            key: 'Installed',
            value: [
              BUILT_IN.label,
              plural(BUILT_IN.palettes, 'palette', 'palettes'),
              plural(BUILT_IN.themes, 'theme', 'themes'),
              plural(BUILT_IN.looks, 'look', 'looks'),
            ].join(' · '),
          },
        ]}
      />
    </Card>
  );
}
