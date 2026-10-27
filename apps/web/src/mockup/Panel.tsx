import type { ReactNode } from 'react';

/** The mock-up's `.panel` (staff.py `panel`): a titled box. `kind` is deep, quiet, danger or closed. */
export function Panel({
  title,
  sub,
  kind,
  id,
  as: Tag = 'section',
  head,
  children,
}: {
  title?: ReactNode;
  sub?: ReactNode;
  kind?: 'deep' | 'quiet' | 'danger' | 'closed';
  id?: string;
  as?: 'section' | 'article';
  /** Something at the right of the title (a status chip): the mock-up's `.closed-head`. */
  head?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Tag className={kind ? `panel ${kind}` : 'panel'} {...(id ? { id } : {})}>
      {head ? (
        <div className="closed-head">
          {title ? <h2>{title}</h2> : null}
          {head}
        </div>
      ) : title ? (
        <h2>{title}</h2>
      ) : null}
      {sub ? <p className="sub">{sub}</p> : null}
      {children}
    </Tag>
  );
}
