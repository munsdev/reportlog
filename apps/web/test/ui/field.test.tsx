import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Field, FieldDescription, FieldError } from '../../src/components/ui/field.tsx';
import { Input } from '../../src/components/ui/input.tsx';
import { Label } from '../../src/components/ui/label.tsx';
import { Select } from '../../src/components/ui/select.tsx';
import { Textarea } from '../../src/components/ui/textarea.tsx';

describe('a field', () => {
  it('labels its text field and reads its hint as the description', () => {
    render(
      <Field>
        <Label>Your email address</Label>
        <FieldDescription>Only to reach you about this report.</FieldDescription>
        <Input type="email" />
      </Field>,
    );
    const input = screen.getByLabelText('Your email address');
    expect(input).toHaveAttribute('type', 'email');
    expect(input).toHaveAccessibleDescription('Only to reach you about this report.');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('marks the control invalid exactly while an error shows, and says why in words', () => {
    const { rerender } = render(
      <Field>
        <Label>Your email address</Label>
        <Input />
        <FieldError>Enter an email address, like name@example.org.</FieldError>
      </Field>,
    );
    const input = screen.getByLabelText('Your email address');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(
      'Error: Enter an email address, like name@example.org.',
    );

    rerender(
      <Field>
        <Label>Your email address</Label>
        <Input />
        <FieldError>{''}</FieldError>
      </Field>,
    );
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).not.toHaveAttribute('aria-describedby');
  });

  it('says "optional" in the label, not only with a mark', () => {
    render(
      <Field>
        <Label optional>Where it happened</Label>
        <Textarea />
      </Field>,
    );
    expect(screen.getByLabelText('Where it happened (optional)').tagName).toBe('TEXTAREA');
  });

  it('keeps two fields on one page apart', () => {
    render(
      <>
        <Field>
          <Label>First</Label>
          <Input />
          <FieldError>Wrong</FieldError>
        </Field>
        <Field>
          <Label>Second</Label>
          <Input />
        </Field>
      </>,
    );
    expect(screen.getByLabelText('First')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Second')).not.toHaveAttribute('aria-invalid');
  });

  it('takes its control’s id from the field, and keeps a caller’s own description', () => {
    render(
      <>
        <p id="outside">Outside help</p>
        <Field controlId="mine">
          <Label>Name</Label>
          <Input aria-describedby="outside" />
        </Field>
      </>,
    );
    const input = screen.getByLabelText('Name');
    expect(input).toHaveAttribute('id', 'mine');
    expect(input).toHaveAccessibleDescription('Outside help');
  });
});

describe('a text field and a text area', () => {
  it('take typing, and a click on the label puts the cursor in them', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Field>
          <Label>Title</Label>
          <Input />
        </Field>
        <Field>
          <Label>What happened</Label>
          <Textarea />
        </Field>
      </>,
    );
    await user.click(screen.getByText('Title'));
    expect(screen.getByLabelText('Title')).toHaveFocus();
    await user.keyboard('A title');
    await user.tab();
    expect(screen.getByLabelText('What happened')).toHaveFocus();
    await user.keyboard('Line one{Enter}Line two');
    expect(screen.getByLabelText('Title')).toHaveValue('A title');
    expect(screen.getByLabelText('What happened')).toHaveValue('Line one\nLine two');
  });

  it('work on their own with a plain htmlFor label', () => {
    render(
      <>
        <Label htmlFor="alone">Alone</Label>
        <Input id="alone" />
      </>,
    );
    expect(screen.getByLabelText('Alone')).toBeInTheDocument();
  });
});

describe('a select', () => {
  it('is the native control, labelled, and chosen from with the keyboard', async () => {
    const user = userEvent.setup();
    render(
      <Field>
        <Label>Logbook</Label>
        <Select defaultValue="">
          <option value="" disabled>
            Choose one
          </option>
          <option value="incidents">Incidents</option>
          <option value="checkins">Check-ins</option>
        </Select>
        <FieldError>Choose a logbook.</FieldError>
      </Field>,
    );
    const select = screen.getByRole('combobox', { name: 'Logbook' });
    expect(select.tagName).toBe('SELECT');
    expect(select).toHaveAttribute('aria-invalid', 'true');
    await user.selectOptions(select, 'checkins');
    expect(select).toHaveValue('checkins');
  });
});
