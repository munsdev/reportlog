import { PTabs } from '@/mockup/PTabs.tsx';

/** The two sections of "Front page and pages": the buttons, and the pages' blocks. */
export function FrontPageTabs({ current }: { current: 'buttons' | 'pages' }) {
  return (
    <PTabs
      label="Sections"
      tabs={[
        { to: '/logbooks/front-page', label: 'Front page buttons', current: current === 'buttons' },
        { to: '/logbooks/pages', label: 'Pages and blocks', current: current === 'pages' },
      ]}
    />
  );
}
