# Interface redesign, stage 2 · Components: status

- **Branch:** `ccr-f0849029-ebgrpd`, after stage 1 (`docs/status/UI1-look-system.md`).
- **State:** built; not merged. Stage 2 of six in `docs/design/README.md`.
- **Scope:** everything in `docs/design/components.md` except §07 (navigation, stage 3), each
  with a unit test and an entry on a development-only components page, and every native radio,
  checkbox and file input replaced.

## What was built, in `apps/web/src/components/ui/`

- **Restyled:** `button.tsx` (label face, outlined in `ink` in every theme, the theme's hard
  shadow and press, sizes `md` 44px and `lg` 52px, `block`, `busy`/`busyLabel`, disabled as a
  dashed edge with no fading; the old `sm` size is gone and its 51 uses are `md`), `card.tsx`
  (variants `raised`, `quiet`, `deep`, `plain`; a `heading` prop draws the theme's panel heading,
  whose shapes are CSS in `styles.css` keyed on `data-panel-head`), `label.tsx` (a field's label
  wears the label face; an option's does not), `input.tsx` (1.5px edge, 16px text),
  `alert.tsx` (tones `note`, `warning`, `serious`, `done`), `dialog.tsx`.
- **New:** `chip.tsx`, `count.tsx`, `empty.tsx`, `choice.tsx` (`CheckOption`, and the choice card
  `RadioOption` now draws), `file-drop.tsx`, `key-value-list.tsx`, `pagination.tsx`, `type.tsx`
  (`Eyebrow`, `Lede`, `Meta`, `CountLine`), `setting-panel.tsx` (`SettingPanels`,
  `SettingPanel`), `save-bar.tsx`, `toast.tsx` (`ToastProvider`, `useToast`).
- **Global, in `styles.css`:** `label-face`, `display-face`, `border-control`, the press
  utilities, `text-section` and `text-lede`, page textures on `data-texture`, motion off under
  `prefers-reduced-motion`, textures off in print. The header, footer and every button are hidden
  in print. The viewport meta has `viewport-fit=cover` and `interactive-widget=resizes-content`;
  the page gutter takes the phone's safe area.
- **`/dev/components`**: every component in every state with a palette and theme switcher. In a
  production build the address is not found.

## Decisions taken while building, for the owner to see

- **The `confirmed` alert tone is gone.** It painted 30 "it worked" messages teal, which
  components.md §09 forbids (teal means a moderator confirmed something). They are `done` now,
  and the transparency log's "needs a look" is `warning`.
- **Bare checkboxes kept on purpose, as row selectors:** the per-report box for bulk actions in
  the moderation queue, and the per-entry and "tick every entry" boxes in list review. A card
  there would be wrong. They are Radix checkboxes, not native ones.
- **`RadioOption` became the choice card** rather than a new component replacing it, so every
  screen using it changed without being edited. The builder's `Check` now takes
  `onCheckedChange(on)` instead of `onChange(e)`.
- **The setting panel, save bar and toast are built and tested, not adopted.** Adopting them is
  the settings screens' work in stage 5.

## Checks

| Suite          | After stage 1          | After stage 2          |
| -------------- | ---------------------- | ---------------------- |
| `pnpm check`   | green; web 328         | green; web 372         |
| `pnpm test:db` | 1373 in 90 files       | 1373 in 90 files       |
| browser        | 1045 passed, 5 skipped | 1054 passed, 6 skipped |

The browser run was on `ebdce4c`; the commit after it only reformats lines Prettier wanted
rewrapped where `size="sm"` was removed.

A browser test walks every page as an administrator and fails if any shows a browser-default
radio, checkbox or file input (`e2e/site-ops.spec.ts`).

## Not done

- No screen uses the new panel heading, the count line, pagination, the empty state or the
  settings pieces yet: that is stages 4 and 5. The components page shows each.
- Looked at by a model in four looks at phone and desktop width on the components page; not by a
  person, and not on a real phone.
