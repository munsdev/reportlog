/**
 * The front page's blocks below the headline, drawn the mock-up's way: each
 * one is the inside of a zone (`.section`), numbered with `.sec-head`. The
 * zone itself, which alternates down the page, is `Zone`.
 */
import { blockItems, blockText, parseMarkdown, safeLink } from '@reportlog/contracts';
import type { Block, Item } from '@reportlog/contracts';
import type { ReactNode } from 'react';
import { inlineNodes, Markdown } from '../pages/Markdown.tsx';

/** One zone: its ground (a or b), the header background on an `a`, and the tint when last. */
export function Zone({
  letter,
  tint = false,
  labelledBy,
  children,
}: {
  letter: 'a' | 'b';
  tint?: boolean;
  labelledBy?: string | undefined;
  children: ReactNode;
}) {
  // The page script keeps the alternation (`scope-light` on the light zones
  // under "Section grounds: Alternate"); the class is there from the start
  // so the page does not flash dark before it runs.
  const cls = ['zone', letter === 'a' ? 'motif-host' : 'scope-light', tint ? 'tint' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <section
      className={cls}
      data-zone={letter}
      {...(labelledBy ? { 'aria-labelledby': labelledBy } : {})}
    >
      {letter === 'a' ? <div className="ov" data-slot="band"></div> : null}
      <div className="wrap">{children}</div>
    </section>
  );
}

export function SecHead({
  num,
  id,
  children,
  line,
  tight = false,
}: {
  num: string | null;
  id: string;
  children: ReactNode;
  line?: string;
  tight?: boolean;
}) {
  return (
    <div className="sec-head" {...(tight ? { style: { marginBottom: 6 } } : {})}>
      {num ? (
        <span className="num" aria-hidden="true">
          {num}
        </span>
      ) : null}
      <h2 id={id}>{children}</h2>
      {line ? <p>{line}</p> : null}
    </div>
  );
}

export const headingId = (b: Block): string => `s-${b.id}`;

// ── steps ───────────────────────────────────────────────────────────────

const STEP_ICONS: readonly ReactNode[] = [
  <svg key="a" className="ico" viewBox="0 0 40 40" aria-hidden="true">
    <rect
      x="9"
      y="4"
      width="22"
      height="32"
      rx="4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
    />
    <circle cx="20" cy="18" r="5" fill="none" stroke="currentColor" strokeWidth="2.4" />
    <path d="M17.6 18l1.8 1.8 3.2-3.4" fill="none" stroke="currentColor" strokeWidth="2.2" />
    <rect x="15" y="30" width="10" height="2" fill="currentColor" />
  </svg>,
  <svg key="b" className="ico" viewBox="0 0 40 40" aria-hidden="true">
    <circle cx="20" cy="13" r="6" fill="none" stroke="currentColor" strokeWidth="2.4" />
    <path
      d="M8 35c1.5-7 6.5-11 12-11s10.5 4 12 11"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
    />
  </svg>,
  <svg key="c" className="ico" viewBox="0 0 40 40" aria-hidden="true">
    <rect
      x="8"
      y="17"
      width="24"
      height="18"
      rx="3"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
    />
    <path d="M13 17v-5a7 7 0 0 1 14 0v5" fill="none" stroke="currentColor" strokeWidth="2.4" />
    <rect x="19" y="23" width="2" height="6" fill="currentColor" />
  </svg>,
];

export function StepsView({ block, num }: { block: Block; num: string | null }) {
  return (
    <div className="section">
      <SecHead num={num} id={headingId(block)}>
        {blockText(block, 'heading')}
      </SecHead>
      {/* The mock-up's own markup: a list with its bullets taken off loses its
          list meaning in Safari unless it says so. */}
      {/* eslint-disable-next-line jsx-a11y/no-redundant-roles */}
      <ol className="stepcards" role="list">
        {blockItems(block).map((i, n) => (
          <li className="stepcard" key={n}>
            {STEP_ICONS[n % STEP_ICONS.length]}
            <h3>{i.title}</h3>
            {i.line ? <p>{i.line}</p> : null}
            {i.tag ? <span className="stamp">{i.tag}</span> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

// ── text ────────────────────────────────────────────────────────────────

/** A paragraph that is one link and nothing else is a button, not a line of text. */
function loneLink(children: ReturnType<typeof parseMarkdown>[number]['children']) {
  const only = children.length === 1 ? children[0] : undefined;
  return only?.kind === 'link' ? only : null;
}

export function TextView({ block, num }: { block: Block; num: string | null }) {
  const heading = blockText(block, 'heading');
  const body = blockText(block, 'body');
  const id = headingId(block);
  if (block.variant === 'statement') {
    const [first, ...rest] = parseMarkdown(body);
    return (
      <div className="section split">
        <div style={{ display: 'grid', gap: 14 }}>
          <SecHead num={num} id={id} tight>
            {heading}
          </SecHead>
          {first ? <p className="statement">{inlineNodes(first.children, 'em')}</p> : null}
        </div>
        <div style={{ display: 'grid', gap: 14 }}>
          {rest.map((n, i) => {
            const link = loneLink(n.children);
            return link ? (
              <a key={i} className="btn" href={link.href} style={{ justifySelf: 'start' }}>
                {link.text}
              </a>
            ) : (
              <p key={i} className="lead" style={{ fontSize: '1rem' }}>
                {inlineNodes(n.children)}
              </p>
            );
          })}
        </div>
      </div>
    );
  }
  const inner = (
    <>
      <SecHead num={num} id={id}>
        {heading}
      </SecHead>
      <Markdown text={body} />
    </>
  );
  return (
    <div className="section">
      {block.variant === 'callout' ? <div className="cta">{inner}</div> : inner}
    </div>
  );
}

// ── cards ───────────────────────────────────────────────────────────────

const external = (url: string) => /^https?:\/\//i.test(url);

function CardLink({
  item,
  className,
  children,
}: {
  item: Item;
  className: string;
  children: ReactNode;
}) {
  const href = safeLink(item.link) ?? '#';
  return (
    <a
      className={className}
      href={href}
      style={{ textDecoration: 'none' }}
      {...(external(href) ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {children}
    </a>
  );
}

export function CardsView({ block, num }: { block: Block; num: string | null }) {
  const links = block.variant === 'links';
  return (
    <div className="section">
      <SecHead num={num} id={headingId(block)}>
        {blockText(block, 'heading')}
      </SecHead>
      <div className="cards">
        {blockItems(block).map((i, n) => {
          const body = (
            <>
              {i.tag ? <span className="tag">{i.tag}</span> : null}
              <h3>{i.title}</h3>
              {i.line ? <p>{i.line}</p> : null}
            </>
          );
          if (links)
            return (
              <CardLink key={n} item={i} className="card plain">
                {body}
              </CardLink>
            );
          const href = safeLink(i.link) ?? '#';
          return (
            <div className="card scope-light" key={n}>
              {body}
              {i.label ? (
                <a
                  className={`btn ${n === 0 ? 'go ' : ''}sm flat`}
                  href={href}
                  {...(external(href) ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                >
                  {i.label}
                </a>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── a call to action the owner added ────────────────────────────────────

export function CtaView({ block }: { block: Block }) {
  const label = blockText(block, 'label');
  const url = safeLink(blockText(block, 'url'));
  return (
    <div className="section">
      <div className="cta urgent">
        {blockText(block, 'mark') ? <span className="mark">{blockText(block, 'mark')}</span> : null}
        <h3>{blockText(block, 'heading')}</h3>
        <p>{blockText(block, 'text')}</p>
        {label && url ? (
          <a className="btn sm flat" href={url}>
            {label}
          </a>
        ) : null}
      </div>
    </div>
  );
}
