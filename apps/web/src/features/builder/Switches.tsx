/**
 * The switches on a logbook that are not questions, and so are not behind
 * the one-way door: who can file to it without the site password, and the
 * freeze on its uploads. (The site's own intake switch moved to the
 * settings overview, features/settings/Switches.tsx.)
 *
 * Each calls an API another workstream already built, through its contract.
 * Nothing here is sealed, and each can be changed back.
 *
 * ASKED BEFORE, NEVER AFTER. Freezing uploads and closing the site to
 * reports stop somebody part-way through, so each takes a second press on a
 * card that says what will happen. Undoing either needs no confirming: it
 * restores what was there.
 */
import { setLogbookFilesFrozen, setLogbookOutsideAccess } from '@reportlog/contracts';
import type { LogbookDetail } from '@reportlog/contracts';
import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Btn } from '@/mockup/StaffBtn.tsx';
import { call } from '../../lib/api.ts';
import { Field, Panel, Problem, Select } from './controls.tsx';
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
      <p className="muted">
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
        <p className="note">
          <strong>Uploads are frozen</strong> since {when(lb.files_frozen_at ?? '')}. This logbook
          is refusing new files. Reports are still taken without them, and nothing already filed or
          published is hidden.
        </p>
      ) : (
        <p className="muted">
          This logbook takes files, because one of its questions asks for them, and only while the
          site has somewhere to put them.
        </p>
      )}
      <Problem error={freeze.error} />
      {frozen ? (
        <Btn
          variant="secondary"
          disabled={freeze.isPending}
          onClick={() => {
            freeze.mutate(false);
          }}
        >
          Take the freeze off
        </Btn>
      ) : asking ? (
        <div className="panel quiet">
          <p>Freeze uploads on this logbook?</p>
          <p>
            It goes on asking for files and refuses new ones, so somebody part-way through attaching
            something will be stopped. Their report can still be sent without them. Nothing already
            filed or published is hidden, and you can take the freeze off at any time.
          </p>
          <div className="acts">
            <Btn
              disabled={freeze.isPending}
              onClick={() => {
                freeze.mutate(true);
              }}
            >
              Freeze uploads
            </Btn>
            <Btn
              variant="secondary"
              onClick={() => {
                setAsking(false);
              }}
            >
              Keep taking files
            </Btn>
          </div>
        </div>
      ) : (
        <Btn
          variant="secondary"
          onClick={() => {
            setAsking(true);
          }}
        >
          Freeze uploads…
        </Btn>
      )}
      <p>
        <Link to="/files/logbooks/$id" params={{ id: String(lb.id) }}>
          This logbook’s upload limits
        </Link>
      </p>
    </Panel>
  );
}
