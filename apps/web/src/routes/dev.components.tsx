/**
 * Every component on one page, in every state, for looking at in each look.
 * Development only: a production build answers this address as not found.
 *
 * The look switcher sets `data-palette`, `data-theme`, `data-panel-head` and
 * `data-texture` on <html> directly, without remembering it, so trying a look
 * here never becomes this browser's remembered look for the real site.
 */
import { DEFAULT_LOOK, PALETTES, THEMES, layoutOf } from '@reportlog/contracts';
import { createFileRoute, notFound } from '@tanstack/react-router';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Alert } from '../components/ui/alert.tsx';
import { Button } from '../components/ui/button.tsx';
import { Card } from '../components/ui/card.tsx';
import { CheckOption } from '../components/ui/choice.tsx';
import { Chip } from '../components/ui/chip.tsx';
import { Count } from '../components/ui/count.tsx';
import { Empty } from '../components/ui/empty.tsx';
import { Field, FieldDescription, FieldError } from '../components/ui/field.tsx';
import { FileDrop } from '../components/ui/file-drop.tsx';
import { Input } from '../components/ui/input.tsx';
import { KeyValueList } from '../components/ui/key-value-list.tsx';
import { Label } from '../components/ui/label.tsx';
import { Page } from '../components/ui/page.tsx';
import { Pagination } from '../components/ui/pagination.tsx';
import { RadioGroup, RadioOption } from '../components/ui/radio-group.tsx';
import { Select } from '../components/ui/select.tsx';
import { SettingPanel, SettingPanels } from '../mockup/SettingPanel.tsx';
import { setLayoutAttributes } from '../components/ui/site.tsx';
import { Textarea } from '../components/ui/textarea.tsx';
import { ToastProvider, useToast } from '../components/ui/toast.tsx';
import { CountLine, Eyebrow, Lede, Meta } from '../components/ui/type.tsx';

export const Route = createFileRoute('/dev/components')({
  beforeLoad: () => {
    // The router's own not-found signal, which it expects to be thrown.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    if (!import.meta.env.DEV) throw notFound();
  },
  component: ComponentsPage,
});

function wear(palette: string, theme: string) {
  const root = document.documentElement;
  const layout = layoutOf(theme);
  root.setAttribute('data-palette', palette);
  root.setAttribute('data-theme', theme);
  setLayoutAttributes(root, layout);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="display-face text-section">{title}</h2>
      {children}
    </section>
  );
}

/** Two panels, one open at a time, and a switch that applies at once. */
function Settings() {
  const [open, setOpen] = useState('Yes');
  const [draft, setDraft] = useState('Yes');
  const toast = useToast();
  return (
    <SettingPanels>
      <SettingPanel
        id="accepting"
        title="Accepting reports"
        summary={[{ key: 'Accepting reports', value: open }]}
        dirty={draft !== open}
        onSave={() => {
          setOpen(draft);
        }}
        onCancel={() => {
          setDraft(open);
        }}
      >
        <Field>
          <Label>Accepting reports</Label>
          <RadioGroup value={draft} onValueChange={setDraft}>
            <RadioOption value="Yes" label="Yes" />
            <RadioOption value="No" label="No" />
          </RadioGroup>
        </Field>
      </SettingPanel>
      <div>
        <Button
          variant="secondary"
          onClick={() => {
            toast.show('Publishing is now off.');
          }}
        >
          Show a toast
        </Button>
      </div>
    </SettingPanels>
  );
}

function ComponentsPage() {
  const [palette, setPalette] = useState(
    () => document.documentElement.getAttribute('data-palette') ?? DEFAULT_LOOK.palette,
  );
  const [theme, setTheme] = useState(
    () => document.documentElement.getAttribute('data-theme') ?? DEFAULT_LOOK.theme,
  );
  const [choice, setChoice] = useState('yes');
  const [page, setPage] = useState(2);
  return (
    <Page title="Components" lede="Every building block, in every state, in the look chosen here.">
      <Card variant="quiet">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <Label>Palette</Label>
            <Select
              value={palette}
              onChange={(e) => {
                setPalette(e.target.value);
                wear(e.target.value, theme);
              }}
            >
              {PALETTES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field>
            <Label>Theme</Label>
            <Select
              value={theme}
              onChange={(e) => {
                setTheme(e.target.value);
                wear(palette, e.target.value);
              }}
            >
              {THEMES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Section title="Type">
        <Eyebrow>ReportLog</Eyebrow>
        <h1 className="display-face text-title">A page title</h1>
        <Lede>The sentence under a title, saying what the page is for.</Lede>
        <h3 className="display-face text-xl">A card title</h3>
        <p>Body text, in the theme’s body size, with room between the lines.</p>
        <Meta>RL-2026-0042 · 22 Oct 2026 14:05</Meta>
        <CountLine
          parts={['31 reports', '7 waiting', '19 approved', '3 declined', '1 withdrawn']}
        />
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="quiet">Quiet</Button>
          <Button size="lg">Large</Button>
          <Button busy busyLabel="Sending…">
            Send
          </Button>
          <Button variant="secondary" disabled>
            Save, nothing changed yet
          </Button>
        </div>
        <Button size="lg" block>
          The page’s main action, full width
        </Button>
      </Section>

      <Section title="Chips and counts">
        <div className="flex flex-wrap items-center gap-3">
          <Chip tone="confirmed">Confirmed</Chip>
          <Chip tone="serious">Serious</Chip>
          <Chip tone="open">Waiting</Chip>
          <Chip>Counts only</Chip>
          <Count value={7} label="7 reports waiting" />
          <span className="rounded-control bg-deep p-2">
            <Count tone="action" value={7} label="7 reports waiting for you" />{' '}
            <Count tone="onDeep" value={3} label="3 tips waiting" />
          </span>
        </div>
      </Section>

      <Section title="Panels">
        <Card heading="A raised panel">Holds a decision, a setting, a report.</Card>
        <Card variant="quiet" heading="A quiet panel">
          Help and side information.
        </Card>
        <Card variant="deep" heading="A deep panel">
          Nothing is public until a moderator approves it.
        </Card>
        <Card variant="plain" heading="A plain panel">
          A section of a long settings page.
        </Card>
        <Empty title="Nothing waiting">New reports appear here when somebody files one.</Empty>
      </Section>

      <Section title="Alerts">
        <Alert title="A note">Most messages are this.</Alert>
        <Alert tone="warning" title="A warning">
          A notice that must not be missed.
        </Alert>
        <Alert tone="serious" title="That did not save">
          Try again in a minute.
        </Alert>
        <Alert tone="done" title="Saved" />
      </Section>

      <Section title="Forms">
        <Field>
          <Label>Your email address</Label>
          <FieldDescription>We only use it to reach you about this report.</FieldDescription>
          <Input type="email" defaultValue="someone@" />
          <FieldError>That address is missing the part after the @.</FieldError>
        </Field>
        <Field>
          <Label optional>What happened</Label>
          <Textarea />
        </Field>
        <Field>
          <Label>Disabled</Label>
          <Input disabled defaultValue="Not this one" />
        </Field>
        <Field>
          <Label>May we publish it?</Label>
          <RadioGroup value={choice} onValueChange={setChoice}>
            <RadioOption value="yes" label="Yes" hint="Without your name or address." />
            <RadioOption value="no" label="No" />
            <RadioOption value="later" label="Ask me later" disabled />
          </RadioGroup>
        </Field>
        <CheckOption label="I have read the standard" hint="It says what is published." />
        <FileDrop
          multiple
          onFiles={() => undefined}
          limits="Up to 5 files, together less than 50 MB."
        />
      </Section>

      <Section title="Lists of values">
        <KeyValueList
          items={[
            { key: 'Accepting reports', value: 'Yes' },
            { key: 'Reference', value: 'RL-2026-0042', mono: true },
          ]}
        />
      </Section>

      <Section title="Editing settings">
        <ToastProvider>
          <Settings />
        </ToastProvider>
      </Section>

      <Section title="Pagination">
        <Pagination page={page} pages={7} onPage={setPage} label="Example pages" />
      </Section>
    </Page>
  );
}
