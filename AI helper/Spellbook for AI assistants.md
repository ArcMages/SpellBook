# Spellbook for AI assistants

You are reading this because a writer wants your help with a novel that is kept in a Spellbook project. This file tells you what the files of such a project mean, how to read them, which edits are safe, and which are not. Follow it exactly: the project is the writer's book, it syncs between their devices, and a wrong edit can lose work.

Everything here describes Spellbook version 0.9.0 (project layout version 1). If the project index says `version: 2` or higher, read only, and tell the writer this file is out of date.

## Contents

1. What Spellbook is
2. How to recognise a project
3. The folders
4. The project index
5. Scenes
6. Timeline events
7. Story dates and invented calendars
8. To-dos
9. World entities
10. Snapshots
11. Daily word logs
12. Exports
13. Reading recipes
14. Safe writing recipes
15. Rules
16. Asking the writer first
17. Checklist after an edit

## 1. What Spellbook is

Spellbook is a plugin for Obsidian for planning and writing novels. A project is an ordinary folder of Markdown notes: one note per scene, per timeline event and per character or place, with the structure kept in YAML properties (frontmatter) and in one index note. There is no database and no hidden state that matters to you: what you can read in the files is the whole project.

Terms used below:

- **Project folder**: the folder that holds one novel. Paths in this file are relative to it unless they say "vault path".
- **Frontmatter**: the YAML block between two `---` lines at the very top of a note. Obsidian calls these the note's properties.
- **Body**: everything in a note below its frontmatter.
- **Binder**: the ordered tree of scenes and folders that is the manuscript.
- **The writer**: the person you are helping. They are a writer, not a programmer.

## 2. How to recognise a project

A Spellbook project is a folder that directly contains a Markdown note whose frontmatter has `spellbook: project`. That note is the **project index**. It is normally named after the folder (`My Novel/My Novel.md`).

To find every project in a vault, look for Markdown notes whose frontmatter contains exactly `spellbook: project`. The folder each one sits in is a project folder.

Three other markers exist. They are not projects:

| Frontmatter | What the note is |
| --- | --- |
| `spellbook: event` | A timeline event, in `Timeline/`. |
| `spellbook: stats` | A daily word log, in `Stats/`. |
| `spellbook-snapshot: 1` | A saved version of a scene, in `Snapshots/`. |

A second note next to the index with the same marker and a name such as `My Novel 2.md` is a **conflicting copy** left by the sync service. It is not a second project. Do not edit, merge or delete it: tell the writer, who can press **Merge** or **Dismiss** in Spellbook's binder.

## 3. The folders

```
<Project>/
  <Project>.md     the project index
  To-do.md         to-dos as plain checkbox lines
  Manuscript/      one note per scene
  Timeline/        one note per timeline event
  Research/        the writer's research notes
  Stats/           daily word logs, one file per device per month
  World/           one note per character, place and so on, in a folder per type
  Snapshots/       saved versions of scenes, one folder per scene
  Exports/         exported manuscripts
  AI helper/       this file
```

The index, `To-do.md`, `Manuscript/`, `Timeline/`, `Research/` and `Stats/` are made with the project. `World/`, `Snapshots/`, `Exports/` and `AI helper/` appear the first time they are needed, so a project may lack them.

| Place | What lives there | Who writes it | What you may do |
| --- | --- | --- | --- |
| `<Project>.md` | The index: binder, lists, targets, calendar. Its body is the writer's own notes. | Spellbook (frontmatter), the writer (body). | Read. Edit frontmatter only as section 14 describes. Never the body. |
| `To-do.md` | Checkbox lines, any other text. | The writer and Spellbook. | Read. Add or change single lines (section 14). |
| `Manuscript/` | Scenes. | The writer (body), Spellbook and the writer (frontmatter). | Read. Edit the documented frontmatter properties. Edit a body only when the writer asks for that scene. |
| `Timeline/` | Events. | The writer and Spellbook. | Read. Add events, edit their frontmatter. Body as for scenes. |
| `Research/` | Free notes. Spellbook only lists them. | The writer. | Read. Add or edit when asked. |
| `Stats/` | Word logs. | Spellbook only. | Read only. Never edit, create, rename or delete. |
| `World/` | Entities. | The writer and Spellbook. | Read. Add entities, edit their frontmatter. Body as for scenes. |
| `Snapshots/` | Saved versions of scenes. | Spellbook only. | Read only. Never edit, create, rename or delete. |
| `Exports/` | Exported files (`.docx`, `.html`, `.md`). | Spellbook only. | Read. Never edit. They are copies, not the manuscript. |
| `AI helper/` | This file. | Spellbook only. | Read. |

Spellbook never looks at notes outside project folders. Neither should you, unless the writer asks.

## 4. The project index

The index is the note with `spellbook: project`. All structure is in its frontmatter. Its body is free text that belongs to the writer.

### Every key

| Key | Type | Meaning |
| --- | --- | --- |
| `spellbook` | the text `project` | Marks the note as a project index. Never change it. |
| `version` | whole number | The layout version. `1` today. A higher number means a newer Spellbook wrote it: do not write to the project. |
| `title` | text | The project's title. When absent, the file name is the title. |
| `binder` | list | The manuscript's tree. See below. |
| `statuses` | list | The statuses a scene can have, in display order. |
| `labels` | list | The labels a scene can have, in display order. |
| `targets` | map | Word targets and a deadline. |
| `marks` | map | Day marks on the planner's calendar. |
| `timelines` | list | The lanes of the timeline, in display order. |
| `calendar` | map | An invented story calendar. Absent for the real-world calendar. |
| `entityTypes` | list | The types of world entity. Absent until the writer changes them. |
| `author` | text | The author's name for exports. Optional. |

Any other key was put there by the writer or by a newer version. Leave it exactly as it is.

Of these, only `spellbook`, `version`, `title` and `binder` decide whether the project can be opened. If `version` or `binder` cannot be understood, Spellbook shows the project as **read-only** and refuses every change until the index is repaired. This is the main reason to be careful here.

### The binder

`binder` is a list. Each entry is one of two things:

- **A scene**: a text, the scene note's path relative to the project folder, with forward slashes and the `.md` ending. Example: `Manuscript/The Last Ferry.md`.
- **A folder**: a map with exactly these keys:
  - `folder`: the folder's name (text; quote it if it is a number or contains a colon);
  - `id`: a short text id, unique within the project, such as `f-k3x9q2`. It never changes;
  - `children`: a list of entries of the same two kinds. Folders nest to any depth. An empty folder has `children: []`.

Binder folders are **virtual**. They exist only in the index. A scene inside the binder folder "Part one" is still the file `Manuscript/<title>.md`; putting a scene in a folder never moves a file. Folders are the parts and chapters of the book.

Rules the reader applies:

- A path must stay inside the project: no leading `/`, no backslash, no `..`. One that does not makes the whole project read-only.
- An entry that is neither a text nor a map, or a folder whose `folder` is not text, or an `id` that is not text, makes the whole project read-only.
- A scene listed twice counts once, at its first place.
- A scene whose note does not exist shows as **Missing**. It may be a note that has not synced yet. Do not remove the entry and do not create an empty note to fill it.
- A note under `Manuscript/` that the binder does not list shows as **Unfiled**. It is not part of the manuscript: it is not exported and not counted in the project's word total.
- A folder may carry other keys that this version does not know. Keep them.

### Statuses and labels

Both lists have the same shape: entries with a `name` (text, any language) and an optional `color`.

```yaml
statuses:
  - name: To do
    color: red
  - name: First draft
    color: orange
labels:
  - name: Mara
    color: purple
```

- `color` is one of eight names: `red`, `orange`, `yellow`, `green`, `cyan`, `blue`, `purple`, `pink`. Anything else means no colour.
- A bare text (`- Mara`) is a name without a colour.
- When `statuses` is absent, the project has the four built-in statuses, in this order: `To do`, `First draft`, `Revised`, `Final`. When `labels` is absent, there are no labels.
- A scene refers to a status or a label by its name. Names are compared without regard to capitals or extra spaces.
- Renaming a status or label in the list does not rename it in the scenes. Spellbook's own "Manage statuses and labels" window does both; by hand you would have to change every scene. Ask the writer to rename there.

### Timelines (lanes)

```yaml
timelines:
  - name: Main plot
    color: purple
  - name: Backstory
```

Each entry is a lane of the timeline screen: a `name` and an optional `color` (the same eight names). A bare text is a lane without a colour. Lane names are compared without regard to capitals. Two lanes are built in and need not be listed: `Manuscript` (every scene that has a date) and `Other` (events that name a lane the list does not have).

### Day marks

```yaml
marks:
  2026-10-20:
    color: red
    label: Deadline for part one
```

A map from a day (`YYYY-MM-DD`) to a mark: an optional `color` (the same eight names, lower case) and an optional `label` (short text, one line). They show on the planner's calendar.

### Targets

```yaml
targets:
  project: 80000
  daily: 500
  deadline: 2026-12-31
```

All three parts are optional. `project` is the number of words the whole manuscript should reach, `daily` the words to write each day, `deadline` a day as `YYYY-MM-DD`. Targets are whole numbers above zero. A target for one scene is not here: it is the scene's own `target` property.

### Entity types

```yaml
entityTypes:
  - id: character
    name: Character
    folder: Characters
    fields: [role, age, occupation, appearance, personality, voice, goal, arc, summary]
    fieldsVersion: 2
    color: blue
    icon: user
```

Each entry is a type of world entity:

- `id`: what an entity note says in its `type` property. Lower case. Never changes.
- `name`: what one of them is called.
- `folder`: the folder inside `World/` where new notes of the type are made.
- `fields`: the properties a new note of the type starts with, in order.
- `color`: one of the eight colour names, or nothing.
- `icon`: the name of an icon.
- `fieldsVersion`: bookkeeping on built-in types. Leave it.

Seven types are built in and exist even when the index says nothing about them: `character`, `place`, `faction`, `item`, `lore`, `creature`, `culture`. Section 9 lists their folders and fields. When `entityTypes` is present, use the `folder` and `fields` it gives, because the writer may have changed them. The writer can add types of their own.

Do not edit `entityTypes` by hand. Ask the writer to use **Entity types** in the World screen.

### Calendar

Present only when the story uses an invented calendar. Section 7 describes it. Do not edit it by hand: changing it changes how every date in the project is read.

### A short real example

```yaml
---
spellbook: project
version: 1
title: Sample Novel
binder:
  - Manuscript/Prologue.md
  - folder: Part one - Arrival
    id: f-k3x9q2
    children:
      - Manuscript/The Last Ferry.md
      - Manuscript/A Room Above the Chandlery.md
  - folder: Part two - The Survey
    id: f-8m2tq0
    children:
      - Manuscript/Low Water.md
      - Manuscript/מכתב לאחותי.md
  - Manuscript/Epilogue.md
statuses:
  - name: To do
    color: red
  - name: First draft
    color: orange
  - name: Revised
    color: blue
  - name: Final
    color: green
labels:
  - name: Mara
    color: purple
  - name: Tobias
    color: cyan
timelines:
  - name: Main plot
    color: purple
  - name: Backstory
    color: orange
marks:
  2026-10-20:
    color: red
    label: Send part one
targets:
  project: 80000
  daily: 1000
  deadline: 2027-03-13
---
Notes about the novel. This text belongs to the writer.
```

### How binder order works, and the `order` property

The order of the manuscript is the order of the `binder` list, read depth first: an entry, then everything inside it, then the next entry. **The index is the only source of truth for order.**

Every scene note also carries an `order` property: a whole number that rises through the manuscript (new scenes are 1024 apart, so that a moved scene can take a number between its neighbours). It is a **copy**, written by Spellbook so that Obsidian's own sorting and other tools can follow the binder. Spellbook never reads it to decide the order.

What this means for you:

- To read the manuscript in order, walk the `binder`. Do not sort by `order`: after a reorder on another device the numbers can lag behind the index for a while.
- Never write, change or remove an `order` value. Each device writes order numbers only for the scenes moved on it; a number written by hand can make two devices rewrite the same notes at once and leave conflicting copies.
- A scene without an `order` is fine. Spellbook gives it one the next time the binder is changed.

## 5. Scenes

A scene is a Markdown note that the binder lists. Scenes are made in `Manuscript/`. The scene's **title is its file name** without `.md`; there is no title property. A new scene made by Spellbook looks like this:

```yaml
---
synopsis: ""
status: To do
label: ""
compile: true
order: 5120
created: 2026-10-14
---
```

### Every property Spellbook reads or writes

| Property | Type | Allowed values | Meaning | May you write it? |
| --- | --- | --- | --- | --- |
| `synopsis` | text | Any text, any language. Empty for none. | The short summary shown on the scene's card, in the inspector and in the outliner. | Yes. |
| `status` | text | The name of a status in the index's `statuses` (or one of the four built-in ones). Empty for none. | The scene's stage. | Yes. |
| `label` | text | The name of a label in the index's `labels`. Empty for none. | The scene's coloured label (often the point-of-view character). | Yes. |
| `target` | whole number | 1 to 10000000. Absent for no target. | The words the scene should come to. | Yes. |
| `compile` | true or false | `true`, `false`. Absent means true. | Whether the scene is included in an export. | Yes. |
| `order` | whole number | Written by Spellbook. | A copy of the scene's place in the binder. See section 4. | **Never.** |
| `created` | date | `YYYY-MM-DD`. | The day the scene was started. | No. Set it once on a scene you create. |
| `edited` | date | `YYYY-MM-DD`. | The day the scene was last typed in, in Obsidian. | No. |
| `entities` | list of links | `"[[Name]]"` entries. Absent for none. | The world entities in the scene. See section 9. | Yes. |
| `date` | story date | See section 7. Absent for none. | When the scene happens in the story. A scene with a date shows on the timeline, in the Manuscript lane. | Yes. |
| `end` | story date | Later than `date`. | Makes a dated scene a span on the timeline. | Yes. |
| `tags` | list of text | Obsidian's own tags property. | Shown in the outliner and on the timeline. | Yes. |
| `snapshot-id` | text | Written by Spellbook. | Ties the scene to its snapshots. Only there after the first snapshot. | **Never.** |

Any other property is the writer's own. The outliner can show it as a column. Leave it alone unless asked.

Reading is forgiving: a missing property takes its usual value (no synopsis, no status, no label, no target, included in compile). A value of the wrong kind (a list where text is expected) is ignored and reported to the writer as a problem, so do not write one.

### What counts as manuscript words

Spellbook counts the words of a scene's **body**. Two things never count:

- the frontmatter block;
- Obsidian comments: everything between a pair of `%%` marks, on one line or across many.

Everything else counts, including headings, link addresses and code blocks. Hebrew, English and languages written without spaces are all counted by word.

The **project total** is the sum over the scenes the binder lists. Unfiled notes and missing scenes are not in it. A scene with `compile: false` is still counted in the project total; it is only left out of exports.

The **daily word log** (section 11) is different: it records words typed in Obsidian's editor, on that device, as they are typed. Words you add to a file from outside Obsidian raise the project total but never appear in the daily log, the writing streak or "words today". Tell the writer this when you add prose for them.

## 6. Timeline events

An event is a Markdown note anywhere under `Timeline/`. Its title is its file name. Any note there is an event, with or without the marker. A new one made by Spellbook:

```yaml
---
spellbook: event
date: 1923-04-12
timelines:
  - Main plot
---
```

| Property | Type | Meaning |
| --- | --- | --- |
| `spellbook` | the text `event` | Marks a note Spellbook made as an event. Keep it. |
| `date` | story date | When it happens: a year, a year and month, or a full day. Empty or absent: the event is **undated** and waits in the timeline's Undated strip. |
| `end` | story date | Optional. Later than `date`: the event is a span. The same day or earlier: ignored, the event is a single moment. |
| `timelines` | list of text | The lanes it shows in, by name. A lane the index does not list puts the event in the built-in `Other` lane. An empty list also means `Other`. |
| `scenes` | list of links | The scenes that tell the event: `"[[Scene title]]"`. |
| `entities` | list of links | The world entities it involves: `"[[Name]]"`. |
| `tags` | list of text | Shown on the event's card. |

The body is free text about the event and belongs to the writer.

A **scene with a `date`** is an event too. It shows in the built-in `Manuscript` lane and cannot be taken out of it.

## 7. Story dates and invented calendars

A story date is the date inside the novel's world. It has nothing to do with today's date.

### The real-world calendar (no `calendar` key in the index)

A date is known to the year, the month or the day:

| Written | Means |
| --- | --- |
| `date: 1923` | The year 1923. A bare number. |
| `date: 1923-04` | April 1923. |
| `date: 1923-04-12` | 12 April 1923. |

Years run from 1 to 9999. A date that does not exist (30 February) is not a date: the event shows as undated with a warning. A time of day after a full date (`1923-04-12T10:30`) is accepted and ignored.

### An invented calendar (`calendar` key in the index)

```yaml
calendar:
  name: Ember reckoning
  months:
    - name: Thaw
      days: 36
    - name: Seedfall
      days: 36
  weekdays: [Sunrest, Moonrise]
  eras:
    - name: Age of Embers
      short: AE
      start: 1
    - name: Age of Tides
      short: AT
      start: 1204
  before:
    name: Before the Embers
    short: BE
  yearZero: false
  leap:
    month: 2
    days: 1
    every: 4
```

- `months`: each with a `name` and its number of `days`. Months are numbered from 1 in this order.
- `weekdays`: optional names of the days of the week.
- `eras`: each with a `name`, a `short` form (no spaces) and the `start` year of one running count of years. The first era starts at year 1 (or 0 when `yearZero` is true). Inside each era, years are counted afresh from 1 (or 0).
- `before`: optional. An era that counts backwards from before the first era: 1, 2, 3 going back in time.
- `leap`: optional. The month numbered `month` gains `days` days in every year of the running count that `every` divides.

**In a project with an invented calendar, every `date` and `end` must be written in that calendar's own form**, as text: the year within its era in four digits, then the month and the day in digits when they are known, then a space and the era's short form.

| Written | Means |
| --- | --- |
| `date: 1203 AE` | Year 1203 of the Age of Embers. |
| `date: 1203-04 AE` | The fourth month of that year. |
| `date: 1203-04-17 AE` | Day 17 of that month. |

A real-world date (`1923-04-12`, or the bare number `1923`) in such a project is **not read**: the event becomes undated. Check the month number against the number of months and the day against that month's length. Use only short forms the calendar defines.

To put dates in order across eras: `before` comes first, counting down to 1; then the eras in the order listed. Within one era, dates sort as text.

## 8. To-dos

To-dos are plain checkbox lines in `To-do.md`, at the top of the project folder.

```markdown
- [ ] Send chapter one 📅 2026-10-20
- [x] Choose a name for the ferry
- [ ] Check the tide tables for 1923
```

### The exact line format

```
<indent><bullet> [<box>] <text>
```

- `<indent>`: optional spaces or tabs.
- `<bullet>`: `-`, `*` or `+`, followed by at least one space.
- `<box>`: one character between square brackets. A space means not done. `x` or `X` means done. Any other character means not done.
- `<text>`: the to-do. One line.

**Due date.** Written inside the text the way the Tasks community plugin writes it: the calendar emoji 📅 (U+1F4C5), a space, and a date as `YYYY-MM-DD`. Spellbook puts it at the end of the line. If a line holds more than one, the last one counts. A date that does not exist is ignored.

Everything else on the line is simply part of the text, including the other marks the Tasks plugin uses (start date, done date, repeat rule, priority).

Lines that are not to-dos (headings, notes, blank lines) are kept exactly as they are. A line inside a fenced code block, or inside a frontmatter block at the top, is never a to-do. Lines indented under a to-do are that to-do's notes.

The planner shows to-dos on the calendar by due date, lists the overdue ones (not done, due before today) and the undated ones.

## 9. World entities

An entity is a character, a place, or anything else of the story's world. It is a Markdown note anywhere under `World/`. Its **name is its file name**. Notes are made in a folder for their type: `World/Characters/Mara.md`.

```yaml
---
type: character
role: Protagonist
age: 34
occupation: Surveyor
appearance: ""
personality: ""
voice: ""
goal: To redraw the sea chart
arc: ""
summary: Sent to Saltwick to redraw the sea chart after the storm.
aliases:
  - The surveyor
image: "[[mara.png]]"
related:
  - "[[Tamar|sister]]"
  - "[[Saltwick|lives in]]"
---
## Appearance

## Background

## Notes
```

### Properties with a meaning of their own

| Property | Type | Meaning |
| --- | --- | --- |
| `type` | text | The id of the entity's type (`character`, `place`, ...). When absent, the type is the one whose folder the note is in. A type that is not in the list shows as "Other". |
| `summary` | text | One or two lines. Shown on the entity's card and searched. |
| `aliases` | list of text | Other names it goes by. This is Obsidian's own property. "Find mentions" looks for these names too. |
| `image` | link | The entity's picture: a link to an image file anywhere in the vault, `"[[mara.png]]"`. Optional. |
| `related` | list of links | The entities it has to do with, each with a short label. Optional. |

Every other property is a **field**: one line of text or a number. The fields a type starts with are listed below, but the writer can add or remove fields in any single note. A field that holds a list cannot be edited on the entity's sheet in Spellbook, so write fields as plain text.

### The built-in types

| `type` | Folder in `World/` | Fields a new note starts with, in order | Headings a new note starts with |
| --- | --- | --- | --- |
| `character` | `Characters` | `role`, `age`, `occupation`, `appearance`, `personality`, `voice`, `goal`, `arc`, `summary` | Appearance, Background, Notes |
| `place` | `Places` | `kind`, `region`, `atmosphere`, `landmarks`, `summary` | Description, History, Notes |
| `faction` | `Factions` | `kind`, `leader`, `summary` | Description, Members, Notes |
| `item` | `Items` | `kind`, `owner`, `summary` | Description, History, Notes |
| `lore` | `Lore` | `kind`, `period`, `told-by`, `summary` | The tale, Who tells it, What is true |
| `creature` | `Creatures` | `kind`, `habitat`, `summary` | Description, Habits, What people say |
| `culture` | `Cultures` | `kind`, `region`, `summary` | Description, Customs, Language |

`lore` is for legends, tales, myths, history, religion and customs. `culture` is for peoples and their languages. If the index has `entityTypes`, its `folder` and `fields` replace the ones in this table.

After its fields, a new note gets `aliases: []`. It has no `image` and no `related` until the writer adds them.

The World screen's "Kind" column shows a character's `role`, and the `kind` of every other built-in type.

### Links: which entities are in a scene or an event

A scene or a timeline event lists its entities in its `entities` property, as Obsidian links:

```yaml
entities:
  - "[[Mara]]"
  - "[[Saltwick]]"
```

- Each entry is one link in double quotes. The link's target is the entity note's name.
- When another note in the vault has the same name (two projects, or a scene called like a character), write the whole vault path without `.md`, and show the name: `"[[My Novel/World/Characters/Mara|Mara]]"`.
- An entity only mentioned in the body is **not** linked. Only the `entities` list counts.
- The link is one-sided: nothing is written into the entity's note. Spellbook works out "the scenes this entity is in" by reading every scene.

### Relations: `related`

An entity lists the entities it has to do with in its own `related` property. Each entry is one link; the **label is the link's display text**:

```yaml
related:
  - "[[Tamar|sister]]"
  - "[[The Archive|keeps]]"
  - "[[Saltwick]]"
```

- The label is short (60 characters at most), one line, and has none of the characters `[`, `]`, `|`.
- An entry without a label is just related.
- A relation is written **on one side only**. The other entity's sheet shows it under "Mentioned by", worked out from the notes that list it. Do not write the reverse entry unless the writer wants a different label on that side.
- An entity is related to another once: do not add a second entry that leads to the same note.

### Pictures: `image`

```yaml
image: "[[mara.png]]"
```

A link, in double quotes, to an image file that is already in the vault (`png`, `jpg`, `jpeg`, `gif`, `webp`, `avif`, `bmp`, `svg`). Use the file name alone when it is unique in the vault, or else its whole vault path. A link to a file that is not there, or is not an image, simply shows no picture. Never create, move or delete image files; only point at one the writer has put in the vault.

## 10. Snapshots

A snapshot is an earlier version of a scene, saved as a note so that it syncs and can be read without the plugin.

```
Snapshots/<scene title> - <scene id>/<YYYY-MM-DD> <HH.MM.SS> <name>.md
```

````markdown
---
spellbook-snapshot: 1
scene-id: m2k9x1ab
scene: Manuscript/Opening.md
name: Before the rewrite
taken: 2026-10-14T12:30:05
taken-at: 1791973805000
automatic: false
words: 1234
device: a1b2c3
---
```yaml
synopsis: Anna arrives.
status: First draft
```
The scene's text, exactly as it was.
````

- The snapshot's own frontmatter says which scene it is a version of (`scene-id`, and `scene`, the path at the time), its `name`, when it was `taken`, whether it was `automatic`, its `words` and the `device`.
- The body starts with a fenced `yaml` code block holding the scene's frontmatter at the time, as text. The rest of the body is the scene's body at the time.
- A snapshot belongs to its scene through the scene's `snapshot-id` property, which matches the snapshot's `scene-id`. That is how snapshots follow a scene through renames.

**Why snapshots must not be edited.** They are the writer's safety net. "Restore" replaces a scene's body with the snapshot's body, so an edited snapshot silently restores text that never existed. Two devices may hold the same snapshot; a changed copy is treated as a different one. And removing or changing a scene's `snapshot-id` cuts the scene off from its history. Read snapshots freely (for example to compare versions). Never write in `Snapshots/`, and never touch `snapshot-id`.

If the writer wants a version saved before you change a scene, ask them to run **Take snapshot** in Obsidian. Do not make a snapshot file yourself.

## 11. Daily word logs

```
Stats/2026-10 k3x9q2ab.md
```

````markdown
---
spellbook: stats
device: "k3x9q2ab"
deviceName: "Dana's iPhone"
month: "2026-10"
---

| Date | Manuscript added | Manuscript deleted | Other added | Other deleted |
| --- | ---: | ---: | ---: | ---: |
| 2026-10-13 | 1200 | 30 | 45 | 0 |
````

Each device writes its own file for each month, so that two devices never write the same file. One row per day that had activity. "Manuscript" is words typed in notes under `Manuscript/`; "Other" is words typed in any other note while the project was open. The net words of a day are added minus deleted, summed over every device's file.

**Never edit these files, never create one, never delete or rename one.** They are a record of what was typed, the calendar, the streak and the averages are computed from them, and each belongs to one device that will write to it again. To answer "how much did I write this week", read them and add up.

## 12. Exports

`Exports/` holds files Spellbook made with **Export manuscript**: a Word document (`.docx`), a web page (`.html`) or one Markdown note (`.md`), named with the project's title and the day, for example `My Novel 2026-10-13.docx`. Every export is a new file; none is ever replaced.

An export holds the scenes of the binder in order, with folders as chapters, without the scenes whose `compile` is `false`, and without frontmatter or `%%` comments.

Exports are **copies**. Editing one changes nothing in the manuscript. If the writer asks you to change the book, change the scenes; if they need a fresh file, ask them to export again. Do not write in `Exports/`.

## 13. Reading recipes

All of these only read.

### Read the manuscript in binder order

1. Read the index's frontmatter and take `binder`.
2. Walk it depth first. A text entry is a scene path; a map entry is a folder: note its `folder` name as a part or chapter heading, then walk its `children`.
3. For each scene path, read `<project folder>/<path>`. If the file is not there, the scene is Missing: skip it and say so.
4. Take the body: drop the frontmatter block, and drop everything between pairs of `%%`.
5. The scene's title is its file name without `.md`.
6. If the writer wants "the book as a reader would get it", also skip scenes whose `compile` is `false`.

Do not use the alphabetical order of `Manuscript/`, and do not sort by `order`.

### List scenes by status

1. Get the scene paths from the binder, in order (above).
2. Read each scene's frontmatter and take `status`. Empty or absent means "no status".
3. Group by status, comparing names without regard to capitals. Show the groups in the order of the index's `statuses` (or the four built-in ones), then any name not in the list, then "no status".

The same works for `label`.

### Find every scene an entity is in

1. Find the entity's note under `World/` and take its name (the file name) and its `aliases`.
2. For each scene in binder order, read `entities`. Take each entry's target: the text between `[[` and `]]`, up to a `|` or a `#` if there is one. The entry leads to the entity when the target is its name, or a path that ends with its name (with or without `.md`). Compare without regard to capitals.
3. Those scenes are the ones the entity **is in**.
4. Separately, and only if asked for mentions: search each scene's body for the name or an alias as a whole word. Report these as "mentioned but not listed". Do not add them to `entities` without asking. In Hebrew, a name may have one or two joined letters in front of it (ו, ה, ב, ל, מ, ש, כ) and still be the name.

### Build a character's timeline

1. Find the character's note and its name.
2. Collect the events: every note under `Timeline/` whose `entities` leads to the character (matched as above).
3. Collect the dated scenes: every scene in the binder that has a `date` and whose `entities` leads to the character.
4. Read each one's `date` (and `end`) as section 7 describes, using the project's calendar.
5. Sort by date. Put a year-only date at the start of its year and a month-only date at the start of its month. List undated events separately at the end.
6. For each, give the title, the date as written, the lanes (`timelines`), and for events the linked `scenes`.

Say which entries are story events and which are scenes: the order of the story's events is not the order in which the book tells them.

### Summarise a chapter

1. In the binder, find the folder whose `folder` name is the chapter. If two folders share a name, ask which.
2. Take the scenes in its `children`, in order, including those in folders nested inside it.
3. For each scene use its `synopsis` when it has one; read the body when it has none, or when the writer wants a summary of the text itself.
4. Report per scene: title, status, word count if useful, and the summary. Keep the scene order.

A summary is something you say to the writer. Do not write it into the project unless they ask (for example "put it in each scene's synopsis").

## 14. Safe writing recipes

General method for every recipe:

1. **Read the file again just before you change it.** The vault syncs; the copy you read a minute ago may be old.
2. Change only the lines the recipe names. Keep every other property, in the same order, with the same values.
3. Keep the frontmatter valid YAML (section 15).
4. Write the file once. Then run the checklist in section 17.

If a file has no frontmatter block, add one at the very top: a line `---`, the properties, a line `---`, then the body unchanged.

### Set a scene's synopsis

Before:

```yaml
---
synopsis: ""
status: To do
label: Mara
compile: true
order: 2048
created: 2026-10-01
---
```

After:

```yaml
---
synopsis: Mara crosses to Saltwick on the last ferry of the day and meets Tobias at the wheel.
status: To do
label: Mara
compile: true
order: 2048
created: 2026-10-01
---
```

Steps: replace the value of `synopsis` (add the key if it is missing). Put the text in double quotes if it contains a colon followed by a space, a `#`, or starts with a quote, a bracket, `-`, `*`, `&`, `!`, `%`, `@` or a backtick. For a synopsis of several lines use a YAML block (`synopsis: |-` and indented lines). Touch nothing else.

### Set a scene's status

Before: `status: To do`. After: `status: First draft`.

Steps:

1. Read the index's `statuses`. If the key is absent, the statuses are `To do`, `First draft`, `Revised`, `Final`.
2. Use a name from that list, written exactly as the list writes it.
3. Replace the value of `status` in the scene.

If the writer wants a status that is not in the list, ask them to add it in **Manage statuses and labels**, then set it.

### Set a scene's label

Before: `label: ""`. After: `label: Mara`.

Steps: as for a status, with the index's `labels`. `label: ""` means no label. If the name is not in the list, ask the writer to add it first.

### Set a scene's target

Before (no target):

```yaml
label: Mara
compile: true
```

After:

```yaml
label: Mara
target: 1500
compile: true
```

Steps: add or replace `target` with a whole number from 1 to 10000000, without quotes or commas. To remove a target, delete the `target` line. Where the key goes among the others does not matter.

### Add a to-do

Before:

```markdown
- [ ] Send chapter one 📅 2026-10-20
- [x] Choose a name for the ferry
```

After:

```markdown
- [ ] Send chapter one 📅 2026-10-20
- [x] Choose a name for the ferry
- [ ] Check the tide tables for 1923 📅 2026-11-02
```

Steps:

1. Read `To-do.md`. If it does not exist, create it with just the new line.
2. Write the line as `- [ ] <text>`, and for a due date add a space, 📅, a space and `YYYY-MM-DD` at the end.
3. Insert it on a line of its own directly after the last to-do line of the file (after any notes indented under that to-do). Never inside a fenced code block.
4. Keep every other line, the blank lines and the line endings as they are.

To tick a to-do, change only its box from `[ ]` to `[x]`. To change a due date, change only the date. Never reorder or rewrite the other lines.

### Add a world entity

Steps, for any type:

1. Find the type's folder and fields: from the index's `entityTypes` if it has an entry with that `id`, or else from the table in section 9.
2. Choose the name. It becomes the file name, so it must follow the file-name rules in section 15, and no note of that name may exist in the folder (compare without regard to capitals). Prefer a name no other note in the vault has, so that `[[Name]]` leads to it.
3. Create `World/<folder>/<Name>.md`. Create the `World` folder and the type's folder if they are missing.
4. Frontmatter, in this order: `type`, then every field of the type (empty ones as `""`), then `aliases: []`. Fill in what the writer told you. Do not invent facts they did not give: leave those fields empty.
5. Body: the type's headings as `## Heading` with a blank line after each. Write under them only what the writer asked for.

Before: no file. After, one example for each built-in type.

`World/Characters/Tobias.md`

```yaml
---
type: character
role: Ally with a secret
age: 52
occupation: Ferryman
appearance: ""
personality: ""
voice: ""
goal: ""
arc: ""
summary: Runs the ferry to Saltwick. Knows the sandbars by feel.
aliases: []
---
## Appearance

## Background

## Notes

```

`World/Places/Saltwick.md`

```yaml
---
type: place
kind: Harbour town
region: The north coast
atmosphere: ""
landmarks: ""
summary: A harbour town that the storm cut off from the old chart.
aliases: []
---
## Description

## History

## Notes

```

`World/Factions/The Harbour Office.md`

```yaml
---
type: faction
kind: Town authority
leader: The Harbour Master
summary: Decides who may sail and which chart is the true one.
aliases: []
---
## Description

## Members

## Notes

```

`World/Items/The Old Chart.md`

```yaml
---
type: item
kind: Sea chart
owner: The Harbour Office
summary: The chart from before the storm. Confident and wrong.
aliases: []
---
## Description

## History

## Notes

```

`World/Lore/The Bell in the Fog.md`

```yaml
---
type: lore
kind: Fishermen's tale
period: Told to this day
told-by: Tobias, and every ferryman before him
summary: A bell that rings from under the water before a boat is lost.
aliases: []
---
## The tale

## Who tells it

## What is true

```

`World/Creatures/The Tide Hound.md`

```yaml
---
type: creature
kind: Creature of local belief
habitat: The flats at low water
summary: A grey dog seen on the sand before the tide turns.
aliases: []
---
## Description

## Habits

## What people say

```

`World/Cultures/The Bay Fishers.md`

```yaml
---
type: culture
kind: Fishing people
region: The bay
summary: The families who have fished the bay since before the town had a name.
aliases: []
---
## Description

## Customs

## Language

```

A name, a field or a whole note may be in Hebrew: `World/Lore/הים מחזיר.md` with `kind: אמרה` is as valid as any of the above.

### List an entity on a scene

Before:

```yaml
---
synopsis: Mara crosses to Saltwick.
status: Final
entities:
  - "[[Mara]]"
---
```

After:

```yaml
---
synopsis: Mara crosses to Saltwick.
status: Final
entities:
  - "[[Mara]]"
  - "[[Tobias]]"
---
```

Steps:

1. Check that the entity's note exists under `World/`. If it does not, create it first (above) or ask.
2. Read the scene's `entities`. If an entry already leads to that entity, stop: there is nothing to do.
3. Append `- "[[<Name>]]"` at the end of the list. If the scene has no `entities` key, add it with this one entry. If `entities` is a single text, turn it into a list of the old entry and the new one.
4. If another note in the vault shares the name, write `"[[<vault path of the entity without .md>|<Name>]]"`.

The same steps list an entity on a timeline event.

### Relate two entities

Before, in `World/Characters/Noa.md`:

```yaml
summary: Keeps the town archive.
aliases: []
```

After:

```yaml
summary: Keeps the town archive.
aliases: []
related:
  - "[[The Archive|keeps]]"
```

Steps:

1. Decide which side carries the relation: the one the label reads from. "Noa keeps The Archive" goes in Noa's note.
2. Check both notes exist under `World/`, and that they are two different notes.
3. Read that note's `related`. If an entry already leads to the other entity, change its label there and add nothing.
4. Append `- "[[<Other name>|<label>]]"`, or `- "[[<Other name>]]"` for no label.
5. Do not touch the other entity's note. It will show "Mentioned by: Noa (keeps)" by itself.

### Add a timeline event

Before: no file. After, `Timeline/The winter storm.md`:

```yaml
---
spellbook: event
date: 1922-11-03
timelines:
  - Main plot
scenes:
  - "[[Prologue]]"
entities:
  - "[[Saltwick]]"
---
The night the bar moved and the old chart stopped being true.
```

Steps:

1. Choose a title that follows the file-name rules and that no note in `Timeline/` has.
2. Write the date in the project's calendar (section 7). If the index has a `calendar`, the date must end with an era's short form. If the writer gave no date, write `date:` with nothing after it: the event is undated.
3. `timelines`: lane names from the index's `timelines`, written as the index writes them. To use a lane that does not exist yet, ask the writer to add it in the timeline's **Lanes** window; an unknown name puts the event in `Other`.
4. `scenes` and `entities` are optional. Each entry is a quoted link to a note that exists.
5. `end` only for a span, and later than `date`.
6. Order of keys: `spellbook`, `date`, `end`, `timelines`, `scenes`, `tags`, `entities`.

To give a **scene** a place on the timeline, add `date: <story date>` to the scene's frontmatter. Nothing else is needed.

### Add a scene

Adding a scene has two parts: the note, and its place in the binder. The note is safe to make. The binder is the one structure in the project that can make the whole project read-only if it is written wrongly, so the default is to leave that part to the writer.

**Default: make the note, and let the writer place it.**

1. Choose a title that follows the file-name rules and that no note in `Manuscript/` has (compare without regard to capitals). Also check the index's `binder` does not already list `Manuscript/<Title>.md`: a listed path with no file is a scene still syncing from another device, and must not be filled in.
2. Create `Manuscript/<Title>.md` with this frontmatter and the body the writer asked for (or an empty body):

```yaml
---
synopsis: ""
status: To do
label: ""
compile: true
created: 2026-10-14
---
```

   Use the first status of the index's `statuses` for `status`, and today's date for `created`. **Do not write `order`.** Do not write `edited` or `snapshot-id`.
3. Tell the writer: "The scene is in the binder under **Unfiled**. Open its menu and choose **Add to manuscript**, or drag it to its place." Until they do, the scene is not part of the manuscript: it is not exported and not counted in the project total.

**Only when the writer asks you to place it yourself, and Obsidian is not busy syncing:**

Before, in the index:

```yaml
binder:
  - Manuscript/Prologue.md
  - folder: Part one - Arrival
    id: f-k3x9q2
    children:
      - Manuscript/The Last Ferry.md
      - Manuscript/A Room Above the Chandlery.md
```

After (the new scene second in Part one):

```yaml
binder:
  - Manuscript/Prologue.md
  - folder: Part one - Arrival
    id: f-k3x9q2
    children:
      - Manuscript/The Last Ferry.md
      - Manuscript/Tobias Counts the Boats.md
      - Manuscript/A Room Above the Chandlery.md
```

1. Make the note as above, first.
2. Read the index again. Insert **one line**: the path `Manuscript/<Title>.md`, as a list entry with the same indentation as its neighbours, at the wanted place (at the top level, or inside a folder's `children`). Quote the path if the title contains a colon followed by a space, or starts with a character YAML treats specially.
3. Change nothing else in the index: no other entry, no folder `id`, no other key, not the body.
4. Do not add an `order` to the scene and do not renumber the others. Spellbook writes the numbers the next time the binder is changed in Obsidian.
5. Read the index back and check it against section 17.

Never do by hand, even when asked, without first explaining the risk: adding, renaming, moving or removing a binder **folder**; moving or removing a scene's entry; renaming or deleting a scene file. All of these are one click in Spellbook's binder, which also keeps links, order numbers and snapshots right. Ask the writer to do them there.

## 15. Rules

### Never touch

- **`Stats/`**: the daily word logs. Read only.
- **`Snapshots/`**: read only. No edits, no new files, no renames, no deletes.
- **`order`** on any scene: never write, change, remove or "tidy" it.
- **`snapshot-id`** on any scene: never write, change or remove it.
- **`created` and `edited`** on an existing scene.
- **The index's structure** beyond the edits in section 14: no folder ids, no reordering, no `version`, no `spellbook`, no `entityTypes`, no `calendar`, no unknown keys. Never the index's body.
- **`Exports/`** and **`AI helper/`**.
- **Conflicting copies** left by the sync service (a note with the same name and " 2" before `.md`).
- **Anything outside the project folder.**

### The writer's text

- Never rewrite, reformat, "clean up" or translate a scene's body unless the writer asks for that scene. When they do, change what they asked for and nothing around it.
- The same goes for the body of an event, an entity, a research note and the index.
- Keep `%% comments %%` in a body exactly as they are. They are the writer's private notes, they are not counted and not exported.
- Do not add headings, tags, links or front matter of your own design "to be helpful".
- Never delete a note. If something should go, tell the writer, who deletes it in Spellbook (it goes to the trash).

### Frontmatter must stay valid YAML

- One `---` line at the very top of the file, one after the last property. Nothing before the first.
- `key: value`, one per line; two spaces of indentation for nested lines; never tabs.
- Put a value in double quotes when it contains a colon followed by a space, or a `#` after a space, or starts with one of `[ ] { } , & * ! | > ' " % @` or a backtick, or is a word YAML reads as something else (`yes`, `no`, `true`, `false`, `null`, a bare number that should be text). Inside double quotes, write `\"` for a quote and `\\` for a backslash.
- Keep the type of a value: a number stays a number (`target: 1500`), a true/false stays one (`compile: true`), a list stays a list.
- Do not put comments (`# ...`) in frontmatter. Obsidian rewrites the block when a property changes, and comments are lost.
- A file that fails to parse loses all its properties in Obsidian's eyes; for the index that means a read-only project.

### Links

- Keep links as plain wikilinks: `[[Name]]` or `[[Name|label]]`. In frontmatter, always inside double quotes: `"[[Name]]"`.
- **Never write an unquoted `[[Name]]` in frontmatter.** YAML reads it as a list inside a list, and Spellbook's World screens then do not see the entry.
- Do not turn wikilinks into Markdown links, and do not add `.md` to a target.
- Do not "fix" a link that seems broken by renaming the note. Tell the writer.

### Names of files

A title becomes a file name. It must not contain `\ / : * ? " < > | # ^ [ ]`, must not start with a dot, must not end with a dot or a space, and must be 200 bytes or less in UTF-8 (about 100 Hebrew letters). Two names that differ only in capitals are the same file on the writer's devices.

### Hebrew and English

The writer writes in Hebrew and English. Titles, synopses, names, labels, fields and bodies may be in either, or mixed. Text direction is automatic: each piece of text takes the direction of its own language. So:

- Write Hebrew as plain Hebrew. Do not add direction marks or other invisible characters, and do not wrap text in HTML to set a direction.
- Keep the language of what you are editing. Do not translate unless asked.
- YAML keys, type ids, colour names and date formats stay as documented here, in English, whatever the language of the values.
- Hebrew file names are fine and common.

### Sync

The vault syncs over iCloud, and another device may change any file at any time.

- Read a file again immediately before writing it. If it changed since you last read it, start over from the new text.
- Write small: the fewest files, the fewest lines. One careful edit is better than a sweep.
- **Never mass-rename, mass-move or mass-rewrite.** Do not rename or move files from outside Obsidian at all: Obsidian updates links and the binder only for renames made inside it. A file renamed behind its back becomes a Missing scene and an Unfiled note.
- Do not change many notes in one go without the writer's say-so. Twenty scenes changed at once on a device that is still syncing can leave twenty conflicting copies.
- If you see a conflicting copy, stop and tell the writer.

## 16. Asking the writer first

Ask before anything that cannot be undone by reading the file back, or that changes more than the one thing requested. In particular, ask before:

- changing the body of any note;
- changing more than a few notes in one request;
- changing the index in any way;
- anything in section 15's "never" list that the writer seems to be asking for;
- creating a note whose name is close to an existing one;
- anything this file does not describe.

How to ask. Use plain words; the writer is not a programmer. Say:

1. **What** you would change, by the names they know: "the scene *The Last Ferry*", not a path.
2. **Exactly how**: show the lines before and after.
3. **What could go wrong**, in one sentence, if anything could.
4. **The safer way**, when Spellbook has a button for it: "You can also do this in the binder: open the scene's menu and choose Rename."

Then wait for a clear yes. A yes covers the change you showed and nothing more.

Before changing a scene's body, suggest a snapshot: "Run **Spellbook: Take snapshot** on this scene first, so the current text is saved." Do not proceed on prose edits to several scenes until the writer has had the chance.

If a request is one of the things Spellbook does better itself, say so and give the command:

| The writer wants | Tell them |
| --- | --- |
| A new scene in a certain place | Binder: **New scene**, or the command **New scene**. |
| To rename, move, reorder or delete a scene or folder | The binder's menus, or drag. |
| A new status, label or their colours | **Manage statuses and labels**. |
| A new timeline lane | Timeline, **Lanes**. |
| A new entity type, or other fields for a type | World, **Entity types**. |
| A different story calendar | **Edit story calendar**. |
| Project or daily targets | **Set writing targets**. |
| A saved version of a scene | **Take snapshot**. |
| A file to send to a reader | **Export manuscript**. |

## 17. Checklist after an edit

Run this after every write, on each file you changed.

1. Read the file back. It starts with `---` on the first line and the frontmatter closes with `---`.
2. The frontmatter parses as YAML, and holds every key it held before, with the same values, except the ones you meant to change.
3. `order`, `snapshot-id`, `created`, `edited` and `spellbook` are exactly as they were (or absent, on a note you created).
4. Every link in frontmatter is in double quotes, has the form `[[Name]]` or `[[Name|label]]`, and leads to a note that exists.
5. The body is byte for byte what it was, unless the body was the request.
6. Every `status` and `label` you wrote is a name from the index's lists. Every lane you wrote is in `timelines`. Every `type` is a known type id.
7. Every date you wrote fits the project's calendar: real-world form without a `calendar` key, era form with one.
8. If you touched the index: `spellbook: project` and `version` are unchanged; `binder` is a list; every entry is a path or a map with `folder`, `id` and `children`; no path appears twice; every folder `id` is as before; the body is untouched.
9. You created no file in `Stats/`, `Snapshots/`, `Exports/` or `AI helper/`, renamed nothing, and deleted nothing.
10. Tell the writer, in a sentence or two, what you changed and in which notes. If you added a scene by the default recipe, remind them it waits under **Unfiled**.

If any check fails, put the file back to what it was before your edit and tell the writer what happened.
