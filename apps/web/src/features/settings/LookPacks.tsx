/**
 * Look packs on the Look screen: the built-in pack, the packs an operator
 * has added, and the upload that adds more (stage 6, features/looks). The
 * settings screens are the owner's and administrators' already; installing,
 * replacing and removing also ask for the step-up, on the server.
 * Installing ends in a toast; the new looks join the chooser's grid.
 */
import { useToast } from '@/components/ui/toast.tsx';
import { AddLookPack } from '@/features/looks/AddLookPack.tsx';
import { InstalledLookPacks } from '@/features/looks/InstalledLookPacks.tsx';
import { BUILT_IN, plural } from './looks.ts';

export function LookPacks() {
  const toast = useToast();
  return (
    <section className="settings-row" aria-labelledby="look-packs" data-slot="look-packs">
      <h2 id="look-packs">Installed look packs</h2>
      <p className="muted">
        A look pack adds palettes, themes, background elements and the shapes they use. It is one
        file, installed here or by a server command, and it changes nothing about reports.
      </p>
      <div style={{ display: 'grid', gap: 10 }}>
        <div className="packrow">
          <div>
            <b>{BUILT_IN.label}</b> <span className="pill">built in</span>
            <p>
              {[
                plural(BUILT_IN.palettes, 'palette', 'palettes'),
                plural(BUILT_IN.themes, 'theme', 'themes'),
                plural(BUILT_IN.looks, 'look', 'looks'),
              ].join(' · ')}
            </p>
          </div>
        </div>
        <InstalledLookPacks />
      </div>
      <AddLookPack
        onInstalled={(pack, replaced) => {
          // Its looks are in the list above at once: the packs' list is
          // read again, and the chooser offers what it holds.
          toast.show(
            replaced
              ? `${pack.label} ${pack.version} replaced version ${replaced}. Its looks are in the list above.`
              : `${pack.label} is installed. Its looks are in the list above.`,
          );
        }}
      />
    </section>
  );
}
