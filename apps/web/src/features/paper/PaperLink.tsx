/**
 * The small "Print a paper copy" line on a form's first card. A plain link,
 * not the router's: on a door navigation is blocked, and the paper copy is a
 * door of its own, so a full page load is what works everywhere.
 */
export function PaperLink({ href }: { href: string }) {
  return (
    <p className="muted text-sm">
      <a href={href}>Print a paper copy</a> to fill in by hand.
    </p>
  );
}
