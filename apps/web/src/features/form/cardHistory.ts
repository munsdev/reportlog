/**
 * One browser history entry per card, so the browser's Back goes back one
 * question, as it did in the old form, instead of leaving the form and
 * everything typed into it.
 *
 * Every entry is the SAME ADDRESS, query and all: only its history state
 * names the card. The address never says which card, because an address
 * with a card in it could be reloaded or shared, and would open a question
 * with none of the answers before it.
 *
 * Entries carry the id of the page visit that made them. After a reload the
 * answers are gone but the browser keeps the old entries, so moving onto one
 * of those starts the form again rather than opening a card from the last
 * visit with nothing behind it.
 *
 * The router's own history is used rather than `window.history`, because
 * the router numbers its entries and a push it did not make would confuse
 * it. On a door the gate blocks every navigation; it lets through these,
 * because they never leave the address (gate.tsx).
 */
import type { RouterHistory } from '@tanstack/react-router';
import { useEffect, useEffectEvent, useState } from 'react';

/** What one entry says: the card, and whether Next from it returns to the review. */
export interface CardEntry {
  card: string;
  toReview: boolean;
}

function entryOf(state: object, visit: string): CardEntry | null {
  if (!('filingVisit' in state) || state.filingVisit !== visit) return null;
  if (!('filingCard' in state) || typeof state.filingCard !== 'string') return null;
  const toReview = 'filingToReview' in state && state.filingToReview === true;
  return { card: state.filingCard, toReview };
}

const newVisit = () => `v${Math.random().toString(36).slice(2)}`;

/**
 * `onMove` is called when the browser moves to another entry (Back, Forward,
 * or a jump from the history menu), with the card it holds, or null for an
 * entry this visit did not make. It returns the card actually shown when
 * that is a different one, and the entry is corrected to say so. Without a
 * history (a test rendering the form alone), cards still move; the browser
 * just has nothing to go back through.
 */
export function useCardHistory(
  history: RouterHistory | undefined,
  first: string,
  onMove: (entry: CardEntry | null) => CardEntry | null,
) {
  const [visit] = useState(newVisit);

  const write = (how: 'push' | 'replace', entry: CardEntry) => {
    if (!history) return;
    const here = history.location;
    history[how](here.href, {
      ...here.state,
      filingVisit: visit,
      filingCard: entry.card,
      filingToReview: entry.toReview,
    });
  };

  const moved = useEffectEvent((entry: CardEntry | null) => {
    const shown = onMove(entry);
    if (shown) write('replace', shown);
  });

  // The entry the page was opened on becomes the first card's.
  useEffect(() => {
    if (!history) return;
    const here = history.location;
    history.replace(here.href, {
      ...here.state,
      filingVisit: visit,
      filingCard: first,
      filingToReview: false,
    });
    return history.subscribe(({ location, action }) => {
      if (action.type === 'PUSH' || action.type === 'REPLACE') return;
      moved(entryOf(location.state, visit));
    });
    // Once per visit: `first` is the opening card and does not change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, visit]);

  return {
    /** Moving on: a new entry. */
    push: (entry: CardEntry) => {
      write('push', entry);
    },
    /** The page's own Back button does what the browser's does. */
    back: history
      ? () => {
          history.back();
        }
      : null,
  };
}
