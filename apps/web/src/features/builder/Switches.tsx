/**
 * The switches on a logbook that are not questions, and so are not behind
 * the one-way door: who can file to it without the site password, and the
 * freeze on its uploads. And the site's own intake switch, which the
 * logbook list shows because it decides whether any of them take reports.
 *
 * Each calls an API another workstream already built, through its contract.
 * Nothing here is sealed, and each can be changed back.
 *
 * ASKED BEFORE, NEVER AFTER. Freezing uploads and closing the site to
 * reports stop somebody part-way through, so each takes a second press on a
 * card that says what will happen. Undoing either needs no confirming: it
 * restores what was there.
 */
import {
  setIntakeSwitch,
  setLogbookFilesFrozen,
  setLogbookOutsideAccess,
} from '@reportlog/contracts';
import type { LogbookDetail } from '@reportlog/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '../../components/ui/button.tsx';
import { call } from '../../lib/api.ts';
import { Field, Panel, Problem, Select } from './controls.tsx';
import { intakeSwitchQuery } from './queries.ts';
import { outsideWords, when } from './words.ts';

type Refresh = () => Promise<void>;
type Outside = LogbookDetail['outside_access'];

/** Who can file to this logbook without the site password. */
export function OutsidePanel({ lb, refresh }: { lb: LogbookDetail; refresh: Refresh }) {
  const save = useMutation({
    mutationFn: (outside_access: Outside) =>
      call(setLogbookOutsideAccess, { params: { slug: lb.slug }, body: { outside_access } }),
    onSuccess: refresh,
  });
  return (
    <Panel title="Without the site password">
      <p className="text-ink-alt">
        When the site has a password, this decides whether people who do not know it can still file
        to this logbook. It opens the form and nothing else: the board, the other logbooks and the
        rest of the site stay behind the password.
        {lb.state === 'draft' ? ' It applies once the logbook has launched.' : ''}
      </p>
      <Field label="Who can file without the password" help={outsideWords[lb.outside_access].help}>
        {(p) => (
          <Select
            {...p}
            value={lb.outside_access}
            disabled={save.isPending}
            onChange={(e) => {
              save.mutate(e.target.value as Outside);
            }}
          >
            {(['closed', 'link', 'door'] as const).map((v) => (
              <option key={v} value={v}>
                {outsideWords[v].label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Problem error={save.error} />
    </Panel>
  );
}

/**
 * The freeze. Offered only where there is something to freeze: a logbook
 * that asks for files, or one somebody already froze.
 */
export function FreezePanel({ lb, refresh }: { lb: LogbookDetail; refresh: Refresh }) {
  const [asking, setAsking] = useState(false);
  const freeze = useMutation({
    mutationFn: (frozen: boolean) =>
      call(setLogbookFilesFrozen, { params: { id: lb.id }, body: { frozen } }),
    onSuccess: async () => {
      setAsking(false);
      await refresh();
    },
  });
  if (!lb.asks_for_files && !lb.files_frozen_at) return null;
  const frozen = lb.files_frozen_at !== null;

  return (
    <Panel title="Files">
      {frozen ? (
        <p className="rounded-card border-l-4 border-brand bg-paper p-3">
          <strong>Uploads are frozen</strong> since {when(lb.files_frozen_at ?? '')}. This logbook
          is refusing new files. Reports are still taken without them, and nothing already filed or
          published is hidden.
        </p>
      ) : (
        <p className="text-ink-alt">
          This logbook takes files, because one of its questions asks for them, and only while the
          site has somewhere to put them.
        </p>
      )}
      <Problem error={freeze.error} />
      {frozen ? (
        <Button
          variant="secondary"
          disabled={freeze.isPending}
          onClick={() => {
            freeze.mutate(false);
          }}
        >
          Take the freeze off
        </Button>
      ) : asking ? (
        <div className="space-y-3 rounded-card border border-line p-3">
          <p className="font-semibold">Freeze uploads on this logbook?</p>
          <p>
            It goes on asking for files and refuses new ones, so somebody part-way through attaching
            something will be stopped. Their report can still be sent without them. Nothing already
            filed or published is hidden, and you can take the freeze off at any time.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={freeze.isPending}
              onClick={() => {
                freeze.mutate(true);
              }}
            >
              Freeze uploads
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setAsking(false);
              }}
            >
              Keep taking files
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="secondary"
          onClick={() => {
            setAsking(true);
          }}
        >
          Freeze uploads…
        </Button>
      )}
      <p>
        <Link to="/files/logbooks/$id" params={{ id: String(lb.id) }} className="underline">
          This logbook’s upload limits
        </Link>
      </p>
    </Panel>
  );
}

/** The whole site's intake switch. Closing it leaves everything filed alone. */
export function IntakeSwitchPanel() {
  const qc = useQueryClient();
  const query = useQuery(intakeSwitchQuery());
  const [asking, setAsking] = useState(false);
  const save = useMutation({
    mutationFn: (open: boolean) => call(setIntakeSwitch, { body: { open } }),
    onSuccess: async (data) => {
      setAsking(false);
      qc.setQueryData(intakeSwitchQuery().queryKey, data);
      await qc.invalidateQueries({ queryKey: intakeSwitchQuery().queryKey });
    },
  });

  return (
    <Panel title="New reports, across the site">
      {query.isPending && <p role="status">Reading the intake switch…</p>}
      <Problem error={query.error} />
      {query.isSuccess && (
        <>
          <p>
            {query.data.open
              ? 'The site is taking new reports, in every logbook that is open.'
              : 'The site is not taking new reports, in any logbook. Reports already filed are unaffected, and corrections to them still work.'}
            {query.data.stored === null
              ? ' Nobody has set this; taking reports is the default.'
              : ''}
          </p>
          <Problem error={save.error} />
          {!query.data.open ? (
            <Button
              variant="secondary"
              disabled={save.isPending}
              onClick={() => {
                save.mutate(true);
              }}
            >
              Take new reports again
            </Button>
          ) : asking ? (
            <div className="space-y-3 rounded-card border border-line p-3">
              <p className="font-semibold">Stop taking new reports across the whole site?</p>
              <p>
                Every logbook’s form will say it is not taking reports, and somebody part-way
                through one will be refused when they send it. Nothing already filed changes, and
                you can open it again at any time.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={save.isPending}
                  onClick={() => {
                    save.mutate(false);
                  }}
                >
                  Stop taking reports
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setAsking(false);
                  }}
                >
                  Keep taking reports
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="secondary"
              onClick={() => {
                setAsking(true);
              }}
            >
              Stop taking new reports…
            </Button>
          )}
        </>
      )}
    </Panel>
  );
}
