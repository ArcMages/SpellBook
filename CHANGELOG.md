# Changelog

What changed in each version of Spellbook, newest first.

## Unreleased

New:
- Revision tools: notes on passages (a dotted underline and a bubble), the Revision pane, Find and replace in the manuscript, and Rename everywhere for World entries. Each changed scene is saved as a snapshot first.
- Chapters and scenes: a note can be a whole chapter, marked in the binder and on the corkboard. A project says whether you usually write in scenes or chapters. The novel view and the export give chapter notes their own headings, and a folder of chapters becomes a part.
- Ages: Born, Died and Age at the top of a character's sheet, worked out at the story's present. Scenes show each character's age, and a warning when someone is not born yet or already dead.
- Timeline: Filter by tags, and Views (Story, World history, and views you save).
- Plot grid: each plotline is shaded before its first scene and after its last, with a setting to turn it off.
- World sheet: "Nicknames and other names" under the picture.
- Export: type the book's own headings, and a "Manuscript exported" window with the file's name and folder.
- Settings: Layout (Automatic, Touch, Desktop) for each device; where renames update links (this project or the whole vault); where Hemingway mode allows undo.

Changed:
- Renames never stall: Spellbook points every link at the new name itself, so Obsidian's "Update links" question never comes up.
- Revision notes are kept in one file per project, "Revision notes.json", instead of in the scenes.
- A tap on a World card or row, its name included, opens the sheet.
- Dragging an entity on the timeline moves its moments with it.
- The tour on a phone slides out the drawers and says where each pane is.
- One rule everywhere: the week starts on the same day in the calendar and "This week", reading time is 250 words a minute, and a hyphenated word counts as one word on every device.
- The sample novel has 25 scenes in its timeline lanes, so the plot grid's lanes have something to show.

Fixed:
- Board cards turned into notes are no longer undone by a board open in Canvas, and relationship-map labels have room.
- Taking out the last lane or entity removes the property instead of leaving an empty list.
- A part heading in a web page stays larger than a chapter heading.
- The "Create project" window keeps the line above "I usually write in" and "Structure".
- Smaller fixes on the timeline and in the export window.

Faster:
- Tested on a full-length novel: about 80,000 words in 290 scenes, with 200 World entries and 300 timeline events.
- Obsidian now starts in under a second with Spellbook on such a book, where it used to freeze for about three seconds.
- Opening the inspector and working with the World open no longer pause for one or two seconds; they now take a tenth of a second or less.
- Every screen opens in about half a second or less, and typing stays smooth (well under a hundredth of a second a key) with prose checks, typewriter and the bottom bar all on.
- Replacing a word across the whole book is quicker, and the stylesheet is half the size.

## 0.10.0 (14 October 2026)

New:
- Plot grid: scenes against plotlines, labels, characters or places, with gaps marked.
- Idea boards on Obsidian's Canvas: turn cards into scenes or World entries, and boards drawn for you (relationship map, a chapter as cards, the web around one entity).
- Templates: project structures (three acts, a fifteen-beat outline, the hero's journey, chapter by chapter), scene and World templates, and saving your own.
- Welcome page, a short tour, a Help pane, and this note after each update.
- Time in the World: dates and moments on characters, places and lore, a History on each sheet, world lanes on the timeline, and "Open world history".
- Export: e-book (EPUB), presets, front and back matter, and a page break or title per scene.

Changed:
- A tap on a World card opens its sheet; a tap on its name opens the note. Other names are edited on the sheet.
- The sample novel is in English only. Hebrew and right-to-left text remain fully supported.
- Sheet fields no longer cut off long text.

## 0.9.0 (14 October 2026)

The first tester release.

- Organise: binder, corkboard, outliner, inspector.
- Write: writing modes (Zen, letter box, typewriter, Hemingway), novel view, prose checks, colour schemes.
- Track: word counts and a bottom bar you arrange, targets, calendar and to-dos, writing report.
- Plan the story: timelines, invented calendars, and a world of characters, places, factions, items, lore, creatures and cultures, with sheets, relations and pictures.
- Keep and share: snapshots, and export to Word, web page, Markdown or a page to print as PDF.
- A reference for AI assistants, and the command "Create AI helper note".
- Hebrew and English, with right-to-left text.

Checked on a Mac and in Obsidian's phone layout. Not yet tried on a real iPhone or iPad.

Later, with no version yet: maps.
