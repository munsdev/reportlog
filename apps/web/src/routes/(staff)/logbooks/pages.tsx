import { PAGE_IDS, PAGE_NAMES } from '@reportlog/contracts';
import type { PageId } from '@reportlog/contracts';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { StaffPage } from '../../../features/nav/StaffPage.tsx';
import { pageBlocksQuery } from '../../../features/pages/queries.ts';
import { FrontPageTabs } from '../../../features/builder/FrontPageTabs.tsx';
import { StaffOnly } from '../../../features/identity/StaffOnly.tsx';

export const Route = createFileRoute('/(staff)/logbooks/pages')({
  component: () => (
    <StaffOnly needs="admin">
      <PagesAndBlocks />
    </StaffOnly>
  ),
});

/** Where each page is read, and so where "Edit this page" is offered. */
const PATH: Record<PageId, string> = {
  home: '/',
  about: '/about',
  'get-involved': '/get-involved',
};

function PageCard({ id }: { id: PageId }) {
  const blocks = useQuery(pageBlocksQuery(id));
  const n = blocks.data?.blocks.length;
  return (
    <a className="area-card" href={PATH[id]}>
      <h3>{PAGE_NAMES[id]}</h3>
      <p>Open it and choose “Edit this page” to arrange its blocks in place.</p>
      <span className="m">
        {n === undefined ? '…' : `${String(n)} block${n === 1 ? '' : 's'}`}
        {blocks.data ? (blocks.data.customised ? ' · edited' : ' · shipped wording') : ''}
      </span>
    </a>
  );
}

function PagesAndBlocks() {
  return (
    <StaffPage
      title="Front page and pages"
      lede="Pages built from blocks. Open one to edit it in place."
      tabs={<FrontPageTabs current="pages" />}
    >
      <div className="areas">
        {PAGE_IDS.map((id) => (
          <PageCard key={id} id={id} />
        ))}
      </div>
    </StaffPage>
  );
}
