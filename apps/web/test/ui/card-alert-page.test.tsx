import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Alert } from '../../src/components/ui/alert.tsx';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '../../src/components/ui/card.tsx';
import { Page } from '../../src/components/ui/page.tsx';

describe('a card', () => {
  it('has a real heading, level 2 unless told otherwise', () => {
    render(
      <>
        <Card>
          <CardHeader>
            <CardTitle>Incidents</CardTitle>
            <CardDescription>12 reports</CardDescription>
          </CardHeader>
          <CardContent>Body</CardContent>
          <CardFooter>Footer</CardFooter>
        </Card>
        <Card>
          <CardTitle as="h3">Nested</CardTitle>
        </Card>
      </>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Incidents' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Nested' })).toBeInTheDocument();
  });

  it('wears no status colour', () => {
    const { container } = render(<Card>Plain</Card>);
    expect((container.firstChild as HTMLElement).className).not.toMatch(/serious|confirmed|action/);
  });
});

describe('an alert', () => {
  it('interrupts for a problem, and says it is one in words', () => {
    render(<Alert tone="serious" title="That did not save." />);
    expect(screen.getByRole('alert')).toHaveTextContent('Problem: That did not save.');
  });

  it('waits its turn for a note or a confirmation', () => {
    render(
      <>
        <Alert title="Saved.">Your changes are live.</Alert>
        <Alert tone="confirmed" title="Approved." />
      </>,
    );
    const [note, done] = screen.getAllByRole('status');
    expect(note).toHaveTextContent('Note: Saved.Your changes are live.');
    expect(done).toHaveTextContent('Done: Approved.');
  });

  it('puts status colour on its edge only, and a note gets none', () => {
    render(
      <>
        <Alert tone="serious">x</Alert>
        <Alert>y</Alert>
      </>,
    );
    const serious = screen.getByRole('alert');
    expect(serious.className).toMatch(/border-l-serious/);
    expect(serious.className).not.toMatch(/bg-serious|text-serious/);
    expect(screen.getByRole('status').className).not.toMatch(/serious|confirmed/);
  });
});

/** A query client that already knows the site, so nothing is fetched. */
function withSite(plain: string): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(['site'], { plain_name: plain });
  return client;
}

describe('a page', () => {
  it('has one h1, a lede, actions, and names the tab', () => {
    render(
      <QueryClientProvider client={withSite('Munich Archive')}>
        <Page title="Settings" lede="How the site looks." actions={<button>Save</button>}>
          <p>Body</p>
        </Page>
      </QueryClientProvider>,
    );
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Settings');
    expect(screen.getByText('How the site looks.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(document.title).toBe('Settings · Munich Archive');
  });
});
