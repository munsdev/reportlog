/**
 * Stage 4's pieces on their own (docs/status/UI4-public-and-filing.md): the
 * card frame and its progress, what a kind of question says for itself, the
 * character count, the file lines, the states picker, the send that waits for
 * the door, and the page for a wrong address.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router';
import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Door } from '../src/features/door/useDoor.tsx';
import type * as DoorModule from '../src/features/door/useDoor.tsx';
import { statusWords } from '../src/features/files/FilesCard.tsx';
import {
  CardBar,
  CardFrame,
  FilingProgress,
  setFilingProgress,
  useFilingProgress,
} from '../src/features/form/CardFrame.tsx';
import { HelpNow } from '../src/features/form/HelpNow.tsx';
import { CharacterCount, kindHelp } from '../src/features/form/QuestionControl.tsx';
import { StatesPicker, US_STATES } from '../src/features/journalists/StatesPicker.tsx';
import { NotFoundPage } from '../src/features/site-pages/NotFound.tsx';

// The real one: test/setup.ts stands in for the rest of the door module.
const { useSendWhenReady } = await vi.importActual<typeof DoorModule>(
  '../src/features/door/useDoor.tsx',
);

afterEach(() => {
  setFilingProgress(null);
});

function withQueries(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('the progress rule', () => {
  it('is published for the header and on <html>, and taken away when the form goes', () => {
    const { result } = renderHook(() => useFilingProgress());
    expect(result.current).toBeNull();
    const shown = render(<FilingProgress value={0.4} />);
    expect(result.current).toBe(0.4);
    const root = document.documentElement;
    expect(root).toHaveAttribute('data-filing-progress', '');
    expect(root.style.getPropertyValue('--rl-filing-progress')).toBe('0.4');
    // For a screen reader, the page keeps the bar, hidden from sight.
    expect(screen.getByRole('progressbar', { name: 'Progress' })).toHaveAttribute(
      'aria-valuenow',
      '40',
    );
    shown.unmount();
    expect(result.current).toBeNull();
    expect(root).not.toHaveAttribute('data-filing-progress');
  });

  it('draws nothing on the opening card', () => {
    render(<FilingProgress value={null} />);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});

describe('the card frame', () => {
  it('names the logbook above the question, which is the page heading and takes focus', () => {
    vi.stubGlobal('scrollTo', vi.fn());
    render(
      withQueries(
        <CardFrame eyebrow="Election incidents" heading="How did it go?" focusKey="a" optional>
          <p>control</p>
        </CardFrame>,
      ),
    );
    const h1 = screen.getByRole('heading', { level: 1, name: 'How did it go?' });
    expect(h1).toHaveFocus();
    // The step label above the question names the logbook and says it is optional.
    expect(screen.getByText('Election incidents · optional')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('moves focus to its error, a sentence with a mark, when one appears', () => {
    vi.stubGlobal('scrollTo', vi.fn());
    const card = (error?: string) =>
      withQueries(
        <CardFrame eyebrow="E" heading="Q" focusKey="a" error={error}>
          <p>control</p>
        </CardFrame>,
      );
    // On the card first, as somebody is when they press Next.
    const { rerender } = render(card());
    expect(screen.getByRole('heading', { name: 'Q' })).toHaveFocus();
    rerender(card('An answer is needed here.'));
    const error = screen.getByRole('alert');
    expect(error).toHaveTextContent('Error: An answer is needed here.');
    expect(error).toHaveFocus();
    vi.unstubAllGlobals();
  });

  it('never disables Next, and Back is there only when there is somewhere to go', async () => {
    const pressed = vi.fn();
    const { rerender } = render(<CardBar primary="Next" onPrimary={pressed} />);
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
    const nextButton = screen.getByRole('button', { name: 'Next' });
    expect(nextButton).toBeEnabled();
    await userEvent.click(nextButton);
    expect(pressed).toHaveBeenCalledTimes(1);
    rerender(<CardBar primary="Send report" onBack={vi.fn()} busy busyLabel="Sending…" />);
    const sending = screen.getByRole('button', { name: 'Sending…' });
    expect(sending).toHaveAttribute('aria-busy', 'true');
    expect(sending).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  });
});

describe('the emergency notice', () => {
  it('says who to call in a panel that cannot be missed, in the words it is given', () => {
    render(<HelpNow text={'Call 911.\nThis page is not watched.'} />);
    expect(
      screen.getByRole('heading', { name: 'If someone needs help right now' }),
    ).toBeInTheDocument();
    expect(document.querySelector('[data-copy="help_now"]')?.textContent).toBe(
      'Call 911.\nThis page is not watched.',
    );
  });
});

describe('what a kind of question says for itself', () => {
  it('asks to tick everything that applies, unless the wording already does', () => {
    expect(kindHelp({ kind: 'choice_many', settings: {} }, 'What did you see?')).toBe(
      'Tick everything that applies.',
    );
    expect(
      kindHelp({ kind: 'choice_many', settings: {} }, 'Tick all that apply to your visit'),
    ).toBeNull();
  });

  it('speaks a date’s format, and whose clock a date and time is in', () => {
    expect(kindHelp({ kind: 'date', settings: {} }, 'When?')).toBe('Day, month and year.');
    expect(kindHelp({ kind: 'datetime', settings: {} }, 'When?')).toMatch(/where you are/);
    expect(kindHelp({ kind: 'short_text', settings: {} }, 'What?')).toBeNull();
  });
});

describe('the character count', () => {
  it('appears only once half the room is used', () => {
    const { rerender } = render(<CharacterCount length={10} max={500} />);
    expect(screen.queryByText(/of 500/)).not.toBeInTheDocument();
    rerender(<CharacterCount length={249} max={500} />);
    expect(screen.queryByText(/of 500/)).not.toBeInTheDocument();
    rerender(<CharacterCount length={312} max={500} />);
    expect(screen.getByText('312 of 500')).toBeInTheDocument();
  });
});

describe('a file’s line', () => {
  it('says how far it has got, then Preparing, then Ready', () => {
    expect(statusWords({ status: 'uploading', progress: 40 })).toBe('Uploading, 40%');
    expect(statusWords({ status: 'uploaded', progress: 100 })).toBe('Uploaded');
    expect(statusWords({ status: 'processing', progress: 100 })).toBe('Preparing');
    expect(statusWords({ status: 'clean', progress: 100 })).toBe('Ready');
  });
});

describe('the states picker', () => {
  function Picker() {
    const [value, setValue] = useState<string[]>([]);
    return <StatesPicker value={value} onChange={setValue} />;
  }

  it('finds on Enter, not as somebody types, and keeps what is ticked out of view', async () => {
    const user = userEvent.setup();
    render(<Picker />);
    await user.click(screen.getByRole('checkbox', { name: 'Ohio' }));
    expect(screen.getByText('1 state chosen')).toBeInTheDocument();
    const find = screen.getByRole('searchbox', { name: 'Find a state' });
    await user.type(find, 'neva');
    // Typed but not asked for: the list is unchanged (decision 59).
    expect(screen.getByRole('checkbox', { name: 'Ohio' })).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('checkbox', { name: 'Ohio' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Nevada' })).toBeInTheDocument();
    expect(screen.getByText('1 state chosen')).toBeInTheDocument();
  });

  it('offers every state at once, first', async () => {
    const user = userEvent.setup();
    render(<Picker />);
    await user.click(screen.getByRole('checkbox', { name: 'All states' }));
    expect(screen.getByText(`${String(US_STATES.length)} states chosen`)).toBeInTheDocument();
  });
});

describe('a send pressed before the door is ready', () => {
  const door = (ready: boolean, failed = false): Door => ({
    ready,
    failed,
    fields: () => null,
    renew: () => undefined,
    website: '',
    setWebsite: () => undefined,
    host: () => undefined,
  });

  it('is kept, says it is sending, and goes the moment the door is ready, once', () => {
    let submittedAt = 0;
    const mutate = vi.fn(() => {
      submittedAt = Date.now() + 1;
    });
    const { result, rerender } = renderHook(
      ({ ready }: { ready: boolean }) => useSendWhenReady(door(ready), { mutate, submittedAt }),
      { initialProps: { ready: false } },
    );
    act(() => {
      result.current.press();
    });
    expect(mutate).not.toHaveBeenCalled();
    expect(result.current.waiting).toBe(true);
    rerender({ ready: true });
    expect(mutate).toHaveBeenCalledTimes(1);
    rerender({ ready: true });
    expect(result.current.waiting).toBe(false);
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('drops the press when the door cannot get ready', () => {
    const mutate = vi.fn();
    const { result } = renderHook(() =>
      useSendWhenReady(door(false, true), { mutate, submittedAt: 0 }),
    );
    act(() => {
      result.current.press();
    });
    expect(result.current.waiting).toBe(false);
    expect(mutate).not.toHaveBeenCalled();
  });
});

describe('the page for a wrong address', () => {
  it('says so, offers filing and the front page, and says to check the reference', async () => {
    const root = createRootRoute({ component: NotFoundPage });
    const router = createRouter({
      routeTree: root,
      history: createMemoryHistory({ initialEntries: ['/'] }),
    });
    render(withQueries(<RouterProvider router={router} />));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'That page isn’t here' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Check the reference, or start from the front page/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Front page' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Submit a report' })).toHaveAttribute(
      'href',
      '/submit',
    );
  });
});
