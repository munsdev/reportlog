import type { Question } from '@reportlog/contracts';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { QuestionForm } from '../src/features/builder/QuestionForm.tsx';

const q = (over: Partial<Question>): Question => ({
  id: 1,
  key: 'k',
  kind: 'short_text',
  label: 'L',
  help: null,
  required: false,
  filterable: false,
  shown_when: null,
  settings: {},
  position: 0,
  ...over,
});

const earlier = [
  q({ id: 1, key: 'hurt', kind: 'yes_no', label: 'Were you hurt?' }),
  q({ id: 2, key: 'what', kind: 'long_text', label: 'What happened?' }),
  q({ id: 3, key: 'where', kind: 'place', label: 'Where?' }),
  q({
    id: 4,
    key: 'role',
    kind: 'choice_one',
    label: 'Your role',
    settings: { options: ['Voter', 'Observer'] },
  }),
];

describe('the question form', () => {
  it('offers a condition only on earlier questions with a fixed list of answers', () => {
    render(
      <QuestionForm earlier={earlier} launched={false} submitLabel="Add" onSubmit={vi.fn()} />,
    );
    const picker = screen.getByLabelText('Ask it');
    const offered = within(picker)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(offered).toEqual([
      'Always: ask everybody',
      'Only depending on “Were you hurt?”',
      'Only depending on “Your role”',
    ]);
  });

  it('sends the condition in the shape the server seals, and no key at all for "always"', async () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    const user = userEvent.setup();
    render(
      <QuestionForm earlier={earlier} launched={false} submitLabel="Add" onSubmit={onSubmit} />,
    );
    await user.type(
      screen.getByLabelText('The question, as the reporter will read it'),
      'Which organisation?',
    );
    await user.click(screen.getByRole('button', { name: 'Add' }));
    const [first] = onSubmit.mock.lastCall as unknown as [object, string];
    expect('shown_when' in first).toBe(false);

    await user.type(
      screen.getByLabelText('The question, as the reporter will read it'),
      'Which organisation?',
    );
    await user.selectOptions(screen.getByLabelText('Ask it'), 'role');
    await user.click(screen.getByLabelText('Observer'));
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(onSubmit).toHaveBeenLastCalledWith(
      expect.objectContaining({ shown_when: { field: 'role', in: ['Observer'] } }),
      'private_text',
    );
  });

  it('will not offer "an answer is needed" after launch, and says why', () => {
    render(<QuestionForm earlier={[]} launched submitLabel="Add" onSubmit={vi.fn()} />);
    expect(screen.getByLabelText('An answer is needed')).toBeDisabled();
    expect(screen.getByText(/reports already filed never answered it/)).toBeInTheDocument();
  });

  it('shows the server’s refusal where the form is', async () => {
    const user = userEvent.setup();
    render(
      <QuestionForm
        earlier={[]}
        launched={false}
        submitLabel="Add"
        onSubmit={() => Promise.reject(new Error('A list of choices needs at least one choice.'))}
      />,
    );
    await user.type(screen.getByLabelText('The question, as the reporter will read it'), 'Pick');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A list of choices needs at least one choice.',
    );
  });
});
