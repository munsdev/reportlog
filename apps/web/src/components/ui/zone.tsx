/**
 * A zone: a region of a page on its own ground. The look alternates dark and
 * light zones down a page (the mock-up's `.zone`), and a light card can sit
 * on a dark one. A zone re-points the palette's page roles, so everything
 * inside it reads correctly with no class of its own (styles.css, ZONES):
 *
 *   <Zone tone="deep">…a dark band…</Zone>
 *   <Zone tone="page" whenSingle="deep">…a light band that stays dark when
 *     the owner chose "One ground"…</Zone>
 *   <Zone tone="page" raised>…a light card on a dark zone…</Zone>
 *
 *   tone         "deep": the palette's deep surface. "page": the palette's
 *                own page (inside a deep zone this is how a light card is made).
 *   whenSingle   what this zone becomes when Settings > Look > Section
 *                grounds is "One ground". Without it, the zone is as drawn.
 *   ruled        a rule above it in the text colour, between two bands.
 *   raised       the theme's hard edge and shadow, for a card on a zone.
 *
 * The owner's choice is read from the site; a Look screen preview passes
 * `zones` itself.
 */
import type { LookOptions } from '@reportlog/contracts';
import type { ComponentProps, ElementType } from 'react';
import { cn } from '@/lib/utils.ts';
import { useSite } from './site.tsx';

export type ZoneTone = 'deep' | 'page';

export interface ZoneProps extends ComponentProps<'div'> {
  tone: ZoneTone;
  whenSingle?: ZoneTone;
  ruled?: boolean;
  raised?: boolean;
  as?: ElementType;
  /** For a preview: use this instead of the site's choice. */
  zones?: LookOptions['zones'];
}

/** Which ground a zone is on, given the owner's choice. */
export function zoneTone(
  tone: ZoneTone,
  whenSingle: ZoneTone | undefined,
  zones: LookOptions['zones'],
): ZoneTone {
  return zones === 'single' && whenSingle ? whenSingle : tone;
}

export function Zone({
  tone,
  whenSingle,
  ruled = false,
  raised = false,
  as: Tag = 'div',
  zones,
  className,
  ...props
}: ZoneProps) {
  const site = useSite();
  const chosen = zones ?? site.data?.look.options?.zones ?? 'alternate';
  return (
    <Tag
      data-zone={zoneTone(tone, whenSingle, chosen)}
      data-ruled={ruled ? '' : undefined}
      data-raised={raised ? '' : undefined}
      className={cn('bg-paper text-ink', className)}
      {...props}
    />
  );
}
