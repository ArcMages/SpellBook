// The timeline's filter by tags and by kind, and its saved views: pure logic.

import { describe, expect, it } from 'vitest';
import {
  EVENTS_KIND,
  MAX_VIEWS,
  NO_TAG_FILTER,
  SCENES_KIND,
  STORY_VIEW,
  WORLD_HISTORY_VIEW,
  builtInViewState,
  countTags,
  currentViewName,
  deleteView,
  describeTagFilter,
  isBuiltInView,
  isTagFilterActive,
  passesTagFilter,
  readSavedViews,
  readTagFilter,
  sameTagFilter,
  sameViewState,
  saveView,
  searchTags,
  tagKey,
  typeKind,
} from '../../src/core/timeline';
import type { TagFilter, ViewState } from '../../src/core/timeline';

const CHARACTERS = typeKind('character');
const filter = (tags: string[], match: 'any' | 'all' = 'any', kinds: string[] = []): TagFilter => ({ tags, match, kinds });

describe('matching tags', () => {
  it('lets anything through while nothing is chosen', () => {
    expect(isTagFilterActive(NO_TAG_FILTER)).toBe(false);
    expect(passesTagFilter(NO_TAG_FILTER, [], EVENTS_KIND)).toBe(true);
    expect(passesTagFilter(NO_TAG_FILTER, ['war'], SCENES_KIND)).toBe(true);
  });

  it('needs one of the tags with "any", and every one with "all"', () => {
    const any = filter(['royalty', 'war']);
    const all = filter(['royalty', 'war'], 'all');
    expect(passesTagFilter(any, ['royalty'], EVENTS_KIND)).toBe(true);
    expect(passesTagFilter(any, ['peace'], EVENTS_KIND)).toBe(false);
    expect(passesTagFilter(all, ['royalty'], EVENTS_KIND)).toBe(false);
    expect(passesTagFilter(all, ['war', 'royalty', 'peace'], EVENTS_KIND)).toBe(true);
    expect(passesTagFilter(any, [], EVENTS_KIND)).toBe(false);
  });

  it('matches as Obsidian does: no "#", any capitals, and the tags nested under one', () => {
    const royal = filter(['#Royalty']);
    expect(passesTagFilter(royal, ['royalty'], EVENTS_KIND)).toBe(true);
    expect(passesTagFilter(royal, ['#ROYALTY/king'], EVENTS_KIND)).toBe(true);
    expect(passesTagFilter(royal, ['royaltyish'], EVENTS_KIND)).toBe(false);
    expect(passesTagFilter(filter(['royalty/king']), ['royalty'], EVENTS_KIND)).toBe(false);
    expect(tagKey(' #War ')).toBe('war');
  });

  it('matches Hebrew tags, nested ones too, with "any" and "all"', () => {
    expect(passesTagFilter(filter(['מלוכה']), ['מלוכה'], EVENTS_KIND)).toBe(true);
    expect(passesTagFilter(filter(['מלוכה']), ['מלוכה/מלך'], CHARACTERS)).toBe(true);
    expect(passesTagFilter(filter(['מלוכה', 'מלחמה'], 'all'), ['מלחמה', 'מלוכה'], EVENTS_KIND)).toBe(true);
    expect(passesTagFilter(filter(['מלוכה', 'מלחמה'], 'all'), ['מלחמה'], EVENTS_KIND)).toBe(false);
    // The same word in another normal form is the same tag.
    expect(tagKey('éte')).toBe(tagKey('éte'));
  });

  it('shows only the kinds chosen, with or without tags', () => {
    const only = filter([], 'any', [CHARACTERS, EVENTS_KIND]);
    expect(isTagFilterActive(only)).toBe(true);
    expect(passesTagFilter(only, [], CHARACTERS)).toBe(true);
    expect(passesTagFilter(only, [], EVENTS_KIND)).toBe(true);
    expect(passesTagFilter(only, ['royalty'], SCENES_KIND)).toBe(false);
    expect(passesTagFilter(only, [], typeKind('place'))).toBe(false);
    const royalOnly = filter(['royalty'], 'any', [CHARACTERS, EVENTS_KIND]);
    expect(passesTagFilter(royalOnly, ['royalty'], CHARACTERS)).toBe(true);
    expect(passesTagFilter(royalOnly, ['war'], CHARACTERS)).toBe(false);
  });
});

describe('the tags of a project', () => {
  it('are counted once per thing, the most used first, Hebrew among them', () => {
    const counts = countTags([['royalty', 'war'], ['Royalty', '#royalty'], ['מלוכה'], ['war', 'מלוכה'], ['royalty'], []]);
    expect(counts).toEqual([
      { tag: 'royalty', count: 3 },
      { tag: 'war', count: 2 },
      { tag: 'מלוכה', count: 2 },
    ]);
    expect(searchTags(counts, 'ROY').map((entry) => entry.tag)).toEqual(['royalty']);
    expect(searchTags(counts, 'מלו').map((entry) => entry.tag)).toEqual(['מלוכה']);
    expect(searchTags(counts, '')).toHaveLength(3);
  });

  it('describe the filter in words', () => {
    const names = (kind: string): string | null => (kind === CHARACTERS ? 'Characters' : kind === EVENTS_KIND ? 'Events' : null);
    expect(describeTagFilter(filter(['royalty', 'war']), names)).toBe('#royalty or #war');
    expect(describeTagFilter(filter(['royalty', 'war'], 'all', [CHARACTERS, EVENTS_KIND, 'type:gone']), names)).toBe(
      '#royalty and #war - only Characters, Events',
    );
  });
});

describe('a stored filter', () => {
  it('is checked: odd values are left out, tags lose their "#" and come once', () => {
    expect(readTagFilter(null)).toBe(NO_TAG_FILTER);
    expect(readTagFilter('war')).toBe(NO_TAG_FILTER);
    expect(readTagFilter({ tags: ['#war', 'War', 7, '', 'מלוכה'], match: 'all', kinds: [EVENTS_KIND, 3] })).toEqual({
      tags: ['war', 'מלוכה'],
      match: 'all',
      kinds: [EVENTS_KIND],
    });
    expect(readTagFilter({ tags: ['war'], match: 'odd' }).match).toBe('any');
  });

  it('is the same as another whatever the order and the capitals', () => {
    expect(sameTagFilter(filter(['War', 'royalty']), filter(['royalty', 'war']))).toBe(true);
    expect(sameTagFilter(filter(['war'], 'all'), filter(['war'], 'any'))).toBe(false);
    // With no tag chosen, the way of matching makes no difference.
    expect(sameTagFilter(filter([], 'all'), NO_TAG_FILTER)).toBe(true);
  });
});

describe('views', () => {
  const now: ViewState = { hiddenLanes: ['Main plot'], world: { on: false, hidden: ['item'] }, filter: filter(['war']) };

  it('"World history" turns the world on and hides the manuscript; "Story" brings it back', () => {
    const history = builtInViewState(WORLD_HISTORY_VIEW, now);
    expect(history).toEqual({ hiddenLanes: ['Main plot', 'Manuscript'], world: { on: true, hidden: ['item'] }, filter: NO_TAG_FILTER });
    const story = builtInViewState(STORY_VIEW, history as ViewState);
    // The lane the writer hid on purpose stays hidden; the manuscript shows again.
    expect(story).toEqual({ hiddenLanes: ['Main plot'], world: { on: false, hidden: ['item'] }, filter: NO_TAG_FILTER });
    expect(builtInViewState('Mine', now)).toBeNull();
    expect(isBuiltInView(' story ')).toBe(true);
  });

  it('knows which view is shown', () => {
    expect(currentViewName(now, [])).toBeNull();
    const story = builtInViewState(STORY_VIEW, now) as ViewState;
    expect(currentViewName(story, [])).toBe(STORY_VIEW);
    expect(currentViewName(builtInViewState(WORLD_HISTORY_VIEW, now) as ViewState, [])).toBe(WORLD_HISTORY_VIEW);
    // A saved view that is exactly what is shown goes first.
    const saved = saveView([], 'מלכים', now);
    expect(saved.ok).toBe(true);
    const views = saved.ok ? saved.views : [];
    expect(currentViewName(now, views)).toBe('מלכים');
    // Lanes are compared as lanes are: whatever their capitals.
    expect(sameViewState(now, { ...now, hiddenLanes: ['main plot'] })).toBe(true);
    // While the world is off, which of its types are hidden makes no difference.
    expect(sameViewState(now, { ...now, world: { on: false, hidden: [] } })).toBe(true);
  });

  it('are saved under a name, replaced by the same name, refused under a built-in one, and deleted', () => {
    const first = saveView([], '  Royals  ', now);
    expect(first).toMatchObject({ ok: true, replaced: false });
    const views = first.ok ? first.views : [];
    expect(views.map((view) => view.name)).toEqual(['Royals']);
    const again = saveView(views, 'royals', { ...now, hiddenLanes: [] });
    expect(again).toMatchObject({ ok: true, replaced: true });
    expect(again.ok ? again.views.map((view) => [view.name, view.hiddenLanes]) : []).toEqual([['royals', []]]);
    expect(saveView(views, 'World history', now)).toEqual({ ok: false, message: '"World history" is a built-in view. Choose another name.' });
    expect(saveView(views, '   ', now)).toEqual({ ok: false, message: 'A view needs a name.' });
    expect(deleteView(views, 'ROYALS')).toEqual([]);
  });

  it('are no more than a limit, and come back from storage checked', () => {
    let views = readSavedViews([]);
    for (let index = 0; index < MAX_VIEWS; index++) {
      const result = saveView(views, `View ${index}`, now);
      if (result.ok) views = result.views;
    }
    expect(saveView(views, 'One more', now).ok).toBe(false);
    expect(
      readSavedViews([
        { name: 'Royals', hiddenLanes: ['Manuscript', 4], world: { on: true, hidden: 'x' }, filter: { tags: ['royalty'] } },
        { name: 'royals' },
        { name: 'Story' },
        { name: '' },
        'odd',
      ]),
    ).toEqual([{ name: 'Royals', hiddenLanes: ['Manuscript'], world: { on: true, hidden: [] }, filter: { tags: ['royalty'], match: 'any', kinds: [] } }]);
  });
});
