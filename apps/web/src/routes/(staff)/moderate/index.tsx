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
    return out;
  },
  component: function Queue() {
    return <QueuePage search={Route.useSearch()} />;
  },
});
