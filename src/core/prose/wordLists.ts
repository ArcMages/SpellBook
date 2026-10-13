// The word lists of the checks, in English and in Hebrew. They are
// Spellbook's own, written by hand; the writer adds filler words of their own
// in the settings.
//
// Everything is in the form words are compared in: lower case, a straight
// apostrophe, Hebrew without points.

/** English words and phrases that usually carry no weight. */
export const FILLERS_EN: readonly string[] = [
  'very', 'really', 'just', 'quite', 'rather', 'somewhat', 'actually', 'basically', 'literally', 'simply', 'totally', 'completely',
  'absolutely', 'definitely', 'certainly', 'probably', 'perhaps', 'maybe', 'suddenly', 'somehow', 'slightly', 'virtually', 'essentially',
  'truly', 'honestly', 'frankly', 'obviously', 'clearly', 'anyway', 'practically', 'fairly', 'extremely', 'utterly', 'merely', 'seemingly',
  'kind of', 'sort of', 'a bit', 'a little bit', 'in order to', 'the fact that', 'at the end of the day', 'needless to say',
  'as a matter of fact', 'due to the fact that', 'in terms of', 'it seems that', 'started to', 'began to', 'seemed to', 'of course',
  'you know', 'i mean', 'each and every', 'all of a sudden', 'more or less', 'pretty much', 'for the most part', 'in a way',
  'at that moment', 'for some reason', 'as if to say', 'the thing is', 'to be honest', 'that being said',
];

/** Hebrew words and phrases that usually carry no weight. */
export const FILLERS_HE: readonly string[] = [
  'ממש', 'בעצם', 'פשוט', 'כאילו', 'די', 'קצת', 'מאוד', 'מאד', 'נורא', 'לגמרי', 'בעיקרון', 'כנראה', 'אולי', 'איכשהו', 'סתם', 'בכלל',
  'דווקא', 'למעשה', 'באמת', 'ממילא', 'בערך', 'כביכול', 'פתאום', 'לפתע', 'כמובן', 'בהחלט', 'אכן', 'הרי', 'בסך הכל', 'בסופו של דבר',
  'באופן כללי', 'כך או כך', 'מן הסתם', 'סוג של', 'פחות או יותר', 'האמת היא', 'איך שהוא', 'בדיוק', 'לחלוטין', 'כמעט',
];

/** English words too common to count as repeated. */
export const COMMON_EN: ReadonlySet<string> = new Set(
  (
    'the a an and or but nor so yet if then than that this these those there here when where while what which who whom whose why how ' +
    'i me my mine myself you your yours yourself he him his himself she her hers herself it its itself we us our ours ourselves they ' +
    'them their theirs themselves am is are was were be been being have has had having do does did doing done will would shall should ' +
    'can could may might must ought not no yes of in on at by for with from into onto upon over under above below between among ' +
    'through across against along around behind beside beyond during before after until toward towards within without about near ' +
    'off out up down past since inside outside as like just very more most much many some any all both each every other another such ' +
    'only own same too also even still again once ever never always now back away well one two three first last next said says say ' +
    'went come came going get got make made know knew think thought want wanted look looked see saw seen tell told take took give ' +
    'gave because though although unless whether either neither rather quite thing things something anything nothing everything ' +
    'someone anyone everyone nobody way time little long good great let put set ask use try far few ago per via due etc yes day man men old new'
  ).split(' '),
);

/** Hebrew words too common to count as repeated. */
export const COMMON_HE: ReadonlySet<string> = new Set(
  (
    'של את על אל עם אם כי לא כן גם רק כל או אז עד יש אין אף זה זאת זו אלה אלו הוא היא הם הן אני אתה אתם אתן אנחנו אנו ' +
    'היה היתה הייתה היו יהיה תהיה להיות אבל אולם אלא אשר כאשר כמו כדי בגלל למרות לפני אחרי אחר בין תחת מעל מתחת מול ליד אצל ' +
    'בלי ללא דרך נגד בתוך מתוך לתוך שלי שלך שלו שלה שלנו שלכם שלהם אותי אותך אותו אותה אותנו אותם אותן לי לך לו לה לנו לכם להם ' +
    'בי בך בו בה בנו בהם ממני ממך ממנו ממנה מהם עליי עליו עליה עליהם אליו אליה אליהם איתי איתו איתה איתם מה מי איך למה מתי ' +
    'איפה לאן כך ככה כאן שם פה הנה עוד כבר עדיין שוב פעם אחד אחת שני שתי שניים שתיים יותר פחות מאוד הרבה מעט כמה הזה הזאת האלה ' +
    'אמר אמרה אמרו אומר אומרת דבר משהו מישהו כלום שום'
  ).split(' '),
);

/** The letters Hebrew attaches to the front of a word: and, the, in, to, from, that, as. */
export const HEBREW_PREFIXES = 'והבלמשכ';

// ---------------------------------------------------------- passive voice

/** The forms of "to be" (and of "to get") that a passive is built with. */
export const BE_FORMS: ReadonlySet<string> = new Set(
  "am is are was were be been being isn't aren't wasn't weren't get gets got getting".split(' '),
);

/** The forms of "to have" that may stand before "been". */
export const HAVE_FORMS: ReadonlySet<string> = new Set("have has had having haven't hasn't hadn't".split(' '));

/** Small words that may stand between "was" and the word it belongs to: "was never quite finished". */
export const BETWEEN: ReadonlySet<string> = new Set(
  'not never always just already also still often even almost quite soon then now ever once only really being been so all both'.split(' '),
);

/** Past forms that do not end in "-ed". */
export const IRREGULAR_PARTICIPLES: ReadonlySet<string> = new Set(
  (
    'seen taken given gotten made known thought told said felt left kept held begun found heard brought bought caught taught sold sent ' +
    'spent built lost met paid read led meant put set let cut hit shut broken spoken written driven ridden risen grown thrown drawn ' +
    'flown blown worn torn sworn woken chosen frozen stolen hidden forgotten eaten drunk sung swum rung sunk swept dealt hung stuck ' +
    'struck dug won shot fought sought laid slid bent lent spun stung swung flung understood shaken forgiven bitten fed bled bred lit ' +
    'beaten burnt done run overcome overtaken undone withdrawn rebuilt retold mistaken forbidden woven sewn shown thrust bound ground ' +
    'wound hurt split spread shed cast'
  ).split(' '),
);

/** Words in "-ed" that are no past forms at all. */
export const NOT_PARTICIPLES: ReadonlySet<string> = new Set(
  'need indeed hundred naked sacred wicked wretched kindred speed breed bleed seed weed deed feed greed shed sled bed red'.split(' '),
);

/** Past forms that mostly describe ("she was tired"). They are a passive only when "by" follows. */
export const DESCRIBING: ReadonlySet<string> = new Set(
  (
    'tired interested married worried excited surprised pleased scared frightened bored exhausted ashamed crowded used supposed gone ' +
    'born amazed annoyed confused delighted disappointed embarrassed relieved satisfied shocked terrified thrilled concerned ' +
    'determined dressed finished prepared convinced inclined accustomed alarmed astonished drunk lost hurt done meant bound'
  ).split(' '),
);
