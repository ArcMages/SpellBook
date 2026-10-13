// The common words of English and Hebrew: the small words every text is full
// of ("the", "and", "of"), which say nothing about a writer's habits. The list
// of most used words leaves them out unless the writer asks for them.
//
// Both lists were written for Spellbook. They hold the words of grammar only
// (articles, pronouns, prepositions, conjunctions, the forms of "to be", "to
// have" and "to do"), never words with a meaning of their own: "said" and
// "just" are exactly what a writer wants to see in the list.

const ENGLISH = `
a an the this that these those
i me my mine myself you your yours yourself he him his himself she her hers herself
it its itself we us our ours ourselves they them their theirs themselves
who whom whose which what where when why how
and or but nor so yet if then than because although though while as until unless since
of in on at to from by with without for about into onto over under between through
during before after above below up down out off against among around across behind beside near
is am are was were be been being have has had having do does did doing done
will would shall should can could may might must
not no there here
i'm i've i'll i'd you're you've you'll you'd he's he'll he'd she's she'll she'd it's it'll
we're we've we'll we'd they're they've they'll they'd that's there's what's who's let's
isn't aren't wasn't weren't haven't hasn't hadn't don't doesn't didn't won't wouldn't
shan't shouldn't can't couldn't mustn't
all any both each every some such other another either neither
too very also only own same more most
`;

// Hebrew joins its smallest words to the word that follows ("and", "the",
// "in", "to", "that" are single letters), so those never stand alone. The
// list holds the words that do: pronouns, prepositions with their endings,
// conjunctions, question words, and the forms of "to be" and "there is".
const HEBREW = `
של את על אל עם אם או גם כי לא כן אז רק עוד כל כמו בין עד מן אך אבל אלא אשר כדי כך כבר
אני אתה אתם אתן הוא היא הם הן אנחנו אנו
זה זאת זו אלה אלו הזה הזאת הזו האלה האלו
לי לך לו לה לנו לכם להם להן
שלי שלך שלו שלה שלנו שלכם שלהם שלהן
אותי אותך אותו אותה אותנו אתכם אותם אותן
בי בך בו בה בנו בכם בהם בהן
ממני ממך ממנו ממנה מכם מהם מהן
עליי עליך עליו עליה עלינו עליכם עליהם עליהן
אליי אליך אליו אליה אלינו אליכם אליהם אליהן
איתי איתך איתו איתה איתנו איתכם איתם איתן
אצל אצלי אצלך אצלו אצלה אצלנו אצלם
היה היתה הייתה היו הייתי היית היינו הייתם יהיה תהיה יהיו אהיה נהיה להיות
יש אין
מה מי איך למה מתי איפה כמה האם
לפני אחרי אחר תוך מול ליד בלי בגלל מפני כאשר לכן אולם
שם פה כאן הנה הכל הכול
`;

const listOf = (text: string): ReadonlySet<string> => new Set(text.split(/\s+/).filter((word) => word !== ''));

export const ENGLISH_COMMON_WORDS = listOf(ENGLISH);
export const HEBREW_COMMON_WORDS = listOf(HEBREW);

/**
 * Whether a word is one of the common words of English or Hebrew.
 *
 * @param key the word as the list of most used words knows it (see wordKey)
 */
export function isCommonWord(key: string): boolean {
  return ENGLISH_COMMON_WORDS.has(key) || HEBREW_COMMON_WORDS.has(key);
}
