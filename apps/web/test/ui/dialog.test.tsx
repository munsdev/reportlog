import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Button } from '../../src/components/ui/button.tsx';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../src/components/ui/dialog.tsx';

function Example() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary">Withdraw the report</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Withdraw this report?</DialogTitle>
          <DialogDescription>It stays in the chain, marked withdrawn.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Keep it</Button>
          </DialogClose>
          <Button>Withdraw it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

describe('a dialog', () => {
  it('is named and described, takes focus, and gives it back on Escape', async () => {
    const user = userEvent.setup();
    render(<Example />);
    const opener = screen.getByRole('button', { name: 'Withdraw the report' });
    await user.click(opener);

    const dialog = screen.getByRole('dialog', { name: 'Withdraw this report?' });
    expect(dialog).toHaveAccessibleDescription('It stays in the chain, marked withdrawn.');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('keeps Tab inside it while open', async () => {
    const user = userEvent.setup();
    render(<Example />);
    await user.click(screen.getByRole('button', { name: 'Withdraw the report' }));
    const dialog = screen.getByRole('dialog');
    for (let i = 0; i < 6; i++) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
  });

  it('has a Close button a keyboard reaches', async () => {
    const user = userEvent.setup();
    render(<Example />);
    await user.click(screen.getByRole('button', { name: 'Withdraw the report' }));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
