# FT-L1: Look screen squeezed beside the staff sidebar

Cause: the Look screen laid itself out by window width (lg/xl/2xl breakpoints:
a 46rem preview column, four cards across, `lg` frame sizes) but the staff shell
gives the page only the window minus a 240px sidebar, capped at 77.5rem. At wide
windows the chooser column was left about 200px. `KeyValueList` also used the
window's `sm:` for its two columns, so the packs panel gave its value a sliver.

Fix:

- `routes/(staff)/settings/look.tsx`: two columns (chooser, 24rem sticky preview)
  only when the page's own column is >= 56rem (ResizeObserver); stacked below.
  The pinned quick-pick bar follows the same switch.
- `LookChooser.tsx`: looks and palette/theme selects use auto-fill/auto-fit grids.
- `LookPreview.tsx`: `fit="always"` gives the small frames at any width; the
  wizard keeps `fit` (window breakpoints).
- `key-value-list.tsx`: container query (`@md`) instead of `sm:`.

Checked at 1440 and 390 as the owner: Look, /logbooks, /moderate, /settings,
/updates, /lists, /access. No sideways scroll; the other six were not squeezed,
so the shared shell was left alone. Temporary screenshot spec not committed.
Browser specs not re-run (lean rules).
