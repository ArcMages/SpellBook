# Installing Spellbook

Spellbook is in a tester period. It is not in Obsidian's community plugin list yet, so it is installed in one of the two ways below. Both give the same plugin.

Spellbook has not yet been tried on a real iPhone or iPad. It is built to work there, and testing it there is part of what testers are asked to do.

## What you need

- Obsidian 1.8.7 or newer, on a Mac, a Windows or Linux computer, an iPhone or an iPad.
- A vault to try it in. For a first try, make a new empty vault rather than using the one that holds your writing.
- For the first way: a GitHub account that has been invited to the Spellbook repository.

## Way 1: with BRAT (updates by itself)

BRAT is a free Obsidian plugin for installing plugins that are still in testing. It works on computers, iPhones and iPads, and it fetches new test versions for you.

### Step 1: accept the invitation

The Spellbook repository is private during the tester period. You will get an email from GitHub inviting you to `ArcMages/SpellBook`. Open it and accept. If you have no GitHub account, make a free one first with the same email address.

### Step 2: make an access token

Because the repository is private, BRAT needs a token that proves you were invited. You do this once.

1. On github.com, open your profile picture, then **Settings**, then **Developer settings**, then **Personal access tokens**, then **Fine-grained tokens**.
2. Choose **Generate new token**. Give it a name such as "Spellbook testing" and an expiry date.
3. Under **Repository access**, choose **Only select repositories** and pick `ArcMages/SpellBook`.
4. Under **Permissions**, **Repository permissions**, set **Contents** to **Read-only**.
5. Generate the token and copy it. GitHub shows it only once. Treat it like a password.

If GitHub does not list `ArcMages/SpellBook` for a fine-grained token, make a classic token instead (**Tokens (classic)**, with the **repo** box ticked).

### Step 3: install BRAT

1. In Obsidian, open **Settings**, then **Community plugins**. If asked, turn on community plugins.
2. Choose **Browse**, search for **BRAT**, install it and enable it.

### Step 4: add Spellbook

1. Open **Settings**, then **BRAT**.
2. Put your token where BRAT asks for a GitHub personal access token. (Depending on the BRAT version, this is a field in BRAT's settings or a field in the window of the next step.)
3. Choose **Add beta plugin** and paste `https://github.com/ArcMages/SpellBook`.
4. Leave the version on the latest and confirm. BRAT downloads Spellbook and enables it.

### Step 5: check it works

Open the command palette (Cmd+P or Ctrl+P on a computer; pull down, or use the toolbar button, on a phone) and type "Spellbook". Run **Spellbook: Create sample project**. A sample novel appears, with every screen filled in.

### Updates

BRAT checks for new test versions when Obsidian starts. To check by hand, run the command **BRAT: Check for updates to all beta plugins**.

## Way 2: by hand (three files)

Use this if you were sent the files instead of an invitation, or if you prefer not to use BRAT. A Spellbook release is three files: `main.js`, `manifest.json` and `styles.css`.

### On a computer

1. In Obsidian, open **Settings**, then **Community plugins**, and turn on community plugins if asked.
2. Open your vault's folder in Finder or File Explorer. Inside it is a hidden folder named `.obsidian`. On a Mac, press Cmd+Shift+. (full stop) in Finder to show hidden folders.
3. Inside `.obsidian`, open `plugins` (make the folder if it is not there), and inside it make a folder named exactly `spellbook-novel-writer`.
4. Put the three files in that folder.
5. Back in Obsidian, open **Settings**, then **Community plugins**, press the refresh button beside "Installed plugins", and switch **Spellbook** on.

### On an iPhone or iPad

The Files app does not show the hidden `.obsidian` folder, so the simplest way is through a computer:

- If your vault is in iCloud: do the steps above on a Mac, in the vault's folder under **iCloud Drive**, then **Obsidian**. Wait for iCloud to finish, open Obsidian on the phone, and switch Spellbook on in **Settings**, then **Community plugins**. Each device has its own switch.
- If your vault is only on the phone, use Way 1 with BRAT.

### Updates by hand

Replace the three files with the new ones, then switch Spellbook off and on in **Settings**, then **Community plugins**.

## After installing

- New to Spellbook: follow the [tutorial](tutorial.md).
- Every screen and command: the [guide](guide.md).
- Colours, shortcuts and the bottom bar: [customising](customising.md).

## Reporting a problem

Open an issue at `https://github.com/ArcMages/SpellBook/issues` and say:

- what you did, what you expected and what happened;
- your device (Mac, Windows, iPhone, iPad) and your Obsidian version (**Settings**, then **About**);
- the Spellbook version (**Settings**, then **Spellbook**, first line);
- a screenshot if the problem is something you can see.

Your writing stays on your devices: Spellbook sends nothing anywhere. Do not paste private text into an issue; a few made-up lines that show the problem are enough.

## Removing Spellbook

Switch it off in **Settings**, then **Community plugins**, and uninstall it there (or remove it in BRAT's settings). Your project folders and notes stay exactly as they are: they are plain markdown notes that open without the plugin.

## If something goes wrong

- **"Spellbook" does not appear in the plugin list.** The folder must be named `spellbook-novel-writer` and hold the three files directly, not inside another folder.
- **BRAT says it cannot find the repository.** The invitation was not accepted yet, or the token does not include `ArcMages/SpellBook`, or the token has expired.
- **The plugin is on but nothing happens.** Spellbook's screens need a project. Run **Spellbook: Create sample project** or **Spellbook: Create project**.
- **It works on the Mac but not on the phone.** Switch it on in the phone's own **Community plugins** settings, and give iCloud time to bring the files across.
