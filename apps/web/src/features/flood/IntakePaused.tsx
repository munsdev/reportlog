/**
 * "Intake is paused" (Plan E, PE3): the site-wide notice, and what the report
 * and tip forms show instead of their first card while a moderator has
 * paused intake.
 *
 * ASKED ONCE, WHEN THE PAGE OPENS. Nothing on the card in front of somebody
 * changes underneath them: a pause that starts while somebody is typing is
 * met by the send, which is refused with the same notice, and their words
 * stay on the screen.
 *
 * `/api/intake-pause` is in front of the password (identity/doors.ts), so
 * the report and tip forms may ask it on a door.
 */
import { getIntakePause } from '@reportlog/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { Alert } from '../../components/ui/alert.tsx';
import { Card } from '../../components/ui/card.tsx';
import { FormNotice } from '../form/FormNotice.tsx';
import { call } from '../../lib/api.ts';
import { useGateMode } from '../identity/gateMode.ts';

export const intakePauseQuery = queryOptions({
  queryKey: ['intake-pause'],
  queryFn: ({ signal }) => call(getIntakePause, { signal }),
  staleTime: Infinity,
  refetchOnWindowFocus: false,
});

/**
 * The notice under the header on every page past the password, while intake
 * is paused. Quiet on a door, like the header (useSite): a door page asks
 * only for what its own form needs, and the forms say it themselves.
 */
export function PauseBanner() {
  const onDoor = useGateMode() === 'door';
  const pause = useQuery({ ...intakePauseQuery, enabled: !onDoor }).data;
  if (!pause?.paused) return null;
  return (
    <div className="mx-auto w-full max-w-page px-4 pt-4">
      <Alert title="Intake is paused">
        {/* The operator's words (site copy), sent with the pause. */}
        <span data-copy="intake_paused_notice">{pause.notice}</span>
        {pause.since ? (
          <span className="text-sm text-ink-alt">
            Paused since {new Date(pause.since).toLocaleString()}.
          </span>
        ) : null}
      </Alert>
    </div>
  );
}

/** True while paused; the form shows `<PausedForm>` in place of its cards. */
export function useIntakePaused(): boolean {
  return useQuery(intakePauseQuery).data?.paused === true;
}

/**
 * In place of a form's opening card: a deep panel, because somebody who came
 * to report something must not miss that it cannot be taken now.
 */
export function PausedForm({ title, eyebrow }: { title: string; eyebrow?: string }) {
  const pause = useQuery(intakePauseQuery).data;
  return (
    <FormNotice title={title} {...(eyebrow ? { eyebrow } : {})}>
      <Card variant="deep">
        <h2 className="label-face text-sm text-brand-on-deep">Intake is paused</h2>
        {/* The operator's words (site copy), sent with the pause. */}
        <p data-copy="intake_paused_notice" className="max-w-prose whitespace-pre-wrap">
          {pause?.notice}
        </p>
      </Card>
    </FormNotice>
  );
}
