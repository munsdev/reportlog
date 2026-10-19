import { createFileRoute } from '@tanstack/react-router';
import { Page } from '@/components/ui/page.tsx';

export const Route = createFileRoute('/(staff)/settings/')({
  component: SettingsHome,
});

function SettingsHome() {
  return (
    <Page title="Site settings" width="prose">
      <p>
        Everything here is about how this site presents itself. None of it is part of any report:
        renaming the site or changing a policy never changes how a report checks out.
      </p>
    </Page>
  );
}
