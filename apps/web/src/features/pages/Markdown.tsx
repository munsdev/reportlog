/**
 * Body text from the blocks' tiny Markdown subset (parseMarkdown in
 * @reportlog/contracts): paragraphs, ## headings, **bold** and links. Our own
 * renderer and no HTML: nothing the operator types can become markup, and a
 * link that is not a path, a web address or a mail address is plain words.
 */
import { isExternalLink, parseMarkdown } from '@reportlog/contracts';
import type { Inline } from '@reportlog/contracts';
import type { ReactNode } from 'react';

function inline(nodes: readonly Inline[]): ReactNode[] {
  return nodes.map((n, i) => {
    if (n.kind === 'text') return n.text;
    if (n.kind === 'bold') return <strong key={i}>{inline(n.children)}</strong>;
    return isExternalLink(n.href) ? (
      <a
        key={i}
        href={n.href}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-4"
      >
        {n.text}
      </a>
    ) : (
      <a key={i} href={n.href} className="underline underline-offset-4">
        {n.text}
      </a>
    );
  });
}

export function Markdown({ text, copy }: { text: string; copy?: string }) {
  return (
    <div className="flex flex-col gap-3" {...(copy ? { 'data-copy': copy } : {})}>
      {parseMarkdown(text).map((n, i) =>
        n.kind === 'h' ? (
          <h3 key={i} className="font-display text-lg">
            {inline(n.children)}
          </h3>
        ) : (
          <p key={i} className="max-w-prose whitespace-pre-wrap">
            {inline(n.children)}
          </p>
        ),
      )}
    </div>
  );
}
