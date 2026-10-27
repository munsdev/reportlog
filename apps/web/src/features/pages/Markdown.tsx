/**
 * Body text from the blocks' tiny Markdown subset (parseMarkdown in
 * @reportlog/contracts): paragraphs, ## headings, **bold** and links. Our own
 * renderer and no HTML: nothing the operator types can become markup, and a
 * link that is not a path, a web address or a mail address is plain words.
 * Drawn the mock-up's way: a `.prose` column.
 */
import { isExternalLink, parseMarkdown } from '@reportlog/contracts';
import type { Inline } from '@reportlog/contracts';
import type { ReactNode } from 'react';

/** The inline runs as elements; `bold` names the element **bold** becomes. */
export function inlineNodes(
  nodes: readonly Inline[],
  bold: 'strong' | 'em' = 'strong',
): ReactNode[] {
  return nodes.map((n, i) => {
    if (n.kind === 'text') return n.text;
    if (n.kind === 'bold') {
      const kids = inlineNodes(n.children, bold);
      return bold === 'em' ? <em key={i}>{kids}</em> : <strong key={i}>{kids}</strong>;
    }
    return isExternalLink(n.href) ? (
      <a key={i} href={n.href} target="_blank" rel="noopener noreferrer">
        {n.text}
      </a>
    ) : (
      <a key={i} href={n.href}>
        {n.text}
      </a>
    );
  });
}

export function Markdown({
  text,
  copy,
  className = 'prose',
}: {
  text: string;
  copy?: string;
  className?: string;
}) {
  return (
    <div className={className} {...(copy ? { 'data-copy': copy } : {})}>
      {parseMarkdown(text).map((n, i) =>
        n.kind === 'h' ? (
          <h3 key={i}>{inlineNodes(n.children)}</h3>
        ) : (
          <p key={i}>{inlineNodes(n.children)}</p>
        ),
      )}
    </div>
  );
}
