import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOAST_MS, ToastProvider, useToast } from '../../src/components/ui/toast.tsx';

function Switch() {
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={() => {
        toast.show('Accepting reports is now off.');
      }}
    >
      Turn off
    </button>
  );
}

function page() {
  return render(
    <ToastProvider>
      <Switch />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('a toast', () => {
  it('speaks from a live region that was there, empty, before it', () => {
    page();
    const region = screen.getByRole('status');
    expect(region).toBeEmptyDOMElement();
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    expect(region).toHaveTextContent('Accepting reports is now off.');
  });

  it('goes after five seconds', () => {
    page();
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    act(() => {
      vi.advanceTimersByTime(TOAST_MS - 100);
    });
    expect(screen.getByText('Accepting reports is now off.')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByText('Accepting reports is now off.')).not.toBeInTheDocument();
  });

  it('waits while the pointer is over it, and goes with what was left after', () => {
    page();
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    const words = screen.getByText('Accepting reports is now off.');
    const toast = words.parentElement;
    if (!toast) throw new Error('the words are not in a toast');
    fireEvent.mouseEnter(toast);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(words).toBeInTheDocument();
    fireEvent.mouseLeave(toast);
    act(() => {
      vi.advanceTimersByTime(2100);
    });
    expect(screen.queryByText('Accepting reports is now off.')).not.toBeInTheDocument();
  });

  it('waits while focus is in it, so reaching for Dismiss is not a race', () => {
    page();
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    const dismiss = screen.getByRole('button', { name: 'Dismiss' });
    act(() => {
      dismiss.focus();
    });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('Accepting reports is now off.')).toBeInTheDocument();
  });

  it('Dismiss closes it at once', () => {
    page();
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Accepting reports is now off.')).not.toBeInTheDocument();
  });

  it('wears no status colour: it is never an error', () => {
    page();
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    expect(screen.getByRole('status').innerHTML).not.toMatch(/serious|confirmed/);
  });
});
