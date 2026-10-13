// The words of the sample project.
//
// Everything in this file was written for Spellbook as placeholder prose; none
// of it is taken from a published work. It is only data: sampleProject.ts
// turns it into a project.
//
// The sample novel is set in Saltwick, a small harbour town. Mara has come to
// redraw the sea chart after a storm moved the coast, Tobias runs the ferry,
// and Noa keeps the town archive and writes home to her sister in Hebrew.

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

// ------------------------------------------------------------- Hebrew scenes

const LETTER_TO_MY_SISTER = [
  `אחותי היקרה,`,
  `אני כותבת לך מהחדר הקטן שמעל הארכיון, ליד חלון שפונה אל הנמל. הים כאן אפור בבוקר וכחול רק לקראת הצהריים, ובערב הוא נעשה כהה כמו דיו. כבר שלושה שבועות אני בעיירה הזאת, ועדיין אינני יודעת אם היא מקבלת אותי או רק סובלת אותי בנימוס.`,
  `האנשים כאן מדברים מעט, אבל זוכרים הכול. האופה יודעת מי קנה לחם ומי לא, והדייגים יודעים לקרוא את הגאות לפני שהם יודעים לקרוא ספרים. כל ערב אני סופרת את הסירות שחוזרות, ותמיד נדמה לי שחסרה אחת.`,
  `מצאתי בארכיון מפה ישנה. מצויר בה כפר קטן, עם כנסייה ושבעה בתים, במקום שיש בו היום רק מים. שאלתי עליו את האיש שמשיט את המעבורת, והוא הסתכל על הים ולא ענה. אני חושבת שהעיירה שומרת סוד, והיא שומרת אותו היטב.`,
  `אל תדאגי לי. אני ישנה טוב, אוכלת לחם טרי כל בוקר, ולומדת את שמות הרוחות. שמרתי לך צדף קטן ולבן, חלק כמו אבן נהר. כשאחזור אספר לך הכול, לאט, ליד השולחן במטבח של אמא.`,
  `שלך באהבה,\nנועה`,
].join('\n\n');

const NIGHT_BEFORE_THE_STORM = [
  `הברומטר במשרד הנמל ירד כל היום, ואיש לא אמר על כך מילה. לקראת ערב קשרו הדייגים את הסירות בחבל כפול, והאופה סגרה את התריסים מוקדם מהרגיל. אני עמדתי ליד החלון וראיתי איך האור נעלם מהשמיים, לאט, כמו מים שיורדים בשפל.`,
  `בלילה כזה העיירה שקטה מדי. אין צחוק מהפונדק, אין צעדים על הרציף, ורק פעמון המעבורת נשמע מבעד לערפל, פעם ועוד פעם. ספרתי את הצלצולים עד שהתבלבלתי. יש ימים שבהם השקט כבד יותר מכל רוח.`,
  `הדלקתי נר וקראתי שוב ביומן של שומר המגדלור. בעמוד האחרון הוא כותב שהים תמיד מחזיר את מה שלקח, רק לא באותו מקום ולא באותה צורה. אינני יודעת אם זו נחמה או אזהרה.`,
  `לפני חצות ראיתי אור בבית הריק שבקצה הרחוב. מישהו הדליק שם פנס והעמיד אותו בחלון, מול הים. רציתי לצאת ולראות מי זה, אבל הרוח כבר התחילה לדפוק על הדלת, ונשארתי במקומי. מחר, אם יהיה מחר שקט, אשאל.`,
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
        'מכתב לאחותי',
        NOA,
        REVISED,
        0,
        'נועה כותבת לאחותה על העיירה, על הים ועל מפה ישנה שמצאה בארכיון.',
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
        'הלילה שלפני הסערה',
        NOA,
        DRAFT,
        0,
        'נועה מחכה לסערה, קוראת ביומן של שומר המגדלור ורואה אור בבית הריק.',
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
        '- **Noa** keeps the archive. Writes home to her sister in Hebrew.',
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
  /** The note's text. */
  readonly body: string;
}

/**
 * The ten events of the story, in the autumn and winter of 1923. Among them:
 * one that lasts six weeks (the survey), one that sits in two timelines
 * (Mara's arrival), one with a Hebrew title, and two that are only known to
 * the month.
 */
export const SAMPLE_EVENTS: readonly SampleEvent[] = [
  {
    title: 'The lighthouse is closed',
    date: '1922-11',
    timelines: [BACKSTORY],
    tags: ['lighthouse'],
    body: 'The keeper is pensioned off, the windows are boarded and the door is chained. His log goes to the archive.',
  },
  {
    title: 'The old chart is last corrected',
    date: '1923-02-10',
    timelines: [BACKSTORY],
    tags: ['chart'],
    body: 'The last time anyone checked the chart of the bay against the bay itself.',
  },
  {
    title: 'The winter storm',
    date: '1923-10-12',
    timelines: [MAIN_PLOT],
    scenes: ['Prologue'],
    tags: ['storm'],
    body: 'One night moves the sandbars. By morning the channel is somewhere else and one boat has not come home.',
  },
  {
    title: 'Mara arrives in Saltwick',
    date: '1923-10-14',
    timelines: [MAIN_PLOT, SURVEY],
    scenes: ['The Last Ferry'],
    body: 'On the last ferry of the day, with her instruments in two cases.',
  },
  {
    title: 'The survey of the bay',
    date: '1923-10-20',
    end: '1923-12-01',
    timelines: [SURVEY],
    scenes: ['First Soundings', 'Low Water'],
    tags: ['chart'],
    body: 'The six weeks the harbour master gives Mara to redraw the chart.',
  },
  {
    title: 'נועה מוצאת את המפה הישנה',
    date: '1923-11-05',
    timelines: [MAIN_PLOT],
    scenes: ['The Village on the Old Map'],
    tags: ['ארכיון'],
    body: 'בארכיון, בין הספרים הלחים: מפה שמצויר בה כפר במקום שיש בו היום רק מים.',
  },
  {
    title: 'The lowest tide of the month',
    date: '1923-11-08',
    timelines: [SURVEY],
    scenes: ['Low Water'],
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
    body: 'The night the ferry bell stops, and someone lights the old lighthouse.',
  },
  {
    title: 'The new chart is published',
    date: '1924-03',
    timelines: [SURVEY],
    scenes: ['The Chart on the Wall'],
    tags: ['chart'],
    body: 'With the drowned village on it, under its old name.',
  },
];

/** The scenes that have a date in the story, by title. They show on the timeline in the Manuscript lane. */
export const SAMPLE_SCENE_DATES: Readonly<Record<string, string>> = {
  Prologue: '1923-10-12',
  'The Last Ferry': '1923-10-14',
  'Low Water': '1923-11-08',
  'הלילה שלפני הסערה': '1923-12-02',
};

/** The two marks on the calendar. A number is how many days from today the day is. */
export const SAMPLE_MARKS: ReadonlyArray<{ readonly inDays: number; readonly color: SampleColor; readonly label: string }> = [
  { inDays: 2, color: 'blue', label: 'Writing group' },
  { inDays: 6, color: 'green', label: 'Day off' },
];

/** The targets: for the whole manuscript, for a day, and how many days from today the deadline is (about five months). */
export const SAMPLE_TARGETS = { project: 80000, daily: 1000, deadlineInDays: 150 } as const;
