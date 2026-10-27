/**
 * A staff screen's door for an audience of several roles (or the tester
 * flag): signed out sees the sign-in prompt, signed in without any of them
 * sees a plain refusal naming who it is for, and only then the screen. The
 * same audiences as the menu (`entries.ts`), so the two cannot disagree.
 *
 * Courtesy, not security: the server refuses the same people regardless.
 */
import { useLocation } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { SecondFactorGate, pendingSecondFactor } from '../identity/secondFactor.tsx';
import { useMe } from '../identity/session.ts';
import { SignInPrompt } from '../identity/SignInPrompt.tsx';
import { mayOpen } from './entries.ts';
import type { Audience } from './entries.ts';

export function OnlyFor({
  audience,
  who,
  children,
}: {
  audience: readonly Audience[];
  /** Who it is for, in words: "testers, administrators and Access Managers". */
  who: string;
  children: ReactNode;
}) {
  const me = useMe();
  const { pathname } = useLocation();
  if (me.isPending) return <p role="status">Loading…</p>;
  if (!me.data?.signedIn) return <SignInPrompt next={pathname} />;
  // A role holder without the second factor yet acts with no role or
  // membership (plan E, E3): the way to it, not a refusal.
  if (pendingSecondFactor(me.data)) return <SecondFactorGate>{null}</SecondFactorGate>;
  if (!mayOpen({ for: audience }, me.data)) {
    return (
      <section className="form-stack">
        <h1 className="h-page">Not for this account</h1>
        <p>This page is for {who}. Ask an administrator if you need it.</p>
      </section>
    );
  }
  return <SecondFactorGate>{children}</SecondFactorGate>;
}
