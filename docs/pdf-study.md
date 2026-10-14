# Can Spellbook write a real PDF itself?

A study for version 1.1 of the export. The question: can the plugin make a
real PDF file by itself, in plain TypeScript, on every device (computer,
iPhone, iPad), with Hebrew text set right to left? And if not, what is the
best way to a PDF?

## Short answer

An English-only PDF is possible at a reasonable cost. A PDF with Hebrew in it
is not, at a quality we would accept, without weeks of work and a larger
plugin. The browser's "Save as PDF" already sets Hebrew correctly, so
Spellbook keeps that route and makes it easier to use. No PDF writer has been
built.

## What a PDF needs

A PDF is a file of numbered objects (pages, fonts, streams of drawing
commands) with an index of where each object starts. The format can be
written by hand, as the Word and EPUB exports already are; the zip and XML
work there is of the same size. Writing the file is not the hard part.
Setting the text is: a PDF does not lay out text. Every line has to be
measured, broken and placed by the program that writes the file, letter by
letter, in a font the file either names or carries inside it.

## English only

PDF readers must have 14 standard fonts, among them Times and Courier in
regular, bold, italic and bold italic. A PDF that uses them carries no font.
Their letters are those of Windows-1252: English and the Western European
accents, curly quotes and dashes. Nothing else can be drawn.

- **Measuring.** To break lines, the writer needs the width of every letter.
  Adobe publishes those tables (AFM files) for the 14 fonts and allows them
  to be used. For Times they come to about 4 x 230 numbers, a few kilobytes
  in the plugin. Courier needs no table: every letter is the same width, and
  12 point Courier, double spaced, is the classic manuscript look.
- **Work.** About 600 to 900 lines: page size and margins, line breaking,
  bold and italic runs, the line at the top of each page with its page
  number, the title page, chapters on new pages, scene breaks, the presets,
  and tests that open the file again. One to two weeks of careful work.
- **Size.** About 15 to 25 KB added to the plugin (main.js is about 940 KB
  today).
- **Quality.** Good for a manuscript: plain, even lines. No kerning, no
  hyphenation. Justified lines are possible but look worse than a browser's.
- **What breaks.** Any letter outside Windows-1252: Hebrew, Greek, Cyrillic,
  many symbols and emoji. The export would have to look at the text first and
  refuse ("this manuscript has letters this PDF cannot show; use Print / save
  as PDF"), because drawing them wrongly is not acceptable. For a writer who
  writes in both languages, that refusal would come often.

## With Hebrew

Five things are needed, none of them small.

1. **A font with Hebrew letters, inside the plugin.** Obsidian ships no font
   we may rely on or pass on, and a PDF cannot borrow the device's fonts.
   Free candidates under the SIL Open Font License, which allows bundling
   with an MIT plugin when the licence text goes with it: Noto Serif Hebrew,
   Frank Ruhl Libre, David Libre, Alef. (The Culmus fonts are GPL with a font
   exception, also usable.) A regular and a bold face with Hebrew and Latin
   letters come to roughly 150 to 400 KB as files, a third more once packed
   into main.js: the plugin would grow by a fifth to a half. These sizes are
   estimates; they could not be checked here without downloading the fonts.
   Hebrew fonts have no true italic, so italics would be faked by slanting.
2. **Reading and cutting down the font.** Embedding a whole font in every PDF
   is wasteful; the usual way is to keep only the letters used. That means
   reading the font's tables (character map, outlines, widths) and writing a
   smaller font: about 1,000 to 1,500 lines.
3. **Right-to-left order.** A PDF draws letters left to right. Every line
   that mixes Hebrew with English, numbers or brackets has to be put into the
   order the eye sees, after the line is broken, by the Unicode bidirectional
   algorithm, with mirrored brackets. About 500 to 800 lines, and easy to get
   subtly wrong on punctuation at the ends of lines.
4. **Vowel points (niqqud).** Pointed Hebrew needs each mark placed under or
   over its letter, which a font describes in tables that only a shaping
   engine reads. The standard engine (HarfBuzz) exists for the web only as a
   WebAssembly module, which would be a new dependency of several hundred
   kilobytes. Without it, points land in the wrong places.
5. **Copying and searching.** For the text to be copied out of the PDF in the
   right order, the file needs a table from letters back to text, and, for
   right-to-left lines, care that copying does not reverse the words.

Work: several weeks, with real risk of wrong-looking Hebrew that the tests
here could not catch, because they cannot look at a page. Cost: a much larger
plugin. And the browser already does all of this well.

## What the browser's route gives

"Print / save as PDF" makes a web page laid out for paper and opens it in the
browser, where "Save as PDF" writes the file. The browser has the device's
fonts, sets Hebrew right to left, places vowel points and keeps the text
searchable. On a phone or tablet the same page is printed from the browser's
or the Files app's share menu. What it costs: a few more taps, and in Safari
the line at the top of each page (author, title, page number) is left out,
because Safari does not print that part of the page rules.

## What was done in 1.1

- The page made for printing now says, at its top, what to choose in the
  print window: the paper (A4 or US Letter, upright), the margins ("Default",
  which keeps the page's own margins) and "Headers and footers" off, so the
  browser adds no address or date of its own.
- The page's margins follow the preset: one inch for a manuscript and a
  reading copy, two inches at the sides for a proof. On the screen the text
  is as wide as it will be on paper.
- A reading copy prints with book-like spacing and lines flush with both
  margins.

## Recommendation

Keep the print route as the way to a PDF, for both languages. Do not build a
Hebrew PDF writer. A Latin-only PDF ("PDF (English text only)") could be
added later if the owner wants a one-tap PDF for English submissions; agents
mostly ask for Word files, which Spellbook already makes, so it is not worth
its cost now.
