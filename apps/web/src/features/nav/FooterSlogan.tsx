/**
 * The footer's slogan (the Footer slogan slot): two lines, the first large
 * and the second quieter, beside the wordmark. Nothing when the operator
 * wrote none.
 */
import { useSite } from '@/components/ui/site.tsx';

export function FooterSlogan() {
  const slogan = useSite().data?.copy.footer_slogan ?? '';
  const [big, ...small] = slogan
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (!big) return null;
  return (
    <p className="foot-slogan" data-copy="footer_slogan">
      {big}
      {small.length ? (
        <>
          <br />
          <span>{small.join(' ')}</span>
        </>
      ) : null}
    </p>
  );
}
