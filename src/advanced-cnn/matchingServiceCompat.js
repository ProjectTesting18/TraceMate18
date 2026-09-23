/**
 * TraceMate Hybrid Matching Engine
 *
 * Combines:
 *  - category
 *  - item name similarity
 *  - description/property similarity
 *  - color
 *  - brand
 *  - object type
 *  - distinctive features
 *  - semantic/contextual location understanding
 *  - date
 *  - detected image labels
 *  - MobileNetV2 image embedding
 *  - CLIP image embedding
 *
 * IMPORTANT:
 * The returned `score` is a MATCH SCORE, not measured model accuracy.
 *
 * Visual AI:
 *   MobileNetV2 = 40%
 *   CLIP        = 60%
 *
 * The visual models share the existing 10-point CNN/visual
 * contribution so the overall score remains 0-100.
 *
 * Location intelligence:
 *   "near canteen"
 *   "near front gate of canteen"
 *
 * is understood as:
 *   same landmark + more specific sub-location.
 */

const W = {
  category: 20,
  nameText: 15,
  description: 20,
  location: 10,
  date: 10,
  properties: 10,
  imageLabels: 5,
  cnnImage: 10
};


const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'had',
  'has',
  'have',
  'i',
  'in',
  'is',
  'it',
  'its',
  'near',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'was',
  'were',
  'with',
  'my',
  'me',
  'very',
  'item',
  'found',
  'lost',
  'there',
  'here',
  'around',
  'area',
  'place',
  'location'
]);


/*
 * Normalize common spelling differences and object terminology.
 */
const SYNONYMS = new Map([
  ['backpack', 'bag'],
  ['rucksack', 'bag'],
  ['handbag', 'bag'],
  ['purse', 'bag'],
  ['schoolbag', 'bag'],

  ['mobile', 'phone'],
  ['cellphone', 'phone'],
  ['smartphone', 'phone'],
  ['mobilephone', 'phone'],

  ['notebook', 'laptop'],
  ['macbook', 'laptop'],

  ['spectacles', 'glasses'],
  ['eyeglasses', 'glasses'],

  ['wallets', 'wallet'],
  ['keys', 'key'],

  ['grey', 'gray'],

  ['grafitee', 'graffiti'],
  ['grafite', 'graffiti'],
  ['graffity', 'graffiti'],
  ['graphic', 'graffiti'],
  ['graphics', 'graffiti'],

  ['company', 'brand'],
  ['manufacturer', 'brand'],

  ['colour', 'color'],

  ['jewellery', 'jewelry'],
  ['ornament', 'jewelry'],

  ['earbud', 'earphone'],
  ['earbuds', 'earphone'],
  ['headphones', 'headphone'],

  /*
   * Location terminology.
   */
  ['entrance', 'gate'],
  ['entry', 'gate'],
  ['doorway', 'gate'],
  ['door', 'gate'],
  ['frontdoor', 'gate'],
  ['mainentrance', 'gate'],
  ['mainentranceway', 'gate'],

  ['outside', 'near'],
  ['beside', 'near'],
  ['nextto', 'near'],
  ['adjacent', 'near'],

  ['canteens', 'canteen'],
  ['libraries', 'library'],
  ['classrooms', 'classroom'],
  ['hostels', 'hostel'],
  ['buildings', 'building'],
  ['gates', 'gate']
]);


function safeString(value) {
  return value == null
    ? ''
    : String(value);
}


function normalizeToken(token) {
  let value =
    safeString(token)
      .toLowerCase()
      .trim();

  if (!value) {
    return '';
  }

  value =
    value.replace(
      /[-_]/g,
      ''
    );

  if (SYNONYMS.has(value)) {
    return SYNONYMS.get(value);
  }

  if (
    value.endsWith('ies') &&
    value.length > 4
  ) {
    value =
      `${value.slice(0, -3)}y`;
  }

  for (
    const suffix of [
      'ingly',
      'edly',
      'ing',
      'ed',
      'es',
      's'
    ]
  ) {
    if (
      value.length >
        suffix.length + 3 &&
      value.endsWith(suffix)
    ) {
      let candidate =
        value.slice(
          0,
          -suffix.length
        );

      if (
        candidate.endsWith('i') &&
        suffix === 'es'
      ) {
        candidate =
          `${candidate.slice(0, -1)}y`;
      }

      value = candidate;
      break;
    }
  }

  if (SYNONYMS.has(value)) {
    value =
      SYNONYMS.get(value);
  }

  return value;
}


function tokens(value) {
  return (
    safeString(value)
      .toLowerCase()
      .match(/[a-z0-9]+/g)
      ?.map(normalizeToken)
      .filter(
        token =>
          token.length >= 2 &&
          !STOP_WORDS.has(token)
      ) || []
  );
}


function uniqueTokens(value) {
  return [
    ...new Set(
      tokens(value)
    )
  ];
}


/*
 * Generic deterministic text similarity.
 */
function textSimilarity(a, b) {
  const aa =
    uniqueTokens(a);

  const bb =
    uniqueTokens(b);

  if (
    !aa.length ||
    !bb.length
  ) {
    return 0;
  }

  const sa =
    new Set(aa);

  const sb =
    new Set(bb);

  const intersection =
    [...sa].filter(
      token =>
        sb.has(token)
    ).length;

  if (!intersection) {

    let fuzzyMatches = 0;

    for (
      const aToken of sa
    ) {
      for (
        const bToken of sb
      ) {
        if (
          aToken.length >= 5 &&
          bToken.length >= 5 &&
          (
            aToken.startsWith(
              bToken.slice(0, 4)
            ) ||
            bToken.startsWith(
              aToken.slice(0, 4)
            )
          )
        ) {
          fuzzyMatches += 1;
          break;
        }
      }
    }

    if (!fuzzyMatches) {
      return 0;
    }

    return Math.min(
      1,
      fuzzyMatches /
        Math.max(
          sa.size,
          sb.size
        )
    );
  }

  const dice =
    (
      2 * intersection
    ) /
    (
      sa.size +
      sb.size
    );

  const jaccard =
    intersection /
    new Set([
      ...sa,
      ...sb
    ]).size;

  let prefixMatches = 0;

  for (
    const aToken of sa
  ) {
    if (
      [...sb].some(
        bToken =>
          aToken.length >= 4 &&
          bToken.length >= 4 &&
          (
            aToken.startsWith(
              bToken.slice(0, 4)
            ) ||
            bToken.startsWith(
              aToken.slice(0, 4)
            )
          )
      )
    ) {
      prefixMatches += 1;
    }
  }

  const prefix =
    prefixMatches /
    Math.max(
      sa.size,
      sb.size
    );

  return Math.min(
    1,
    dice * 0.55 +
    jaccard * 0.25 +
    prefix * 0.20
  );
}


/*
 * Extract useful object properties from free text.
 */
function extractProperties(item = {}) {

  const text = [
    item.name,
    item.itemName,
    item.desc,
    item.description,
    item.details,
    item.features,
    item.color,
    item.brand,
    item.type
  ]
    .map(safeString)
    .join(' ');

  const result = {
    colors: [],
    brands: [],
    objectTypes: [],
    features: []
  };

  const normalized =
    new Set(
      tokens(text)
    );

  const colorWords = [
    'black',
    'white',
    'red',
    'blue',
    'green',
    'yellow',
    'orange',
    'pink',
    'purple',
    'brown',
    'gray',
    'grey',
    'silver',
    'gold',
    'dark blue',
    'light blue',
    'dark green',
    'light green'
  ];

  const brandWords = [
    'skybag',
    'nike',
    'adidas',
    'puma',
    'apple',
    'samsung',
    'oneplus',
    'hp',
    'dell',
    'lenovo',
    'boat',
    'wildcraft',
    'american tourister',
    'samsonite'
  ];

  const objectWords = [
    'bag',
    'backpack',
    'wallet',
    'phone',
    'laptop',
    'tablet',
    'watch',
    'key',
    'keys',
    'bottle',
    'umbrella',
    'book',
    'notebook',
    'headphone',
    'earphone',
    'glasses',
    'document',
    'jewelry',
    'jewellery'
  ];

  const featureAliases = {
    logo: 'logo',

    graffiti: 'graffiti',
    grafitee: 'graffiti',
    grafite: 'graffiti',
    graffity: 'graffiti',
    graphic: 'graffiti',
    graphics: 'graffiti',

    zipper: 'zipper',
    zip: 'zipper',

    pocket: 'pocket',
    strap: 'strap',
    handle: 'handle',
    wheel: 'wheel',
    sticker: 'sticker',
    design: 'design',
    pattern: 'pattern',
    mark: 'mark',
    scratch: 'scratch',
    dent: 'dent',
    cover: 'cover',
    screen: 'screen',
    case: 'case',

    print: 'print',
    printed: 'print'
  };


  /*
   * Colors.
   */
  for (
    const color of colorWords
  ) {

    const colorTokens =
      tokens(color);

    if (
      colorTokens.length === 1 &&
      normalized.has(
        colorTokens[0]
      )
    ) {
      result.colors.push(
        normalizeToken(color)
      );

    } else if (
      colorTokens.length > 1 &&
      colorTokens.every(
        token =>
          normalized.has(token)
      )
    ) {

      result.colors.push(
        normalizeToken(color)
      );
    }
  }


  /*
   * Brands.
   */
  for (
    const brand of brandWords
  ) {

    const brandTokens =
      tokens(brand);

    if (
      brandTokens.length &&
      brandTokens.every(
        token =>
          normalized.has(token)
      )
    ) {

      result.brands.push(
        normalizeToken(brand)
      );
    }
  }


  /*
   * Object type.
   */
  for (
    const objectType of objectWords
  ) {

    const objectTokens =
      tokens(objectType);

    if (
      objectTokens.length &&
      objectTokens.some(
        token =>
          normalized.has(token)
      )
    ) {

      result.objectTypes.push(
        normalizeToken(
          objectType
        )
      );
    }
  }


  /*
   * Distinctive features.
   */
  for (
    const [
      alias,
      canonical
    ] of Object.entries(
      featureAliases
    )
  ) {

    const aliasTokens =
      tokens(alias);

    if (
      aliasTokens.length &&
      aliasTokens.every(
        token =>
          normalized.has(token)
      )
    ) {

      result.features.push(
        canonical
      );
    }
  }


  /*
   * Explicit structured fields.
   */
  for (
    const color of safeString(
      item.color
    )
      .split(/[,\s]+/)
      .filter(Boolean)
  ) {

    result.colors.push(
      normalizeToken(color)
    );
  }


  if (item.brand) {

    const brandTokens =
      tokens(item.brand);

    if (brandTokens.length) {

      result.brands.push(
        ...brandTokens
      );
    }
  }


  return {
    colors: [
      ...new Set(
        result.colors
          .filter(Boolean)
      )
    ],

    brands: [
      ...new Set(
        result.brands
          .filter(Boolean)
      )
    ],

    objectTypes: [
      ...new Set(
        result.objectTypes
          .filter(Boolean)
      )
    ],

    features: [
      ...new Set(
        result.features
          .filter(Boolean)
      )
    ]
  };
}


function overlapScore(
  a = [],
  b = []
) {

  const aa =
    new Set(
      a.map(normalizeToken)
    );

  const bb =
    new Set(
      b.map(normalizeToken)
    );

  if (
    !aa.size ||
    !bb.size
  ) {
    return 0;
  }

  const intersection =
    [...aa].filter(
      x =>
        bb.has(x)
    ).length;

  return (
    intersection /
    Math.max(
      1,
      Math.min(
        aa.size,
        bb.size
      )
    )
  );
}


/*
 * Semantic-style deterministic text similarity.
 */
function semanticTextSimilarity(a, b) {

  const base =
    textSimilarity(
      a,
      b
    );

  if (
    !safeString(a).trim() ||
    !safeString(b).trim()
  ) {
    return 0;
  }

  const left =
    extractProperties({
      description: a
    });

  const right =
    extractProperties({
      description: b
    });

  const brand =
    overlapScore(
      left.brands,
      right.brands
    );

  const color =
    overlapScore(
      left.colors,
      right.colors
    );

  const objectType =
    overlapScore(
      left.objectTypes,
      right.objectTypes
    );

  const features =
    overlapScore(
      left.features,
      right.features
    );

  const conceptEvidence =
    brand * 0.30 +
    color * 0.10 +
    objectType * 0.20 +
    features * 0.40;

  return Math.min(
    1,
    base * 0.70 +
    conceptEvidence * 0.30
  );
}


function nlpTextScore(
  a,
  b,
  weight
) {

  return Math.round(
    semanticTextSimilarity(
      a,
      b
    ) * weight
  );
}


/*
 * Calculate object-property similarity.
 */
function propertySimilarity(
  lost,
  found
) {

  const a =
    extractProperties(lost);

  const b =
    extractProperties(found);

  const color =
    overlapScore(
      a.colors,
      b.colors
    );

  const brand =
    overlapScore(
      a.brands,
      b.brands
    );

  const objectType =
    overlapScore(
      a.objectTypes,
      b.objectTypes
    );

  const features =
    overlapScore(
      a.features,
      b.features
    );

  const combined =
    brand * 0.35 +
    color * 0.20 +
    objectType * 0.15 +
    features * 0.30;

  return {
    score:
      Math.min(
        1,
        combined
      ),

    details: {
      color,
      brand,
      objectType,
      features,
      lost: a,
      found: b
    }
  };
}


function categoryScore(
  a,
  b
) {

  const aa =
    safeString(a)
      .trim()
      .toLowerCase();

  const bb =
    safeString(b)
      .trim()
      .toLowerCase();

  if (
    !aa ||
    !bb
  ) {
    return 0;
  }

  if (aa === bb) {
    return W.category;
  }

  const related = {

    wallet: [
      'accessories',
      'bag'
    ],

    bag: [
      'accessories',
      'wallet'
    ],

    accessories: [
      'bag',
      'wallet'
    ],

    jewellery: [
      'accessories'
    ],

    jewelry: [
      'accessories'
    ],

    books: [
      'documents'
    ],

    documents: [
      'books'
    ]
  };

  if (
    related[aa]?.includes(bb) ||
    related[bb]?.includes(aa)
  ) {

    return Math.round(
      W.category * 0.5
    );
  }

  return 0;
}


function dateScore(
  a,
  b
) {

  if (
    !a ||
    !b
  ) {
    return 0;
  }

  const d1 =
    new Date(a);

  const d2 =
    new Date(b);

  if (
    Number.isNaN(
      d1.getTime()
    ) ||
    Number.isNaN(
      d2.getTime()
    )
  ) {
    return 0;
  }

  const signedDiff =
    (
      d2.getTime() -
      d1.getTime()
    ) / 86400000;

  if (
    signedDiff < -1
  ) {
    return 0;
  }

  const diff =
    Math.abs(
      signedDiff
    );

  if (
    diff <= 1
  ) {
    return W.date;
  }

  if (
    diff <= 3
  ) {
    return Math.round(
      W.date * 0.8
    );
  }

  if (
    diff <= 7
  ) {
    return Math.round(
      W.date * 0.5
    );
  }

  if (
    diff <= 14
  ) {
    return Math.round(
      W.date * 0.25
    );
  }

  return 0;
}


function colorBrandScore(
  lost,
  found
) {

  const properties =
    propertySimilarity(
      lost,
      found
    );

  const value =
    properties.score;

  return Math.min(
    Math.round(
      value *
      W.properties
    ),
    W.properties
  );
}


function labelScore(
  a = [],
  b = []
) {

  if (
    !Array.isArray(a) ||
    !Array.isArray(b) ||
    !a.length ||
    !b.length
  ) {
    return 0;
  }

  return Math.round(
    textSimilarity(
      a.join(' '),
      b.join(' ')
    ) *
    W.imageLabels
  );
}


/* =========================================================
 * VISUAL AI
 * =========================================================
 *
 * MobileNetV2 = 40%
 * CLIP        = 60%
 *
 * The combined visual score remains inside the existing
 * W.cnnImage = 10 point budget.
 */


/*
 * Calculate cosine similarity between two embeddings.
 */
function embeddingCosine(
  a,
  b
) {

  if (
    !Array.isArray(a) ||
    !Array.isArray(b) ||
    a.length !== b.length ||
    a.length === 0
  ) {
    return null;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (
    let i = 0;
    i < a.length;
    i += 1
  ) {

    const x =
      Number(a[i]);

    const y =
      Number(b[i]);

    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    ) {
      return null;
    }

    dot +=
      x * y;

    normA +=
      x * x;

    normB +=
      y * y;
  }

  if (
    normA <= 0 ||
    normB <= 0
  ) {
    return null;
  }

  return Math.max(
    -1,
    Math.min(
      1,
      dot /
        (
          Math.sqrt(normA) *
          Math.sqrt(normB)
        )
    )
  );
}


/*
 * Convert cosine [-1, 1]
 * to percentage [0, 100].
 */
function cosineToPercentage(
  cosine
) {

  if (
    cosine === null ||
    cosine === undefined ||
    !Number.isFinite(cosine)
  ) {
    return null;
  }

  return (
    (cosine + 1) /
    2
  ) * 100;
}


/*
 * Compare MobileNetV2 and CLIP separately,
 * then calculate the hybrid visual score.
 *
 * MobileNetV2 = 40%
 * CLIP        = 60%
 *
 * These are engineering weights,
 * NOT experimentally measured accuracy.
 */
function cnnScore(
  lost,
  found
) {

  const mobileNetCosine =
    embeddingCosine(
      lost?.imageEmbedding,
      found?.imageEmbedding
    );

  const clipCosine =
    embeddingCosine(
      lost?.clipEmbedding,
      found?.clipEmbedding
    );

  const mobileNetPercentage =
    cosineToPercentage(
      mobileNetCosine
    );

  const clipPercentage =
    cosineToPercentage(
      clipCosine
    );

  const hasMobileNet =
    mobileNetPercentage !== null;

  const hasClip =
    clipPercentage !== null;

  let percentage = null;

  let model = 'none';

  let mobileNetWeight = 0;

  let clipWeight = 0;


  /*
   * Both models available.
   */
  if (
    hasMobileNet &&
    hasClip
  ) {

    mobileNetWeight = 0.40;

    clipWeight = 0.60;

    percentage =
      mobileNetPercentage *
        mobileNetWeight +
      clipPercentage *
        clipWeight;

    model =
      'MobileNetV2 + CLIP';
  }


  /*
   * Only MobileNetV2 available.
   */
  else if (
    hasMobileNet
  ) {

    mobileNetWeight = 1;

    percentage =
      mobileNetPercentage;

    model =
      'MobileNetV2';
  }


  /*
   * Only CLIP available.
   */
  else if (
    hasClip
  ) {

    clipWeight = 1;

    percentage =
      clipPercentage;

    model =
      'CLIP';
  }


  const points =
    percentage === null
      ? 0
      : Math.round(
          (
            percentage /
            100
          ) *
          W.cnnImage
        );


  return {

    /*
     * Existing compatibility fields.
     */
    points,

    cosine:
      mobileNetCosine,

    percentage:
      percentage === null
        ? null
        : Math.round(
            percentage * 10
          ) / 10,


    /*
     * MobileNetV2.
     */
    mobileNetCosine,

    mobileNetPercentage:
      mobileNetPercentage === null
        ? null
        : Math.round(
            mobileNetPercentage * 10
          ) / 10,


    /*
     * CLIP.
     */
    clipCosine,

    clipPercentage:
      clipPercentage === null
        ? null
        : Math.round(
            clipPercentage * 10
          ) / 10,


    /*
     * Hybrid weights.
     */
    mobileNetWeight,

    clipWeight,

    model
  };
}


/*
 * Build one combined text representation.
 */
function buildCombinedText(
  item = {}
) {

  return [
    item.name,
    item.itemName,
    item.desc,
    item.description,
    item.details,
    item.features,
    item.color,
    item.brand,
    item.category,
    item.type
  ]
    .map(safeString)
    .filter(Boolean)
    .join(' ');
}


/* =========================================================
 * SEMANTIC / CONTEXTUAL LOCATION ENGINE
 * ========================================================= */

const LOCATION_STOP_WORDS = new Set([
  'near',
  'at',
  'in',
  'inside',
  'outside',
  'of',
  'the',
  'to',
  'from',
  'my',
  'a',
  'an',
  'on',
  'by',
  'and',
  'area',
  'place',
  'location',
  'there',
  'here'
]);


const LOCATION_SUB_TERMS = new Set([
  'gate',
  'entrance',
  'door',
  'front',
  'back',
  'rear',
  'side',
  'corner',
  'counter',
  'desk',
  'room',
  'floor',
  'block',
  'wing',
  'parking',
  'stairs',
  'stair',
  'lift',
  'elevator',
  'hall',
  'corridor',
  'outside',
  'inside',
  'entranceway'
]);


const LOCATION_PHRASES = [

  {
    phrase: 'front gate',
    tokens: [
      'front',
      'gate'
    ],
    type: 'gate'
  },

  {
    phrase: 'front door',
    tokens: [
      'front',
      'gate'
    ],
    type: 'gate'
  },

  {
    phrase: 'main gate',
    tokens: [
      'main',
      'gate'
    ],
    type: 'gate'
  },

  {
    phrase: 'main entrance',
    tokens: [
      'main',
      'gate'
    ],
    type: 'gate'
  },

  {
    phrase: 'front entrance',
    tokens: [
      'front',
      'gate'
    ],
    type: 'gate'
  },

  {
    phrase: 'back gate',
    tokens: [
      'back',
      'gate'
    ],
    type: 'gate'
  },

  {
    phrase: 'back door',
    tokens: [
      'back',
      'gate'
    ],
    type: 'gate'
  }
];


const LOCATION_LANDMARKS = new Set([
  'canteen',
  'library',
  'classroom',
  'hostel',
  'college',
  'school',
  'office',
  'laboratory',
  'lab',
  'auditorium',
  'cafeteria',
  'parking',
  'playground',
  'ground',
  'gym',
  'gymnasium',
  'building',
  'block',
  'department',
  'reception',
  'station',
  'bus',
  'busstop',
  'canteenarea'
]);


function locationTokens(
  value
) {

  return (
    safeString(value)
      .toLowerCase()
      .match(/[a-z0-9]+/g)
      ?.map(normalizeToken)
      .filter(Boolean) || []
  );
}


/*
 * Extract semantic location information.
 */
function parseLocation(
  value
) {

  const original =
    safeString(value)
      .trim();

  const rawTokens =
    locationTokens(
      original
    );

  const normalizedTokens =
    [
      ...new Set(
        rawTokens
      )
    ];

  const landmarks = [];

  const subLocations = [];

  const context = [];


  /*
   * Detect known landmarks.
   */
  for (
    const token of normalizedTokens
  ) {

    if (
      LOCATION_LANDMARKS.has(
        token
      )
    ) {

      landmarks.push(
        token
      );
    }
  }


  /*
   * Detect sub-location terms.
   */
  for (
    const token of normalizedTokens
  ) {

    if (
      LOCATION_SUB_TERMS.has(
        token
      )
    ) {

      subLocations.push(
        token
      );
    }
  }


  /*
   * Detect directional/context words.
   */
  const contextWords = [
    'near',
    'inside',
    'outside',
    'front',
    'back',
    'rear',
    'side',
    'next',
    'beside',
    'adjacent'
  ];

  for (
    const token of normalizedTokens
  ) {

    if (
      contextWords.includes(
        token
      )
    ) {

      context.push(
        token
      );
    }
  }


  /*
   * Detect compound location phrases.
   */
  const phrases = [];

  const lower =
    original.toLowerCase();

  for (
    const entry of LOCATION_PHRASES
  ) {

    if (
      lower.includes(
        entry.phrase
      )
    ) {

      phrases.push(
        entry.phrase
      );

      for (
        const token of entry.tokens
      ) {

        if (
          !subLocations.includes(
            token
          )
        ) {

          subLocations.push(
            token
          );
        }
      }
    }
  }


  /*
   * Remove location stop words.
   */
  const meaningful =
    normalizedTokens.filter(
      token =>
        !LOCATION_STOP_WORDS.has(
          token
        ) &&
        !LOCATION_SUB_TERMS.has(
          token
        )
    );


  /*
   * Prefer known landmark.
   */
  const primaryLandmark =
    landmarks.length
      ? landmarks[0]
      : meaningful.length
        ? meaningful[0]
        : null;


  let landmarkPhrase = null;

  if (
    meaningful.length
  ) {

    landmarkPhrase =
      meaningful.join(' ');
  }


  return {

    original,

    tokens:
      normalizedTokens,

    landmarks:
      [
        ...new Set(
          landmarks
        )
      ],

    primaryLandmark,

    landmarkPhrase,

    subLocations:
      [
        ...new Set(
          subLocations
        )
      ],

    context:
      [
        ...new Set(
          context
        )
      ],

    phrases:
      [
        ...new Set(
          phrases
        )
      ]
  };
}


/*
 * Determine whether two locations refer to
 * the same broad landmark.
 */
function sameLandmark(
  a,
  b
) {

  if (
    !a ||
    !b
  ) {
    return false;
  }

  if (
    a.primaryLandmark &&
    b.primaryLandmark &&
    a.primaryLandmark ===
      b.primaryLandmark
  ) {

    return true;
  }

  const aLandmarks =
    new Set(
      a.landmarks || []
    );

  const bLandmarks =
    new Set(
      b.landmarks || []
    );

  return [
    ...aLandmarks
  ].some(
    landmark =>
      bLandmarks.has(
        landmark
      )
  );
}


/*
 * Determine whether one location describes
 * a more specific sub-location.
 */
function isSpecificSubLocation(
  a,
  b
) {

  if (
    !a ||
    !b
  ) {
    return false;
  }

  if (
    !sameLandmark(
      a,
      b
    )
  ) {
    return false;
  }

  const aSub =
    new Set(
      a.subLocations || []
    );

  const bSub =
    new Set(
      b.subLocations || []
    );


  if (
    !aSub.size &&
    bSub.size
  ) {
    return true;
  }


  if (
    [...aSub].some(
      token =>
        bSub.has(
          token
        )
    )
  ) {
    return true;
  }

  return false;
}


/*
 * Calculate contextual location similarity.
 */
function contextualLocationSimilarity(
  lostLocation,
  foundLocation
) {

  const lost =
    parseLocation(
      lostLocation
    );

  const found =
    parseLocation(
      foundLocation
    );

  if (
    !lost.original ||
    !found.original
  ) {

    return {
      score: 0,
      percentage: 0,
      relation: 'unknown',
      sameLandmark: false,
      specificSubLocation: false,
      explanation: null,
      lost,
      found
    };
  }


  const lexical =
    textSimilarity(
      lost.original,
      found.original
    );

  const same =
    sameLandmark(
      lost,
      found
    );

  const foundSpecific =
    isSpecificSubLocation(
      lost,
      found
    );

  const lostSpecific =
    isSpecificSubLocation(
      found,
      lost
    );

  let similarity =
    lexical;

  let relation =
    'different_or_unclear';

  let explanation = null;


  if (same) {

    similarity =
      Math.max(
        similarity,
        0.70
      );

    relation =
      'same_landmark';

    explanation =
      `Both reports refer to the same landmark: ${lost.primaryLandmark}.`;
  }


  if (foundSpecific) {

    similarity =
      Math.max(
        similarity,
        0.85
      );

    relation =
      'same_landmark_specific_found';

    explanation =
      `Both reports refer to the ${lost.primaryLandmark} area. The found report gives a more specific sub-location: ${found.subLocations.join(' / ') || 'specific entrance area'}.`;

  } else if (
    lostSpecific
  ) {

    similarity =
      Math.max(
        similarity,
        0.80
      );

    relation =
      'same_landmark_specific_lost';

    explanation =
      `Both reports refer to the ${found.primaryLandmark} area, with the lost report providing a more specific sub-location.`;
  }


  if (
    lost.landmarkPhrase &&
    found.landmarkPhrase &&
    lost.landmarkPhrase ===
      found.landmarkPhrase
  ) {

    similarity =
      Math.max(
        similarity,
        0.90
      );

    relation =
      'same_location_phrase';

    explanation =
      `Both reports identify the same location context: ${lost.landmarkPhrase}.`;
  }


  similarity =
    Math.max(
      0,
      Math.min(
        1,
        similarity
      )
    );


  return {

    score:
      similarity,

    percentage:
      Math.round(
        similarity * 100
      ),

    relation,

    sameLandmark:
      same,

    specificSubLocation:
      foundSpecific ||
      lostSpecific,

    explanation,

    lost,

    found
  };
}


/*
 * Public location wrapper.
 */
function locationSimilarity(
  lost,
  found
) {

  const lostLocation =
    lost.location ||
    lost.lastSeenLocation;

  const foundLocation =
    found.location ||
    found.foundLocation;

  return contextualLocationSimilarity(
    lostLocation,
    foundLocation
  );
}


/*
 * Convert location relationship into
 * human-readable reasons.
 */
function buildLocationReasons(
  location
) {

  if (!location) {
    return [];
  }

  const reasons = [];


  if (
    location.relation ===
    'same_landmark_specific_found'
  ) {

    reasons.push(
      'Same landmark; found location is a more specific sub-location'
    );

  } else if (
    location.relation ===
    'same_landmark_specific_lost'
  ) {

    reasons.push(
      'Same landmark with compatible sub-location context'
    );

  } else if (
    location.relation ===
    'same_location_phrase'
  ) {

    reasons.push(
      'Same location context'
    );

  } else if (
    location.sameLandmark
  ) {

    reasons.push(
      'Same landmark'
    );

  } else if (
    location.percentage >= 50
  ) {

    reasons.push(
      'Similar location wording'
    );
  }

  return reasons;
}


/* =========================================================
 * FINAL MATCH SCORE
 * ========================================================= */

function calculateMatchScore(
  lost = {},
  found = {}
) {

  const image =
    cnnScore(
      lost,
      found
    );


  const lostName =
    lost.name ||
    lost.itemName;

  const foundName =
    found.name ||
    found.itemName;


  const lostDescription =
    lost.desc ||
    lost.description;

  const foundDescription =
    found.desc ||
    found.description;


  const location =
    locationSimilarity(
      lost,
      found
    );


  const properties =
    propertySimilarity(
      lost,
      found
    );


  const scores = {

    category:
      categoryScore(
        lost.category,
        found.category
      ),

    nameText:
      nlpTextScore(
        lostName,
        foundName,
        W.nameText
      ),

    description:
      nlpTextScore(
        lostDescription,
        foundDescription,
        W.description
      ),

    location:
      Math.round(
        location.score *
        W.location
      ),

    date:
      dateScore(
        lost.dateLost ||
          lost.date,

        found.dateFound ||
          found.foundDate ||
          found.date
      ),

    properties:
      Math.round(
        properties.score *
        W.properties
      ),

    imageLabels:
      labelScore(
        lost.detectedLabels,
        found.detectedLabels
      ),

    cnnImage:
      image.points
  };


  /*
   * Combined text evidence.
   */
  const combinedSimilarity =
    semanticTextSimilarity(
      buildCombinedText(lost),
      buildCombinedText(found)
    );


  /*
   * Base score.
   */
  let score =
    Object.values(scores)
      .reduce(
        (sum, value) =>
          sum + value,
        0
      );


  /*
   * Category mismatch remains a strong
   * negative signal.
   */
  if (
    scores.category === 0
  ) {

    score =
      Math.min(
        score,
        35
      );
  }


  /*
   * Shared normalized text evidence.
   *
   * Maximum 5 points.
   */
  const sharedTextBoost =
    Math.round(
      combinedSimilarity * 5
    );


  if (
    scores.category > 0
  ) {

    score +=
      sharedTextBoost;
  }


  /*
   * Location contextual boost.
   *
   * Maximum 2 points.
   */
  let locationContextBoost = 0;


  if (
    location.sameLandmark
  ) {

    locationContextBoost = 1;
  }


  if (
    location.specificSubLocation
  ) {

    locationContextBoost = 2;
  }


  if (
    scores.category > 0
  ) {

    score +=
      locationContextBoost;
  }


  /*
   * Prevent score from exceeding 100.
   */
  score =
    Math.max(
      0,
      Math.min(
        100,
        score
      )
    );


  /*
   * Confidence is based on the resulting
   * matching score.
   *
   * This is NOT measured model accuracy.
   */
  const confidence =
    score >= 75
      ? 'high'
      : score >= 45
        ? 'medium'
        : 'low';


  const reasons = [];


  if (
    scores.category ===
    W.category
  ) {

    reasons.push(
      'Same category'
    );

  } else if (
    scores.category > 0
  ) {

    reasons.push(
      'Related category'
    );
  }


  if (
    scores.nameText >=
    W.nameText * 0.6
  ) {

    reasons.push(
      'Strong item-name similarity'
    );
  }


  if (
    scores.description >=
    W.description * 0.45
  ) {

    reasons.push(
      'Shared description details'
    );
  }


  if (
    combinedSimilarity >= 0.35
  ) {

    reasons.push(
      'Multiple shared object terms'
    );
  }


  if (
    properties.details.brand > 0
  ) {

    reasons.push(
      'Brand appears to match'
    );
  }


  if (
    properties.details.color > 0
  ) {

    reasons.push(
      'Color appears to match'
    );
  }


  if (
    properties.details.objectType > 0
  ) {

    reasons.push(
      'Object type appears to match'
    );
  }


  if (
    properties.details.features > 0
  ) {

    reasons.push(
      'Distinctive object features match'
    );
  }


  /*
   * Semantic location reasons.
   */
  reasons.push(
    ...buildLocationReasons(
      location
    )
  );


  if (
    scores.date >= 8
  ) {

    reasons.push(
      'Dates are very close'
    );

  } else if (
    scores.date >= 5
  ) {

    reasons.push(
      'Dates are within a week'
    );
  }


  if (
    scores.imageLabels > 0
  ) {

    reasons.push(
      'Image labels matched'
    );
  }


  /*
   * Visual AI reasons.
   */
  if (
    image.percentage != null
  ) {

    reasons.push(
      `Visual AI similarity ${image.percentage}% (${image.model})`
    );
  }


  if (
    image.mobileNetPercentage != null
  ) {

    reasons.push(
      `MobileNetV2 visual similarity ${image.mobileNetPercentage}%`
    );
  }


  if (
    image.clipPercentage != null
  ) {

    reasons.push(
      `CLIP visual similarity ${image.clipPercentage}%`
    );
  }


  /*
   * Human-readable property breakdown.
   */
  const propertyBreakdown = {

    color:
      Math.round(
        properties.details.color *
        100
      ),

    brand:
      Math.round(
        properties.details.brand *
        100
      ),

    objectType:
      Math.round(
        properties.details.objectType *
        100
      ),

    distinctiveFeatures:
      Math.round(
        properties.details.features *
        100
      )
  };


  /*
   * Human-readable location breakdown.
   */
  const locationBreakdown = {

    similarity:
      location.percentage,

    relation:
      location.relation,

    sameLandmark:
      location.sameLandmark,

    specificSubLocation:
      location.specificSubLocation,

    lostLandmark:
      location.lost.primaryLandmark,

    foundLandmark:
      location.found.primaryLandmark,

    lostSubLocations:
      location.lost.subLocations,

    foundSubLocations:
      location.found.subLocations,

    explanation:
      location.explanation
  };


  return {

    score,

    confidence,

    reasons,


    /*
     * Existing UI compatibility.
     */
    breakdown:
      scores,


    /*
     * NLP information.
     */
    nlpSimilarity:
      Math.round(
        combinedSimilarity * 100
      ),

    nlpSimilarityPercentage:
      Math.round(
        combinedSimilarity * 100
      ),


    /*
     * Existing image fields.
     */
    imageSimilarity:
      image.percentage,

    imageSimilarityPercentage:
      image.percentage,


    /*
     * Property information.
     */
    propertySimilarity:
      Math.round(
        properties.score * 100
      ),

    propertyBreakdown,


    extractedProperties: {

      lost:
        properties.details.lost,

      found:
        properties.details.found
    },


    /*
     * Location information.
     */
    locationSimilarity:
      location.percentage,

    locationSimilarityPercentage:
      location.percentage,

    locationBreakdown,

    locationExplanation:
      location.explanation,

    locationRelation:
      location.relation,

    sameLocationLandmark:
      location.sameLandmark,

    locationSpecificSubLocation:
      location.specificSubLocation,


    /*
     * =====================================================
     * VISUAL AI INFORMATION
     * =====================================================
     *
     * Existing CNN fields remain for compatibility.
     */

    cnnCosineSimilarity:
      image.cosine,

    cnnSimilarityPercentage:
      image.percentage,


    /*
     * MobileNetV2.
     */
    mobileNetCosineSimilarity:
      image.mobileNetCosine,

    mobileNetSimilarityPercentage:
      image.mobileNetPercentage,


    /*
     * CLIP.
     */
    clipCosineSimilarity:
      image.clipCosine,

    clipSimilarityPercentage:
      image.clipPercentage,


    /*
     * Final hybrid visual score.
     */
    visualSimilarityPercentage:
      image.percentage,

    visualModel:
      image.model,


    /*
     * Visual model weights.
     */
    visualWeights: {

      mobileNetV2:
        image.mobileNetWeight,

      clip:
        image.clipWeight
    },


    /*
     * Explicit contribution information.
     */
    contribution: {

      cnnImage:
        image.points,

      cnnImageMax:
        W.cnnImage,

      visualAI:
        image.points,

      visualAIMax:
        W.cnnImage,

      locationContext:
        locationContextBoost,

      locationContextMax:
        2
    },


    /*
     * Useful for debugging/research.
     */
    weights: {
      ...W
    }
  };
}


module.exports = {
  calculateMatchScore,
  W
};