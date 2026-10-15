# Making Spellbook your own

This page shows how to change how Spellbook looks and behaves: its colours, its keys, its bars and the lists a project works with. Each section gives the steps. For what each screen does, see the [user guide](guide.md); for a first walk through the whole tool, see the [tutorial](tutorial.md).

Two kinds of choice are made here, and it helps to know which is which:

- **Choices kept on the device.** How Spellbook looks and behaves for you: the layout, the colour scheme, the writing modes, the prose checks, the bottom bar. A phone and a computer can each have their own. Most of these are in Obsidian's **Settings**, under **Spellbook**.
- **Choices kept in the project.** What belongs to the book: statuses and labels, targets, timeline lanes, the story calendar, entity types. They are saved in the project's own notes, so they sync with the vault and are the same on every device.

The table at the end, [Where each setting lives](#where-each-setting-lives), lists them all.

## Contents

- [Colour schemes](#colour-schemes)
- [Obsidian themes and light or dark mode](#obsidian-themes-and-light-or-dark-mode)
- [Touch or desktop layout](#touch-or-desktop-layout)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Phone and tablet toolbar](#phone-and-tablet-toolbar)
- [The bottom bar](#the-bottom-bar)
- [Writing modes](#writing-modes)
- [Prose checks](#prose-checks)
- [Statuses and labels](#statuses-and-labels)
- [The story graph](#the-story-graph)
- [Entity types of your own](#entity-types-of-your-own)
- [An invented story calendar](#an-invented-story-calendar)
- [Writing targets](#writing-targets)
- [Writing report options](#writing-report-options)
- [Snapshot options](#snapshot-options)
- [Where each setting lives](#where-each-setting-lives)

## Colour schemes

![A scene and the binder in the Sepia colour scheme](images/colour-scheme-sepia.png)

*The Sepia scheme: tan pages and brown ink, in the editor and in Spellbook's own screens.*

A colour scheme is a set of colours to write in. There are six, and "None".

| Scheme | Light or dark | What it is like |
| --- | --- | --- |
| None | As your theme | Gives everything back to your Obsidian theme. |
| Paper | Light | Warm cream paper with soft black ink. |
| Sepia | Light | An old book: tan pages and brown ink. |
| Mist | Light | Cool, calm grey with slate ink. |
| Dusk | Dark | A soft blue-grey evening, easy on the eyes. |
| Ink | Dark | Near-black with bright text: the strongest contrast. |
| Ember | Dark | Amber on deep brown, with very little blue, for late nights. |

**To choose a scheme**

1. Run the command **Choose colour scheme**.
2. A list opens with a small picture of each scheme. The one in use is marked "In use".
3. Choose one. The whole window changes at once.

**To step through them**

1. Run the command **Next colour scheme**.
2. The next scheme of the list is put on, and a short notice names it, for example "Colour scheme: Sepia".
3. Run it again to go on, round and round. "None" is one of the stops.

This command is a good one to give a keyboard shortcut or a button in the bottom bar; see below.

**From the settings**

1. Open Obsidian's **Settings** and choose **Spellbook**.
2. Under **Colour scheme**, each scheme has a row with its picture and a **Use** button. The button of the scheme in use says **In use**.

**How a scheme sits on top of your theme.** A scheme changes colours only. Your fonts, text size, line width and everything else your Obsidian theme sets stay as they are. A scheme recolours the editor, the sidebars and every Spellbook screen together, so the binder and the corkboard always match the page you write on. Choose **None** and Spellbook leaves no trace: every colour comes from your theme again.

**The choice is per device.** A scheme is remembered on the device you chose it on. Your computer can wear Paper while your phone wears Ember.

**Limits.** Pop-out windows are not recoloured.

## Obsidian themes and light or dark mode

Spellbook is drawn with your theme's own colours. With no scheme on, it looks like part of whatever theme you use.

**What follows your theme (with the scheme set to None)**

- Every Spellbook screen: the binder, corkboard, outliner, planner, timeline, World, novel view, report and snapshots take their backgrounds, text colours, borders and accent from the theme.
- Light and dark mode: switch Obsidian between them and Spellbook follows.
- The eight colours used for statuses, labels, timeline lanes, day marks and entity types (red, orange, yellow, green, cyan, blue, purple, pink) are the theme's own versions of those colours.
- The colours of the prose-check marks are taken from those same eight.
- Fonts and text size.

**What a scheme overrides**

- The page, panel and border colours, the text colours, the accent colour, and the eight named colours, each adjusted so that it can be read on the scheme's page.
- Obsidian's light or dark setting. A scheme keeps its own colours whichever mode Obsidian is in. Sepia stays light when Obsidian is dark, and Ink stays dark when Obsidian is light. Pick a light scheme or a dark one as you like.

**What a scheme never touches.** Fonts, sizes, spacing, and anything your theme does that is not a colour.

**If a theme and a scheme do not get on.** A scheme sets the colour variables that Obsidian and most themes read. A theme that paints something with a fixed colour of its own will keep that colour. If a part of the window looks wrong under a scheme, choose **None** and it goes back to the theme at once.

### For people who write CSS snippets

You do not need any of this to use Spellbook. It is here for writers who already keep CSS snippets in Obsidian (Settings, then Appearance, then CSS snippets).

**Names.** Every class Spellbook adds starts with `spellbook-`, and every CSS variable it defines starts with `--spellbook-`. Nothing else in the page is named by Spellbook, so a rule that starts with a `spellbook-` class can only affect Spellbook.

**Classes on the page's body while a scheme is on**

| Class | When it is there |
| --- | --- |
| `spellbook-scheme` | Any scheme is on. |
| `spellbook-scheme-light` | A light scheme is on (Paper, Sepia, Mist). |
| `spellbook-scheme-dark` | A dark scheme is on (Dusk, Ink, Ember). |
| `spellbook-scheme-paper`, `-sepia`, `-mist`, `-dusk`, `-ink`, `-ember` | That one scheme is on. |

With **None**, none of these classes is there.

**The scheme's colours by name.** While a scheme is on, these variables hold its eight colours, for a snippet that wants to follow the scheme:

| Variable | What it holds |
| --- | --- |
| `--spellbook-scheme-page` | The page that is written on. |
| `--spellbook-scheme-panel` | The side panels and the bars around the page. |
| `--spellbook-scheme-raised` | What lies on a panel: a card, a button, a field. |
| `--spellbook-scheme-border` | The lines between things. |
| `--spellbook-scheme-ink` | The text. |
| `--spellbook-scheme-muted` | Quieter text: a synopsis, a word count. |
| `--spellbook-scheme-faint` | The quietest text: a hint, a placeholder. |
| `--spellbook-scheme-accent` | Links, what is selected, the button that matters. |

They are not set when the scheme is None, so give a fallback: `var(--spellbook-scheme-ink, var(--text-normal))`.

A scheme works by setting Obsidian's own colour variables (`--background-primary`, `--text-normal`, `--color-red` and the rest) directly on the body. That outranks a snippet's ordinary rule for the same variable on the body. To change one of them under a scheme, set it on a narrower element, or mark your value `!important`.

**Prose-check colours.** Each kind of mark has a variable, set on the class `spellbook-prose`:

| Variable | Mark | Starts as |
| --- | --- | --- |
| `--spellbook-prose-noun` | Colour nouns | `var(--color-blue)` |
| `--spellbook-prose-verb` | Colour verbs | `var(--color-green)` |
| `--spellbook-prose-adjective` | Colour adjectives | `var(--color-purple)` |
| `--spellbook-prose-adverb` | Colour adverbs | `var(--color-orange)` |
| `--spellbook-prose-filler` | Filler words | `var(--color-yellow)` |
| `--spellbook-prose-passive` | Passive voice | `var(--color-red)` |
| `--spellbook-prose-repeated` | Repeated words | `var(--color-cyan)` |
| `--spellbook-prose-overused` | Overused adverbs | `var(--color-orange)` |
| `--spellbook-prose-long` | A very long sentence | `var(--color-pink)` |
| `--spellbook-prose-run` | Sentences in a row of one length | `var(--color-blue)` |
| `--spellbook-prose-line` | Thickness of the underline | `2px` |

**A few layout variables**

| Variable | Set on | What it does | Starts as |
| --- | --- | --- | --- |
| `--spellbook-scrivenings-line-width` | `.spellbook-scrivenings` | The widest a line of text gets in the novel view. | `44rem` |
| `--spellbook-card-lines` | `.spellbook-board-grid.spellbook-size-small`, `-medium`, `-large` | How many lines of a synopsis a corkboard card shows. | 3, 5 and 9 |
| `--spellbook-world-card-min` | `.spellbook-world` | The narrowest a card gets in the World screen before a column is dropped. | `220px` |
| `--spellbook-report-tile-width` | `.spellbook-report` | The narrowest a tile gets in the writing report. | `13em` |

**Examples**

```css
/* A narrower column of text in the novel view */
body .spellbook-scrivenings {
  --spellbook-scrivenings-line-width: 36rem;
}

/* Filler words in purple, and a thicker underline for every mark */
body .spellbook-prose {
  --spellbook-prose-filler: var(--color-purple);
  --spellbook-prose-line: 3px;
}

/* More of the synopsis on large corkboard cards */
body .spellbook-board-grid.spellbook-size-large {
  --spellbook-card-lines: 12;
}

/* Something of your own that only applies under the Sepia scheme */
body.spellbook-scheme-sepia .markdown-source-view {
  letter-spacing: 0.01em;
}
```

The other `--spellbook-` variables you may find in the stylesheet (the ones ending in `-touch`, `-touch-target` and `-bar-room`) keep buttons large enough for a finger and keep the last row clear of Obsidian's phone toolbar. Leave those alone.

Class names and variables may change between versions while Spellbook is before version 1.0. A snippet that stops working after an update is the place to look first.

## Touch or desktop layout

Spellbook lays its screens out for a finger on phones and tablets and for a mouse on computers. If that does not suit how you hold the device, choose another layout for it.

1. Open Obsidian's **Settings** and choose **Spellbook**.
2. Under the version, pick a **Layout**:
   - **Automatic**, as it comes: by the kind of device.
   - **Touch layout**: big buttons and rows, buttons always shown, and the word figures at the top of the inspector. Good for a touch-screen laptop, or a computer window you keep small. A tablet keeps its own size in this layout; only a window as narrow as a phone gets the phone's sizes.
   - **Desktop layout**: the full desktop screens, with compact rows and the figures in the bottom bar. Good for an iPad with a keyboard and trackpad.

Open screens change at once. The choice is kept on the device you make it on, so an iPad can use the desktop layout while your phone keeps the touch one.

**What the layout does not change.** What the device itself can or cannot do. Printing to PDF is offered on computers only. On a phone the sidebars still slide in over the page, there is still no bottom bar (the figures stay at the top of the inspector), and the screens leave room for the phone's own bar at the bottom. On a touch screen, buttons that a mouse would only show when pointed at stay shown, because a finger cannot point without tapping.

**For people who write CSS snippets.** The touch layout puts the class `spellbook-is-mobile` on each Spellbook screen; the desktop layout, when you choose it, puts `spellbook-is-desktop-layout` there.

Spellbook has not been tried on a real iPad yet, so this section is how it works by design.

## Keyboard shortcuts

Spellbook sets no keyboard shortcuts of its own, so it can never take a key you already use. You give a key to any command you like.

**To give a command a shortcut**

1. Open Obsidian's **Settings** and choose **Hotkeys**.
2. In the search box, type "Spellbook". The list shows every Spellbook command.
3. Find the command, and press the plus button on its row.
4. Press the keys you want. They appear next to the command.
5. If Obsidian shows the keys as already in use by another command, choose different keys, or remove them from the other command.

To take a shortcut away, press the small cross next to it in the same list.

Shortcuts are part of Obsidian's own settings for the vault, not Spellbook's.

**Commands worth a shortcut.** You do not need many. These are the ones you are likely to run many times a day:

| Command | Why it earns a key |
| --- | --- |
| Toggle Zen mode | In and out of distraction-free writing many times a session. |
| Toggle typewriter mode | Switched on for drafting, off for editing. |
| Toggle letter box mode | The same. |
| Toggle Hemingway mode | Switched on for a sprint. |
| Toggle prose checks | On to revise, off to draft. |
| New scene | Adds a scene next to the one you are working on, without leaving the keyboard. |
| Move scene up, Move scene down | Reorders the open scene from the keyboard. |
| Reveal active scene in binder | Shows where the open scene sits in the book. |
| Open binder | Brings the binder back when the sidebar is closed. |
| Open inspector | The same, for the scene's details. |
| Open corkboard, Open novel view | The two screens you move to most often from a scene. |
| Take snapshot | One key before every revision makes saving a version a habit. |
| Snapshots of this scene | To look back at an earlier version. |
| Set writing targets | A quick look at how far you are. |
| Next colour scheme | Day colours to night colours in one key. |
| New character, New place | When someone new walks into the scene you are writing. |

**Example keys.** These are suggestions only. None of them is set for you, and you may prefer others. They use Ctrl+Alt with a letter (Cmd+Option on a Mac), a combination that Obsidian's own default shortcuts rarely use. The Hotkeys list shows when a key is already taken by another command, so check each one as you set it.

| Command | A key you might give it |
| --- | --- |
| Toggle Zen mode | Ctrl+Alt+Z |
| Toggle typewriter mode | Ctrl+Alt+T |
| Toggle prose checks | Ctrl+Alt+P |
| New scene | Ctrl+Alt+N |
| Take snapshot | Ctrl+Alt+S |
| Open binder | Ctrl+Alt+B |
| Next colour scheme | Ctrl+Alt+C |

Avoid Cmd+Option+I on a Mac and Ctrl+Shift+I elsewhere: Obsidian keeps those for its own developer tools. On some keyboards Alt (or Option) with a letter types a special character; if a combination types a letter instead of running the command, pick another.

## Phone and tablet toolbar

On a phone or tablet, Obsidian shows a toolbar above the keyboard while you write. You can put any Spellbook command on it, so that one tap does what a shortcut does on a computer.

This is a feature of Obsidian, not of Spellbook, and the exact names of its settings may differ between versions of Obsidian.

1. On the phone or tablet, open Obsidian's **Settings**.
2. Choose **Toolbar**. This entry is only shown on a phone or tablet.
3. Find the list of options that can be added, and search it for "Spellbook".
4. Add the commands you want. Good ones to start with: **Toggle Zen mode**, **Toggle typewriter mode**, **Take snapshot**, **Open inspector** and **New scene**.
5. Drag the added commands into the order you like, with the ones you use most at the start.

Keep the list short. The toolbar scrolls sideways, and a command you have to scroll to is slower than the command palette.

The toolbar only shows while the keyboard is up. For buttons that are there when you are not typing, use the shortcut buttons described in the next section: on a phone or tablet they appear at the top of the inspector.

Spellbook has not been tried on a real iPhone or iPad yet, so this section is how it works by design.

## The bottom bar

![The inspector on a phone with word figures and shortcut buttons at the top](images/phone-inspector.png)

*On a phone the figures of the bottom bar, and its shortcut buttons, stand at the top of the inspector.*

The bottom bar shows figures about the open scene and the project. You choose which figures, in what order, and you can add buttons that run a command.

All of this is in Obsidian's **Settings**, under **Spellbook**, in the section **Writing progress**, below the heading **Bottom bar**. Every change shows in the bar at once.

**The figures you can show**

| Figure | What it shows |
| --- | --- |
| Scene words | The words of the open scene. |
| Scene target | How far the open scene is toward its own target, with a small progress bar. |
| Session words | Net words written since Obsidian was opened. |
| Words today | Net words written today, against the daily target. |
| Project words | The words of the whole manuscript, against the project target. |
| Reading time | About how long the open scene takes to read. |
| Date started | The day the open scene was started. |
| Date last edited | The day the open scene was last edited. |
| Status | The status of the open scene. |
| To-dos due | How many open to-dos are due today or are late. |
| Scene title | The name of the open scene. |

**To start from a ready-made bar**

1. Find the row **Ready-made bars**.
2. Press one of its three buttons:
   - **Minimal**: scene words and words today.
   - **Drafting**: scene words and target, session, today and reading time.
   - **Everything**: every figure there is.

Your shortcut buttons are kept when you choose a ready-made bar.

**To choose figures yourself**

1. Each figure in the bar has a numbered row. Press **Remove** on a row to take that figure out.
2. Under **Add to the bar**, press **Add figure** and choose from the figures that are not in the bar yet.
3. Press **Move up** and **Move down** on a row to change the order. The first row is the first thing in the bar.

**To add a shortcut button**

A shortcut button runs one command when you press it. It can be a Spellbook command, a command of Obsidian itself or one from another plugin.

1. Under **Add to the bar**, press **Add button**.
2. A list of commands opens. Search for the one you want, for example "Toggle Zen mode", and choose it.
3. The button gets a row of its own, named "Button:" and the command. In the **Label** field, type a short label, or leave it empty.
4. Press the icon button on the row (it says "Icon: none" to begin with) and choose an icon from the list, or **No icon**. A button can have a label, an icon or both.
5. Move it with **Move up** and **Move down** like any figure.

Good buttons to have: **Toggle Zen mode**, **Toggle typewriter mode**, **Toggle prose checks**, **Take snapshot** and **Next colour scheme**.

If a button's command is not available (its plugin may be switched off), the button stays in the bar, dimmed, and does nothing.

**To start over.** Press **Reset** on the row **Reset to default**. The bar goes back to scene words, date started, date last edited, session, project and today. This removes your shortcut buttons.

**One more switch.** Above the bar's settings, **Count pasted text** decides what counts as writing. When it is on, words you paste or drop in count as written and words you cut count as deleted. When it is off, only what you type counts.

**On a phone or tablet.** A phone has no bottom bar. The figures stand at the top of the inspector, and so do your shortcut buttons, on a phone and on a tablet. With the [touch layout](#touch-or-desktop-layout) they stand there on any device; with the desktop layout a tablet keeps them in the bottom bar, and a phone, which has none, keeps them in the inspector.

**Limits.** A long bar takes at most 60% of the window's width and scrolls sideways. The bar holds at most 40 figures and buttons. The layout is kept on each device separately, so the bar on your computer and the line on your phone can differ.

## Writing modes

![A scene in letter box mode, with a lit band of lines and the rest of the page covered](images/letter-box.png)

*Letter box mode: a band of lines stays lit, and the text above and below it is covered.*

The four modes are switched with their commands: **Toggle Zen mode**, **Toggle letter box mode**, **Toggle typewriter mode** and **Toggle Hemingway mode**. They can be on together, and they work in any note.

How they behave is set in Obsidian's **Settings**, under **Spellbook**, in the section **Writing modes**. A mode that is on follows a change at once, so you can switch a mode on first and then tune it while looking at the result.

| Setting | Choices | What it does |
| --- | --- | --- |
| Letter box: height of the band | 20% to 70% of the page's height, in steps of 10. Starts at 40%. | How much of the page stays lit. |
| Letter box: text outside the band | Hidden, Barely visible, Dimmed. Starts at Barely visible. | Whether the lines above and below the band can still be made out. |
| Typewriter: where the line rests | From "20% from the top" through "In the middle" to "20% from the bottom". Starts in the middle; on a phone, 40% from the top. | The height at which the line you are writing stays. |
| Zen: hide properties | On or off. Starts on. | Hides the properties at the top of a note while Zen is on. |
| Zen: hide the title | On or off. Starts off. | Hides the title above the text while Zen is on. |
| Zen: leave with Escape | On or off. Starts on. | The Escape key leaves Zen. Switch it off if you use Escape for something else while writing. |
| Hemingway: allow undo | Never, On phones and tablets only, Everywhere. Starts on phones and tablets only. | Whether undo and redo still work while Hemingway is on. A phone has no other way to fix a typo. |

**Some set-ups to try**

- *Drafting on a computer:* Zen and typewriter together, with the line in the middle.
- *Drafting on a phone:* typewriter with the line above the middle, so that it stays clear of the on-screen keyboard.
- *Revising line by line:* letter box with a 30% band and the text outside set to **Dimmed**, so that you can still see where you are.
- *A first-draft sprint:* Hemingway with Zen. While Hemingway is on, a lock shows in the note's header, or in the corner of the screen during Zen; press it to switch the mode off.

Which modes are on, and these settings, are kept on each device separately.

## Prose checks

![A scene with prose-check marks on filler words, repeated words and a long sentence](images/prose-checks.png)

*Prose checks: each kind of mark has its own colour, and you choose which checks are on.*

Settings are in Obsidian's **Settings**, under **Spellbook**, in the section **Prose checks**. Each check also has a command; see the [guide](guide.md#prose-checks).

**To choose which checks are on**

1. The first switch, **Prose checks**, turns all the marks on or off together.
2. Below it, each check has its own switch. Switch on only the ones you want to see.

| Check | What it marks | Languages |
| --- | --- | --- |
| Colour nouns | Names of things and people. | English |
| Colour verbs | Doing words, with "was", "had" and "could". | English |
| Colour adjectives | Describing words. | English |
| Colour adverbs | Words like "slowly", "never", "again". | English |
| Filler words | Words that often carry no weight, such as "very" and "just". | English and Hebrew |
| Passive voice | "The door was opened" rather than "she opened the door". | English |
| Repeated words | The same word used again close by. | English and Hebrew |
| Overused adverbs | Three or more "-ly" adverbs close together. | English |
| Sentence rhythm | Very long sentences, and four or more sentences in a row of nearly the same length. | English and Hebrew |

The four word colours together make a busy page. Most writers will want them one at a time, for one pass, for example verbs only to hunt for weak ones.

**To set how strict two checks are**

- **Repeated words: how close.** A word used again within this many words is marked. It starts at 40 and can be 10 to 200. Lower it if too much is marked; raise it to catch echoes further apart.
- **Sentence rhythm: a long sentence.** A sentence of this many words or more is marked as long. It starts at 35 and can be 12 to 100. If you write long sentences on purpose, raise it.

**To add your own filler words**

1. In **Your own filler words (English)**, type words or short phrases with commas between them, for example: nevertheless, at any rate.
2. In **Your own filler words (Hebrew)**, do the same for Hebrew.

They are marked along with the built-in ones. This is the place for your own habits: the word you know you overuse.

To change the colours of the marks, see the [variables for CSS snippets](#for-people-who-write-css-snippets) above.

These choices are kept on each device separately.

## Statuses and labels

A status says how far along a scene is. A label is a colour of your own choosing: a point-of-view character, a plot line, a setting, a draft pass, anything you want to see at a glance on the corkboard.

**To open the window.** Run the command **Manage statuses and labels**, or press **Statuses and labels** in the inspector, or use the corkboard's "More options" menu.

**To change the statuses**

1. A new project has To do, First draft, Revised and Final.
2. Press **Add status**, type a name, and confirm with **Add**.
3. Open a status's menu to **Rename** it, **Change colour** or **Remove** it.
4. Move statuses up and down so that they run in the order a scene passes through them.

**To make labels**

1. A new project has no labels. Press **Add label**, type a name and confirm.
2. Give it a colour. There are eight: red, orange, yellow, green, cyan, blue, purple and pink. A status or label can also have no colour.

**Good to know**

- Renaming a status or a label changes it in every scene that uses it.
- If scenes use a name that is not in the list (for example one typed by hand into a note's properties), it shows under "Used by scenes, but not in the list" with an **Add** button.
- The colours are your theme's or your scheme's versions of those eight, so they always suit the page.

Statuses and labels are saved in the project, so they are the same on every device.

## The story graph

![Obsidian's graph view of a novel, coloured by kind of note](images/graph-view.png)

*Obsidian's graph view of the sample novel, with one colour for each folder of the project.*

Spellbook lists the characters, places, lore and other entities of a scene or a timeline event as ordinary Obsidian links, in the note's `entities` property. Obsidian's own graph view and its backlinks pane read those links, so the graph shows who appears in which scene without any setup. The graph belongs to Obsidian, not to Spellbook, so the steps below use Obsidian's settings.

To see the graph of one project, coloured by kind of note:

1. Open the graph: the **Open graph view** button in Obsidian's ribbon, or the command **Graph view: Open graph view**.
2. Open the graph's settings (the cog at its top right).
3. Under **Filters**, type `path:"My Novel"` in the search field, with your project's folder name, to show that project alone. Add `-path:"My Novel/Stats"` to leave out the word logs, and `-path:"My Novel/AI helper"` if the project has the AI helper note. Switch **Orphans** off to hide notes with no links.
4. Under **Groups**, choose **New group** once for each kind of note, type its folder, and pick a colour. For example:

| Group query | Shows | Colour in the picture |
| --- | --- | --- |
| `path:"My Novel/Manuscript"` | Scenes | Grey |
| `path:"My Novel/World/Characters"` | Characters | Blue |
| `path:"My Novel/World/Places"` | Places | Green |
| `path:"My Novel/World/Factions"` | Factions | Red |
| `path:"My Novel/World/Items"` | Items | Orange |
| `path:"My Novel/World/Lore"` | Lore | Yellow |
| `path:"My Novel/World/Creatures"` | Creatures | Cyan |
| `path:"My Novel/World/Cultures"` | Cultures | Pink |
| `path:"My Novel/Timeline"` | Timeline events | Purple |

5. Under **Display**, raise **Text fade threshold** to see more names, and **Node size** to taste.

The settings are kept by Obsidian for the vault. To see what surrounds one note only, open that note and run **Graph view: Open local graph**.

One limit: when a vault holds two projects that each have an entity of the same name (two characters called "Mara"), Obsidian's graph may draw a scene's link to the other project's note. Spellbook's own screens lead to the right one.

## Entity types of your own

The World starts with seven types: Character, Place, Faction, Item, Lore, Creature and Culture. A fantasy novel may want Spell or Deity; a mystery may want Clue.

**To add a type**

1. Run **Open world** and press **Entity types**. The window is called "Entity types".
2. Press **Add a type**, type a name, for example "Spell", and press **Add**. The type appears in the list with a folder of its own and one property, summary.
3. Open the new type's menu and choose **Change properties**. List the properties a new note of this type should start with, with commas between them, for example: school, cost, danger, summary. Press **Save**.
4. Choose a colour and an icon for it on its row.

From then on the **New** button in the World screen and the command **New entity** offer your type, and the inspector's **Add** offers it when you type a new name.

**To change a type.** Each type in the window has a menu: **Rename**, **Change folder**, **Change properties**, and, for a type of your own, **Remove**. The seven built-in types can be changed in the same way, but not removed. Changing a type's folder is where new notes are made from then on; the notes already there are not moved.

**What a type is.** Each type keeps its notes in a folder of its own inside the project's World folder, and gives a new note its starting properties. The built-in ones start with these:

| Type | Folder | Starting properties |
| --- | --- | --- |
| Character | Characters | role, age, occupation, appearance, personality, voice, goal, arc, summary |
| Place | Places | kind, region, atmosphere, landmarks, summary |
| Faction | Factions | kind, leader, summary |
| Item | Items | kind, owner, summary |
| Lore | Lore | kind, period, told-by, summary |
| Creature | Creatures | kind, habitat, summary |
| Culture | Cultures | kind, region, summary |

Lore is for legends, tales, myths, history, religion and customs. Culture is for peoples and their languages.

**What every entity has, whatever its type.** Five properties have a meaning of their own and cannot be listed as a type's properties: `type`, `aliases` (other names), `entities`, `image` (the picture, chosen on the sheet with **Choose picture**) and `related` (the relations, added on the sheet under **Related**). Every other property shows on the entity's sheet as a field that you fill in place.

**A project made with an earlier version.** Lore, Creature and Culture simply appear. A Character or a Place whose properties you never changed gets the longer lists above for new notes; one you changed keeps your list.

**Changing a type never changes a note.** New properties are given to notes you make from then on; the notes you already have stay exactly as they are. Add or remove properties in any single note as you like: they are ordinary Obsidian properties.

Entity types are saved in the project. Types of your own have not been tried on screen yet.

## An invented story calendar

A story set in an invented world can have its own months, week and eras. The timeline then counts in that calendar.

1. Run the command **Edit story calendar**, or press **Calendar** on the timeline. The window is called "Story calendar".
2. Under **Start from**, choose a starting point: the real-world calendar, or a ready-made one such as "Twelve months of thirty days".
3. Give the calendar a **Name**.
4. Under **Months**, give each month its name and its number of days. **Add month** adds one; each row can be moved up, moved down or removed.
5. Under **Days of the week**, list the days with **Add day**. This is optional: leave the list empty for a calendar without weeks.
6. Under **Eras**, give each era a name, a short form and the year it begins, with **Add era**.
7. Switch on **An era before the first** if years before your first era should count backwards, and give it a name and a short form.
8. Switch on **Year zero** if eras should count their years from 0 instead of from 1.
9. Switch on **Leap years** if one month gains days every so many years, then say which month, how many days and every how many years.
10. Press **Use this calendar**.

**Before you switch.** Switching calendar changes no note. Dates that do not fit the new calendar show as undated on the timeline until you set them again. The window lists those events first and asks you to press **Use it anyway**. It is easiest to set the calendar up before you date many events.

**Limits.** Dates sort correctly only within one era. The date pickers in the event window have not been tried on screen.

The story calendar is saved in the project.

## Writing targets

1. Run the command **Set writing targets**, or click a figure in the bottom bar. The window is called "Writing targets".
2. Set any of these, and leave empty what you do not want:
   - **Project target (words)**: the length you are aiming for.
   - **Daily target (words)**: what you mean to write on a writing day.
   - **Deadline**: the day the draft should be done.
   - **Target for the open scene (words)**: shown when a scene is open. It is the same number as **Target (words)** in the inspector.
3. Press **Save**.

**Where the targets show**

- The bottom bar: "Words today" against the daily target, "Project words" against the project target, and "Scene target" with a small progress bar (add that figure, or choose the **Drafting** bar).
- The planner: today's target.
- The corkboard cards and the outliner: each scene's own target.

**Setting many scene targets at once.** Open the outliner and type in the **Target** column, one row after another.

Targets are saved in the project, so they are the same on every device.

## Writing report options

- **What the report is about.** At the top of the report: **The open scene**, a folder of the binder, or **Whole manuscript**.
- **Words on a page.** What the report takes as one page when it counts pages. It starts at 250, the usual figure for a manuscript, and can be any whole number from 50 to 2000. Set it in the report itself, under the pages figure, or in Spellbook's settings, where the writing report has a row for it. Use 250 to 300 for a manuscript page, or a higher number to estimate the pages of a printed book.
- **Leave out common words.** Under **Most used words**. On, the list hides the small words of English and Hebrew such as "the", "and" and "of", and shows the words you choose.
- **Show more words.** A longer list of the most used words.

"Words on a page" is kept on each device separately.

## Snapshot options

In Obsidian's **Settings**, under **Spellbook**, in the section **Snapshots**:

- **Take a snapshot before the first edit of the day.** When this is on, the first time you change a scene on a day, Spellbook first saves the scene as it was, as an automatic snapshot. It is off unless you switch it on. Automatic snapshots are marked "Automatic" in the list.
- **Automatic snapshots to keep for a scene.** When a scene has more automatic snapshots than this, the oldest go to the trash. It starts at 10 and can be 1 to 100.

Snapshots you took yourself are never removed for you, whatever this number is.

Switch the first setting on if you tend to forget to take a snapshot before revising. It costs a little space: each snapshot is a note in the project's Snapshots folder.

Both settings are kept on each device separately, so switch automatic snapshots on on every device you revise on. Automatic snapshots have not been tried on screen yet.

## Where each setting lives

"Syncs with the project" means the choice is saved in the project's notes and travels with the vault. "Stays on the device" means it is remembered on the device you made it on, and each device can differ.

"Settings" below means Obsidian's Settings, then **Spellbook**.

| Setting | Where to find it | Syncs or stays |
| --- | --- | --- |
| Layout (Automatic, Touch layout, Desktop layout) | Settings, "Layout", under the version | Stays on the device |
| Colour scheme | Settings, "Colour scheme"; commands **Choose colour scheme** and **Next colour scheme** | Stays on the device |
| Which writing modes are on | The four **Toggle ... mode** commands | Stays on the device |
| Letter box band, typewriter line, Zen switches | Settings, "Writing modes" | Stays on the device |
| Which prose checks are on | Settings, "Prose checks"; the **Toggle prose check** commands | Stays on the device |
| Repeated-word distance, long-sentence length | Settings, "Prose checks" | Stays on the device |
| Your own filler words | Settings, "Prose checks" | Stays on the device |
| Bottom bar figures, order and shortcut buttons | Settings, "Writing progress", under "Bottom bar" | Stays on the device |
| Count pasted text | Settings, "Writing progress" | Stays on the device |
| Automatic snapshots, and how many to keep | Settings, "Snapshots" | Stays on the device |
| Where links are updated when a note is renamed (this project only, or the whole vault) | Settings, "Renaming" | Stays on the device |
| Words on a page | The writing report, under the pages figure; also in Settings | Stays on the device |
| Last choices in the export window | The export window | Stays on the device |
| Corkboard card size | The corkboard | Stays on the device |
| Outliner columns, sorting and filters | The outliner, **Columns** button and column headings | Stays on the device |
| Hidden timeline lanes | The "Timeline lanes" window, **Hide** and **Show** | Stays on the device |
| Which project is open, folded binder folders | The binder | Stays on the device |
| Keyboard shortcuts | Obsidian's Settings, **Hotkeys** | Obsidian's own setting, kept with the vault's configuration |
| Phone and tablet toolbar | Obsidian's Settings, **Toolbar**, on the phone or tablet | Obsidian's own setting |
| CSS snippets | Obsidian's Settings, **Appearance** | Obsidian's own setting, kept with the vault's configuration |
| Statuses and labels, names and colours | **Manage statuses and labels** | Syncs with the project |
| A scene's synopsis, status, label, target, compile switch | The inspector, the corkboard, the outliner | Syncs with the project |
| Project target, daily target, deadline | **Set writing targets** | Syncs with the project |
| Timeline lanes, names, colours and order | The "Timeline lanes" window | Syncs with the project |
| Story calendar | **Edit story calendar** | Syncs with the project |
| Entity types | **Entity types** in the World screen | Syncs with the project |
| An entity's picture, fields and relations | The entity's sheet in the World screen | Syncs with the project |
| World shown as cards or as a list | The World screen, **Cards** and **List** | Stays on the device |
| Day marks | The planner, on a chosen day | Syncs with the project |
| To-dos | The planner, or `To-do.md` | Syncs with the project |
| Author's name for exports | The export window | Syncs with the project |
| Order of the binder | The binder, the corkboard, the outliner | Syncs with the project |

A practical consequence: when you set Spellbook up on a second device, your book arrives complete, with its statuses, targets, timeline and world. What you set again by hand is how the tool looks and behaves there: the colour scheme, the modes, the prose checks and the bar.
