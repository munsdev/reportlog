/** How the tracker's dates and statuses read on screen. */
import { FEEDBACK_STATUS_LABELS, FEEDBACK_TYPE_LABELS } from '@reportlog/contracts';
import type { FeedbackIssue } from '@reportlog/contracts';

export const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** One line under an issue's title: what it is, how bad, where it stands, who filed it. */
export function IssueLine({ issue, author }: { issue: FeedbackIssue; author?: string }) {
  return (
    <p className="text-sm text-ink-alt">
      #{issue.id} · {FEEDBACK_TYPE_LABELS[issue.type]} · {issue.severity} ·{' '}
      <strong>{FEEDBACK_STATUS_LABELS[issue.status]}</strong> ·{' '}
      {issue.mine ? 'you' : (author ?? issue.author)} · {when(issue.created_at)}
      {issue.comment_count
        ? ` · ${String(issue.comment_count)} comment${issue.comment_count === 1 ? '' : 's'}`
        : ''}
    </p>
  );
}
