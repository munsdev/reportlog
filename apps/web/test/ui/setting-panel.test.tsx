import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Input } from '../../src/components/ui/input.tsx';
import { KeyValueList } from '../../src/components/ui/key-value-list.tsx';
import { SettingPanel, SettingPanels } from '../../src/mockup/SettingPanel.tsx';

/** A panel with one text box, saving into its own state, as a page would. */
function Setting({ id, title, fails = false }: { id: string; title: string; fails?: boolean }) {
  const [saved, setSaved] = useState('Yes');
  const [draft, setDraft] = useState(saved);
  return (
    <SettingPanel
      id={id}
      title={title}
      summary={[{ key: title, value: saved }]}
      dirty={draft !== saved}
      onSave={() => {
        if (fails) return false;
        setSaved(draft);
        return true;
      }}
      onCancel={() => {
        setDraft(saved);
      }}
    >
      <Input
        aria-label={`${title} answer`}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
        }}
      />
    </SettingPanel>
  );
}

/** The panel around a heading. */
function panelOf(title: string): HTMLElement {
  const panel = screen.getByRole('heading', { name: title }).closest('section');
  if (!panel) throw new Error(`no panel called ${title}`);
  return panel;
}

function page() {
  return render(
    <SettingPanels>
      <Setting id="intake" title="Accepting reports" />
      <Setting id="publish" title="Publishing" />
      <Setting id="broken" title="Broken" fails />
    </SettingPanels>,
  );
}

describe('a setting panel', () => {
  it('closed, shows what it is set to now and an Edit button', () => {
    page();
    const panel = panelOf('Accepting reports');
    expect(panel).toHaveTextContent('Accepting reportsYes');
    expect(screen.getByRole('button', { name: 'Edit Accepting reports' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('open, shows its form and a Save bar naming it, and saving closes it', async () => {
    const user = userEvent.setup();
    page();
    await user.click(screen.getByRole('button', { name: 'Edit Accepting reports' }));
    const box = screen.getByRole('textbox', { name: 'Accepting reports answer' });
    expect(screen.getByRole('region', { name: 'Save changes' })).toHaveTextContent(
      'Saving: Accepting reports',
    );
    await user.clear(box);
    await user.type(box, 'No');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(panelOf('Accepting reports')).toHaveTextContent('Accepting reportsNo');
  });

  it('only one is open at a time: opening another with nothing changed just moves', async () => {
    const user = userEvent.setup();
    page();
    await user.click(screen.getByRole('button', { name: 'Edit Accepting reports' }));
    await user.click(screen.getByRole('button', { name: 'Edit Publishing' }));
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.getByRole('textbox', { name: 'Publishing answer' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opening another with changes asks first, naming the open one', async () => {
    const user = userEvent.setup();
    page();
    await user.click(screen.getByRole('button', { name: 'Edit Accepting reports' }));
    await user.type(screen.getByRole('textbox'), '!');
    await user.click(screen.getByRole('button', { name: 'Edit Publishing' }));
    expect(
      screen.getByRole('dialog', { name: 'Leave your changes to Accepting reports?' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByRole('textbox', { name: 'Accepting reports answer' })).toHaveValue('Yes!');

    await user.click(screen.getByRole('button', { name: 'Edit Publishing' }));
    await user.click(screen.getByRole('button', { name: 'Leave them' }));
    expect(screen.getByRole('textbox', { name: 'Publishing answer' })).toBeInTheDocument();
    expect(panelOf('Accepting reports')).toHaveTextContent('Accepting reportsYes');
  });

  it('Escape with changes asks too, and Escape in the question only closes the question', async () => {
    const user = userEvent.setup();
    page();
    await user.click(screen.getByRole('button', { name: 'Edit Accepting reports' }));
    await user.type(screen.getByRole('textbox'), '!');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('Yes!');
  });

  it('Cancel with nothing changed closes without asking', async () => {
    const user = userEvent.setup();
    page();
    await user.click(screen.getByRole('button', { name: 'Edit Accepting reports' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('a save that fails keeps the panel open on its form', async () => {
    const user = userEvent.setup();
    page();
    await user.click(screen.getByRole('button', { name: 'Edit Broken' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('textbox', { name: 'Broken answer' })).toBeInTheDocument();
  });
});

describe('a key-value list', () => {
  it('pairs each name with its value, codes in mono', () => {
    render(
      <KeyValueList
        items={[
          { key: 'Accepting reports', value: 'Yes' },
          { key: 'Reference', value: 'RL-2041', mono: true },
        ]}
      />,
    );
    const terms = screen.getAllByRole('term');
    const values = screen.getAllByRole('definition');
    expect(terms.map((t) => t.textContent)).toEqual(['Accepting reports', 'Reference']);
    expect(values.map((v) => v.textContent)).toEqual(['Yes', 'RL-2041']);
    expect(values[1]?.className).toMatch(/font-mono/);
  });
});
