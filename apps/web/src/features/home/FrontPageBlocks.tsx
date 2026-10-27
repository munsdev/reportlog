/**
 * The front page as a visitor sees it, drawn from its blocks: the headline,
 * the Follow along band (D11) directly under it, then the zones.
 *
 * THE EMERGENCY NOTICE IS NOT A BLOCK. Its words are their own settings (the
 * help_now and call to action slots, decisions 62 and 78), so it sits at the
 * top of the first zone, where the mock-up puts it, whatever the owner does
 * with the blocks.
 */
import type { Block, HomeButton } from '@reportlog/contracts';
import type { ReactNode } from 'react';
import { FollowBand } from '../follow/FollowBand.tsx';
import { HelpNow } from '../form/HelpNow.tsx';
import { CardsView, CtaView, StepsView, TextView, Zone, headingId } from './BlockViews.tsx';
import { HeroBlock } from './HeroBlock.tsx';
import { LiveView } from './LiveParts.tsx';
import { useRefreshLook } from './useRefreshLook.ts';
import type { Placed } from './plan.ts';

/** What a block draws as the inside of a zone. Not the headline. */
export function BlockInside({ block, num }: { block: Block; num: string | null }): ReactNode {
  switch (block.type) {
    case 'text':
      return <TextView block={block} num={num} />;
    case 'steps':
      return <StepsView block={block} num={num} />;
    case 'cards':
      return <CardsView block={block} num={num} />;
    case 'cta':
      return <CtaView block={block} />;
    case 'live':
      return <LiveView block={block} num={num} />;
    default:
      return null;
  }
}

export interface Notice {
  text: string;
  heading: string;
  buttonLabel: string;
  buttonUrl: string;
}

export function FrontPageBlocks({
  placed,
  buttons,
  notice,
}: {
  placed: readonly Placed[];
  buttons: readonly HomeButton[];
  notice: Notice | null;
}) {
  useRefreshLook(
    placed.map((p) => `${p.block.id}${p.block.variant ?? ''}${String(p.shown)}`).join(),
  );
  const hero = placed.find((p) => p.block.type === 'hero' && p.shown);
  const zones = placed.filter((p) => p.block.type !== 'hero' && p.shown);
  const noticeEl = notice ? (
    <HelpNow
      text={notice.text}
      heading={notice.heading}
      buttonLabel={notice.buttonLabel}
      buttonUrl={notice.buttonUrl}
    />
  ) : null;
  return (
    <div data-bleed>
      {hero ? <HeroBlock block={hero.block} buttons={buttons} /> : null}
      <FollowBand placement="front" />
      {zones.map((p, i) => (
        <Zone
          key={p.block.id}
          letter={p.zone}
          tint={p.tint}
          labelledBy={p.num ? headingId(p.block) : undefined}
        >
          {i === 0 ? noticeEl : null}
          <BlockInside block={p.block} num={p.num} />
        </Zone>
      ))}
      {/* No block to hold the notice: it still shows. */}
      {!zones.length && noticeEl ? (
        <Zone letter="b" tint>
          {noticeEl}
        </Zone>
      ) : null}
    </div>
  );
}
