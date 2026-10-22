/**
 * Where the "Easier reading" switch is drawn: at the end of the menu's
 * "You" row, for everybody signed in or not, and at the end of the footer
 * (docs/design/navigation.md, sections 02 and 06; the switch itself is the
 * look system's, docs/design/looks/README.md section 07, in
 * features/easy-reading). Both places draw the same switch and stay in step:
 * it is one setting for this browser.
 *
 * `where` fits it to each surface: the menu is deep, the footer is the
 * page's own ground. `data-easier-reading` marks the spot for the tests.
 */
import { EasyReadingSwitch } from '@/features/easy-reading/EasyReadingSwitch.tsx';

export function EasierReadingSlot({ where }: { where: 'menu' | 'footer' }) {
  return (
    <span data-easier-reading={where} className="contents">
      <EasyReadingSwitch onDeep={where === 'menu'} />
    </span>
  );
}
