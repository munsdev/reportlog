/**
 * What a fixed page is made of until somebody saves it: the blocks that
 * reproduce the page as the mock-up draws it, derived from the page wording
 * and the front page sections an administrator arranged. So the first save
 * starts from what is on screen, and a site that never edits a page sees the
 * page as it was arranged in Site settings.
 *
 * Generic ReportLog wording only: anything particular to a deployment comes
 * from that deployment's own copy rows, or from its own saved blocks.
 */
import { resolveHomeSections } from '@reportlog/contracts';
import type { Block, HomeSectionId, PageId } from '@reportlog/contracts';
import type { Database } from '../db/database.ts';
import { publicSite } from '../site/site.ts';

const block = (
  id: string,
  type: Block['type'],
  variant: string,
  fields: Block['fields'],
  shown = true,
): Block => ({ id, type, variant, fields, shown });

const item = (title: string, line: string, link = '', tag = '', label = '') => ({
  title,
  line,
  link,
  tag,
  label,
});

export async function defaultBlocks(db: Database, page: PageId): Promise<Block[]> {
  switch (page) {
    case 'home':
      return homeBlocks(db);
    // About and Get involved are built later; until then they have no blocks.
    case 'about':
    case 'get-involved':
      return [];
  }
}

/** The "More you can do" cards: where the software's own pages lead on. */
const MORE_CARDS = [
  item('Read the reports', 'Every report a moderator has approved.', '/board'),
  item('For journalists', 'Alerts and desk access.', '/journalists'),
  item('How to use this site', 'What filing looks like, step by step.', '/how'),
];

/**
 * The front page: the headline, How it works, then the quieter sections in
 * the order (and with the hiding) an administrator gave them in Site
 * settings. The emergency notice is not a block: it may not be removed
 * (decision 62), so it keeps its own wording (help_now and the cta slots).
 */
async function homeBlocks(db: Database): Promise<Block[]> {
  const site = await publicSite(db);
  const { copy } = site;
  const section = (id: HomeSectionId, shown: boolean): Block => {
    switch (id) {
      case 'intro':
        return block(
          'intro',
          'text',
          'plain',
          { heading: 'What this archive is for', body: copy.home_intro },
          shown,
        );
      case 'check':
        return block('check', 'live', 'live', { module: 'check', heading: '', line: '' }, shown);
      case 'map':
        return block('map', 'live', 'live', { module: 'map', heading: '', line: '' }, shown);
      case 'figures':
        return block(
          'figures',
          'live',
          'live',
          { module: 'figures', heading: '', line: '' },
          shown,
        );
      case 'links':
        return block(
          'links',
          'cards',
          'links',
          { heading: 'More you can do', items: MORE_CARDS },
          shown,
        );
      case 'social':
        return block('social', 'live', 'live', { module: 'social', heading: '', line: '' }, shown);
    }
  };
  return [
    block('hero', 'hero', 'poster', {
      eyebrow: '',
      headline: copy.home_headline,
      headline2: '',
      slogan: copy.home_slogan,
      line: copy.home_lede,
      who: '',
    }),
    block('how', 'steps', 'steps', {
      heading: 'How it works',
      items: [
        item(
          'You answer a few questions',
          'Pick from short lists of answers, on a phone or a computer.',
        ),
        item(
          'A person reads it',
          'A moderator reads every report before anything is public.',
          '',
          'Read by a person',
        ),
        item(
          'It stays on the record',
          'Once filed, a report is not quietly changed or deleted.',
          '',
          'On the record',
        ),
      ],
    }),
    ...resolveHomeSections(site.home_sections).map((s) => section(s.id, s.shown)),
  ];
}
