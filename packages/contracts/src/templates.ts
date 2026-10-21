/**
 * Deployment templates: how a DEPLOYMENT begins, offered by the setup wizard
 * and to administrators afterwards.
 *
 * A template is a bundle of ordinary settings applied once, not a mode. What
 * a person is shown is what it will change (`sets`), one plain line each,
 * never the settings themselves: a bundle that applies invisibly is a bundle
 * nobody can agree to.
 *
 * Not the same as a logbook's starting point (`logbooks.ts`), which carries
 * questions and nothing about the site.
 */
import { z } from 'zod';
import { defineRoute } from './route.ts';

export const TemplateSummary = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  /** One plain line per thing applying it will change. */
  sets: z.array(z.string()),
});
export type TemplateSummary = z.infer<typeof TemplateSummary>;

export const TemplateCatalogue = z.object({
  templates: z.array(TemplateSummary),
  /** Which one this deployment was last started from, for the record. Nothing reads it to decide anything. */
  applied: z.object({ id: z.string(), at: z.string() }).nullable(),
});
export type TemplateCatalogue = z.infer<typeof TemplateCatalogue>;

export const listTemplates = defineRoute({
  method: 'GET',
  path: '/api/admin/templates',
  summary: 'The deployment templates on offer, and what each would change.',
  response: TemplateCatalogue,
});

export const applyTemplate = defineRoute({
  method: 'POST',
  path: '/api/admin/templates',
  summary:
    'Apply a deployment template: its settings, a draft logbook and a hidden list if it has them, in one transaction.',
  body: z.object({ template: z.string().max(63) }),
  response: z.object({
    applied: z.string(),
    /** The draft it made, if it makes one. Never launched on anybody's behalf. */
    logbook: z.object({ id: z.number().int(), slug: z.string(), title: z.string() }).optional(),
    /** The list it made, if it makes one. Hidden until an administrator lists it. */
    list: z.object({ id: z.number().int(), slug: z.string(), title: z.string() }).optional(),
  }),
});
