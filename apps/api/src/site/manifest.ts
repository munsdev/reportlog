/**
 * The web app manifest, built per deployment. A static file would label
 * every deployment's home-screen icon "ReportLog": the browser reads the
 * manifest itself, so no painting on the page can reach it.
 *
 * Not gated. A manifest carries no writing from the site (a name, icons and
 * two colours) and a locked deployment still has to be installable.
 */
import { PALETTES } from '@reportlog/contracts';
import type { Look, WebManifest } from '@reportlog/contracts';

export function buildManifest(plainSiteName: string, look: Look): WebManifest {
  // An unknown palette is not a reason to serve no manifest; the default is
  // what the page falls back to too, so the two agree.
  const palette = PALETTES.find((p) => p.id === look.palette) ?? PALETTES[0];
  return {
    id: '/',
    name: plainSiteName,
    // A home screen truncates anyway; the browser picks which to show.
    short_name: plainSiteName,
    description: 'File and check incident reports in a tamper-evident archive.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    // The splash screen paints the page's ground while the app starts; the
    // status bar sits against the header, which is the deep surface.
    background_color: palette.background,
    theme_color: palette.deep,
    lang: 'en',
    dir: 'ltr',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/icon-maskable-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
