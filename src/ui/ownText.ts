// The writer's own text in places that only take a title, such as the items
// of a menu.
//
// Every element that shows the writer's text lets that text choose its own
// direction (dir="auto"), so that Hebrew reads right to left in an English
// app. A menu item given plain text has no element of its own to mark; given
// a piece of page instead, it has.

/**
 * A title made of the writer's own text, for a menu item: the text in an
 * element that takes the direction of the text itself.
 */
export function ownTextTitle(text: string): DocumentFragment {
  const fragment = createFragment();
  fragment.createSpan({ text, attr: { dir: 'auto' } });
  return fragment;
}
