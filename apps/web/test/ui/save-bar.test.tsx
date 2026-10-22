import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SaveBar } from '../../src/components/ui/save-bar.tsx';

describe('the Save bar', () => {
  it('names what it saves', () => {
    render(<SaveBar name="Accepting reports" onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'Save changes' })).toHaveTextContent(
      'Saving: Accepting reports',
    );
  });

  it('saves and cancels from its two buttons, and Escape is Cancel', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(<SaveBar name="Accepting reports" onSave={onSave} onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('says it is saving, and a second press does nothing', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<SaveBar name="Accepting reports" busy onSave={onSave} onCancel={vi.fn()} />);
    const save = screen.getByRole('button', { name: 'Saving…' });
    expect(save).toHaveAttribute('aria-busy', 'true');
    await user.click(save);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('sits above a phone keyboard', () => {
    const listeners: Record<string, () => void> = {};
    const vv = {
      height: 800,
      offsetTop: 0,
      addEventListener: (type: string, fn: () => void) => {
        listeners[type] = fn;
      },
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('visualViewport', vv);
    vi.stubGlobal('innerHeight', 800);
    try {
      render(<SaveBar name="Accepting reports" onSave={vi.fn()} onCancel={vi.fn()} />);
      const bar = screen.getByRole('region', { name: 'Save changes' });
      expect(document.documentElement.style.getPropertyValue('--rl-kb-inset')).toBe('0px');
      expect(bar.className).toMatch(/bottom-\(--rl-kb-inset/);
      vv.height = 500;
      act(() => {
        listeners.resize?.();
      });
      expect(document.documentElement.style.getPropertyValue('--rl-kb-inset')).toBe('300px');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('leaves room for itself at the foot of the page, and in print it is gone', () => {
    const { container } = render(
      <SaveBar name="Accepting reports" onSave={vi.fn()} onCancel={vi.fn()} />,
    );
    const spacer = container.firstElementChild as HTMLElement;
    expect(spacer).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('region', { name: 'Save changes' }).className).toMatch(/print:hidden/);
  });
});
