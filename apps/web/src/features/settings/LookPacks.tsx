/**
 * Look packs on the Look screen: the built-in pack, the packs an operator
 * has added, and the upload that adds more (stage 6, features/looks). The
 * settings screens are the owner's and administrators' already; installing,
 * replacing and removing also ask for the step-up, on the server.
 */
import { Card } from '@/components/ui/card.tsx';
import { KeyValueList } from '@/components/ui/key-value-list.tsx';
import { AddLookPack } from '@/features/looks/AddLookPack.tsx';
import { InstalledLookPacks } from '@/features/looks/InstalledLookPacks.tsx';
import { BUILT_IN, plural } from './looks.ts';

export function LookPacks() {
  return (
    <Card heading="Look packs" data-slot="look-packs">
      <KeyValueList
        items={[
          {
            key: 'Built in',
            value: [
              BUILT_IN.label,
              plural(BUILT_IN.palettes, 'palette', 'palettes'),
              plural(BUILT_IN.themes, 'theme', 'themes'),
              plural(BUILT_IN.looks, 'look', 'looks'),
            ].join(' · '),
          },
        ]}
      />
      <InstalledLookPacks />
      <AddLookPack />
    </Card>
  );
}
