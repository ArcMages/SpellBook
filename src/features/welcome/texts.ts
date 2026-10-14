// Every word the welcome, the tour, "What is new" and the Help pane show.
// Kept in one place so that the tests can check them against the commands
// the plugin really has.

/** The kinds of pane this feature registers. */
export const WELCOME_VIEW_TYPE = 'spellbook-welcome';
export const HELP_VIEW_TYPE = 'spellbook-help';

export const WELCOME_VIEW_NAME = 'Welcome to Spellbook';
export const HELP_VIEW_NAME = 'Spellbook help';
export const WELCOME_ICON = 'sparkles';
export const HELP_ICON = 'help-circle';

/** The commands this feature adds. Obsidian puts the plugin's name in front of their names. */
export const WELCOME_COMMANDS = {
  openWelcome: { id: 'open-welcome', name: 'Open welcome page' },
  help: { id: 'help', name: 'Help' },
  tour: { id: 'show-me-around', name: 'Show me around' },
  whatsNew: { id: 'show-whats-new', name: 'Show what is new' },
} as const;

/** The commands of the plugin that the welcome page's choices run. */
export const SAMPLE_COMMAND = 'create-sample-project';
export const CREATE_COMMAND = 'create-project';
export const OPEN_BINDER_COMMAND = 'open-binder';
export const OPEN_INSPECTOR_COMMAND = 'open-inspector';

/** Where the guide and the tutorial can be read online. Shown as text to copy; never opened by the plugin. */
export const GUIDE_ADDRESS = 'https://github.com/ArcMages/SpellBook/blob/main/docs/guide.md';
export const TUTORIAL_ADDRESS = 'https://github.com/ArcMages/SpellBook/blob/main/docs/tutorial.md';

// ------------------------------------------------------------------ welcome

export const WELCOME_TITLE = 'Welcome to Spellbook';
export const WELCOME_TEXT =
  'Spellbook turns a folder of your vault into a novel-writing desk: a binder of chapters and scenes, index cards on a corkboard, ' +
  'word targets, a calendar, a story timeline and notes on your characters and places. Your book stays a folder of plain notes that you own. ' +
  'It works on a computer, a tablet and a phone, in Hebrew and in English.';

export interface Choice {
  readonly id: 'sample' | 'create' | 'tutorial';
  readonly title: string;
  readonly text: string;
  readonly icon: string;
}

export const CHOICES: readonly Choice[] = [
  { id: 'sample', title: 'Try the sample novel', text: 'A made-up novel of about fifty scenes to try every screen on. Change anything; it is there to play with.', icon: 'book-open' },
  { id: 'create', title: 'Start my own project', text: 'Give your book a name and a place in the vault. Spellbook makes its folder and a first scene.', icon: 'feather' },
  { id: 'tutorial', title: 'Read the tutorial', text: 'The steps from an empty vault to a Word file for a reader, in short, with every command.', icon: 'graduation-cap' },
];

export const TOUR_BUTTON = 'Show me around';
export const HELP_BUTTON = 'Help';
export const PLACES_TITLE = 'Where things are';
export const PLACES_TEXT = 'Open the command palette (Ctrl+P or Cmd+P on a computer, swipe down on a phone) and type the command. Spellbook\'s commands start with "Spellbook:".';
export const WELCOME_AGAIN_TEXT = 'You can open this page again with the command "Spellbook: Open welcome page", or from Spellbook\'s settings.';

/** One of the main screens, and the command that opens it. */
export interface Place {
  readonly name: string;
  readonly text: string;
  /** The id of the command, as the plugin registers it. */
  readonly command: string;
  /** The command's name, as the command palette shows it after "Spellbook: ". */
  readonly commandName: string;
}

export const PLACES: readonly Place[] = [
  { name: 'Binder', text: 'Your book as a tree of folders and scenes, in the left sidebar.', command: 'open-binder', commandName: 'Open binder' },
  { name: 'Inspector', text: "The open scene's synopsis, status, label and target, in the right sidebar.", command: 'open-inspector', commandName: 'Open inspector' },
  { name: 'Corkboard', text: 'Your scenes as index cards to drag into order.', command: 'open-corkboard', commandName: 'Open corkboard' },
  { name: 'Outliner', text: 'Your scenes as a table.', command: 'open-outliner', commandName: 'Open outliner' },
  { name: 'Novel view', text: 'The manuscript as one page to read through.', command: 'open-scrivenings', commandName: 'Open novel view' },
  { name: 'Bottom bar and targets', text: 'Words of the scene, the session, the project and today. On a phone, at the top of the inspector.', command: 'set-writing-targets', commandName: 'Set writing targets' },
  { name: 'Planner', text: 'A calendar of the words written each day, with to-dos and marked days.', command: 'open-planner', commandName: 'Open planner' },
  { name: 'Timeline', text: 'Story events in coloured lanes on one time axis.', command: 'open-timeline', commandName: 'Open timeline' },
  { name: 'World', text: 'Characters, places, factions, items, lore, creatures and cultures.', command: 'open-world', commandName: 'Open world' },
  { name: 'Writing report', text: 'Words, pages, reading time and the most used words.', command: 'open-writing-report', commandName: 'Open writing report' },
  { name: 'Export', text: 'The manuscript as a Word file, a web page, Markdown or a page to print.', command: 'export-manuscript', commandName: 'Export manuscript' },
  { name: 'Help', text: 'Every command, and the tutorial in short.', command: 'help', commandName: 'Help' },
];

// --------------------------------------------------------------------- help

export const HELP_TITLE = 'Spellbook help';
export const STEPS_TITLE = 'The tutorial in short';
export const STEPS_TEXT = 'The tutorial walks through a first novel in these steps. The full text is online, at the address at the end of this page.';
export const COMMANDS_TITLE = 'Every command';
export const COMMANDS_TEXT_INTRO = 'Run them from the command palette, where each starts with "Spellbook:". You can give any of them a keyboard shortcut in Obsidian\'s Hotkeys settings.';
export const NO_COMMANDS_TEXT = 'Spellbook is still starting. Close this pane and open it again in a moment.';
export const ADDRESS_TITLE = 'The full guide';
export const ADDRESS_TEXT = 'The user guide and the tutorial can be read online. Spellbook never opens them by itself: copy an address into your browser.';
export const GUIDE_LABEL = 'User guide';
export const TUTORIAL_LABEL = 'Tutorial';
export const COPY_BUTTON = 'Copy';
export const COPIED_TEXT = 'Address copied.';
export const NOT_COPIED_TEXT = 'The address could not be copied. Select it and copy it by hand.';
export const WELCOME_PAGE_BUTTON = 'Open the welcome page';

/** One line for each step of the tutorial, by its title. A step without one is listed by its title alone. */
export const STEP_HINTS: Readonly<Record<string, string>> = {
  'Install Spellbook and switch it on': 'Copy three files into the vault and switch the plugin on. If you can read this, it is done.',
  'Look around the sample project': 'Run "Create sample project" and open each screen. Change anything you like.',
  'Create your own project': 'Run "Create project", give the book a name and choose where it goes.',
  'Build the book in the binder': 'Folders are chapters, notes are scenes. Drag rows, or use "Move up" and "Move down" in their menus.',
  'Write a scene and fill in its inspector': 'Write, then give the scene a synopsis, a status, a label and a target in the inspector.',
  'Plan on the corkboard': 'Each scene is an index card. Drag the cards to change the order of the book.',
  'Set targets and watch the bottom bar': 'Run "Set writing targets". The bottom bar counts as you type.',
  'Plan your writing days': 'The planner shows the words of each day, to-dos that are due and the days you mark.',
  'Put story events on the timeline': 'Add events with dates and put them in coloured lanes.',
  'Build the world': 'Characters, places and more: each is a note with a sheet, linked to its scenes.',
  'Read the book through': 'The novel view shows the manuscript as one page.',
  'Take a snapshot before a big revision': 'Save a scene as it is now. Compare and restore it later.',
  'Check the prose': 'Mark filler words, the passive voice, repeated words and the rhythm of sentences.',
  'Read the writing report': 'Words, pages, reading time and the most used words.',
  'Export a Word file for a reader': 'Run "Export manuscript" and choose Word.',
};

// --------------------------------------------------------------- what is new

export const whatsNewTitle = (version: string): string => `What is new in ${version}`;
export const WHATS_NEW_SEVERAL_TITLE = 'What is new in Spellbook';
export const WHATS_NEW_FOOT = 'This note shows once after each update. You can turn it off in Spellbook\'s settings.';
export const NOTHING_NEW_TEXT = 'There are no notes for this version.';
export const CLOSE_BUTTON = 'Close';

// ---------------------------------------------------------------------- tour

/** One stop of the tour. */
export interface TourStop {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  /**
   * Where the thing is: CSS selectors of Obsidian's public page structure and
   * the plugin's own elements, tried in order; the first that is on screen is
   * pointed at. Empty: a bubble in the middle of the window. A stop whose
   * thing is not on screen is passed over.
   */
  readonly selectors: readonly string[];
  /** Only on a phone (true), or never on a phone (false), or anywhere (undefined). */
  readonly phone?: boolean;
  /**
   * The thing lives in a sidebar pane. On a phone the sidebars are drawers,
   * closed most of the time: the tour slides out the one that holds the pane
   * before this stop, and when the pane is not open anywhere it shows the
   * stop as a card in the middle, saying where to find it.
   */
  readonly sidebar?: TourSidebar;
  /** What the stop says on a phone, when it differs: where to find the thing there. */
  readonly phoneText?: string;
}

/** Where a sidebar pane of the tour is: its kind of pane, and the side it usually opens on. */
export interface TourSidebar {
  readonly view: string;
  readonly side: 'left' | 'right';
}

export const TOUR_STOPS: readonly TourStop[] = [
  {
    id: 'binder',
    title: 'The binder',
    text: 'Your book as a tree: folders for chapters, notes for scenes, each with its word count. Tap a scene to open it. The "More options" button of a row does the rest.',
    selectors: ['.workspace-leaf-content[data-type="spellbook-binder"]'],
    sidebar: { view: 'spellbook-binder', side: 'left' },
    phoneText:
      'Your book as a tree: folders for chapters, notes for scenes, each with its word count. Tap a scene to open it. On a phone it lives in the left sidebar: swipe in from the left edge of the screen to open it.',
  },
  {
    id: 'inspector',
    title: 'The inspector',
    text: "The open scene's synopsis, status, label and target. Change them here.",
    selectors: ['.workspace-leaf-content[data-type="spellbook-inspector"]'],
    sidebar: { view: 'spellbook-inspector', side: 'right' },
    phoneText:
      "The open scene's synopsis, status, label and target. On a phone it lives in the right sidebar: swipe in from the right edge of the screen to open it.",
  },
  {
    id: 'bottom-bar',
    title: 'The bottom bar',
    text: 'The words of this scene, this session, the project and today. Click a figure to set your targets.',
    selectors: ['.spellbook-status'],
    phone: false,
  },
  {
    id: 'inspector-line',
    title: 'Your word figures',
    text: 'On a phone the word figures stand at the top of the inspector, in the right sidebar: this scene, this session, the project and today.',
    selectors: ['.workspace-leaf-content[data-type="spellbook-inspector"] .spellbook-inspector-slot'],
    phone: true,
    sidebar: { view: 'spellbook-inspector', side: 'right' },
  },
  {
    id: 'ribbon',
    title: 'The ribbon buttons',
    text: "These buttons open Spellbook's screens: binder, corkboard, planner, timeline, outliner, writing report, novel view and world. Point at one to read its name.",
    selectors: ['.side-dock-ribbon-action[aria-label^="Open Spellbook"]'],
  },
  {
    id: 'commands',
    title: 'Commands',
    text: 'Everything Spellbook does is also a command. Open the command palette (Ctrl+P or Cmd+P, or swipe down on a phone) and type "Spellbook". "Spellbook: Help" lists them all.',
    selectors: [],
  },
];

export const TOUR_LABEL = 'Spellbook tour';
export const BACK_BUTTON = 'Back';
export const NEXT_BUTTON = 'Next';
export const DONE_BUTTON = 'Done';
export const stepCount = (step: number, of: number): string => `${step} of ${of}`;

// ------------------------------------------------------------------ settings

export const SETTINGS_TITLE = 'Welcome and help';
export const SHOW_WELCOME_NAME = 'Show the welcome page again';
export const SHOW_WELCOME_DESC = 'Open the page Spellbook showed the first time it ran on this device.';
export const SHOW_WELCOME_BUTTON = 'Show';
export const WHATS_NEW_NAME = 'Show what is new after updates';
export const WHATS_NEW_DESC = 'After Spellbook is updated, show a short note of what changed, once. Kept on this device.';
export const COULD_NOT_OPEN_TEXT = 'The page could not be opened.';
