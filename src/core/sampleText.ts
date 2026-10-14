// The words of the sample project.
//
// Everything in this file was written for Spellbook as placeholder prose; none
// of it is taken from a published work. It is only data: sampleProject.ts
// turns it into a project.
//
// The sample novel is set in Saltwick, a small harbour town. Mara has come to
// redraw the sea chart after a storm moved the coast, Tobias runs the ferry,
// and Noa keeps the town archive and writes home to her sister Ellen.

/** The three point-of-view characters; scenes are labelled with these names. */
export const SAMPLE_CHARACTERS = ['Mara', 'Tobias', 'Noa'] as const;

/** Index into SAMPLE_CHARACTERS. */
export type SampleCharacter = 0 | 1 | 2;

/** Index into SCENE_STATUSES: 0 To do, 1 First draft, 2 Revised, 3 Final. */
export type SampleStatus = 0 | 1 | 2 | 3;

export interface SampleScene {
  readonly title: string;
  readonly who: SampleCharacter;
  readonly status: SampleStatus;
  /** About how many words to write for it. Ignored when `text` is given. */
  readonly words: number;
  readonly synopsis: string;
  /** Finished text, for the scenes that are not put together from the sentences below. */
  readonly text?: string;
}

export interface SamplePart {
  readonly folder: string;
  readonly scenes: readonly SampleScene[];
}

const MARA = 0;
const TOBIAS = 1;
const NOA = 2;
const TODO = 0;
const DRAFT = 1;
const REVISED = 2;
const FINAL = 3;

function scene(
  title: string,
  who: SampleCharacter,
  status: SampleStatus,
  words: number,
  synopsis: string,
  text?: string,
): SampleScene {
  return text === undefined ? { title, who, status, words, synopsis } : { title, who, status, words, synopsis, text };
}

// ------------------------------------------------------- Noa's own scenes

const LETTER_TO_MY_SISTER = [
  `Dear Ellen,`,
  `I am writing from the small room above the archive, by a window that faces the harbour. The sea is grey in the morning, blue only towards noon, and dark as ink by evening. Three weeks here, and I still cannot tell whether the town has taken me in or only puts up with me.`,
  `People here say little and remember everything. Every evening I count the boats coming home, and one always seems missing.`,
  `I found an old map in the archive. It shows a church and seven houses where there is only water now. I asked the ferryman about it, and he looked at the sea and did not answer. I think the town is keeping a secret.`,
  `Do not worry about me. I sleep well and eat well. I have kept a small white shell for you. When I come home I will tell you everything, at the table in Mother's kitchen.`,
  `Love,\nNoa`,
].join('\n\n');

const NIGHT_BEFORE_THE_STORM = [
  `The barometer in the harbour office fell all day, and nobody spoke of it. The fishermen doubled their ropes, and the baker shut early. I stood at the window and watched the light go out of the sky like water at the ebb.`,
  `On a night like this the town is too quiet. No steps on the quay, only the ferry bell through the fog, again and again.`,
  `I lit a candle and read the keeper's log again. On the last page he writes that the sea always gives back what it took, only not in the same place and not in the same shape. I cannot tell if that is a comfort or a warning.`,
  `Before midnight a lamp was lit in the empty house. I wanted to go and look, but the wind was already at the door, and I stayed.`,
].join('\n\n');

// ------------------------------------------------------------------- outline

/** The scene before the first binder folder. */
export const SAMPLE_OPENING: SampleScene = scene(
  'Prologue',
  TOBIAS,
  FINAL,
  340,
  'A winter storm moves the sandbars overnight, and by morning the old chart is no longer true.',
);

/** The five binder folders and their scenes. */
export const SAMPLE_PARTS: readonly SamplePart[] = [
  {
    folder: 'Part one - Arrival',
    scenes: [
      scene('The Last Ferry', MARA, FINAL, 1180, 'Mara crosses to Saltwick on the last ferry of the day and meets Tobias at the wheel.'),
      scene('A Room Above the Chandlery', MARA, FINAL, 620, 'Mara takes a draughty room over the chandlery and unpacks her instruments.'),
      scene('What the Harbour Master Wants', MARA, FINAL, 870, 'The harbour master gives Mara six weeks to redraw the chart of the bay.'),
      scene('Tobias Counts the Boats', TOBIAS, FINAL, 450, 'Tobias counts the boats in at dusk and comes up one short.'),
      scene('The Archive Door', NOA, FINAL, 760, 'Noa opens the archive for the first time since the storm and finds the lower shelves wet.'),
      scene('First Soundings', MARA, REVISED, 1040, 'Mara and Tobias take the first depth soundings and find that the channel has moved.'),
      scene('Bread and Rumours', NOA, FINAL, 390, 'At the bakery Noa hears three different stories about the missing boat.'),
      scene('The Chart That Lies', MARA, REVISED, 930, 'Mara compares the old chart with the shore and marks every place where it is wrong.'),
      scene('Lamp in the Empty House', TOBIAS, FINAL, 540, 'Tobias sees a lamp burning in a house that has been shut for years.'),
    ],
  },
  {
    folder: 'Part two - The Survey',
    scenes: [
      scene('Low Water', MARA, REVISED, 1200, 'At the lowest tide of the month Mara walks out onto the new sandbar.'),
      scene("The Keeper's Log", NOA, REVISED, 810, "Noa finds the old lighthouse keeper's log among the damp ledgers."),
      scene('A Line of Stakes', TOBIAS, FINAL, 480, 'Tobias helps Mara set a line of stakes across the flats before the tide turns.'),
      scene(
        'A Letter to My Sister',
        NOA,
        REVISED,
        0,
        'Noa writes to her sister about the town, the sea and an old map she found in the archive.',
        LETTER_TO_MY_SISTER,
      ),
      scene('Names of the Rocks', MARA, REVISED, 700, 'An old fisherman teaches Mara the local name of every rock in the bay.'),
      scene('The Village on the Old Map', NOA, FINAL, 990, 'Noa finds a map that shows a village where there is now only water.'),
      scene('Fog on the Crossing', TOBIAS, REVISED, 660, 'Fog closes in mid-channel and Tobias steers by the sound of the bell.'),
      scene('An Argument About North', MARA, DRAFT, 570, 'Mara and Tobias disagree about where the channel really runs.'),
      scene("The Baker's Daughter", NOA, REVISED, 430, "The baker's daughter tells Noa what she saw from the sea wall on the night of the storm."),
      scene('Triangles', MARA, DRAFT, 300, 'Mara spends a whole day measuring angles from the church tower.'),
      scene('What Tobias Did Not Say', TOBIAS, REVISED, 890, 'Tobias almost tells Mara why he was out on the water that night.'),
    ],
  },
  {
    folder: 'Part three - Low Tide',
    scenes: [
      scene('The Drowned Lane', MARA, REVISED, 1100, 'At a spring tide the stones of an old lane show under the water.'),
      scene('Pages Out of Order', NOA, DRAFT, 640, "Noa realises that pages have been cut from the keeper's log."),
      scene('Mending Nets', TOBIAS, DRAFT, 520, 'Tobias mends nets with his uncle and asks about the village that is gone.'),
      scene('Ink and Salt', MARA, DRAFT, 360, "Mara's first draft of the new chart is ruined by a leaking roof."),
      scene('The Missing Boat', TOBIAS, REVISED, 950, 'The missing boat is found, empty, on the far side of the bar.'),
      scene('A Second Lamp', NOA, DRAFT, 780, 'Noa and Tobias watch the empty house to see who lights the lamp.'),
      scene('Depths by Candlelight', MARA, DRAFT, 410, 'Mara redraws the soundings by candlelight and notices a pattern.'),
      scene("The Harbour Master's Offer", MARA, DRAFT, 850, 'The harbour master asks Mara to leave one thing off the chart.'),
      scene('Under the Floorboards', NOA, REVISED, 590, 'Noa finds the missing pages hidden in the archive itself.'),
      scene('Slack Water', TOBIAS, DRAFT, 270, 'Tobias takes the ferry out at slack water to look at the drowned lane.'),
    ],
  },
  {
    folder: 'Part four - The Storm',
    scenes: [
      scene('Glass Falling', MARA, DRAFT, 730, 'The barometer falls all morning and the town begins to tie things down.'),
      scene(
        'The Night Before the Storm',
        NOA,
        DRAFT,
        0,
        "Noa waits for the storm, reads the keeper's log again and sees a light in the empty house.",
        NIGHT_BEFORE_THE_STORM,
      ),
      scene('The Last Crossing Before', TOBIAS, DRAFT, 1010, 'Tobias makes one more crossing than he should.'),
      scene('Sandbags', NOA, TODO, 210, 'Mara, Noa and half the town carry sandbags to the archive door.'),
      scene('The Bell Stops', MARA, DRAFT, 460, 'In the middle of the night the ferry bell stops ringing.'),
      scene('What the Keeper Wrote', NOA, DRAFT, 1150, 'Noa reads the missing pages aloud while the wind takes the shutters.'),
      scene('Adrift', TOBIAS, TODO, 180, 'Tobias loses the engine in the channel and lets the tide decide.'),
      scene('The Light', MARA, TODO, 240, 'Someone climbs the old lighthouse and lights it for the first time in years.'),
      scene('Between Two Bars', TOBIAS, DRAFT, 680, 'Tobias finds the new channel by feel and brings the ferry through.'),
      scene('Morning After', NOA, TODO, 130, 'The town counts its roofs and its boats.'),
      scene('A New Shore', MARA, TODO, 290, 'Mara walks the tideline and sees that the coast has moved again.'),
    ],
  },
  {
    folder: 'Part five - The New Map',
    scenes: [
      scene('Starting Over', MARA, DRAFT, 500, 'Mara throws away six weeks of work and begins the chart again.'),
      scene('The Honest Chart', MARA, TODO, 220, 'Mara decides to draw what is there, including what the harbour master wanted left out.'),
      scene('Tobias Tells It', TOBIAS, TODO, 330, 'Tobias finally tells Mara what he saw on the night of the first storm.'),
      scene('A Place for the Log', NOA, TODO, 110, "Noa finds a dry shelf for the keeper's log and writes its catalogue card."),
      scene('The Village Gets a Name', NOA, TODO, 160, 'The drowned village is written onto the new chart under its old name.'),
      scene('Proofs', MARA, TODO, 100, 'The proofs come back from the printer with one mistake.'),
      scene('The Ferry Timetable', TOBIAS, TODO, 140, 'Tobias rewrites the ferry timetable for the new channel.'),
      scene('Leaving on the Morning Tide', MARA, TODO, 260, 'Mara packs her instruments and says her goodbyes.'),
      scene('The Chart on the Wall', NOA, TODO, 190, 'The new chart is hung in the harbour office and the town comes to look.'),
    ],
  },
];

/** The scene after the last binder folder. */
export const SAMPLE_CLOSING: SampleScene = scene(
  'Epilogue',
  TOBIAS,
  TODO,
  120,
  'A year later a child points at the chart and asks about the village under the water.',
);

// ------------------------------------------------------------ sentence bank
//
// The English scenes are put together from these sentences. "{pov}" becomes
// the name of the scene's own character and "{other}" one of the other two.
// The sentences avoid "he" and "she", so they fit whoever they are given to.

/** The place: sea, weather, town. */
export const SETTING_SENTENCES: readonly string[] = [
  `The tide had gone out so far that the harbour looked like a mistake someone had forgotten to correct.`,
  `Gulls stood along the sea wall like a row of small grey judges.`,
  `The wind came off the water with the smell of salt, tar and wet rope.`,
  `Every boat in the harbour pointed the same way, as if they had all agreed on something.`,
  `The lighthouse stood at the end of the spit with its windows boarded and its door chained.`,
  `Rain had polished the cobbles until the street lamps lay in them like coins.`,
  `Out past the bar the sea changed colour, from the green of old glass to a flat and serious grey.`,
  `The church clock was eleven minutes slow, and nobody in Saltwick had ever thought to mend it.`,
  `Fog sat on the channel like a lid on a pot.`,
  `Somewhere below the quay a loose mooring ring knocked against the stone, patient as a visitor.`,
  `The sand was ribbed where the water had left it, and each ridge held a thin line of light.`,
  `Smoke rose from the chimneys along Net Street and leaned east with the wind.`,
  `The ferry bell rang twice, which meant the crossing would be rough but not impossible.`,
  `At low water the posts of a vanished pier stood up out of the mud like the teeth of a comb.`,
  `The chandlery window was full of things that had once been useful on a ship.`,
  `A line of weed marked how high the last storm had climbed up the wall.`,
  `The moon was thin that week and the tides were lazy, hardly bothering to come in at all.`,
  `Lamps were being lit one by one along the front, each a little later than the last.`,
  `The bakery opened before dawn, and the smell of bread reached the boats before the light did.`,
  `Shingle hissed as each wave drew back, the same word repeated without ever being finished.`,
  `The archive was a long room over the fish market, cold in every season.`,
  `On the flats the water returned quietly, filling the low places first and saying nothing about it.`,
  `Nets hung drying between the houses, and the lane beneath them was striped with shade.`,
  `The harbour office kept a barometer in a brass case, and people came in only to look at it.`,
  `A coil of rope lay on the slipway, stiff with frost.`,
  `Clouds were stacked over the headland in long shelves, darker at the bottom.`,
  `The channel buoys leaned with the current, all nodding in the same direction.`,
  `Beyond the last houses the road gave up and became a path, and the path became sand.`,
  `The water in the inner harbour was so still that the boats seemed to sit on their own reflections.`,
  `By four o'clock the light was already going, draining out of the sky toward the west.`,
  `A bell buoy sounded somewhere out in the grey, slow and without any hurry.`,
  `The sea wall had been repaired so many times that no two stones in it were the same age.`,
  `Spray came over the end of the quay and fell on the planks like a handful of thrown gravel.`,
  `Three cats waited where the fish were landed, each pretending not to know the others.`,
  `The old chart hung in the hallway, brown at the edges, confident and wrong.`,
  `Morning came up pale and windless, and the bay lay flat as a table.`,
  `The far shore was only a darker line, drawn once and never gone over.`,
  `Wet sand took a footprint, held it for a moment and then let it go.`,
  `In the square the market stalls were folded and stacked, waiting for Thursday.`,
  `A single window was lit at the top of the customs house.`,
];

/** Something the scene's own character does. */
export const ACTION_SENTENCES: readonly string[] = [
  `{pov} counted the steps down to the water, as always, and as always lost count near the bottom.`,
  `{pov} pulled the collar higher and walked into the wind.`,
  `{pov} wrote the figure down, looked at it, and wrote it again more carefully.`,
  `{pov} stopped at the corner and listened until the sound came a second time.`,
  `{pov} wiped the lens with a sleeve and looked again toward the bar.`,
  `{pov} had never been good at waiting, and the tide did not care.`,
  `{pov} unrolled the paper across the table and pinned its corners with four smooth stones.`,
  `{pov} held the lantern low and read the line twice.`,
  `{pov} tied the knot from memory, without looking at it.`,
  `{pov} stood for a long time at the window, watching the water rise in the lane.`,
  `{pov} folded the note in half, and then in half again, and put it away.`,
  `{pov} knelt and pressed a palm flat against the sand, as if the ground might have a pulse.`,
  `{pov} drank the tea while it was still too hot, because the cold was worse.`,
  `{pov} climbed the last flight slowly, one hand on the damp wall.`,
  `{pov} looked back once, and the town was already half hidden.`,
  `{pov} turned the page and found that the next one had been cut away.`,
  `{pov} measured the distance again with the brass dividers and got a different answer.`,
  `{pov} shook the rain from the coat and hung it by the stove.`,
  `{pov} lit the lamp and the room came back, one object at a time.`,
  `{pov} could not have said afterwards how long the crossing had taken.`,
  `{pov} made a small mark on the map where the water had been deepest.`,
  `{pov} waited for the wave to pull back and then ran across the gap.`,
  `{pov} said nothing, which in Saltwick was a way of agreeing.`,
  `{pov} checked the knots, then the lamp, and then the knots again.`,
  `{pov} woke before the bell and lay still, listening to the roof.`,
  `{pov} took the long way round by the sea wall, to have more time to think.`,
  `{pov} opened the ledger at the ribbon and began where the last entry ended.`,
  `{pov} crouched by the water and let the line run out through cold fingers.`,
  `{pov} found the key on its nail behind the door, exactly where it should not have been.`,
  `{pov} sat on an upturned crate and watched the boats come in.`,
];

/** Something between the scene's character and one of the others. */
export const SHARED_SENTENCES: readonly string[] = [
  `{other} was already on the quay, hands in pockets, looking at the sky as if it owed money.`,
  `{pov} passed the rope to {other} without being asked.`,
  `{other} laughed, shortly, and then looked as if the laugh had been a mistake.`,
  `{pov} watched {other} read the page and tried to guess which line had caused the frown.`,
  `{other} pointed with the stem of a pipe toward the place where the water broke white.`,
  `They walked the length of the sea wall without speaking, and it was not uncomfortable.`,
  `{other} handed over a paper bag, still warm, and would not take a coin for it.`,
  `{pov} held the end of the tape while {other} walked backwards across the sand, calling out numbers.`,
  `{other} shrugged in the way that people in Saltwick shrugged, with one shoulder only.`,
  `{pov} could tell from the set of {other}'s back that the news was not good.`,
  `{other} drew a line in the wet sand with a boot heel and said that the channel had once run there.`,
  `For a moment {pov} and {other} looked at the same patch of sea and saw different things.`,
  `{other} poured two cups without asking and pushed one across the table.`,
  `{pov} waited until {other} had finished coiling the line before asking the question.`,
  `{other} had a way of answering a question with the name of a place.`,
  `{pov} and {other} carried the box between them down the narrow stairs, turning it at each landing.`,
  `{other} held the door against the wind until {pov} was through.`,
  `When {pov} looked up from the chart, {other} was gone and the lamp was burning low.`,
  `{other} nodded toward the lighthouse and then seemed sorry for it.`,
  `{pov} wanted to ask {other} about the night of the storm, and asked about the weather instead.`,
];

/** Lines of speech; each becomes a paragraph of its own. */
export const DIALOGUE_LINES: readonly string[] = [
  `"You can't draw a thing that won't keep still," {other} said.`,
  `"It was deeper here last year," {other} said. "I'd have sworn to it."`,
  `"Ask me again at low water," {other} said, and turned back to the nets.`,
  `"Nobody goes out to the spit any more," {other} said. "There's no reason to."`,
  `"The chart says one thing and the sea says another," {pov} said. "I know which of them I'd believe."`,
  `"Then write that down," {other} said. "Write down that we don't know."`,
  `"My grandmother was born in a house that is under the water now," {other} said.`,
  `"Six weeks," {pov} said. "It isn't enough, and it's all there is."`,
  `"You'll want boots for that," {other} said, looking at {pov}'s shoes.`,
  `"Did you hear the bell last night?" {other} asked. "It rang with no one near it."`,
  `"There are older maps than this one," {other} said, "if you know who to ask."`,
  `"I'm only telling you what I saw," {other} said. "I'm not telling you what it means."`,
  `"Is it always this quiet?" {pov} asked. "Only before something," {other} said.`,
  `"Leave it till morning," {other} said. "Everything in this town looks worse by lamplight."`,
  `"Tide's turning," {other} said, though nothing {pov} could see had changed.`,
  `"You measure it your way," {other} said, "and I'll go on not running aground."`,
  `"Who lights the lamp in that house?" {pov} asked. {other} did not answer at once.`,
  `"It's a good map," {other} said. "It's just a map of somewhere else."`,
  `"Hold this," {pov} said, "and tell me when the line goes slack."`,
  `"People here remember everything," {other} said, "and talk about almost none of it."`,
  `"Bring it to the archive," {other} said. "Paper should not be kept near the sea."`,
  `"We'll know by Thursday," {pov} said, without believing it.`,
];

/** A thought, belonging to nobody in particular. */
export const REFLECTION_SENTENCES: readonly string[] = [
  `A map was a kind of promise, and this one had been broken by the weather.`,
  `It was strange how quickly a place could teach you its habits.`,
  `There were things the town knew about itself that it had never written down.`,
  `The sea did not take sides; it only kept moving, and that was enough to make trouble.`,
  `Every measurement was a small argument with the truth, and the truth usually won.`,
  `Nothing here was lost exactly, only put down somewhere else by the tide.`,
  `Perhaps the old chart had been right once, in the way that a stopped clock is right.`,
  `It was easier to count things than to understand them, and so the counting went on.`,
  `The coast was a sentence that the water kept revising.`,
  `Some questions were better asked outdoors, where the wind could carry off a bad answer.`,
  `Six weeks had sounded like a long time when it was said in an office.`,
  `What was a shoreline, after all, but an agreement that held until the next storm?`,
  `The work was slow, and its slowness was the only honest thing about it.`,
  `A town that lived by the tide learned not to trust anything that stayed the same.`,
  `Memory was the first map of any place, and the least reliable.`,
  `There would be time to be afraid later, when it was over.`,
  `The trouble with a secret in a small town was that everyone was helping to keep it.`,
  `Whatever had happened that night, the sand had already covered its share of it.`,
];

// ------------------------------------------------------------- other notes

/** A comment (not counted as words) put at the top of every scene that is still "To do". */
export const ROUGH_NOTES_COMMENT = '%% Rough notes only. This scene is still to be written. %%';

/** The note that is left out of the binder on purpose, so that it shows under Unfiled. */
export const SAMPLE_UNFILED = {
  title: 'The Night Market',
  body: [
    '%% Sample note: it is in the Manuscript folder but not in the binder, so Spellbook lists it under Unfiled. %%',
    'Twice a year the night market set up along the front, and for one evening the town forgot to be careful. There were lanterns on poles, chestnuts in paper cones, and a man who sold maps of places that did not exist.',
    'Mara bought one. It showed an island shaped like a sleeping dog, and it stayed folded in a coat pocket for the rest of the winter.',
  ].join('\n\n'),
} as const;

export const SAMPLE_RESEARCH = [
  {
    title: 'Tides and the bay',
    body: [
      '# Tides and the bay',
      'Notes for keeping the sea the same from one scene to the next.',
      [
        '- Two high tides and two low tides a day, a little over six hours apart.',
        '- Spring tides, the biggest, come just after the new moon and the full moon. Neap tides, the smallest, come in between.',
        '- The drowned lane only shows at the lowest spring tides.',
        '- The ferry cannot cross for an hour either side of low water.',
        '- Fog is most likely on a still morning after a cold night.',
      ].join('\n'),
    ].join('\n\n'),
  },
  {
    title: 'People of Saltwick',
    body: [
      '# People of Saltwick',
      [
        '- **Mara** makes sea charts. Sent to redraw the coast; careful, impatient, new to the town.',
        '- **Tobias** runs the ferry. Knows the sandbars by feel and keeps one secret.',
        '- **Noa** keeps the archive. Writes home to her sister Ellen.',
        '- The harbour master wants the chart finished in six weeks, with one thing left off it.',
        '- The old lighthouse keeper is gone before the story starts. His log is still in the archive.',
      ].join('\n'),
    ].join('\n\n'),
  },
] as const;

/** The three lines of To-do.md. A number is how many days from today the task is due. */
export const SAMPLE_TODOS: ReadonlyArray<{ readonly text: string; readonly done: boolean; readonly dueInDays?: number }> = [
  { text: 'Rewrite "Fog on the Crossing" from Tobias\'s side', done: false, dueInDays: 3 },
  { text: 'Check the tide times in "Low Water" against the research note', done: false, dueInDays: 10 },
  { text: 'Choose a name for the ferry', done: true },
];

// ------------------------------------------------ for the screens besides the binder
//
// Everything below gives the corkboard, the timeline and the planner
// something to show. There is no writing history here on purpose: which
// words were written on which day is the writer's own, and none is made up.

/** One of the eight colour names Obsidian offers; every screen draws them with the theme's own colours. */
export type SampleColor = 'red' | 'orange' | 'yellow' | 'green' | 'cyan' | 'blue' | 'purple' | 'pink';

/** The colour of each status, in the order of SCENE_STATUSES: To do, First draft, Revised, Final. */
export const SAMPLE_STATUS_COLORS: readonly SampleColor[] = ['red', 'orange', 'blue', 'green'];

/** The colour of each character's label, in the order of SAMPLE_CHARACTERS: Mara, Tobias, Noa. */
export const SAMPLE_LABEL_COLORS: readonly SampleColor[] = ['purple', 'cyan', 'pink'];

/** The three timelines (the lanes of the timeline screen), in the order they are shown. */
export const SAMPLE_TIMELINES: ReadonlyArray<{ readonly name: string; readonly color: SampleColor }> = [
  { name: 'Main plot', color: 'purple' },
  { name: "Mara's survey", color: 'cyan' },
  { name: 'Backstory', color: 'orange' },
];

const MAIN_PLOT = 0;
const SURVEY = 1;
const BACKSTORY = 2;

/** An event of the story: a note in the Timeline folder. */
export interface SampleEvent {
  readonly title: string;
  /** When it happens: YYYY-MM-DD, or YYYY-MM when only the month is known. */
  readonly date: string;
  /** The day it ends, for an event that lasts. */
  readonly end?: string;
  /** Indexes into SAMPLE_TIMELINES. */
  readonly timelines: readonly number[];
  /** The titles of the scenes that tell it. */
  readonly scenes?: readonly string[];
  readonly tags?: readonly string[];
  /** The names of the entities of the world that are in it (see SAMPLE_ENTITIES). */
  readonly entities?: readonly string[];
  /** The note's text. */
  readonly body: string;
}

/**
 * The ten events of the story, in the autumn and winter of 1923. Among them:
 * one that lasts six weeks (the survey), one that sits in two timelines
 * (Mara's arrival), one that names a tag of its own (the archive), and two
 * that are only known to the month. Nine of them say which entities of the world are in them.
 */
export const SAMPLE_EVENTS: readonly SampleEvent[] = [
  {
    title: 'The lighthouse is closed',
    date: '1922-11',
    timelines: [BACKSTORY],
    tags: ['lighthouse'],
    entities: ['The Old Lighthouse', 'The Keeper', 'The Logbook'],
    body: 'The keeper is pensioned off, the windows are boarded and the door is chained. His log goes to the archive.',
  },
  {
    title: 'The old chart is last corrected',
    date: '1923-02-10',
    timelines: [BACKSTORY],
    tags: ['chart'],
    entities: ['The Old Chart'],
    body: 'The last time anyone checked the chart of the bay against the bay itself.',
  },
  {
    title: 'The winter storm',
    date: '1923-10-12',
    timelines: [MAIN_PLOT],
    scenes: ['Prologue'],
    tags: ['storm'],
    entities: ['Saltwick'],
    body: 'One night moves the sandbars. By morning the channel is somewhere else and one boat has not come home.',
  },
  {
    title: 'Mara arrives in Saltwick',
    date: '1923-10-14',
    timelines: [MAIN_PLOT, SURVEY],
    scenes: ['The Last Ferry'],
    entities: ['Mara', 'Tobias', 'Saltwick'],
    body: 'On the last ferry of the day, with her instruments in two cases.',
  },
  {
    title: 'The survey of the bay',
    date: '1923-10-20',
    end: '1923-12-01',
    timelines: [SURVEY],
    scenes: ['First Soundings', 'Low Water'],
    tags: ['chart'],
    entities: ['Mara', 'The Harbour Master'],
    body: 'The six weeks the harbour master gives Mara to redraw the chart.',
  },
  {
    title: 'Noa finds the old map',
    date: '1923-11-05',
    timelines: [MAIN_PLOT],
    scenes: ['The Village on the Old Map'],
    tags: ['archive'],
    entities: ['Noa', 'The Archive', 'The Drowned Village', 'The Legend of the Drowned Village'],
    body: 'In the archive, among the damp ledgers: a map that shows a village where there is now only water.',
  },
  {
    title: 'The lowest tide of the month',
    date: '1923-11-08',
    timelines: [SURVEY],
    scenes: ['Low Water'],
    entities: ['Mara'],
    body: 'Mara walks out onto the new sandbar. The drowned lane does not show yet.',
  },
  {
    title: 'The missing boat is found',
    date: '1923-11-19',
    timelines: [MAIN_PLOT],
    scenes: ['The Missing Boat'],
    body: 'Empty, on the far side of the bar.',
  },
  {
    title: 'The second storm',
    date: '1923-12-03',
    timelines: [MAIN_PLOT],
    scenes: ['The Bell Stops', 'What the Keeper Wrote'],
    tags: ['storm'],
    entities: ['The Old Lighthouse', 'The Bell in the Fog'],
    body: 'The night the ferry bell stops, and someone lights the old lighthouse.',
  },
  {
    title: 'The new chart is published',
    date: '1924-03',
    timelines: [SURVEY],
    scenes: ['The Chart on the Wall'],
    tags: ['chart'],
    entities: ['The Drowned Village', 'The Legend of the Drowned Village'],
    body: 'With the drowned village on it, under its old name.',
  },
];

/** The scenes that have a date in the story, by title. They show on the timeline in the Manuscript lane. */
export const SAMPLE_SCENE_DATES: Readonly<Record<string, string>> = {
  Prologue: '1923-10-12',
  'The Last Ferry': '1923-10-14',
  'Low Water': '1923-11-08',
  'The Night Before the Storm': '1923-12-02',
};

/**
 * The timelines each scene is in, besides Manuscript, by title: a little
 * over a third of the scenes, so that the plot grid's lanes view shows how
 * the three threads run through the book. Main plot follows the storm, the
 * missing boat and the lamp; Mara's survey follows the chart; Backstory
 * follows the keeper's log and the drowned village. A scene that tells an
 * event is in that event's timelines; three scenes sit in two.
 */
export const SAMPLE_SCENE_TIMELINES: Readonly<Record<string, readonly number[]>> = {
  Prologue: [MAIN_PLOT],
  'The Last Ferry': [MAIN_PLOT, SURVEY],
  'What the Harbour Master Wants': [SURVEY],
  'Tobias Counts the Boats': [MAIN_PLOT],
  'First Soundings': [SURVEY],
  'The Chart That Lies': [SURVEY],
  'Lamp in the Empty House': [MAIN_PLOT],
  'Low Water': [SURVEY],
  "The Keeper's Log": [BACKSTORY],
  'A Line of Stakes': [SURVEY],
  'The Village on the Old Map': [MAIN_PLOT, BACKSTORY],
  Triangles: [SURVEY],
  'What Tobias Did Not Say': [MAIN_PLOT],
  'Pages Out of Order': [BACKSTORY],
  'Mending Nets': [BACKSTORY],
  'The Missing Boat': [MAIN_PLOT],
  'A Second Lamp': [MAIN_PLOT],
  "The Harbour Master's Offer": [SURVEY],
  'Under the Floorboards': [BACKSTORY],
  'The Bell Stops': [MAIN_PLOT],
  'What the Keeper Wrote': [MAIN_PLOT, BACKSTORY],
  'The Light': [MAIN_PLOT],
  'Starting Over': [SURVEY],
  'Tobias Tells It': [MAIN_PLOT],
  'The Chart on the Wall': [SURVEY],
};

/**
 * The scenes that have a word target, by title: about a third of them, so
 * that the outliner's Target column has every kind of row to show. A number
 * is the target in words; 'reached' gives the scene exactly as many words to
 * aim for as it has, so that it stands at 100 per cent whatever its text.
 *
 * The numbers are round and well away from the scenes' lengths: four scenes
 * have more words than their target, and ten have fewer (some nearly there,
 * some about half way, some barely begun).
 */
export const SAMPLE_SCENE_TARGETS: Readonly<Record<string, number | 'reached'>> = {
  Prologue: 300,
  'The Last Ferry': 1000,
  'What the Harbour Master Wants': 'reached',
  'First Soundings': 1200,
  'Lamp in the Empty House': 'reached',
  'Low Water': 1400,
  'A Letter to My Sister': 'reached',
  'The Village on the Old Map': 900,
  'An Argument About North': 1000,
  Triangles: 800,
  'The Drowned Lane': 'reached',
  'Mending Nets': 900,
  'The Missing Boat': 800,
  'The Night Before the Storm': 250,
  'What the Keeper Wrote': 1300,
  Adrift: 900,
  'Starting Over': 600,
  'The Honest Chart': 1000,
};

/** The two marks on the calendar. A number is how many days from today the day is. */
export const SAMPLE_MARKS: ReadonlyArray<{ readonly inDays: number; readonly color: SampleColor; readonly label: string }> = [
  { inDays: 2, color: 'blue', label: 'Writing group' },
  { inDays: 6, color: 'green', label: 'Day off' },
];

/** The targets: for the whole manuscript, for a day, and how many days from today the deadline is (about five months). */
export const SAMPLE_TARGETS = { project: 80000, daily: 1000, deadlineInDays: 150 } as const;

// ------------------------------------------------------------------ the world
//
// The people, places, groups and things of the story, the tales the town
// tells, what it believes in and who its people are, so that the World
// browser, the entity sheet, a scene's "In this scene" and the timeline's
// cards have something to show for every type a project has. Each becomes a
// note in the World folder, in the folder of its type.

/** One of the types every project has, by its id. */
export type SampleEntityType = 'character' | 'place' | 'faction' | 'item' | 'lore' | 'creature' | 'culture';

/** An entity of the world: a note in the World folder. */
export interface SampleEntity {
  readonly type: SampleEntityType;
  /** The note's name. No other note of the sample has it, so that a link by name leads here. */
  readonly name: string;
  /** What its type's properties say, by name: "role", "kind", "summary" and so on. The others stay empty. */
  readonly fields: Readonly<Record<string, string | number>>;
  /** The other names it goes by. */
  readonly aliases?: readonly string[];
  /** What the note says under its first heading. */
  readonly description: string;
  /** What it says under the headings after the first, in order. Headings without a text stay empty. */
  readonly sections?: readonly string[];
  /**
   * The entities it has to do with: the name of each (see SAMPLE_ENTITIES)
   * and a short label, "" for none. Written on this side only: the other
   * entity's sheet shows it as "mentioned by".
   */
  readonly related?: ReadonlyArray<readonly [name: string, label: string]>;
  /**
   * When it begins, the way an event's date is written: a year (1841), a
   * month (1922-11) or a day (1889-04-17). A character's birth, a place's
   * founding, when a thing was made, when a tale is set.
   */
  readonly date?: string;
  /** When it ends: a death, a closing, a loss. Later than `date`. */
  readonly end?: string;
  /** More points in its life: the date of each and a few words, in order of time. */
  readonly moments?: ReadonlyArray<readonly [date: string, label: string]>;
}

/** The year the story is told in: the ages of the characters are counted to it. */
export const SAMPLE_STORY_YEAR = 1923;

/**
 * The eighteen entities, at least one of every type a project has: six
 * characters (the three the scenes are told by, two more of the town, and
 * Ellen, Noa's sister, who is only met in a letter), four places, one
 * faction, two items, three pieces of lore (a legend, a fishermen's tale,
 * and the keeper's saying), one creature of local belief and one people. None has a picture: a seed makes notes, not image files.
 *
 * Every one of them has a place in time, so that the sheet's "Time" and
 * "History", the timeline's world lanes and the world's history have a
 * coherent past to show around the story's 1923: the village founded in
 * 1612 and lost in 1723, the town and its office, the lighthouse built in
 * 1841 and closed in November 1922 (the very month of the event that tells
 * it), the keeper who kept it for thirty years, the chart made in 1871 and
 * last corrected on 10 February 1923, and the births the characters' ages
 * come from. Some have moments as well.
 */
export const SAMPLE_ENTITIES: readonly SampleEntity[] = [
  {
    type: 'character',
    name: 'Mara',
    fields: {
      role: 'Protagonist',
      age: 34,
      occupation: 'Chart maker',
      appearance: 'Ink on her cuffs; never without a notebook.',
      personality: 'Exact and impatient, and kinder than she lets on.',
      voice: 'Short sentences and numbers. Says "roughly" when she means that she has not measured it yet.',
      goal: 'To draw the bay as it really is.',
      arc: 'Learns that an honest chart has to show what a town would rather forget.',
      summary: 'Sent to Saltwick to redraw the sea chart after the storm. Careful, impatient, new to the town.',
    },
    description: 'Mara makes sea charts. She trusts what she has measured herself and very little else.',
    related: [
      ['The Harbour Master', 'hired by'],
      ['Tobias', 'surveys the bay with'],
    ],
    date: '1889-04-17',
    moments: [
      ['1911', 'qualifies as a chart maker'],
      ['1923-10-13', 'is sent to Saltwick to redraw the chart'],
    ],
  },
  {
    type: 'character',
    name: 'Tobias',
    fields: {
      role: 'Ally with a secret',
      age: 41,
      occupation: 'Ferryman',
      appearance: 'Weathered hands, an old oilskin coat.',
      personality: 'Steady and dry. Loyal to the town before anyone in it.',
      voice: 'Talks about the weather when he means people. Never finishes a story the first time he tells it.',
      goal: 'To keep the ferry crossing, and one secret kept.',
      arc: 'From keeping what he saw on the night of the storm to telling it.',
      summary: 'Runs the ferry to Saltwick. Knows the sandbars by feel and was out on the water on the night of the storm.',
    },
    description: 'Tobias has taken the ferry across the channel since he was a boy. He counts the boats in every evening.',
    related: [['The Bay Fishers', 'born among']],
    date: '1882-02',
    moments: [['1897', 'takes over the ferry from his father']],
  },
  {
    type: 'character',
    name: 'Noa',
    fields: {
      role: 'Second lead',
      age: 29,
      occupation: 'Archivist',
      appearance: 'Reading glasses pushed up into her hair.',
      personality: 'Curious and patient, and stubborn about small facts.',
      voice: 'Careful and exact in the town; quick and warm in her letters home.',
      goal: 'To find out what the town does not say.',
      arc: 'From putting papers in order to deciding what the town should know.',
      summary: 'Keeps the town archive, and writes home to her sister Ellen.',
    },
    aliases: ['The archivist'],
    description: 'Noa came to Saltwick to put the archive in order. She lives in the small room above it.',
    related: [
      ['Ellen', 'sister'],
      ['The Archive', 'keeps'],
    ],
    date: '1894-06-03',
    moments: [['1923-05', 'takes over the archive in Saltwick']],
  },
  {
    type: 'character',
    name: 'The Harbour Master',
    fields: {
      role: 'Antagonist',
      occupation: 'Harbour master',
      personality: 'Courteous and tidy, and afraid of what a true chart would cost the town.',
      voice: 'Formal and unhurried. Says "we" when he means "I".',
      goal: 'A finished chart in six weeks, with one thing left off it.',
      arc: 'Has to choose between a chart that sells and a chart that is true.',
      summary: 'Gives Mara her work and her deadline, and has his own reasons for both.',
    },
    aliases: ['Harbour master'],
    description: 'The harbour master runs the harbour office and, most days, the town.',
    related: [['The Harbour Office', 'runs']],
    date: '1866',
    moments: [['1909', 'becomes harbour master']],
  },
  {
    type: 'character',
    name: 'The Keeper',
    fields: {
      role: 'The absent one',
      occupation: 'Lighthouse keeper, pensioned off',
      personality: 'Watchful and plain-spoken, to judge by his log.',
      voice: 'Heard only in his log: dates, weather, and now and then one line too many.',
      summary: 'The last keeper of the old lighthouse. Gone before the story starts; his log is still in the archive.',
    },
    aliases: ['The lighthouse keeper'],
    description: 'Nobody in the town says his name. What is known of him is what he wrote.',
    related: [
      ['The Old Lighthouse', 'kept it for thirty years'],
      ['The Logbook', 'wrote'],
    ],
    date: '1858',
    end: '1923-03',
    moments: [
      ['1892', 'takes over the light'],
      ['1922-11', 'is pensioned off'],
    ],
  },
  {
    type: 'character',
    name: 'Ellen',
    fields: {
      role: "Noa's sister",
      personality: 'Curious and warm, and more worried than she admits.',
      voice: 'Heard only through what Noa writes back to her.',
      summary: "Noa's younger sister. She stayed at home, and Noa writes her letters from the town.",
    },
    aliases: ['Nell'],
    description: 'Ellen never appears in the story itself: she is the one Noa writes to, and the one waiting for answers.',
    date: '1897',
    moments: [['1923-06', 'the first letter from Noa arrives']],
  },
  {
    type: 'place',
    name: 'Saltwick',
    fields: {
      kind: 'Harbour town',
      region: 'The bay',
      atmosphere: 'Salt, fog and coal smoke. Quiet in a way that listens.',
      landmarks: 'The sea wall, the bakery, the chandlery, the church tower, the harbour office.',
      summary: 'A small harbour town where people say little and remember everything.',
    },
    description: 'One street along the front, a sea wall, a bakery, a chandlery and the harbour office. The ferry is the only quick way in.',
    date: '1688',
    moments: [['1923-10-12', 'the winter storm moves the sandbars']],
  },
  {
    type: 'place',
    name: 'The Archive',
    fields: {
      kind: 'Town archive',
      region: 'Saltwick',
      atmosphere: 'Damp paper and lamp oil. Cold even in daylight.',
      landmarks: 'The lower shelves that flood, the small room above, the loose floorboards.',
      summary: 'Ledgers, maps and logs, some of them wet since the storm. Noa keeps it.',
    },
    description: 'A long room by the harbour, with a small room above it. The lower shelves flood.',
    related: [['Saltwick', 'in']],
    date: '1867',
    moments: [['1923-05', 'Noa takes it over']],
  },
  {
    type: 'place',
    name: 'The Old Lighthouse',
    fields: {
      kind: 'Lighthouse',
      region: 'Saltwick',
      atmosphere: 'Wind, rust and gulls. A door nobody goes near.',
      landmarks: 'The chained door, the boarded windows, the lamp room.',
      summary: 'Closed, boarded and chained a year before the story starts.',
    },
    description: 'It stands at the end of the point. Its light has not been lit since the keeper was pensioned off.',
    related: [['Saltwick', 'on the point by']],
    date: '1841',
    end: '1922-11',
    moments: [['1892', 'its last keeper takes over']],
  },
  {
    type: 'place',
    name: 'The Drowned Village',
    fields: {
      kind: 'Lost village',
      region: 'The bay',
      atmosphere: 'Still water over stone. A place people look away from.',
      landmarks: 'The church, the seven houses, the lane that shows at spring tides.',
      summary: 'A church and seven houses on an old map, where there is now only water.',
    },
    aliases: ['The village under the water'],
    description: 'At the lowest spring tides the stones of its lane show under the water.',
    date: '1612',
    end: '1723',
  },
  {
    type: 'faction',
    name: 'The Harbour Office',
    fields: {
      kind: 'Town authority',
      leader: 'The harbour master',
      summary: 'Pays for the new chart, and decides what the town is told.',
    },
    description: 'The office that keeps the harbour, its dues and its records.',
    date: '1794',
  },
  {
    type: 'item',
    name: 'The Old Chart',
    fields: {
      kind: 'Sea chart',
      owner: 'The harbour office',
      summary: 'The chart of the bay as it was before the storm. No longer true.',
    },
    aliases: ['The old chart'],
    description: 'Last corrected in February 1923. Every pilot in the bay learned from it.',
    related: [['The Harbour Office', 'belongs to']],
    date: '1871',
    moments: [['1923-02-10', 'last corrected']],
  },
  {
    type: 'item',
    name: 'The Logbook',
    fields: {
      kind: 'Logbook',
      owner: 'The archive',
      summary: 'The log the old lighthouse keeper kept. Some of its pages have been cut out.',
    },
    aliases: ["The keeper's log"],
    description: 'Damp at the edges. The last page says the sea always gives back what it took.',
    related: [['The Archive', 'kept in']],
    date: '1892',
    moments: [['1922-11', 'goes to the archive']],
  },
  {
    type: 'lore',
    name: 'The Legend of the Drowned Village',
    fields: {
      kind: 'Legend',
      period: 'Two hundred years ago, as it is told',
      'told-by': 'The fishers of the bay',
      summary: 'The village under the bay owed the sea a debt and would not pay it, so the sea came one night and took the village instead.',
    },
    aliases: ['The legend'],
    description:
      'The village had the best fishing in the bay and thanked nobody for it. One winter an old woman came to every door and asked for the tenth fish, for the sea. Every door was shut. That night the tide came in and did not go out again. They say the church bell rang once under the water, and never since.',
    sections: [
      'The fishers tell it while they mend nets, and never on a boat. Each family has its own old woman: a widow, a saint, the sea herself.',
      'The old map in the archive shows a church and seven houses where there is now only water, and at the lowest spring tides the stones of a lane can be seen. Nobody has found a debt.',
    ],
    related: [
      ['The Drowned Village', 'is about'],
      ['The Bay Fishers', 'told by'],
    ],
    date: '1723',
  },
  {
    type: 'lore',
    name: 'The Bell in the Fog',
    fields: {
      kind: "Fishermen's tale",
      period: 'Told to this day',
      'told-by': 'Tobias, and every ferryman before him',
      summary: 'As long as the ferry bell rings in the fog, the sea lets the boats come home. The night it stops, the sea keeps one.',
    },
    aliases: ['The tale of the bell'],
    description:
      'The first ferryman hung a bell on the bow and rang it through every fog, so that the boats could steer by it. He rang it for forty years and no boat was lost. The night he died nobody rang, and in the morning one boat was missing.',
    sections: [
      'Tobias tells it to passengers on a clear day, and not at all in fog. The fishers say it is why a ferryman is never paid in coin on the water.',
      'A bell does carry over water in fog, and Tobias has steered by its echo. Boats were lost in years when the bell rang, too.',
    ],
    related: [
      ['Tobias', 'told by'],
      ['Saltwick', 'told in'],
    ],
    date: '1790',
    end: '1830',
  },
  {
    type: 'lore',
    name: 'What the Sea Gives Back',
    fields: {
      kind: 'Saying',
      period: "From the keeper's time",
      'told-by': 'The keeper, on the last page of his log',
      summary: 'The sea always gives back what it took, only not in the same place and not in the same shape.',
    },
    aliases: ['What the sea took'],
    description:
      'So the keeper wrote on the last page of the log: the sea always gives back what it took, only not in the same place and not in the same shape. Under it there is no date and no weather, only a straight line.',
    sections: [
      'Nobody in the town says it aloud. Noa reads it in the log on the night before the storm, and cannot tell whether it is a comfort or a warning.',
      'The missing boat was found empty on the far side of the bar, and the stones of the village show again at low water. What the sea gave back can be measured; what the keeper meant cannot.',
    ],
    related: [
      ['The Keeper', 'written by'],
      ['The Logbook', 'written on the last page of'],
    ],
    date: '1922-11',
  },
  {
    type: 'creature',
    name: 'The Tide Hound',
    fields: {
      kind: 'Creature of local belief',
      habitat: 'The sandbars, at the turn of the tide',
      summary: 'A grey dog said to walk the sandbars before a storm. Whoever follows it finds the channel, or does not come back.',
    },
    aliases: ['The grey dog'],
    description: 'The size of a calf and the colour of wet sand, with no sound to it and no prints behind it. It is seen from the sea wall, never from close by.',
    sections: [
      'It walks the edge of the bar when the glass is falling, always toward deep water, and is gone when the tide covers the sand.',
      'The fishers will not put out on a morning it has been seen. The harbour office says it is a seal, and that seals do not forecast the weather.',
    ],
    related: [['The Bay Fishers', 'feared by']],
    date: '1804',
  },
  {
    type: 'culture',
    name: 'The Bay Fishers',
    fields: {
      kind: 'Fishing people',
      region: 'The bay',
      summary: 'The families who have fished the bay for generations. They name every rock, read the tide before they read books, and keep the tales of the town.',
    },
    aliases: ['The fishers'],
    description: 'A few dozen families along the front of Saltwick and in the cottages past the sea wall. Boats pass from uncle to nephew, and so do the names of the rocks.',
    sections: [
      'Nobody whistles on a boat, counts the catch before it is landed, or pays the ferryman in coin on the water. Nets are mended in company, and that is where the tales are told.',
      'They speak the English of the town with words of their own for the water: every rock, bar and run of the tide has a name that is on no chart.',
    ],
    related: [['Saltwick', 'live in']],
    date: '1650',
  },
];

/**
 * The entities each scene lists, by the scene's title: who and what its
 * synopsis is about. A few scenes list none, so that the screens have an
 * empty case to show too.
 */
export const SAMPLE_SCENE_ENTITIES: Readonly<Record<string, readonly string[]>> = {
  Prologue: ['The Old Chart'],
  'The Last Ferry': ['Mara', 'Tobias', 'Saltwick'],
  'A Room Above the Chandlery': ['Mara'],
  'What the Harbour Master Wants': ['The Harbour Master', 'Mara', 'The Harbour Office'],
  'Tobias Counts the Boats': ['Tobias'],
  'The Archive Door': ['Noa', 'The Archive'],
  'First Soundings': ['Mara', 'Tobias'],
  'Bread and Rumours': ['Noa'],
  'The Chart That Lies': ['Mara', 'The Old Chart'],
  'Lamp in the Empty House': ['Tobias'],
  'Low Water': ['Mara', 'The Tide Hound'],
  "The Keeper's Log": ['Noa', 'The Keeper', 'The Logbook', 'The Archive'],
  'A Line of Stakes': ['Tobias', 'Mara'],
  'A Letter to My Sister': ['Noa', 'Ellen', 'The Archive', 'The Drowned Village'],
  'Names of the Rocks': ['Mara', 'The Bay Fishers'],
  'The Village on the Old Map': ['Noa', 'The Drowned Village', 'The Legend of the Drowned Village'],
  'Fog on the Crossing': ['Tobias', 'The Bell in the Fog'],
  'An Argument About North': ['Mara', 'Tobias'],
  "The Baker's Daughter": ['Noa'],
  Triangles: ['Mara'],
  'What Tobias Did Not Say': ['Tobias', 'Mara'],
  'The Drowned Lane': ['The Drowned Village'],
  'Pages Out of Order': ['Noa', 'The Logbook'],
  'Mending Nets': ['Tobias', 'The Drowned Village', 'The Legend of the Drowned Village', 'The Bay Fishers'],
  'Ink and Salt': ['Mara'],
  'A Second Lamp': ['Noa', 'Tobias'],
  'Depths by Candlelight': ['Mara'],
  "The Harbour Master's Offer": ['The Harbour Master', 'Mara'],
  'Under the Floorboards': ['Noa', 'The Logbook', 'The Archive'],
  'Slack Water': ['Tobias', 'The Drowned Village'],
  'Glass Falling': ['Saltwick'],
  'The Night Before the Storm': ['Noa', 'The Logbook', 'The Keeper', 'What the Sea Gives Back'],
  'The Last Crossing Before': ['Tobias'],
  'The Bell Stops': ['The Bell in the Fog'],
  Sandbags: ['Mara', 'Noa', 'The Archive'],
  'What the Keeper Wrote': ['Noa', 'The Keeper', 'The Logbook', 'What the Sea Gives Back'],
  Adrift: ['Tobias'],
  'The Light': ['The Old Lighthouse'],
  'Between Two Bars': ['Tobias', 'The Tide Hound'],
  'Morning After': ['Saltwick'],
  'A New Shore': ['Mara'],
  'Starting Over': ['Mara'],
  'The Honest Chart': ['Mara', 'The Harbour Master'],
  'Tobias Tells It': ['Tobias', 'Mara'],
  'A Place for the Log': ['Noa', 'The Logbook'],
  'The Village Gets a Name': ['The Drowned Village'],
  'The Ferry Timetable': ['Tobias'],
  'Leaving on the Morning Tide': ['Mara'],
  'The Chart on the Wall': ['The Harbour Office', 'Saltwick'],
  Epilogue: ['The Drowned Village', 'The Legend of the Drowned Village'],
};
