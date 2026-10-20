/** The links module's refusals, each with the sentence a moderator reads. */
import { HttpError } from '../http/errors.ts';

const SENTENCES = {
  'no-group': 'There is no such link.',
  'no-block': 'That is not on the blocklist.',
  'not-an-outcome': 'A link is checked, withheld or illegal.',
  'reason-needed': 'Pick why the link is illegal. It is recorded with the erasure.',
  'already-erased': 'This link was found illegal and erased. There is nothing left to check.',
  'unblock-reason': 'Pick why the entry comes off the blocklist. It is recorded.',
  'comment-too-long': 'Keep the comment under 500 characters.',
  'not-an-address':
    'That is not an address this site would take, so nothing could match it. Paste the whole link, starting with https://',
  'not-a-domain': 'That is not a domain. Type it like example.com.',
  'no-domain-left': 'This link has no copies left to take its domain from.',
} as const;

export type LinkRefusalCode = keyof typeof SENTENCES;

const STATUS: Partial<Record<LinkRefusalCode, number>> = {
  'no-group': 404,
  'no-block': 404,
  'already-erased': 409,
};

export class LinkRefusal extends HttpError {
  override name = 'LinkRefusal';
  declare readonly code: LinkRefusalCode;
  constructor(code: LinkRefusalCode) {
    super(STATUS[code] ?? 400, code, SENTENCES[code]);
  }
}
