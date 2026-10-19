import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Checkbox } from '../../src/components/ui/checkbox.tsx';
import { Field, FieldError } from '../../src/components/ui/field.tsx';
import { Label } from '../../src/components/ui/label.tsx';

describe('a checkbox', () => {
  it('is a labelled checkbox that Space toggles and the label toggles too', async () => {
    const user = userEvent.setup();
    render(
      <Field className="flex-row">
        <Checkbox />
        <Label>I agree</Label>
      </Field>,
    );
    const box = screen.getByRole('checkbox', { name: 'I agree' });
    expect(box).not.toBeChecked();
    await user.tab();
    expect(box).toHaveFocus();
    await user.keyboard(' ');
    expect(box).toBeChecked();
    await user.click(screen.getByText('I agree'));
    expect(box).not.toBeChecked();
  });

  it('is invalid while its error shows', () => {
    render(
      <Field>
        <Checkbox />
        <Label>I agree</Label>
        <FieldError>Tick the box to go on.</FieldError>
      </Field>,
    );
    const box = screen.getByRole('checkbox', { name: 'I agree' });
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(box).toHaveAccessibleDescription('Error: Tick the box to go on.');
  });

  it('submits with a plain form', async () => {
    const user = userEvent.setup();
    let sent: FormData | null = null;
    render(
      <form
        onSubmit={(e) => {
          e.preventDefault();
          sent = new FormData(e.currentTarget);
        }}
      >
        <Checkbox id="c" name="agree" value="yes" />
        <Label htmlFor="c">I agree</Label>
        <button type="submit">Send</button>
      </form>,
    );
    await user.click(screen.getByRole('checkbox', { name: 'I agree' }));
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect((sent as FormData | null)?.get('agree')).toBe('yes');
  });
});
