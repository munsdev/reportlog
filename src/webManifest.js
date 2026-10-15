/**
 * The web app manifest, built per deployment.
 *
 * It was a static file naming the software. Installed to a phone's home
 * screen, EVERY deployment's icon was labelled ReportLog — the one branding
 * surface no amount of client-side painting can reach, because the browser
 * reads the manifest itself and the operator's name never enters it.
 *
 * The two colours are read from the palette the operator actually chose.
 * A manifest cannot reference a CSS variable, so they have to be literals;
 * they are parsed out of the stylesheet rather than restated, so a palette
 * edit cannot leave the phone's status bar painted the old colour. A dark
 * palette with a light navy status bar is the visible form of that bug.
 *
 * NOT gated. A manifest carries no writing from the site — a name, an icon
 * and two colours — and a locked deployment still has to be installable
 * from its lock screen.
 */
import { plainSiteName } from './siteIdentity.js';
import { currentLook } from './look.js';
import { paletteColors } from './indexPage.js';

export async function buildManifest() {
  const name = await plainSiteName();
  const look = await currentLook();
  const colors = paletteColors();
  // An unknown palette is not a reason to serve no manifest. The default is
  // what the page itself falls back to, so the two agree.
  const palette = colors.get(look.palette) || colors.get('flint');

  return {
    id: '/',
    name,
    // A home screen truncates at about twelve characters anyway, and a
    // deployment that picked a long name still needs something under the
    // icon. The full name is in `name`; the browser decides which to show.
    short_name: name,
    description: 'File and track incident reports in a tamper-evident archive.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    orientation: 'portrait-primary',
    // The deep surface is the navigation bar, which is what sits against a
    // phone's status bar; the plain background is what the splash screen
    // paints while the app starts.
    background_color: palette.background,
    theme_color: palette.deep,
    lang: 'en',
    dir: 'ltr',
    categories: ['government', 'news', 'utilities'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
