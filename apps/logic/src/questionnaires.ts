// The six farmer questionnaires from "USSD Questionnaire" (Zekhethelo, 16 Oct
// 2026). The flag picks the questionnaire. Each has four main questions, and
// each main question has one follow-up for a yes and one for a no, so a farmer
// answers exactly eight yes/no screens.
//
// Questions 1-3 test the flagged disease. Question 4 tests the disease that
// shares its trigger (or, for maize, streak virus, which no weather rule can
// catch). The rules that turn answers into an outcome live with each
// questionnaire here; scoring.ts applies them.
//
// The farmer never sees a disease name. `name`, `key` and `note` are for Felix.
//
// Chichewa (`ny`) text is an unverified draft. Per the source document, every
// question still needs testing with farmers before it is sent to one.

export type Lang = "en" | "ny";
export type Text = Record<Lang, string>;

export const CROPS = ["tomato", "maize", "beans", "cabbage"] as const;
export type Crop = (typeof CROPS)[number];

export const DISEASES = [
  "late_blight",
  "bacterial_wilt",
  "maize_leaf_blights",
  "bean_leaf_diseases",
  "black_rot",
  "clubroot",
] as const;
export type DiseaseId = (typeof DISEASES)[number];

/** How Felix should read a follow-up answered with its concern value. */
export type Role =
  | "detail" // adds detail to a yes, not decisive on its own
  | "spread" // Q3's yes follow-up: the problem is spreading
  | "sign" // an early sign worth re-checking
  | "elsewhere" // points away from the flagged disease
  | "timing" // ties the problem to the last rain
  | "history"; // the problem has been here in past seasons

export interface FollowUp {
  key: string;
  ask: Text;
  role: Role;
  /** The answer that is the worrying one. Almost always yes. */
  concern?: boolean;
  /** Shown to Felix when this follow-up comes back with its concern value. */
  note?: string;
  /** A different problem this answer points to, which Felix should go for. */
  suggests?: string;
}

export interface Question {
  key: string;
  ask: Text;
  yes: FollowUp;
  no: FollowUp;
}

export interface Answer {
  main: boolean;
  follow?: boolean;
}
export type Answers = (Answer | undefined)[];

/** Facts from the flag that change how answers read. */
export interface FlagContext {
  /** Longest unbroken run of leaf-wet hours in the forecast window. */
  leafWetHours?: number;
}

export interface Questionnaire {
  disease: DiseaseId;
  crop: Crop;
  name: string;
  /** The disease question 4 tests. */
  other: string;
  questions: [Question, Question, Question, Question];
  /** The disease the answers confirm for this flag, or null. */
  confirms(a: Answers): string | null;
  /** Whether question 4 confirms the other disease. */
  otherConfirmed(a: Answers): boolean;
  /** A confirmed other disease needs a visit now, whatever else was said. */
  otherUrgent?: boolean;
  /** A confirmed other disease outranks a confirmed flagged one. */
  otherOutranks?: boolean;
  /** Days until the questionnaire should be sent again after a clear result. */
  recheckWhenClear?: number;
  /** Extra notes for Felix that depend on the flag, not the answers. */
  context?(ctx: FlagContext): string | null;
}

/** The plant on its own, for the "which plant?" list. */
export const CROP_NAME: Record<Crop, Text> = {
  tomato: { en: "Tomatoes", ny: "Matimati" },
  maize: { en: "Maize", ny: "Chimanga" },
  beans: { en: "Beans", ny: "Nyemba" },
  cabbage: { en: "Cabbages", ny: "Kabichi" },
};

/** Words a farmer might type for each plant, in English and Chichewa. */
export const CROP_WORDS: Record<string, Crop> = {
  tomato: "tomato",
  tomatoes: "tomato",
  matimati: "tomato",
  maize: "maize",
  corn: "maize",
  chimanga: "maize",
  bean: "beans",
  beans: "beans",
  nyemba: "beans",
  cabbage: "cabbage",
  cabbages: "cabbage",
  kabichi: "cabbage",
};

/** "Your tomatoes" in each language; Chichewa possessives agree with the noun. */
export const CROP_LABEL: Record<Crop, Text> = {
  tomato: { en: "Your tomatoes", ny: "Matimati anu" },
  maize: { en: "Your maize", ny: "Chimanga chanu" },
  beans: { en: "Your beans", ny: "Nyemba zanu" },
  cabbage: { en: "Your cabbages", ny: "Kabichi wanu" },
};

const yes = (a: Answers, i: number) => a[i]?.main === true;
const yesYes = (a: Answers, i: number) => a[i]?.main === true && a[i]?.follow === true;
const noYes = (a: Answers, i: number) => a[i]?.main === false && a[i]?.follow === true;

// Follow-ups that several questionnaires share.

const lowestLeaves: FollowUp = {
  key: "lowest leaves marked",
  role: "sign",
  ask: {
    en: "Look at the lowest leaves near the ground. Are any marked or yellowing?",
    ny: "Yang'anani masamba apansi kwambiri pafupi ndi nthaka. Kodi ena ali ndi mawanga kapena akusanduka achikasu?",
  },
};

const fieldWet: FollowUp = {
  key: "field wet",
  role: "sign",
  ask: {
    en: "Is any part of your field still wet or holding water?",
    ny: "Kodi pali mbali ya munda wanu yomwe idakali yonyowa kapena yosunga madzi?",
  },
};

const worse: Text = {
  en: "Is it worse now than three days ago?",
  ny: "Kodi vutoli lakula kuposa masiku atatu apitawo?",
};

const overHalf: FollowUp = {
  key: "over half the field",
  role: "spread",
  ask: {
    en: "Is it in more than half of your field?",
    ny: "Kodi lafika pa mbali yoposa theka la munda wanu?",
  },
};

const afterRain = (en: string, ny: string): FollowUp => ({ key: "began after heavy rain", role: "timing", ask: { en, ny } });

const sickAfterRain = afterRain(
  "Did the first sick plants show up within a week of the last heavy rain?",
  "Kodi mbewu zoyamba kudwala zinaoneka pasanathe sabata imodzi kuchokera pamene mvula yamphamvu inagwa komaliza?",
);

const wiltingWetGround: Text = {
  en: "Are any plants wilting even though the ground is wet?",
  ny: "Kodi pali mbewu zomwe zikufota ngakhale nthaka ili yonyowa?",
};

const lowestYellowAll: FollowUp = {
  key: "lowest leaves yellow all over",
  role: "elsewhere",
  note: "Lowest leaves yellowing all over points to age or nutrients, not black rot.",
  ask: {
    en: "Are the lowest leaves yellowing all over instead?",
    ny: "Kodi m'malo mwake masamba apansi kwambiri akusanduka achikasu ponseponse?",
  },
};

export const QUESTIONNAIRES: Record<DiseaseId, Questionnaire> = {
  late_blight: {
    disease: "late_blight",
    crop: "tomato",
    name: "late blight",
    other: "bacterial wilt",
    otherUrgent: true,
    // "A yes to both parts of Q4 outranks everything above it."
    otherOutranks: true,
    questions: [
      {
        key: "wet patches",
        ask: {
          en: "Do any leaves have brown or black patches that look wet?",
          ny: "Kodi masamba ena ali ndi mawanga a bulauni kapena akuda ooneka onyowa?",
        },
        yes: {
          key: "bigger than thumbnail",
          role: "detail",
          ask: {
            en: "Are the patches bigger than your thumbnail?",
            ny: "Kodi mawangawo ndi aakulu kuposa chikhadabo cha chala chanu chachikulu?",
          },
        },
        no: lowestLeaves,
      },
      {
        key: "white fuzz",
        ask: {
          en: "After a damp night, is there white fuzz on the underside of the patches?",
          ny: "Pambuyo pa usiku wa chinyontho, kodi pansi pa mawangawo pali ubweya woyera?",
        },
        yes: {
          key: "stem marks",
          role: "detail",
          ask: {
            en: "Are there dark brown marks on the stems as well?",
            ny: "Kodi pa mapesi palinso mawanga a bulauni wakuda?",
          },
        },
        no: {
          key: "dry papery",
          role: "elsewhere",
          note: "Dry, papery patches point to another cause: likely a wrong flag.",
          ask: {
            en: "Are the patches dry and papery rather than wet?",
            ny: "Kodi mawangawo ndi ouma ngati pepala m'malo monyowa?",
          },
        },
      },
      { key: "worse", ask: worse, yes: overHalf, no: sickAfterRain },
      {
        key: "wilt, leaves green",
        ask: {
          en: "Are any whole plants wilting while their leaves are still green?",
          ny: "Kodi pali mbewu zathunthu zomwe zikufota pamene masamba ake akadali obiriwira?",
        },
        yes: {
          key: "recovers at night",
          role: "detail",
          ask: { en: "Do those plants stand up again at night?", ny: "Kodi mbewuzo zimaimiriranso usiku?" },
        },
        no: fieldWet,
      },
    ],
    // "Q2 is the one that decides it."
    confirms: (a) => (yes(a, 1) ? "late blight" : null),
    otherConfirmed: (a) => yesYes(a, 3),
  },

  bacterial_wilt: {
    disease: "bacterial_wilt",
    crop: "tomato",
    name: "bacterial wilt",
    other: "late blight",
    questions: [
      {
        key: "wilt",
        ask: { en: "Are any whole plants wilting?", ny: "Kodi pali mbewu zathunthu zomwe zikufota?" },
        yes: {
          key: "leaves stay green",
          role: "detail",
          ask: {
            en: "Do the wilted leaves stay green instead of turning yellow?",
            ny: "Kodi masamba ofotawo amakhalabe obiriwira m'malo mosanduka achikasu?",
          },
        },
        no: fieldWet,
      },
      {
        key: "recovers at night",
        ask: {
          en: "Do the wilted plants stand up again at night and wilt again during the day?",
          ny: "Kodi mbewu zofotazo zimaimiriranso usiku ndi kufotanso masana?",
        },
        yes: {
          key: "stem base dark brown",
          role: "detail",
          ask: {
            en: "Is the bottom of the stem, near the soil, dark brown?",
            ny: "Kodi tsinde la pesi, pafupi ndi nthaka, ndi la bulauni wakuda?",
          },
        },
        no: {
          key: "lower leaves yellow, dry",
          role: "elsewhere",
          note: "Yellow, dry lower leaves point to water shortage or nitrogen, not disease.",
          ask: { en: "Are the lower leaves yellow and dry?", ny: "Kodi masamba apansi ndi achikasu komanso ouma?" },
        },
      },
      { key: "worse", ask: worse, yes: overHalf, no: sickAfterRain },
      {
        key: "wet patches",
        ask: {
          en: "Do any leaves have brown patches that look wet?",
          ny: "Kodi masamba ena ali ndi mawanga a bulauni ooneka onyowa?",
        },
        yes: {
          key: "white fuzz",
          role: "detail",
          ask: {
            en: "After a damp night, is there white fuzz underneath them?",
            ny: "Pambuyo pa usiku wa chinyontho, kodi pansi pake pali ubweya woyera?",
          },
        },
        no: lowestLeaves,
      },
    ],
    // Green leaves that wilt by day and recover at night: the strongest pair of
    // answers in the set. Yellowing wilted leaves read as drought instead.
    confirms: (a) => (yes(a, 0) && a[0]?.follow !== false && yes(a, 1) ? "bacterial wilt" : null),
    otherConfirmed: (a) => yesYes(a, 3),
  },

  maize_leaf_blights: {
    disease: "maize_leaf_blights",
    crop: "maize",
    name: "maize leaf blights",
    other: "maize streak virus",
    // Streak virus is leafhopper-spread; this is the only way the system hears of it.
    otherUrgent: true,
    questions: [
      {
        key: "long marks",
        ask: {
          en: "Do the lower leaves have long marks running along them?",
          ny: "Kodi masamba apansi ali ndi mizere yaitali yotsatira utali wa tsamba?",
        },
        yes: {
          key: "longer than finger",
          role: "detail",
          ask: { en: "Are the marks longer than your finger?", ny: "Kodi mizereyo ndi yaitali kuposa chala chanu?" },
        },
        no: {
          key: "lowest leaves yellow from tip",
          role: "sign",
          ask: {
            en: "Are the lowest leaves yellowing from the tip inwards?",
            ny: "Kodi masamba apansi kwambiri akusanduka achikasu kuyambira kunsonga kulowa mkati?",
          },
        },
      },
      {
        key: "rectangles",
        ask: {
          en: "Are the marks rectangles with straight sides?",
          ny: "Kodi mizereyo ndi yamakona anayi yokhala ndi mbali zowongoka?",
        },
        yes: {
          key: "grey/tan centre",
          role: "detail",
          ask: { en: "Are they grey or tan in the middle?", ny: "Kodi pakati pake ndi pa imvi kapena pa bulauni wopepuka?" },
        },
        no: {
          key: "cigar shapes",
          role: "detail",
          ask: {
            en: "Are they long cigar shapes with pointed ends?",
            ny: "Kodi ndi zazitali ngati ndudu, zosongoka kumapeto?",
          },
        },
      },
      {
        key: "worse",
        ask: worse,
        // For maize the cob matters more than field coverage: leaf area above
        // the cob fills the grain.
        yes: {
          key: "above the cob",
          role: "spread",
          note: "Damage above the cob costs yield.",
          ask: { en: "Has it reached the leaves above the cob?", ny: "Kodi lafika pa masamba apamwamba pa chisononkho?" },
        },
        no: afterRain(
          "Did the first marks show up within a week of the last heavy rain?",
          "Kodi mizere yoyamba inaoneka pasanathe sabata imodzi kuchokera pamene mvula yamphamvu inagwa komaliza?",
        ),
      },
      {
        key: "stripes, stunted",
        ask: {
          en: "Are there yellow or pale stripes running the full length of the leaves, on stunted plants?",
          ny: "Kodi pa mbewu zosakula bwino pali mizere yachikasu kapena yotuwa yotsatira utali wonse wa masamba?",
        },
        yes: {
          key: "on newest leaves",
          role: "detail",
          ask: {
            en: "Are the stripes on the newest leaves at the top?",
            ny: "Kodi mizereyo ili pa masamba atsopano kwambiri apamwamba?",
          },
        },
        no: {
          key: "normal height",
          role: "sign",
          concern: false,
          ask: {
            en: "Are the plants a normal height for this stage?",
            ny: "Kodi mbewuzo zatalika moyenera pa msinkhu umenewu?",
          },
        },
      },
    ],
    // One flag covers two diseases; Q2 tells them apart.
    confirms: (a) => {
      if (!yes(a, 0)) return null;
      if (yesYes(a, 1)) return "grey leaf spot";
      if (noYes(a, 1)) return "northern leaf blight";
      return null;
    },
    // "A yes here should go to Felix as urgent regardless of every other answer."
    otherConfirmed: (a) => yes(a, 3),
  },

  bean_leaf_diseases: {
    disease: "bean_leaf_diseases",
    crop: "beans",
    name: "bean leaf diseases",
    other: "bean root rot",
    questions: [
      {
        key: "spots",
        ask: { en: "Do the leaves have spots or marks?", ny: "Kodi masamba ali ndi mawanga kapena zizindikiro?" },
        yes: {
          key: "over ten spots on a leaf",
          role: "detail",
          ask: {
            en: "Are there more than ten spots on one leaf?",
            ny: "Kodi pali mawanga oposa khumi pa tsamba limodzi?",
          },
        },
        no: lowestLeaves,
      },
      {
        key: "straight edges at veins",
        ask: {
          en: "Do the spots have straight edges that stop where the leaf veins are?",
          ny: "Kodi mawangawo ali ndi m'mphepete mowongoka omwe amaima pamene pali mitsempha ya tsamba?",
        },
        yes: {
          key: "grey/brown centre",
          role: "detail",
          ask: { en: "Are they grey or brown in the middle?", ny: "Kodi pakati pake ndi pa imvi kapena pa bulauni?" },
        },
        no: {
          key: "rust powder",
          role: "detail",
          ask: {
            en: "Is there rust-coloured powder underneath that rubs onto your finger?",
            ny: "Kodi pansi pake pali ufa wa mtundu wa dzimbiri umene umamatira pa chala chanu?",
          },
        },
      },
      {
        key: "worse",
        ask: worse,
        yes: overHalf,
        no: afterRain(
          "Did the first spots show up within a week of the last heavy rain?",
          "Kodi mawanga oyamba anaoneka pasanathe sabata imodzi kuchokera pamene mvula yamphamvu inagwa komaliza?",
        ),
      },
      {
        key: "wilting or gaps",
        ask: {
          en: "Are whole plants wilting, or are there gaps where young plants died?",
          ny: "Kodi mbewu zathunthu zikufota, kapena pali mipata pamene mbewu zazing'ono zinafa?",
        },
        yes: {
          key: "stem rotten at soil",
          role: "detail",
          ask: {
            en: "Is the stem brown or rotten where it meets the soil?",
            ny: "Kodi pesi ndi la bulauni kapena lowola pamene limakumana ndi nthaka?",
          },
        },
        no: fieldWet,
      },
    ],
    confirms: (a) => {
      if (!yes(a, 0)) return null;
      if (yesYes(a, 1)) return "angular leaf spot";
      if (noYes(a, 1)) return "bean rust";
      return null;
    },
    otherConfirmed: (a) => yesYes(a, 3),
    // Rust needs 10 wet hours, angular leaf spot 24 to 48.
    context: ({ leafWetHours }) => {
      if (leafWetHours === undefined) return null;
      return leafWetHours >= 24
        ? `Leaves wet ${leafWetHours} h: angular leaf spot and rust both likely.`
        : `Leaves wet ${leafWetHours} h: points at rust more than angular leaf spot.`;
    },
  },

  black_rot: {
    disease: "black_rot",
    crop: "cabbage",
    name: "black rot",
    other: "clubroot",
    // Symptoms take 10-14 days at 25 °C, so a clean result may only be early.
    recheckWhenClear: 7,
    questions: [
      {
        key: "leaf edges yellow",
        ask: {
          en: "Are the edges of any leaves turning yellow or brown?",
          ny: "Kodi m'mphepete mwa masamba ena mukusanduka achikasu kapena a bulauni?",
        },
        yes: {
          key: "V shape",
          role: "detail",
          ask: {
            en: "Do the yellow patches point inwards from the edge, like a V?",
            ny: "Kodi mawanga achikasuwo amaloza mkati kuchokera m'mphepete, ngati chilembo V?",
          },
        },
        no: lowestYellowAll,
      },
      {
        key: "black veins",
        ask: {
          en: "Cut across a leaf stalk. Are the veins inside it black?",
          ny: "Dulani phesi la tsamba. Kodi mitsempha ya mkati mwake ndi yakuda?",
        },
        yes: {
          key: "black into main stem",
          role: "detail",
          note: "Black runs into the main stem: infected right through, will not recover.",
          ask: {
            en: "Does the black run down into the main stem?",
            ny: "Kodi kuda kumeneko kumapitirira mpaka mu tsinde lalikulu?",
          },
        },
        no: {
          key: "dry papery",
          role: "elsewhere",
          note: "Dry, papery patch without black veins: likely not black rot.",
          ask: { en: "Is the patch dry and papery?", ny: "Kodi banga lija ndi louma ngati pepala?" },
        },
      },
      {
        key: "worse",
        ask: worse,
        yes: overHalf,
        no: afterRain(
          "Did it start within a week of the last heavy rain?",
          "Kodi vutoli linayamba pasanathe sabata imodzi kuchokera pamene mvula yamphamvu inagwa komaliza?",
        ),
      },
      {
        key: "wilting on wet ground",
        ask: wiltingWetGround,
        yes: {
          key: "roots swollen",
          role: "detail",
          ask: {
            en: "Pull one up. Are the roots swollen or lumpy?",
            ny: "Zulani imodzi. Kodi mizu yake ndi yotupa kapena yamapundu?",
          },
        },
        no: fieldWet,
      },
    ],
    // "Black veins inside the cut are the answer that confirms it."
    confirms: (a) => (yes(a, 1) ? "black rot" : null),
    otherConfirmed: (a) => yesYes(a, 3),
  },

  clubroot: {
    disease: "clubroot",
    crop: "cabbage",
    name: "clubroot",
    other: "black rot",
    questions: [
      {
        key: "wilting on wet ground",
        ask: wiltingWetGround,
        yes: {
          key: "recovers overnight",
          role: "detail",
          ask: {
            en: "Do they recover a little overnight and wilt again the next day?",
            ny: "Kodi zimatsitsimuka pang'ono usiku ndi kufotanso tsiku lotsatira?",
          },
        },
        no: {
          key: "smaller or paler",
          role: "sign",
          ask: {
            en: "Are any plants smaller or paler than the rest around them?",
            ny: "Kodi pali mbewu zazing'ono kapena zotuwa kuposa zina zozungulira?",
          },
        },
      },
      {
        key: "roots swollen",
        ask: {
          en: "Pull up one sick plant. Are the roots swollen, lumpy or club-shaped?",
          ny: "Zulani mbewu imodzi yodwala. Kodi mizu yake ndi yotupa, yamapundu kapena yooneka ngati chibonga?",
        },
        yes: {
          key: "main root swollen too",
          role: "detail",
          ask: {
            en: "Are the swellings on the thick main root as well as the fine side roots?",
            ny: "Kodi zotupazo zili pa muzu waukulu komanso pa mizu ing'onoing'ono ya m'mbali?",
          },
        },
        no: {
          key: "roots dark, rotten",
          role: "elsewhere",
          note: "Dark, rotten roots without swelling: a different root problem, not clubroot.",
          suggests: "root rot",
          ask: { en: "Are the roots dark and rotten instead?", ny: "Kodi m'malo mwake mizu ndi yakuda komanso yowola?" },
        },
      },
      {
        key: "worse",
        ask: worse,
        yes: overHalf,
        no: {
          key: "same spot past seasons",
          role: "history",
          note: "Same spot in past seasons: field likely infested for 10+ years. Talk rotation and liming, not a spray.",
          ask: {
            en: "Has this happened in the same part of the field in past seasons?",
            ny: "Kodi izi zinachitikapo pa mbali yomweyi ya munda m'nyengo zapitazo?",
          },
        },
      },
      {
        key: "V-shaped yellow edges",
        ask: {
          en: "Are the edges of any leaves turning yellow in a V shape from the edge inwards?",
          ny: "Kodi m'mphepete mwa masamba ena mukusanduka achikasu mooneka ngati chilembo V kuchokera m'mphepete kulowa mkati?",
        },
        yes: {
          key: "black veins",
          role: "detail",
          ask: { en: "Are the veins inside the patch black?", ny: "Kodi mitsempha ya mkati mwa bangalo ndi yakuda?" },
        },
        no: { ...lowestYellowAll, note: "Lowest leaves yellowing all over points to age or nutrients." },
      },
    ],
    // "Q2 is the whole questionnaire."
    confirms: (a) => (yes(a, 1) ? "clubroot" : null),
    otherConfirmed: (a) => yesYes(a, 3),
  },
};
