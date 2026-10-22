/**
 * Starting points (deployment templates) after setup. The setup wizard
 * offers them once; this offers the same ones to an administrator later,
 * through the same route (`POST /api/admin/templates`), so there is one
 * place a template can be wrong.
 *
 * Applying one writes over settings somebody may have chosen since, so it
 * is never one click: the dialog lists what it will change, in the server's
 * own words, and asks. Nothing on the page moves while somebody reads it,
 * and choosing a template applies nothing until "Apply it" is pressed.
 */
import { applyTemplate, listTemplates } from '@reportlog/contracts';
import type { TemplateSummary } from '@reportlog/contracts';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { Card } from '@/components/ui/card.tsx';
import { Field } from '@/components/ui/field.tsx';
import { Label } from '@/components/ui/label.tsx';
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import { RadioGroup, RadioOption } from '@/components/ui/radio-group.tsx';
import { call } from '@/lib/api.ts';

const templatesQuery = queryOptions({
  queryKey: ['site-editor', 'templates'],
  queryFn: ({ signal }) => call(listTemplates, { signal }),
});

export const Route = createFileRoute('/(staff)/settings/starting-points')({
  component: StartingPointsPage,
});

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'long' });

export function StartingPointsPage() {
  const client = useQueryClient();
  const catalogue = useQuery(templatesQuery);
  const [asking, setAsking] = useState<TemplateSummary | null>(null);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const apply = useMutation({
    mutationFn: (template: string) => call(applyTemplate, { body: { template } }),
    onSuccess: () => {
      setAsking(null);
      // It changes settings every part of the site reads, and adds a logbook.
      void client.invalidateQueries();
    },
  });
  const templates = catalogue.data?.templates ?? [];
  const applied = catalogue.data?.applied ?? null;
  const appliedLabel = templates.find((t) => t.id === applied?.id)?.label;
  const done = apply.data ? templates.find((t) => t.id === apply.data.applied) : undefined;
  const chosen = templates.find((t) => t.id === chosenId);

  return (
    <StaffPage
      title="Starting points"
      width="prose"
      lede="The bundles of settings the setup wizard offered, for starting again or adding another kind of logbook."
    >
      <p>
        Each one lists what it changes: page wording, whether reports are published, whether files
        are taken, and most also make a <strong>draft</strong> logbook. None touches the legal
        notices, and a draft takes no reports until you launch it yourself, under Logbooks.
        Everything one sets stays yours to change afterwards.
      </p>
      {applied ? (
        <p className="text-sm text-ink-alt">
          This site was last started from “{appliedLabel ?? applied.id}”, on {when(applied.at)}.
        </p>
      ) : null}

      {apply.data ? (
        <Alert tone="done" title={`Applied “${done?.label ?? apply.data.applied}”.`}>
          {apply.data.logbook ? (
            <p>
              It made a draft logbook,{' '}
              <Link
                to="/logbooks/$id"
                params={{ id: apply.data.logbook.id }}
                className="underline underline-offset-4"
              >
                {apply.data.logbook.title}
              </Link>
              . Read its questions before you launch it.
            </p>
          ) : (
            <p>It made no logbook.</p>
          )}
        </Alert>
      ) : null}

      {catalogue.isPending ? <p role="status">Loading the starting points…</p> : null}
      {catalogue.isError ? (
        <Alert tone="serious" title="The starting points could not be loaded.">
          {catalogue.error.message}
        </Alert>
      ) : null}

      {templates.length > 0 ? (
        <Field>
          <Label>Starting points</Label>
          <RadioGroup
            value={chosen?.id ?? ''}
            onValueChange={(id) => {
              apply.reset();
              setChosenId(id);
            }}
          >
            {templates.map((t) => (
              <RadioOption key={t.id} value={t.id} label={t.label} hint={t.description} />
            ))}
          </RadioGroup>
        </Field>
      ) : null}

      {/* Choosing shows what it would change; only the dialog's "Apply it" sends. */}
      {chosen ? (
        <Card heading={chosen.label}>
          <p>What it changes:</p>
          <ul className="list-disc pl-5 text-ink-alt">
            {chosen.sets.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                apply.reset();
                setAsking(chosen);
              }}
            >
              Apply it…
            </Button>
          </div>
        </Card>
      ) : null}

      <Dialog
        open={asking !== null}
        onOpenChange={(open) => {
          if (!open && !apply.isPending) setAsking(null);
        }}
      >
        {asking ? (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Apply “{asking.label}”?</DialogTitle>
              <DialogDescription>
                It writes over what is set now. This is what it will change:
              </DialogDescription>
            </DialogHeader>
            <ul className="list-disc pl-5">
              {asking.sets.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {apply.isError ? (
              <Alert tone="serious" title="It was not applied.">
                {apply.error.message} Nothing was changed.
              </Alert>
            ) : null}
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="secondary" disabled={apply.isPending}>
                  Cancel
                </Button>
              </DialogClose>
              <Button
                type="button"
                variant="primary"
                disabled={apply.isPending}
                onClick={() => {
                  apply.mutate(asking.id);
                }}
              >
                Apply it
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </StaffPage>
  );
}
