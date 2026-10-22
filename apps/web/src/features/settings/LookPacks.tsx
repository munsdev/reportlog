/**
 * Look packs on the Look screen: the built-in pack, the packs an operator
 * has added, and the upload that adds more (stage 6, features/looks). The
 * settings screens are the owner's and administrators' already; installing,
 * replacing and removing also ask for the step-up, on the server.
 * Installing ends in a toast; the new looks join the chooser's grid.
 */
import { Card } from '@/components/ui/card.tsx';
import { KeyValueList } from '@/components/ui/key-value-list.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { AddLookPack } from '@/features/looks/AddLookPack.tsx';
import { InstalledLookPacks } from '@/features/looks/InstalledLookPacks.tsx';
import { BUILT_IN, plural } from './looks.ts';

export function LookPacks() {
  const toast = useToast();
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
      <AddLookPack
        onInstalled={(pack, replaced) => {
          // Its looks are in the grid above at once: the packs' list is
          // read again, and the chooser offers what it holds.
          toast.show(
            replaced
              ? `${pack.label} ${pack.version} replaced version ${replaced}. Its looks are in the grid above.`
              : `${pack.label} is installed. Its looks are in the grid above.`,
          );
        }}
      />
    </Card>
  );
}
