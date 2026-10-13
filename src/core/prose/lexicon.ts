// The English word lists behind the colouring of nouns, verbs, adjectives and
// adverbs. They are Spellbook's own: a few hundred of the commonest words of
// fiction, written out by hand. A word that is not listed is guessed from its
// ending (see tagger.ts).
//
// A word that can be more than one thing is listed with all of them, the
// likeliest first: "light" is JNV (an adjective, a noun or a verb). The words
// around it decide.
//
//   N noun   V verb   J adjective   R adverb

/** The small words of the language. They are never coloured, but they tell what the next word is. */
export type ClosedTag = 'DET' | 'POSS' | 'PRON' | 'SUBJ' | 'PREP' | 'CONJ' | 'BE' | 'HAVE' | 'DO' | 'MODAL' | 'TO' | 'NUM' | 'OTHER';

const closed = new Map<string, ClosedTag>();
const open = new Map<string, string>();

function close(tag: ClosedTag, words: string): void {
  for (const word of words.split(/\s+/)) if (word !== '') closed.set(word, tag);
}

/** The first listing of a word stands: the lists of words with several uses come first. */
function add(uses: string, words: string): void {
  for (const word of words.split(/\s+/)) if (word !== '' && !open.has(word)) open.set(word, uses);
}

close('DET', 'the a an this that these those some any no every each either neither another such what which whose all both half many much few several enough');
close('POSS', 'my your his her its our their');
close('SUBJ', 'i you he she we they it who');
close(
  'PRON',
  'me us him them myself yourself himself herself itself ourselves themselves whom whoever someone somebody something anyone anybody anything ' +
    'everyone everybody everything nobody nothing none mine yours hers ours theirs there',
);
close(
  'PREP',
  'of in on at by for with from into onto upon over under above below between among through across against along around behind beside beyond ' +
    'during before after until till toward towards within without about near off out up down past since inside outside beneath underneath ' +
    'despite except like than per via amid throughout',
);
close('CONJ', 'and or but nor so yet because although though while when whenever where wherever if unless whether as once why how');
close('BE', "am is are was were be been being isn't aren't wasn't weren't ain't");
close('HAVE', "have has had having haven't hasn't hadn't");
close('DO', "do does did don't doesn't didn't");
close('MODAL', "can could will would shall should may might must ought cannot can't couldn't won't wouldn't shan't shouldn't mightn't mustn't let's");
close('TO', 'to');
close(
  'NUM',
  'one two three four five six seven eight nine ten eleven twelve twenty thirty forty fifty hundred thousand million dozen',
);
close('OTHER', 'oh ah yes yeah okay ok hey hello please mr mrs ms dr');

// ------------------------------------------------- words with more than one use

add(
  'NV',
  'hand eye face head shoulder voice rain snow wind fire water rock dust name word line question answer fear pain silence shadow colour color ' +
    'shape cup lock pocket ring phone train fish shop corner edge space step power dream mind sense tear point wave force attack trip matter ' +
    'seat bank board book bottle bridge button camp chain coat crowd dance dress fence finger floor flower fool frame garden guard ' +
    'hammer harbour harbor heat honour honor house judge knot land map mark market mask mirror nail note number order paint paper park ' +
    'part picture place plan plant plate post pound price reason rope salt sail scale school shade ship sign smoke stage stain stamp stone ' +
    'storm string table taste thread tide time title track trap tree view wall weight wheel whip wire wound smell blood',
);
add(
  'VN',
  'work walk talk wait watch stop start stay turn move pull push reach pass cross climb jump lift drop pick press shout whisper cry scream sigh ' +
    'nod shrug stare gaze frown grin wonder notice reply promise offer help use change return finish study play wish worry care rest hurry ' +
    'rush travel visit search trust doubt guess count check show tie escape slip roll glow gleam drift pause murmur snap crack echo cover ' +
    'cook laugh smile kiss look glance touch love hope lie thought run set cut hit miss sort call end fall fight fly ride rise shake sleep ' +
    'swim swing throw bite blow break build burn catch deal dig draw drink drive feed feel hold keep leap ' +
    'meet pay read shoot shut spin stand steal stick strike sweep win bend bow breath kick knock need shiver slide spill split spread ' +
    'stretch struggle surprise switch tap wake want wash whistle yawn act aim approach arrest bet claim delay demand flash grip hunt ' +
    'limp march pinch rattle remark request rescue sip sob stir support twist view whirl',
);
add('JN', 'cold dark quiet whole safe flat white orange human general public patient sweet second gold silver stone middle top bottom front secret firm chief kind young poor rich dead future present');
add('RN', 'back');
add('JNV', 'light sound');
add('JV', 'open warm cool wet dry clean clear calm slow free empty narrow smooth perfect separate own steady faint dim');
add('VJ', 'broken frozen hidden burnt drunk tired worn torn close hurt lost shut left');
add('JR', 'late early hard fast deep straight little pretty last next first long alone high low right wrong');
add('RJ', 'still just well even only far');

// ------------------------------------------------------------------ verbs

add(
  'V',
  'go come see take give get make know think tell say leave begin find hear bring buy teach sell send spend lose lead mean put let speak ' +
    'write grow wear swear choose freeze hide forget eat sing sink weep creep kneel hang shine seek lay lend sting cling fling understand ' +
    'become forgive flee bleed speed ask seem try live believe happen listen remember follow carry raise realize realise decide suppose ' +
    'imagine expect explain describe mention agree refuse allow arrive enter appear disappear continue learn kill die marry hate enjoy ' +
    'belong remain exist occur gather fill pour breathe swallow lean wander discover recognize recognise add fix save serve admit warn ' +
    'beg pray heal settle tremble flicker float sway crawl stumble hesitate linger mutter creak fade vanish emerge thank stare glare ' +
    'went gone came saw seen took taken gave given got gotten made knew known told said felt kept held stood sat ran began begun fell ' +
    'fallen found heard brought bought caught taught sold sent spent built met paid led meant spoke spoken wrote written drove driven ' +
    'rode ridden rose risen grew grown threw thrown drew drawn flew flown blew blown wore swore sworn woke woken chose chosen froze stole ' +
    'stolen hid forgot forgotten ate eaten drank sang sung swam swum rang rung sank sunk slept wept swept crept leapt dealt knelt dreamt ' +
    'hung stuck struck dug won shone shot fought sought laid lain slid bent lent spun stung swung clung flung understood became ' +
    'shook shaken forgave forgiven bit bitten fed fled bled bred sped lit tore broke born bore done doing does',
);

// ------------------------------------------------------------------ nouns

add(
  'N',
  'year day night morning evening afternoon week month hour minute moment man woman child children boy girl people person men women friend ' +
    'mother father sister brother son daughter husband wife family baby king queen doctor captain stranger neighbour neighbor teacher ' +
    'soldier home room door window roof kitchen bedroom street road path city town village country world sea ocean river lake shore ' +
    'beach boat island mountain hill forest wood woods field sky sun moon star cloud air earth ground sand hair mouth lip nose ear arm leg ' +
    'foot feet heart body neck skin bone tooth teeth thing way side piece bit lot story letter page idea truth fact problem life death ' +
    'anger joy noise darkness chair bed desk lamp glass knife key box bag hat shoe shirt clock car bus horse dog cat bird food bread ' +
    'coffee tea wine money job church office station hotel hospital centre center distance stairs hall gate war peace law god memory ' +
    'soul feeling summer winter spring autumn weather today tomorrow yesterday tonight animal arrival signal metal belly bully jelly ' +
    'lily ally reply supply butterfly assembly folly valley army party lady body city company enemy history victory mystery ' +
    'century country duty beauty journey money honey monkey turkey chimney alley abbey penny pony puppy daddy mummy study ' +
    'parent student moment silence evening morning ceiling wedding ' +
    'water daughter laughter winter dinner supper corner finger paper letter number river silver shoulder soldier stranger danger ' +
    'anger butter matter master sister brother mother father weather feather leather answer power flower tower shower officer ' +
    'bed shed seed weed deed need speed breed thread hundred kindred sacred news glass grass class dress boss loss cross ' +
    'business darkness harness witness princess goddess address success distress mattress fortress progress',
);

// -------------------------------------------------------------- adjectives

add(
  'J',
  'good bad big small large great short tall old new hot soft heavy bright pale shallow wide thick thin fat full loud silent quick sudden ' +
    'strange familiar real true false sure certain plain simple easy difficult possible impossible important different same other ' +
    'entire single lonely happy sad angry afraid glad sorry sick ill alive strong weak busy ready dangerous beautiful ugly lovely nice ' +
    'fine terrible awful wonderful gentle rough sharp dull round tiny huge enormous vast black red blue green yellow grey gray brown ' +
    'golden pink purple bare naked blind deaf mad wild tame bitter sour fresh raw rotten ancient modern final main distant foreign local ' +
    'wooden careful careless serious curious anxious nervous proud ashamed eager polite rude honest brave cruel clever stupid foolish ' +
    'wise innocent guilty private common usual normal special particular likely unlikely obvious apparent vague loose tight stiff damp ' +
    'friendly silly holy deadly lively elderly costly ghostly kindly daily weekly curly chilly hilly oily woolly jolly burly surly sly ' +
    'shy ugly early interested worried excited surprised pleased scared frightened bored exhausted crowded married hungry thirsty ' +
    'sleepy weary dirty dusty empty heavy pretty ready steady tidy tiny easy busy lazy crazy noisy rosy grey ' +
    'better best worse worst less least more most elder eldest former latter inner outer upper lower proper eager clever bitter tender ' +
    'sober sinister silent absent ancient decent distant instant pleasant present recent urgent violent',
);

// ----------------------------------------------------------------- adverbs

add(
  'R',
  'not never always often sometimes seldom again once twice soon now then here everywhere somewhere nowhere anywhere away forward forwards ' +
    'backward backwards together apart ahead aside already ever also too very quite rather almost nearly perhaps maybe instead anyway ' +
    'however otherwise therefore thus hence meanwhile afterwards afterward later sooner earlier indoors outdoors upstairs downstairs ' +
    'abroad somehow somewhat anymore forever indeed besides further twice nevertheless nonetheless moreover overhead underfoot',
);

/** What a small word of the language is, or undefined for any other word. */
export function closedTag(word: string): ClosedTag | undefined {
  return closed.get(word);
}

/** What a listed word can be ("N", "VN", "JNV"...), or undefined when it is not listed. */
export function usesOf(word: string): string | undefined {
  return open.get(word);
}

/** Adverbs that say how much: the word after them is an adjective or an adverb. */
export const DEGREE_WORDS = new Set(
  'very so too quite rather more most less least really extremely fairly almost nearly utterly somewhat slightly incredibly terribly awfully how as'.split(' '),
);

/** Verbs that are followed by an adjective: "she seemed tired". */
export const LINKING_VERBS = new Set(
  ('seem seems seemed seeming look looks looked looking feel feels felt feeling become becomes became becoming grow grows grew growing ' +
    'remain remains remained stay stays stayed sound sounds sounded smell smells smelled taste tastes tasted appear appears appeared ' +
    'get gets got getting turn turns turned').split(' '),
);
