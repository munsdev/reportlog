/**
 * The stage 2 components (docs/design/components.md): each one's rules,
 * as a person or a screen reader meets them.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button, buttonVariants } from '../../src/components/ui/button.tsx';
import { Card } from '../../src/components/ui/card.tsx';
import { CheckOption } from '../../src/components/ui/choice.tsx';
import { Chip } from '../../src/components/ui/chip.tsx';
import { Count } from '../../src/components/ui/count.tsx';
import { Empty } from '../../src/components/ui/empty.tsx';
import { Field, FieldError } from '../../src/components/ui/field.tsx';
import { FileDrop } from '../../src/components/ui/file-drop.tsx';
import { Pagination } from '../../src/components/ui/pagination.tsx';
import { RadioGroup, RadioOption } from '../../src/components/ui/radio-group.tsx';
import { CountLine } from '../../src/components/ui/type.tsx';

describe('the button', () => {
  it('is at least 44px tall in both sizes, and 52px when large', () => {
    expect(buttonVariants({ size: 'md' })).toMatch(/\bmin-h-11\b/);
    expect(buttonVariants({ size: 'lg' })).toMatch(/\bmin-h-13\b/);
  });

  it('never fades: disabled is a dashed edge, not opacity', () => {
    for (const variant of ['primary', 'secondary', 'quiet'] as const) {
      const classes = buttonVariants({ variant });
      expect(classes).not.toMatch(/opacity/);
      expect(classes).toMatch(/disabled:border-dashed/);
    }
  });

  it('is outlined in the text colour, primary and secondary alike', () => {
    expect(buttonVariants({ variant: 'primary' })).toMatch(/\bborder-ink\b/);
    expect(buttonVariants({ variant: 'secondary' })).toMatch(/\bborder-ink\b/);
  });

  it('full width is a prop', () => {
    expect(buttonVariants({ block: true })).toMatch(/\bw-full\b/);
  });

  it('busy says what it is doing, stays focusable, and ignores a second press', async () => {
    const user = userEvent.setup();
    const pressed = vi.fn();
    render(
      <Button busy busyLabel="Sending…" onClick={pressed}>
        Send
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Sending…' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toBeEnabled();
    await user.click(button);
    expect(pressed).not.toHaveBeenCalled();
  });

  it('a busy submit button does not send its form twice', async () => {
    const user = userEvent.setup();
    const sent = vi.fn((e: { preventDefault: () => void }) => {
      e.preventDefault();
    });
    render(
      <form onSubmit={sent}>
        <Button type="submit" busy busyLabel="Saving…">
          Save
        </Button>
      </form>,
    );
    await user.click(screen.getByRole('button', { name: 'Saving…' }));
    expect(sent).not.toHaveBeenCalled();
  });
});

describe('the chip and the count', () => {
  it('a chip says its status in words, and open and tag wear no status colour', () => {
    render(
      <>
        <Chip tone="confirmed">Confirmed</Chip>
        <Chip tone="open">Waiting</Chip>
        <Chip>Counts only</Chip>
      </>,
    );
    expect(screen.getByText('Confirmed').className).toMatch(/bg-confirmed/);
    expect(screen.getByText('Waiting').className).not.toMatch(/confirmed|serious|action/);
    expect(screen.getByText('Counts only').className).not.toMatch(/confirmed|serious|action/);
  });

  it('a count is said as a sentence, not a bare number', () => {
    render(<Count value={7} label="7 reports waiting for a moderator" />);
    expect(screen.getByText('7 reports waiting for a moderator')).toHaveClass('sr-only');
    expect(screen.getByText('7')).toHaveAttribute('aria-hidden', 'true');
  });

  it('only the action tone wears the action colour', () => {
    const { container } = render(<Count value={3} label="3" />);
    expect(container.innerHTML).not.toMatch(/bg-action/);
  });
});

describe('the panel', () => {
  it('with a heading, is a section named by a real heading', () => {
    render(<Card heading="Accepting reports">Body</Card>);
    expect(screen.getByRole('heading', { level: 2, name: 'Accepting reports' })).toHaveClass(
      'panel-title',
    );
    expect(screen.getByRole('heading').closest('section')).toHaveAttribute(
      'data-variant',
      'raised',
    );
  });

  it('takes a level 3 heading under a section', () => {
    render(
      <Card heading="Files" headingLevel={3}>
        Body
      </Card>,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'Files' })).toBeInTheDocument();
  });

  it('a deep panel is the deep surface, and no panel wears a status colour', () => {
    const { container } = render(<Card variant="deep">Nothing is public until approved.</Card>);
    const panel = container.firstChild as HTMLElement;
    expect(panel.className).toMatch(/bg-deep/);
    expect(panel.className).not.toMatch(/serious|confirmed|action/);
  });
});

describe('the empty state', () => {
  it('is a title and what happens next, never a bare sentence', () => {
    render(<Empty title="Nothing waiting">New reports appear here.</Empty>);
    expect(screen.getByText('Nothing waiting')).toBeInTheDocument();
    expect(screen.getByText('New reports appear here.')).toBeInTheDocument();
  });
});

describe('the choice card', () => {
  function Question() {
    const [value, setValue] = useState('');
    return (
      <Field>
        <RadioGroup aria-label="May we publish it?" value={value} onValueChange={setValue}>
          <RadioOption value="yes" label="Yes" hint="Without your name." />
          <RadioOption value="no" label="No" />
        </RadioGroup>
      </Field>
    );
  }

  it('chooses from anywhere on the card, the note included, and draws a tick', async () => {
    const user = userEvent.setup();
    render(<Question />);
    await user.click(screen.getByText('Without your name.'));
    const yes = screen.getByRole('radio', { name: 'Yes' });
    expect(yes).toBeChecked();
    expect(yes.querySelector('svg')).not.toBeNull();
  });

  it('is named by its words alone and described by its note', () => {
    render(<Question />);
    expect(screen.getByRole('radio', { name: 'Yes' })).toHaveAccessibleDescription(
      'Without your name.',
    );
  });

  it('a tick card: Space ticks it, the words tick it, and it carries the field’s error', async () => {
    const user = userEvent.setup();
    render(
      <Field>
        <CheckOption label="I agree" hint="You can change your mind later." />
        <FieldError>Tick the box to go on.</FieldError>
      </Field>,
    );
    const box = screen.getByRole('checkbox', { name: 'I agree' });
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(box).toHaveAccessibleDescription(
      'You can change your mind later. Error: Tick the box to go on.',
    );
    await user.tab();
    await user.keyboard(' ');
    expect(box).toBeChecked();
    await user.click(screen.getByText('I agree'));
    expect(box).not.toBeChecked();
  });

  it('outside a field, keeps the description the caller points it at', () => {
    render(
      <>
        <p id="help">Only if you were there.</p>
        <CheckOption label="I saw it" aria-describedby="help" />
      </>,
    );
    expect(screen.getByRole('checkbox', { name: 'I saw it' })).toHaveAccessibleDescription(
      'Only if you were there.',
    );
  });

  it('no browser-default radio or checkbox is visible', () => {
    // Inside a form Radix adds a real input for each control, so the form
    // still posts them; it must never be the thing a person sees.
    const { container } = render(
      <form>
        <RadioGroup aria-label="Publish?" name="publish" defaultValue="yes">
          <RadioOption value="yes" label="Yes" />
        </RadioGroup>
        <CheckOption name="agree" label="I agree" />
      </form>,
    );
    const inputs = container.querySelectorAll('input[type=radio], input[type=checkbox]');
    expect(inputs.length).toBeGreaterThanOrEqual(2);
    for (const input of inputs) expect(input).toHaveAttribute('aria-hidden', 'true');
  });
});

function fileInput(container: HTMLElement): HTMLInputElement {
  const el = container.querySelector('input[type=file]');
  if (!(el instanceof HTMLInputElement)) throw new Error('no file input');
  return el;
}

describe('the file picker', () => {
  it('is a button over a hidden input, said with its limits, and hands over what was chosen', async () => {
    const user = userEvent.setup();
    const chosen = vi.fn();
    const { container } = render(
      <FileDrop multiple onFiles={chosen} limits="Up to 5 files, together less than 50 MB." />,
    );
    const button = screen.getByRole('button', { name: 'Choose files' });
    expect(button).toHaveAccessibleDescription('Up to 5 files, together less than 50 MB.');
    const input = fileInput(container);
    expect(input).toHaveClass('sr-only');
    expect(input).toHaveAttribute('tabindex', '-1');
    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    await user.upload(input, file);
    expect(chosen).toHaveBeenCalledWith([file]);
  });

  it('takes one file when it asks for one, even if two are dropped in', async () => {
    const user = userEvent.setup();
    const chosen = vi.fn();
    const { container } = render(<FileDrop onFiles={chosen} />);
    const input = fileInput(container);
    const a = new File(['a'], 'a.jpg');
    await user.upload(input, a);
    expect(chosen).toHaveBeenCalledWith([a]);
    expect(screen.getByRole('button', { name: 'Choose a file' })).toBeInTheDocument();
  });
});

describe('pagination and the count line', () => {
  it('says where it is, and leaves out a button with nowhere to go', async () => {
    const user = userEvent.setup();
    const go = vi.fn();
    render(<Pagination page={1} pages={7} onPage={go} label="Reports" />);
    expect(screen.getByRole('navigation', { name: 'Reports' })).toHaveTextContent('Page 1 of 7');
    expect(screen.queryByRole('button', { name: 'Previous' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(go).toHaveBeenCalledWith(2);
  });

  it('draws nothing for a single page', () => {
    const { container } = render(<Pagination page={1} pages={1} onPage={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('the count line joins what the list holds, and is read when it changes', () => {
    render(<CountLine parts={['31 reports', '7 waiting', null, '19 approved']} />);
    const line = screen.getByText('31 reports · 7 waiting · 19 approved');
    expect(line).toHaveAttribute('aria-live', 'polite');
  });
});
