/**
 * A date or time field shows its own calendar or clock, the same on every
 * phone (an iPhone draws an empty date field as a blank box), and a tap
 * anywhere on it opens the browser's picker. Any other field is unchanged.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Input } from '../src/components/ui/input.tsx';

describe('a date or time field', () => {
  it('carries a calendar for a date, and a clock for a time, hidden from screen readers', () => {
    const { container } = render(
      <>
        <Input type="date" aria-label="When" />
        <Input type="datetime-local" aria-label="From" />
        <Input type="time" aria-label="At" />
        <Input type="text" aria-label="Name" />
      </>,
    );
    const marks = [...container.querySelectorAll('[data-picker-mark]')];
    expect(marks.map((m) => m.getAttribute('data-picker-mark'))).toEqual([
      'calendar',
      'calendar',
      'clock',
    ]);
    for (const m of marks) expect(m).toHaveAttribute('aria-hidden', 'true');
  });

  it('opens the picker when tapped anywhere, and keeps the caller’s own click', () => {
    const clicked = vi.fn();
    render(<Input type="date" aria-label="When" onClick={clicked} />);
    const box = screen.getByLabelText<HTMLInputElement>('When');
    const showPicker = vi.fn();
    box.showPicker = showPicker;
    fireEvent.click(box);
    expect(clicked).toHaveBeenCalledOnce();
    expect(showPicker).toHaveBeenCalledOnce();
  });

  it('does not open the picker of a field that is disabled, or where the browser refuses', () => {
    render(
      <>
        <Input type="date" aria-label="Off" disabled />
        <Input type="date" aria-label="Refused" />
      </>,
    );
    const off = screen.getByLabelText<HTMLInputElement>('Off');
    const offPicker = vi.fn();
    off.showPicker = offPicker;
    fireEvent.click(off);
    expect(offPicker).not.toHaveBeenCalled();
    const refused = screen.getByLabelText<HTMLInputElement>('Refused');
    refused.showPicker = () => {
      throw new DOMException('not allowed', 'NotAllowedError');
    };
    expect(() => fireEvent.click(refused)).not.toThrow();
  });
});
