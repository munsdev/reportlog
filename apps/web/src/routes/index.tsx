import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { Button } from '../components/ui/button.tsx';

export const Route = createFileRoute('/')({
  component: Home,
});

function Home() {
  const navigate = useNavigate();
  const inputId = useId();
  const [ref, setRef] = useState('');

  return (
    <section className="space-y-6">
      <h1 className="font-display text-3xl font-bold">Check a report</h1>
      <p className="max-w-prose text-ink-alt">
        Every report has a reference like <span className="font-mono">RL-…</span>. Enter one to
        check that it has not been changed since it was filed.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = ref.trim();
          if (trimmed) void navigate({ to: '/verify/$ref', params: { ref: trimmed } });
        }}
        className="flex max-w-xl flex-col gap-3 sm:flex-row sm:items-end"
      >
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor={inputId} className="font-semibold">
            Report reference
          </label>
          <input
            id={inputId}
            value={ref}
            onChange={(e) => {
              setRef(e.target.value);
            }}
            autoComplete="off"
            spellCheck={false}
            className="rounded-card border border-line bg-surface px-3 py-2 font-mono"
          />
        </div>
        <Button type="submit">Check it</Button>
      </form>
    </section>
  );
}
