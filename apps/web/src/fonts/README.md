# The bundled fonts

Every face a built-in theme names, served from this site and nowhere else. The
`@font-face` rules are not written here: `looks.gen.css` writes them from the
`fonts` list in `packages/contracts/src/look/reportlog-core.look.json`, and the
website's suite fails if a file named there is missing or a file here is not
named there.

All nine families are under the SIL Open Font License 1.1. The licence of each
is in `licences/`, as shipped by its source.

| Family                | Files                            | Source                                                                             | What was done to it                                                                |
| --------------------- | -------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| IBM Plex Sans         | `IBMPlexSans-{400,500,600,700}`  | `@ibm/plex-sans` 1.1.0 on npm, `fonts/complete/woff2`                              | Nothing. Renamed only. Plex is a Reserved Font Name, so it is shipped unmodified.  |
| IBM Plex Mono         | `IBMPlexMono-{400,500,700}`      | `@ibm/plex-mono` 2.5.0 on npm, `fonts/complete/woff2`                              | Nothing. Renamed only, for the same reason.                                        |
| Public Sans           | `PublicSans-{400,500,700}`       | `google/fonts`, `ofl/publicsans/PublicSans[wght].ttf`                              | Instanced at each weight, subset to Latin and Latin Extended, converted to WOFF2.  |
| Archivo               | `Archivo-variable`               | `google/fonts`, `ofl/archivo/Archivo[wdth,wght].ttf`                               | Weight axis limited to 500–800 (width kept whole, 62–125), subset, WOFF2.          |
| Courier Prime         | `CourierPrime-{400,700}`         | `google/fonts`, `ofl/courierprime/CourierPrime-{Regular,Bold}.ttf`                 | Subset, WOFF2.                                                                     |
| Newsreader            | `Newsreader-{400,600,700}`       | `google/fonts`, `ofl/newsreader/Newsreader[opsz,wght].ttf`                         | Instanced at each weight and the default optical size, subset, WOFF2.              |
| Bitter                | `Bitter-{600,700,800}`           | `google/fonts`, `ofl/bitter/Bitter[wght].ttf`                                      | Instanced at each weight, subset, WOFF2. (Its Reserved Font Name is "Bitter Pro".) |
| JetBrains Mono        | `JetBrainsMono-{400,500,700}`    | `google/fonts`, `ofl/jetbrainsmono/JetBrainsMono[wght].ttf`                        | Instanced at each weight, subset, WOFF2.                                           |
| Atkinson Hyperlegible | `AtkinsonHyperlegible-{400,700}` | `google/fonts`, `ofl/atkinsonhyperlegible/AtkinsonHyperlegible-{Regular,Bold}.ttf` | Subset, WOFF2.                                                                     |

Fetched 22 October 2026 from the `main` branch of `google/fonts`. The subset
keeps U+0000–024F, U+0259, U+02B0–036F, U+1E00–1EFF, general punctuation,
currency, letterlike symbols, arrows, U+2212, U+2215, box drawing and
geometric shapes, U+2C60–2C7F, U+A720–A7FF, U+FEFF and U+FFFD, with every
OpenType feature. Made with fontTools 4.67 (`varLib.instancer`, `subset`).

Red Hat Mono, which the earlier themes used, is retired: IBM Plex Mono is the
mono face (decision 63).
