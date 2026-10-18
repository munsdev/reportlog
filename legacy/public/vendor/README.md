# Vendored third-party code

Committed rather than fetched because the Content-Security-Policy is
`script-src 'self'`, which rules out a CDN, and because there is no build
step in `public/` and there must not be one.

## Leaflet 1.9.4

- `leaflet.js`, `leaflet.css` — the stock minified distribution.
- © 2010–2023 Vladimir Agafonkin, © 2010–2011 CloudMade.
- BSD-2-Clause, which goes into an AGPL-3.0 project without friction.
- <https://leafletjs.com>

**Do not edit these files.** To move to a new version, replace them from
the upstream distribution and re-run the browser suite.

**`L.tileLayer` must never be used.** A tile request would tell a third
party which states the readers of an incident archive are looking at, and
every deployment would make it on behalf of an operator who never chose
it. `npm test` fails if `public/js/map.js` so much as names it.

Leaflet uses `innerHTML` internally. That is its business; the rule about
not writing markup from strings is about the code we write.
