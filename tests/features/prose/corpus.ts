// Long texts for timing the analysis: about 5,000 words of English and of
// Hebrew, put together from a stock of sentences in an order that is the
// same every time. No two paragraphs are alike, so that nothing is spared by
// remembering a line that was seen before.

const ENGLISH = [
  'The tide came in slowly that evening, and the harbour was strangely quiet.',
  'Anna stood at the end of the pier and watched the grey water climb the wooden posts.',
  'She had always loved this hour, when the fishing boats returned and the gulls followed them home.',
  'A single lantern burned in the window of the old customs house.',
  'Its light trembled on the waves like something that was very nearly alive.',
  'The letter had been written in haste, and it was never really finished.',
  '"You should not have come," he said quietly, and then he actually laughed.',
  'Nobody answered him.',
  'Behind her the town lit its lamps one by one, and a dog barked twice in the dark.',
  'The door was opened by a woman who looked suddenly, completely, terribly tired.',
  'He walked quickly along the wall, counting the steps, just as his father had done before him.',
  'Somewhere above them a shutter banged against the stone.',
  'It was a small boat, and it was drifting toward the rocks.',
  'She wiped the glass with her sleeve and looked out at the black water for a long time.',
  'The words were simple, almost kind, but they had broken something inside her.',
  'Rain fell.',
  'In the morning the nets were found on the beach, torn and tangled, and the boat was gone.',
  'Her fingers were stiff and clumsy, but they remembered what to do.',
  'The old machine groaned, shuddered, and began to turn in the cold salt air.',
  'They said the lighthouse keeper had kept the light burning for thirty years without once letting it go dark.',
];

const HEBREW = [
  'הגאות עלתה לאט באותו ערב, והנמל היה שקט באופן מוזר.',
  'אנה עמדה בקצה המזח והביטה במים האפורים המטפסים על העמודים.',
  'היא תמיד אהבה את השעה הזאת, כשסירות הדייגים חזרו והשחפים ליוו אותן הביתה.',
  'פנס יחיד דלק בחלון של בית המכס הישן.',
  'האור שלו רעד על הגלים כמו משהו שממש כמעט חי.',
  'המכתב נכתב בחיפזון, ובעצם אף פעם לא הושלם.',
  '"לא היית צריך לבוא," הוא אמר בשקט, ואז פשוט צחק.',
  'איש לא ענה לו.',
  'מאחוריה העיר הדליקה את הפנסים אחד אחד, וכלב נבח פעמיים בחושך.',
  'את הדלת פתחה אישה שנראתה פתאום עייפה לגמרי.',
  'הוא הלך מהר לאורך החומה וספר את הצעדים, בדיוק כמו שאביו עשה לפניו.',
  'אי שם מעליהם תריס נחבט באבן.',
  'זו הייתה סירה קטנה, והסירה נסחפה אל הסלעים.',
  'היא ניגבה את הזכוכית בשרוול והביטה החוצה אל המים השחורים זמן רב.',
  'המילים היו פשוטות, כמעט טובות, אבל הן שברו בה משהו.',
  'ירד גשם.',
  'בבוקר נמצאו הרשתות על החוף, קרועות וסבוכות, והסירה נעלמה.',
  'האצבעות שלה היו נוקשות ומגושמות, אבל הן זכרו מה לעשות.',
  'המכונה הישנה נאנקה, רעדה, והתחילה להסתובב באוויר המלוח והקר.',
  'אמרו ששומר המגדלור החזיק את האור דולק שלושים שנה בלי לתת לו לכבות אפילו פעם אחת.',
];

/** A scene of about `words` words: its properties, a heading, and paragraphs of prose. */
function scene(stock: readonly string[], words: number): string {
  const lines = ['---', 'synopsis: A long scene for timing.', 'status: Draft', '---', '# Scene', ''];
  let seed = 7;
  const next = (below: number): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % below;
  };
  let count = 0;
  for (let paragraph = 0; count < words; paragraph++) {
    const sentences: string[] = [];
    for (let left = 3 + next(4); left > 0; left--) sentences.push(stock[next(stock.length)] ?? '');
    // A number in each paragraph: no two are the same line.
    const text = `${sentences.join(' ')} (${paragraph})`;
    count += text.split(/\s+/).length;
    lines.push(text, '');
  }
  return lines.join('\n');
}

export const WORDS = 5000;
export const ENGLISH_SCENE = scene(ENGLISH, WORDS);
export const HEBREW_SCENE = scene(HEBREW, WORDS);
