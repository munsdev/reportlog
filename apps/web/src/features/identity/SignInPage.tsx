import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { useBodyClass } from '../../mockup/useBodyClass.ts';
import { SignInForm } from './SignInForm.tsx';
import { useIdentityChanged } from './session.ts';

/**
 * /access/sign-in (account.md §02; mock-up sign-in.html). `next` is where to
 * go afterwards: a path on this site, never another one.
 */
export function SignInPage({ next }: { next: string | undefined }) {
  useBodyClass('light', 'form');
  const router = useRouter();
  const changed = useIdentityChanged();
  const [step, setStep] = useState<'email' | 'code'>('email');
  return (
    <div data-bleed>
      <div className="wrap" style={{ paddingTop: 30 }}>
        <div className="form-stack" style={{ maxWidth: 460 }}>
          <span className="eyebrow">Sign in</span>
          <h1 className="h-page" id="h1">
            {step === 'email' ? 'Your email first' : 'Now the code'}
          </h1>
          <p className="muted">
            We send a six-digit code. Moderators and administrators then confirm with their second
            factor.
          </p>
          <SignInForm
            onStep={setStep}
            onSignedIn={async () => {
              await changed();
              router.history.push(next ?? '/home');
            }}
          />
        </div>
      </div>
    </div>
  );
}

/** Only a path on this site: a `next` of "//elsewhere" or "https://…" would send somebody away. */
export function safeNext(value: unknown): string | undefined {
  return typeof value === 'string' && /^\/(?![/\\])/.test(value) ? value : undefined;
}
