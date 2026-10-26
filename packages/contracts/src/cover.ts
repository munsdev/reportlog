import { z } from 'zod';

/**
 * A cover page (decision 78): the words and the call to action on the first
 * card of a logbook or a list. NEVER SEALED: it is presentation, so changing
 * it changes no fingerprint. Every key is optional; an absent one means the
 * default (the logbook's "File a report", the site's call to action, "Start").
 */
export const CoverCta = z.object({
  /** site: follow the site's box. hide: no box. custom: this cover's own. */
  mode: z.enum(['site', 'hide', 'custom']),
  heading: z.string().max(80).optional(),
  body: z.string().max(1000).optional(),
  button_label: z.string().max(40).optional(),
  button_url: z.string().max(500).optional(),
});
export type CoverCta = z.infer<typeof CoverCta>;

export const Cover = z.object({
  eyebrow: z.string().max(60).optional(),
  intro: z.string().max(4000).optional(),
  button_label: z.string().max(40).optional(),
  cta: CoverCta.optional(),
});
export type Cover = z.infer<typeof Cover>;
