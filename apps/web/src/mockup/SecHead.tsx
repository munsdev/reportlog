import type { ReactNode } from 'react';

/** `<div class="sec-head">`: the number, the h2 and one line under it. */
export function SecHead({
  num,
  id,
  title,
  children,
}: {
  num?: string;
  id: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="sec-head">
      {num ? (
        <span className="num" aria-hidden="true">
          {num}
        </span>
      ) : null}
      <h2 id={id}>{title}</h2>
      {children ? <p>{children}</p> : null}
    </div>
  );
}
