import { createFileRoute } from '@tanstack/react-router';
import { QueuePage } from '../../../features/moderation/Queue.tsx';
import type {
  QueueSearch,
  QueueSeverity,
  QueueStatus,
} from '../../../features/moderation/queries.ts';

const STATUSES: readonly QueueStatus[] = [
  'all',
  'pending',
  'valid',
  'invalid',
  'unknown',
  'withdrawn',
];
const SEVERITIES: readonly QueueSeverity[] = [
  'note',
  'irregularity',
  'serious',
  'systemic',
  'none',
];

export const Route = createFileRoute('/(staff)/moderate/')({
  validateSearch: (s: Record<string, unknown>): QueueSearch => {
    const out: QueueSearch = {};
    if (STATUSES.includes(s.status as QueueStatus)) out.status = s.status as QueueStatus;
    if (typeof s.q === 'string' && s.q) out.q = s.q.slice(0, 200);
    if (s.flagged === true || s.flagged === 'true') out.flagged = true;
    if (typeof s.logbook === 'string' && s.logbook) out.logbook = s.logbook.slice(0, 63);
    if (SEVERITIES.includes(s.severity as QueueSeverity)) {
      out.severity = s.severity as QueueSeverity;
    }
    if (s.sort === 'oldest') out.sort = 'oldest';
    // Plan E: the flood filters, checked again by the server.
    const text = (v: unknown, max: number) =>
      typeof v === 'string' && v ? v.slice(0, max) : undefined;
    const from = text(s.from, 40);
    if (from) out.from = from;
    const to = text(s.to, 40);
    if (to) out.to = to;
    const place = text(s.place, 16);
    if (place && /^[A-Z]{2}(-[A-Z0-9]{1,3}(-\d{5})?)?$/.test(place)) out.place = place;
    const set = text(s.answer_set, 32);
    if (set && /^[0-9a-f]{32}$/.test(set)) out.answer_set = set;
    const org =
      typeof s.organization === 'number' ? String(s.organization) : text(s.organization, 16);
    if (org && /^[1-9]\d*$/.test(org)) out.organization = org;
    if (s.lane === 'organization' || s.lane === 'open_form') out.lane = s.lane;
    return out;
  },
  component: function Queue() {
    return <QueuePage search={Route.useSearch()} />;
  },
});
