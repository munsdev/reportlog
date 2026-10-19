import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Field, FieldError } from '../../src/components/ui/field.tsx';
import { Label } from '../../src/components/ui/label.tsx';
import { RadioGroup, RadioOption } from '../../src/components/ui/radio-group.tsx';

function Question({ error }: { error?: string }) {
  const [value, setValue] = useState('');
  return (
    <>
      <Field>
        <Label>May we publish it?</Label>
        <RadioGroup value={value} onValueChange={setValue}>
          <RadioOption value="yes" label="Yes" hint="Without your name." />
          <RadioOption value="no" label="No" />
        </RadioGroup>
        <FieldError>{error}</FieldError>
      </Field>
      <p>Chosen: {value || 'nothing'}</p>
      <button type="button">Next</button>
    </>
  );
}

describe('a radio group', () => {
  it('is named by the field’s label, and each option by its own words', () => {
    render(<Question />);
    const group = screen.getByRole('radiogroup', { name: 'May we publish it?' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Yes' })).toHaveAccessibleDescription(
      'Without your name.',
    );
    expect(screen.getByRole('radio', { name: 'No' })).toBeInTheDocument();
  });

  it('moves with the arrow keys, and Tab leaves it', async () => {
    const user = userEvent.setup();
    render(<Question />);
    await user.tab();
    expect(screen.getByRole('radio', { name: 'Yes' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: 'No' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus();
  });

  it('chooses by clicking the words, and moves nobody on by itself', async () => {
    const user = userEvent.setup();
    render(<Question />);
    await user.click(screen.getByText('Yes'));
    expect(screen.getByRole('radio', { name: 'Yes' })).toBeChecked();
    expect(screen.getByText('Chosen: yes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).not.toHaveFocus();
  });

  it('carries its error to the group', () => {
    render(<Question error="Choose yes or no." />);
    const group = screen.getByRole('radiogroup', { name: 'May we publish it?' });
    expect(group).toHaveAttribute('aria-invalid', 'true');
    expect(group).toHaveAccessibleDescription('Error: Choose yes or no.');
  });
});
