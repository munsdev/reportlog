import type { Verification } from '@reportlog/contracts';
import {
  buildSealedObject,
  canonicalJson,
  chainGenesis,
  chainHash,
  contentHash,
  normalizeReportFields,
} from '@reportlog/seal';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VerifyResult } from '../src/routes/verify.$ref.tsx';

/** A verification exactly as the server would build it, from the real sealing code. */
function verification(): Verification {
  const sealed = buildSealedObject({
    publicRef: 'RL-T-ABCDEF',
    receivedAt: '2026-10-18T12:00:00.000Z',
    threadId: '0b6f3c2e-6a43-4b8e-9a59-0f1f6f4f2b11',
    correctsId: null,
    fields: normalizeReportFields({
      logbook: 'incidents',
      answers: { what: 'Something happened' },
      may_publish: true,
      may_publish_digest: 'a'.repeat(64),
    }),
  });
  const content = contentHash(sealed);
  const genesis = chainGenesis('incidents');
  const link = chainHash(content, genesis);
  return {
    public_ref: sealed.public_ref,
    recipe: 1,
    received_at: sealed.received_at,
    chain: { logbook: 'incidents', logbook_title: 'Incidents', genesis },
    hashed_fields: { ...sealed },
    canonical_json: canonicalJson(sealed),
    content: { recorded: content, computed: content, ok: true },
    link: { recorded: link, computed: link, prev_chain_hash: genesis, ok: true },
    position: { expected_prev: genesis, recorded_prev: genesis, ok: true, is_first: true },
    anchor: { anchored: false },
  };
}

const checks = () => within(screen.getByRole('list', { name: 'Checks' })).getAllByRole('listitem');

describe('the verification result', () => {
  it('shows every check holding, including the one recomputed in the browser', () => {
    render(<VerifyResult v={verification()} />);
    expect(checks()).toHaveLength(4);
    for (const item of checks()) expect(item).toHaveTextContent(/Holds:/);
    expect(screen.getByText(/No outside timestamp covers this report yet/)).toBeInTheDocument();
  });

  it('catches a server that vouches for bytes which do not match the record', () => {
    const v = verification();
    // The server claims everything is fine, but the bytes it shows were edited.
    v.canonical_json = v.canonical_json.replace('Something happened', 'Something else');
    render(<VerifyResult v={v} />);
    expect(screen.getByText('Checked again in your browser').closest('li')).toHaveTextContent(
      /Fails:/,
    );
  });
});
