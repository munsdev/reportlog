/** An editor state as the server would send it, for screens tested without one. */
import { resolveHomeSections, resolveSocialLinks } from '@reportlog/contracts';
import type { SiteEditor } from '@reportlog/contracts';

export function editorState(overrides: Partial<SiteEditor> = {}): SiteEditor {
  return {
    look: { palette: 'flint', theme: 'signal' },
    name: null,
    effective_name: 'ReportLog',
    copy: [
      {
        key: 'home_headline',
        kind: 'line',
        label: 'Front page headline',
        help: 'The first line anybody reads.',
        optional: false,
        fallback: 'A record of what happened.',
        body: 'A record of what happened.',
        written: false,
        changed_at: null,
      },
    ],
    legal: [
      { kind: 'impressum', text: 'IMPRINT — outline to complete\n[name]', published: false },
      { kind: 'privacy', text: 'Our policy.', published: true },
    ],
    home_sections: resolveHomeSections(null),
    social_links: resolveSocialLinks(null),
    ...overrides,
  };
}

/** A fetch that records what was sent and answers every save with `answer`. */
export function recordingFetch(answer: unknown) {
  const sent: { url: string; method: string; body: unknown }[] = [];
  const fetchImpl = (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({
      url: input instanceof Request ? input.url : input.toString(),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    });
    return Promise.resolve(
      new Response(JSON.stringify(answer), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
  return { sent, fetchImpl };
}
