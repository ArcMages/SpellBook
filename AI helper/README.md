# AI helper

This folder holds one file: [Spellbook for AI assistants.md](Spellbook%20for%20AI%20assistants.md).

It is written for an AI assistant, not for you. It tells the assistant what the files of a Spellbook project mean, how to read your book in the right order, which changes are safe to make, and what it must never touch. With it, an assistant can help with your novel without breaking the project. It works with any assistant.

You do not need this file to use Spellbook. It is only for when you want an assistant's help.

## Three ways to use it

**1. Paste it into a chat.** Open the file, copy all of it, and paste it into a chat with your assistant before your first question. Then paste or attach the notes you want help with. This suits questions about a few scenes, and nothing in your vault can be changed this way.

**2. Point a coding assistant at the vault.** If you use an assistant that can read and change files on your computer, open it in your vault's folder and tell it: "Read `AI helper/Spellbook for AI assistants.md` first, then help me with the project in `My Novel`." This suits work across the whole book. The assistant can change files, so read the note below first.

**3. Use the command in Obsidian.** Run **Spellbook: Create AI helper note**. It puts a copy of the file inside the open project, at `AI helper/Spellbook for AI assistants.md`, and offers to open it. The copy travels with your project to every device, so an assistant that reads the project folder finds it there. If the project already has a copy that you changed, Spellbook asks before replacing it.

## Things you might ask

- "Read the manuscript in order and tell me where the pacing drags."
- "List the scenes that are still marked First draft, with their word counts."
- "Which scenes is Mara in? And which scenes mention her without listing her?"
- "Build a timeline of everything that happens to Tobias, in story order."
- "Summarise Part two, one line per scene."
- "Write a synopsis for each scene that has none. Show me them before you save anything."
- "Add a to-do: check the tide tables, due next Friday."
- "Make a character note for the harbour master from what the scenes say about him. Leave empty what the scenes do not say."
- "Add the legend of the drowned village to the world, and relate it to the village and to the old lighthouse."

## Before you let an assistant change files

- The file tells the assistant to ask you before it changes the text of a scene, and to show you what it will change. Hold it to that.
- Take a snapshot of a scene (**Spellbook: Take snapshot**) before an assistant rewrites it.
- Let your vault finish syncing first, and do not write on another device while the assistant works.
- Keep your own backup of the vault. An assistant can make mistakes that this file cannot prevent.
- Words an assistant adds do not show in your daily word counts or your writing streak. Those count only what is typed in Obsidian. The project's total does include them.
- Moving, renaming and deleting scenes, and changing the order of the book, are best done by you in Spellbook's binder. The file tells the assistant to leave them to you.

## For developers

The Markdown file here is the source of the text. The plugin ships the same text: `npm run build` copies it into `src/features/aihelper/referenceText.ts`, and a test fails when the two differ. To change the reference, edit the Markdown file and build.
