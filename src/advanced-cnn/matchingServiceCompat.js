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
 *  - fine-grained visual details
 *
 * IMPORTANT:
 * The returned `score` is a MATCH SCORE, not measured model accuracy.
 *
 * Visual AI contribution:
 *
 *   MobileNetV2      = 40%
 *   CLIP             = 40%
 *   Fine Visual AI   = 20%
 *
 * The complete visual contribution remains inside the
 * existing 10-point W.cnnImage budget.
 *
 * Fine Visual AI combines:
 *   - colour structure
 *   - shape
 *   - foreground geometry
 *   - 3x3 local regions
 *   - visible OCR text
 *
 * Location intelligence:
 *   "near canteen"
 *   "near front gate of canteen"
 *
 * is understood as:
 *   same landmark + more specific sub-location.
 */

const { compareVisualDetails } = require('./visualDetailMatching');


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
  ['oneplus', 'oneplus'],
  ['backpack', 'bag'],
  ['rucksack', 'bag'],
  ['handbag', 'bag'],
  ['purse', 'bag'],
  ['schoolbag', 'bag'],

  ['mobile', 'phone'],
  ['cellphone', 'phone'],
  ['smartphone', 'phone'],
  ['mobilephone', 'phone'],

  // A paper notebook is not a laptop; keep the object families distinct.
  ['macbook', 'laptop'],

  ['spectacles', 'glasses'],
  ['eyeglasses', 'glasses'],

  ['wallets', 'wallet'],
  ['keys', 'key'],

  ['grey', 'gray'],

  ['grafitee', 'graffiti'],
  ['grafite', 'graffiti'],
  ['graffity', 'graffiti'],

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
 * Return OCR-derived brand candidates only when the visual-details
 * service reports usable confidence. Brand OCR is supporting evidence,
 * not a guess: absent/low-confidence OCR must never create a conflict.
 */
function extractImageBrandCandidates(item = {}) {
  const visualDetails =
    item?.visualDetails || item?.visual_details || {};
  if (visualDetails.available !== true) return [];

  const attributes = visualDetails.image_attributes || {};
  const ocr = visualDetails.ocr || {};
  const visibleText = visualDetails.visible_text || {};
  const confidence = Number(
    attributes.ocr_confidence ?? ocr.confidence ?? visibleText.confidence
  );
  if (!Number.isFinite(confidence) || confidence < 55) return [];

  const candidates = [
    ...(Array.isArray(visualDetails.brand_candidates) ? visualDetails.brand_candidates : []),
    ...(Array.isArray(attributes.brand_candidates) ? attributes.brand_candidates : []),
    ...(Array.isArray(ocr.brand_candidates) ? ocr.brand_candidates : [])
  ];

  return [...new Set(candidates
    .map(value => normalizeToken(value))
    .filter(Boolean))];
}


/*
 * Extract useful object properties from free text and trusted image OCR.
 */
function normalizeBrandName(value) {
  const raw = safeString(value).toLowerCase().trim()
    .replace(/one[\s_-]*plus/g, 'oneplus');
  if (raw === 'oneplus') return 'oneplus';
  return normalizeToken(raw);
}


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
  // Fix missing spaces in common color/item labels.
  const propertyText = text
    .replace(/\bone[\s_-]*plus\b/gi, 'oneplus')
    .replace(
      /\b(black|white|red|blue|green|yellow|orange|pink|purple|brown|gray|grey|silver|gold)(?=[a-z])(?=(gaming|wireless|wired|computer|office|optical|bluetooth|portable|smart|school|travel|leather|plastic|metal|rgb|led)\b)/gi,
      '$1 '
    );

  const result = {
    colors: [],
    brands: [],
    objectTypes: [],
    features: []
  };

  const normalized =
    new Set(
      tokens(propertyText)
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
    'one plus',
    'hp',
    'dell',
    'lenovo',
    'boat',
    'wildcraft',
    'american tourister',
    'samsonite',
    'studds',
    'sounce',
    'classmate',
    'octane',
    'samsonite',
    'fossil',
    'casio',
    'titan',
    'sony',
    'jbl',
    'boat',
    'reebok',
    'curren',
    'rolex',
    'vivo',
    'oppo',
    'realme',
    'asus',
    'acer',
    'canon',
    'nikon'
  ];

  const objectWords = [
    'bag',
    'backpack',
    'schoolbag',
    'school bag',
    'rucksack',

    'wallet',
    'cardholder',
    'card holder',

    'phone',
    'mobile',
    'cellphone',
    'cell phone',
    'smartphone',
    'smart phone',

    'mouse',
    'computer mouse',
    'gaming mouse',
    'wireless mouse',
    'wired mouse',
    'trackball mouse',

    'helmet',
    'motorcycle helmet',
    'laptop',
    'notebook computer',
    'notebook',

    'tablet',
    'ipad',

    'watch',
    'wristwatch',
    'wrist watch',
    'smartwatch',
    'smart watch',

    'key',
    'keys',
    'keychain',
    'key chain',

    'bottle',
    'water bottle',
    'flask',
    'thermos',
    'sipper',

    'pen',
    'ball pen',
    'ballpoint',
    'ballpoint pen',
    'ball point pen',
    'ink pen',
    'gel pen',
    'gelpen',
    'fountain pen',

    'pencil',
    'marker',
    'highlighter',

    'umbrella',

    'book',
    'notebook',

    'charging cable',
    'charge cable',
    'charging cord',
    'power cord',
    'cable',
    'charger',
    'charging adapter',
    'power adapter',
    'usb adapter',
    'adapter',

    'headphone',
    'headphones',
    'earphone',
    'earphones',
    'earbud',
    'earbuds',

    'glasses',
    'spectacles',
    'eyeglasses',
    'sunglasses',

    'shoe',
    'shoes',
    'sneaker',
    'sneakers',
    'footwear',

    'document',
    'brush',
    'cleaning brush',
    'scrub brush',
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

    const brandTokens = tokens(brand);
    const hasContiguousPhrase = brandTokens.length > 1 &&
      new RegExp('\\b' + brandTokens.map(token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+') + '\\b', 'i').test(propertyText);
    const hasAllTokens = brandTokens.length > 0 && brandTokens.every(token => normalized.has(token));
    if (hasContiguousPhrase || hasAllTokens) {
      const canonicalBrand = normalizeBrandName(brand);
      if (!result.brands.includes(canonicalBrand)) result.brands.push(canonicalBrand);
    }
  }


  // Image-derived OCR brands enter the same property pipeline as text brands.
  // Confidence is checked inside extractImageBrandCandidates().
  for (const brand of extractImageBrandCandidates(item)) {
    if (!result.brands.includes(brand)) result.brands.push(brand);
  }

  /*
   * Object type.
   */
  for (const objectType of objectWords) {
    const escapedType = objectType
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\s+/g, '\\s+');

    const phrasePattern = new RegExp(
      `\\b${escapedType}\\b`,
      'i'
    );

    if (phrasePattern.test(String(text || ''))) {
      // Keep the subtype for property evidence. The separate object-family
      // gate groups these as compatible charging accessories, but collapsing
      // cable/charger/adapter to one token falsely reports 100% exact type match.
      const canonicalType =
        /\bhelmet\b/i.test(objectType)
          ? 'helmet'
          : /\bmouse\b/i.test(objectType)
            ? 'mouse'
            : /\b(cable|cord)\b/i.test(objectType)
              ? 'charging_cable'
              : /\bcharger\b/i.test(objectType)
                ? 'charger'
                : /\badapter\b/i.test(objectType)
                  ? 'power_adapter'
                  : normalizeToken(objectType);

      if (!result.objectTypes.includes(canonicalType)) {
        result.objectTypes.push(canonicalType);
      }
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
const objectAliases = {

  helmet: [
    'helmet',
    'motorcycle helmet',
    'crash helmet'
  ],

  bag: [
    'bag',
    'backpack',
    'schoolbag',
    'school bag',
    'rucksack'
  ],

  wallet: [
    'wallet',
    'cardholder',
    'card holder'
  ],

  phone: [
    'phone',
    'mobile',
    'cellphone',
    'cell phone',
    'smartphone',
    'smart phone'
  ],

  mouse: [
    'mouse',
    'computer mouse',
    'gaming mouse',
    'wireless mouse',
    'wired mouse',
    'trackball mouse'
  ],

  laptop: [
    'laptop',
    'notebook computer',
    'macbook'
  ],

  tablet: [
    'tablet',
    'ipad'
  ],

  watch: [
    'watch',
    'wristwatch',
    'wrist watch',
    'smartwatch',
    'smart watch'
  ],

  key: [
    'key',
    'keys',
    'keychain',
    'key chain'
  ],

  bottle: [
    'bottle',
    'water bottle',
    'flask',
    'thermos',
    'sipper'
  ],

  pen: [
    'pen',
    'ball pen',
    'ballpoint',
    'ballpoint pen',
    'ball point pen',
    'ink pen',
    'gel pen',
    'gelpen',
    'fountain pen'
  ],

  pencil: [
    'pencil',
    'marker',
    'highlighter'
  ],

  book: [
    'book',
    'notebook'
  ],

  headphone: [
    'headphone',
    'headphones',
    'earphone',
    'earphones',
    'earbud',
    'earbuds'
  ],

  glasses: [
    'glasses',
    'spectacles',
    'eyeglasses',
    'sunglasses'
  ],

  shoe: [
    'shoe',
    'shoes',
    'sneaker',
    'sneakers',
    'footwear'
  ]
};

function semanticTextSimilarity(a, b) {

  const leftText =
    safeString(a).trim();

  const rightText =
    safeString(b).trim();

  if (
    !leftText ||
    !rightText
  ) {
    return 0;
  }

  const base =
    textSimilarity(
      leftText,
      rightText
    );

  const left =
    extractProperties({
      description: leftText
    });

  const right =
    extractProperties({
      description: rightText
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

  function canonicalFamilies(properties) {

    const values =
      (
        properties &&
        Array.isArray(
          properties.objectTypes
        )
          ? properties.objectTypes
          : []
      ).map(
        value =>
          safeString(value)
            .toLowerCase()
            .trim()
      );

    const families = [];

    for (
      const family of Object.keys(
        objectAliases
      )
    ) {

      const aliases =
        objectAliases[family] || [];

      let matched = false;

      for (
        const alias of aliases
      ) {

        const aliasValue =
          normalizeToken(alias);

        for (
          const value of values
        ) {

          const normalizedValue =
            normalizeToken(value);

          if (
            normalizedValue ===
            aliasValue
          ) {
            matched = true;
            break;
          }
        }

        if (matched) {
          break;
        }
      }

      if (matched) {
        families.push(family);
      }
    }

    return [
      ...new Set(families)
    ];
  }

  const leftFamilies =
    canonicalFamilies(left);

  const rightFamilies =
    canonicalFamilies(right);

  const canonicalObject =
    leftFamilies.some(
      family =>
        rightFamilies.includes(
          family
        )
    )
      ? 1
      : 0;

  const leftTokens =
    new Set(
      tokens(leftText)
    );

  const rightTokens =
    new Set(
      tokens(rightText)
    );

  const commonTokens =
    [...leftTokens].filter(
      token =>
        rightTokens.has(token)
    );

  const coverage =
    commonTokens.length /
    Math.max(
      1,
      Math.min(
        leftTokens.size,
        rightTokens.size
      )
    );

  let result =
    base * 0.30 +
    coverage * 0.25 +
    canonicalObject * 0.30 +
    color * 0.10 +
    features * 0.05;

  if (brand > 0) {

    result +=
      Math.min(
        0.10,
        brand * 0.10
      );
  }

  if (
    left.colors.length > 0 &&
    right.colors.length > 0 &&
    color === 0
  ) {

    result *= 0.78;
  }

  const leftNormalized =
    uniqueTokens(leftText).join(' ');

  const rightNormalized =
    uniqueTokens(rightText).join(' ');

  if (
    leftNormalized &&
    leftNormalized ===
      rightNormalized
  ) {

    result =
      Math.max(
        result,
        0.95
      );
  }

  return Math.min(
    1,
    Math.max(
      0,
      result
    )
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

  // Color evidence uses Jaccard overlap rather than the generic subset
  // overlap used for some attributes. This prevents a one-color report from
  // receiving 100% merely because that color is one of several colors in the
  // other report (e.g. a red cable + white adapter vs a white adapter).
  const color = (() => {
    const left = new Set(a.colors.map(normalizeToken));
    const right = new Set(b.colors.map(normalizeToken));
    if (!left.size || !right.size) return 0;
    const intersection = [...left].filter(value => right.has(value)).length;
    const union = new Set([...left, ...right]).size;
    return union ? intersection / union : 0;
  })();

  // Missing brand data is unknown, not a perfect brand match. Only compare
  // brands when both reports actually provide a brand value.
  const brand = a.brands.length && b.brands.length
    ? overlapScore(a.brands, b.brands)
    : 0;

  const chargingSubtypes = new Set([
    'charging_cable', 'charger', 'power_adapter'
  ]);
  const bothChargingSubtypeLists =
    a.objectTypes.length > 0 && b.objectTypes.length > 0 &&
    a.objectTypes.every(type => chargingSubtypes.has(type)) &&
    b.objectTypes.every(type => chargingSubtypes.has(type));
  // For a kit with multiple accessory components, use Jaccard overlap so a
  // lost report listing cable + adapter does not receive 100% merely because
  // those two types are contained in a found report listing cable + charger + adapter.
  const objectType = bothChargingSubtypeLists
    ? (() => {
        const left = new Set(a.objectTypes);
        const right = new Set(b.objectTypes);
        const intersection = [...left].filter(type => right.has(type)).length;
        const union = new Set([...left, ...right]).size;
        return union ? intersection / union : 0;
      })()
    : overlapScore(a.objectTypes, b.objectTypes);

  const features =
    overlapScore(
      a.features,
      b.features
    );

  const components = [];

  if (
    a.colors.length ||
    b.colors.length
  ) {

    components.push({
      score: color,
      weight: 0.35
    });
  }

  if (
    a.brands.length ||
    b.brands.length
  ) {

    components.push({
      score: brand,
      weight: 0.15
    });
  }

  if (
    a.objectTypes.length ||
    b.objectTypes.length
  ) {

    components.push({
      score: objectType,
      weight: 0.35
    });
  }

  if (
    a.features.length ||
    b.features.length
  ) {

    components.push({
      score: features,
      weight: 0.15
    });
  }

  let total = 0;
  let weight = 0;

  for (
    const component of components
  ) {

    total +=
      component.score *
      component.weight;

    weight +=
      component.weight;
  }

  const combined =
    weight > 0
      ? total / weight
      : 0;

  return {

    score:
      Math.min(
        1,
        Math.max(
          0,
          combined
        )
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
function inferCategoryFromItem(item = {}) {
  const text = [
    item.name,
    item.itemName,
    item.item_name,
    item.title,
    item.desc,
    item.description,
    item.details,
    item.features,
    item.type,
    item.itemType,
    item.item_type,
    item.objectType,
    item.object_type
  ]
    .map(safeString)
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');

  // Test computer-specific phrases first: a notebook computer is a laptop,
  // while a school/paper notebook is a stationery item.
  if (/\b(macbook|laptop|notebook\s+computer|computer\s+notebook)\b/i.test(text)) {
    return 'laptop';
  }

  if (/\b(notebook|notepad|exercise\s+book|copybook|copy\s+book|writing\s+notebook|ruled\s+notebook|spiral\s+notebook|composition\s+(?:notebook|book)|school\s+notebook|paper\s+notebook)\b/i.test(text)) {
    return 'notebook';
  }

  if (/\b(stationery|stationary|school supplies|office supplies|pen|pencil|eraser|ruler|marker|highlighter)\b/i.test(text)) {
    return 'stationery';
  }

  if (/\b(textbook|storybook|novel|book)\b/i.test(text)) {
    return 'books';
  }

  return '';
}

function getCategoryValue(item = {}) {
  const candidates = [
    item.category,
    item.itemCategory,
    item.item_category,
    item.categoryName,
    item.category_name,
    item.categoryLabel,
    item.category_label,
    item.itemType,
    item.item_type
  ];
  const genericCategories = new Set([
    'other', 'others', 'general', 'misc', 'miscellaneous',
    'unknown', 'uncategorized', 'uncategorised', 'item', 'items'
  ]);
  const knownCategoryPattern = /\b(notebook|notepad|exercise book|copybook|copy book|school notebook|paper notebook|stationery|stationary|school supplies|office supplies|book|books|textbook|storybook|documents?|accessories|wallets?|bags?|jewell?ery|electronics?|computers?|laptops?|macbook|phones?|mobiles?|bottles?|watches|helmets?|mice|mouse|pens?|pencils?|headphones?|earphones?|tablets?)\b/i;
  let genericFallback = '';
  let unrecognizedFallback = '';
  const inferredCategory = inferCategoryFromItem(item);

  for (const candidate of candidates) {
    let value = candidate;

    if (candidate && typeof candidate === 'object') {
      if (Array.isArray(candidate)) {
        value = candidate.find(entry => entry != null && safeString(entry).trim());
      } else {
        value = candidate.name ?? candidate.label ?? candidate.value ??
          candidate.category ?? candidate.categoryName ?? candidate.category_name ??
          candidate.title ?? candidate.displayName ?? candidate.display_name ?? candidate.slug;
      }
    }

    if (value == null || !safeString(value).trim()) continue;

    const normalized = safeString(value).trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
    if (genericCategories.has(normalized)) {
      genericFallback = genericFallback || safeString(value).trim();
      continue;
    }

    // A broad "documents" category must not override a clearly
    // identified physical item such as a paper notebook.
    if (/^(documents?|accessories?)$/i.test(normalized) && inferredCategory) {
      unrecognizedFallback = unrecognizedFallback || safeString(value).trim();
      continue;
    }

    if (knownCategoryPattern.test(normalized)) {
      return value;
    }

    // Some forms store broad/local labels such as "Educational Items" or
    // "Personal Belongings". Prefer an explicit object category from the
    // item's own name/description rather than scoring those unrelated labels
    // as if they were comparable item categories.
    unrecognizedFallback = unrecognizedFallback || safeString(value).trim();
  }

  // Real report records may have a blank/generic/unrecognized category even
  // when their title and description clearly identify a notebook. Infer only
  // a narrow, explicit object category rather than guessing from vague text.
  return inferredCategory || genericFallback || unrecognizedFallback;
}

function categoryScore(a, b) {
  const normalizeCategory = value => {
    const raw = safeString(value)
      .trim()
      .toLowerCase()
      .replace(/[_-]+/g, ' ')
      .replace(/[&/]+/g, ' and ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!raw) return '';

    // Preserve the laptop/paper-notebook distinction in category labels too.
    if (/\b(macbook|laptop|notebook computer|computer notebook)\b/.test(raw)) return 'laptop';
    if (/\b(notebook|notepad|exercise book|copybook|copy book|writing notebook|ruled notebook|spiral notebook|composition notebook|composition book|school notebook|paper notebook)\b/.test(raw)) return 'notebook';
    if (/\b(stationery|stationary|school supplies|office supplies)\b/.test(raw)) return 'stationery';

    const aliases = {
      notebook: 'notebook',
      notebooks: 'notebook',
      'exercise book': 'notebook',
      'exercise books': 'notebook',
      'school notebook': 'notebook',
      'school notebooks': 'notebook',
      copybook: 'notebook',
      'copy book': 'notebook',
      'writing notebook': 'notebook',
      'ruled notebook': 'notebook',
      'spiral notebook': 'notebook',
      'composition notebook': 'notebook',
      'composition book': 'notebook',
      notepad: 'notebook',
      stationery: 'stationery',
      stationary: 'stationery',
      book: 'books',
      books: 'books',
      document: 'documents',
      documents: 'documents',
      accessory: 'accessories',
      accessories: 'accessories',
      wallet: 'wallet',
      wallets: 'wallet',
      bag: 'bag',
      bags: 'bag',
      jewelry: 'jewellery',
      jewellery: 'jewellery'
    };

    return aliases[raw] || raw;
  };

  const aa = normalizeCategory(a);
  const bb = normalizeCategory(b);

  if (!aa || !bb) return 0;

  if (aa === bb) return W.category;

  // Partial credit for related categories, not full equivalence.
  const related = {
    wallet: ['accessories', 'bag'],
    bag: ['accessories', 'wallet'],
    accessories: ['bag', 'wallet', 'jewellery'],
    jewellery: ['accessories'],
    books: ['documents', 'notebook', 'stationery'],
    documents: ['books'],
    notebook: ['stationery', 'books'],
    stationery: ['notebook', 'books']
  };

  if (
    related[aa]?.includes(bb) ||
    related[bb]?.includes(aa)
  ) {
    return Math.round(W.category * 0.5);
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


function imageLabelsForScore(item) {
  if (Array.isArray(item)) return item.filter(Boolean).map(String);
  if (!item || typeof item !== 'object') return [];

  const explicit = Array.isArray(item.detectedLabels)
    ? item.detectedLabels.filter(Boolean).map(String)
    : [];
  if (explicit.length) return explicit;

  // Defensive fallback: some persisted reports predate detectedLabels, while
  // the enrichment step has already stored the model's recognition payload.
  const recognition = item.visualRecognition || item.visual_recognition || {};
  const objectType = recognition.object_type || recognition.objectType;
  if (objectType) return [String(objectType)];

  const candidates = recognition.object_candidates || recognition.objectCandidates;
  if (Array.isArray(candidates)) {
    const candidate = candidates.find((entry) => {
      const label = entry && (entry.value || entry.label || entry.raw_label);
      const confidence = Number(entry && (entry.confidence ?? entry.score));
      return Boolean(label) && Number.isFinite(confidence) && confidence > 0;
    });
    if (candidate) {
      const label = candidate.value || candidate.label || candidate.raw_label;
      return [String(label).replace(/^a[n]?\s+/i, '')];
    }
  }

  // LostNet fallback: use only when existing image-label sources are absent.
  // Low-confidence predictions are ignored; existing scoring weights remain unchanged.
  const lostNet = item.lostNetPrediction || item.lost_net_prediction;
  const lostNetLabel = String(lostNet?.predicted_class || '').trim();
  const rawLostNetConfidence = Number(
    lostNet?.confidence_percent ?? lostNet?.confidence
  );
  const lostNetConfidence = Number.isFinite(rawLostNetConfidence)
    ? (
        lostNet?.confidence_percent !== undefined ||
        rawLostNetConfidence > 1
          ? rawLostNetConfidence / 100
          : rawLostNetConfidence
      )
    : 0;

  if (lostNetLabel && lostNetConfidence >= 0.75) {
    const normalizedLostNetLabel = lostNetLabel
      .replace(/[_-]+/g, ' ')
      .replace(/usbflashdisk/ig, 'usb flash drive')
      .replace(/vacuumcup/ig, 'vacuum cup');

    return [normalizedLostNetLabel];
  }

  return [];
}

function chargingAccessoryLabel(label) {
  const value = String(label || '').toLowerCase().replace(/[_-]+/g, ' ');
  return /\b(charger|charging|charge|power adapter|adapter|adaptor|usb cable|charging cable|cable)\b/.test(value);
}

function labelScore(
  a = [],
  b = []
) {
  // Accept raw label arrays (legacy callers) or item records. Prefer the
  // normalized labels written by the API, but recover model labels from the
  // recognition payload when older/persisted records lack detectedLabels.
  const aIsItem = !Array.isArray(a) && a && typeof a === 'object';
  const bIsItem = !Array.isArray(b) && b && typeof b === 'object';
  const labelsA = imageLabelsForScore(a);
  const labelsB = imageLabelsForScore(b);
  if (!labelsA.length || !labelsB.length) return 0;

  const similarity = textSimilarity(labelsA.join(' '), labelsB.join(' '));
  let rawScore = Math.round(similarity * W.imageLabels);

  // Related charging accessories (e.g. charger vs charging cable) often have
  // different CLIP labels and no shared tokens. Give only partial family
  // evidence rather than incorrectly reporting either zero or an exact match.
  if (rawScore <= 0 && labelsA.some(chargingAccessoryLabel) && labelsB.some(chargingAccessoryLabel)) {
    rawScore = 2;
  }
  if (rawScore <= 0) return 0;

  const confidenceFor = (item, isItem) => {
    if (!isItem) return 1;
    const explicit = Number(item.detectedLabelConfidence);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    const recognition = item.visualRecognition || item.visual_recognition || {};
    const candidate = (recognition.object_candidates || recognition.objectCandidates || [])[0];
    const nested = Number(recognition.object_confidence ?? recognition.objectConfidence ?? candidate?.confidence ?? candidate?.score ?? 0);
    return Number.isFinite(nested) ? nested : 0;
  };
  const confidenceA = confidenceFor(a, aIsItem);
  const confidenceB = confidenceFor(b, bIsItem);
  // Both high-confidence predictions can contribute up to 5/5 only when the
  // labels agree strongly. Related-but-not-identical charging accessories
  // remain partial evidence; weak model labels are capped at 2/5.
  const relatedAccessoryFallback = similarity < 0.999 && labelsA.some(chargingAccessoryLabel) && labelsB.some(chargingAccessoryLabel);
  const confidenceCapped = confidenceA < 0.65 || confidenceB < 0.65;
  return relatedAccessoryFallback || confidenceCapped
    ? Math.min(2, rawScore)
    : rawScore;
}


/* =========================================================
 * VISUAL AI
 * =========================================================
 *
 * Total visual contribution = 10 points.
 *
 * When all three visual systems are available:
 *
 *   MobileNetV2    = 40% = 4 / 10 points
 *   CLIP           = 40% = 4 / 10 points
 *   Fine Visual AI = 20% = 2 / 10 points
 *
 * Fine Visual AI is supplied by visualDetailMatching.js.
 *
 * If a component is unavailable, the remaining available
 * components are re-normalized so missing AI services do not
 * automatically destroy the visual score.
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

    // Null/blank values are missing embedding dimensions, not numeric zero.
    // Coercing them with Number() can make incomplete vectors look identical.
    const rawX = a[i];
    const rawY = b[i];
    if (
      rawX === null || rawX === undefined ||
      rawY === null || rawY === undefined ||
      (typeof rawX === 'string' && rawX.trim() === '') ||
      (typeof rawY === 'string' && rawY.trim() === '')
    ) {
      return null;
    }
    const x = Number(rawX);
    const y = Number(rawY);

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
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
 * Convert cosine similarity to a non-negative display score.
 *
 * Do not shift [-1, 1] to [0, 100]: that makes orthogonal vectors
 * (cosine 0, no directional similarity) appear to be a 50% match and
 * inflates ordinary MobileNet/CLIP comparisons. This remains a similarity
 * score, not a calibrated probability of physical-item identity.
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

  return Math.max(0, Math.min(1, cosine)) * 100;
}


/*
 * Compare MobileNetV2, CLIP and fine visual details.
 *
 * Normal configuration:
 *
 *   MobileNetV2      40%
 *   CLIP             40%
 *   Fine Visual AI   20%
 *
 * The resulting percentage is converted into the existing
 * W.cnnImage = 10 point visual contribution.
 */
function cnnScore(
  lost,
  found
) {

  const firstImageSource = item => {
    const direct = [
      item?.image,
      item?.imageUrl,
      item?.image_url,
      item?.photo,
      item?.photoUrl,
      item?.photo_url
    ].find(value => typeof value === 'string' && value.trim());
    if (direct) return direct.trim();
    const images = Array.isArray(item?.images) ? item.images : [];
    const first = images.find(value => typeof value === 'string' && value.trim());
    return first ? first.trim() : '';
  };
  const lostImageSource = firstImageSource(lost);
  const foundImageSource = firstImageSource(found);
  const distinctImageSources = Boolean(
    lostImageSource && foundImageSource &&
    lostImageSource !== foundImageSource
  );
  const exactVectorMatch = (a, b) => Boolean(
    Array.isArray(a) && Array.isArray(b) &&
    a.length > 0 && a.length === b.length &&
    a.every((value, index) =>
      Number.isFinite(Number(value)) &&
      Number.isFinite(Number(b[index])) &&
      Number(value) === Number(b[index])
    )
  );

  // Do not mislabel the deterministic color-histogram fallback as MobileNetV2.
  // Older stored records without model metadata remain backward-compatible, but
  // explicit fallback metadata makes that vector ineligible for a MobileNet score.
  const modelName = (item, keys) => {
    for (const key of keys) {
      const value = item?.[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
  };
  const lostMobileModel = modelName(lost, ['imageEmbeddingModel', 'image_embedding_model', 'model']);
  const foundMobileModel = modelName(found, ['imageEmbeddingModel', 'image_embedding_model', 'model']);
  const mobileNetProvenanceValid =
    !/fallback|histogram/i.test(lostMobileModel) &&
    !/fallback|histogram/i.test(foundMobileModel);
  const lostClipModel = modelName(lost, ['clipEmbeddingModel', 'clip_embedding_model', 'clip_model']);
  const foundClipModel = modelName(found, ['clipEmbeddingModel', 'clip_embedding_model', 'clip_model']);
  const clipProvenanceValid =
    !/fallback|unavailable|none/i.test(lostClipModel) &&
    !/fallback|unavailable|none/i.test(foundClipModel) &&
    lost?.clipAvailable !== false && found?.clipAvailable !== false;

  const mobileNetCosine = mobileNetProvenanceValid
    ? embeddingCosine(lost?.imageEmbedding, found?.imageEmbedding)
    : null;

  const clipCosine = clipProvenanceValid
    ? embeddingCosine(lost?.clipEmbedding, found?.clipEmbedding)
    : null;

  const mobileNetPercentage =
    cosineToPercentage(
      mobileNetCosine
    );

  const clipPercentage =
    cosineToPercentage(
      clipCosine
    );


  /*
   * Fine-grained visual comparison.
   *
   * This is now part of the actual visual score.
   */
  const fineVisualDetails =
    compareVisualDetails(
      lost?.visualDetails ||
      lost?.visual_details ||
      null,

      found?.visualDetails ||
      found?.visual_details ||
      null
    );

  const fineVisualPercentage =
    fineVisualDetails &&
    fineVisualDetails.available &&
    Number.isFinite(
      Number(
        fineVisualDetails.percentage
      )
    )
      ? Number(
          fineVisualDetails.percentage
        )
      : null;


  const lostVisualDetails = lost?.visualDetails || lost?.visual_details || {};
  const foundVisualDetails = found?.visualDetails || found?.visual_details || {};
  const lostScratch = lostVisualDetails?.scratchScreening || null;
  const foundScratch = foundVisualDetails?.scratchScreening || null;
  const hasLostScratchResult = lostScratch?.available === true;
  const hasFoundScratchResult = foundScratch?.available === true;
  const scratchMismatch = Boolean(
    hasLostScratchResult && hasFoundScratchResult &&
    lostScratch.possible_mark !== foundScratch.possible_mark
  );
  const scratchScreening = {
    available: hasLostScratchResult || hasFoundScratchResult,
    lost: hasLostScratchResult ? lostScratch : null,
    found: hasFoundScratchResult ? foundScratch : null,
    mismatch: scratchMismatch,
    note: 'Heuristic screening only; scratches must be visually reviewed and are not an automatic identity rejection.'
  };

  const hasMobileNet =
    mobileNetPercentage !== null;

  const hasClip =
    clipPercentage !== null;

  const hasFineVisual =
    fineVisualPercentage !== null;


  /*
   * Engineering weights.
   *
   * IMPORTANT:
   * These are contribution weights, NOT measured model
   * accuracy.
   */
  const configuredMobileNetWeight = 0.40;
  const configuredClipWeight = 0.40;
  const configuredFineVisualWeight = 0.20;


  /*
   * Only include components that are actually available.
   *
   * This means:
   *
   * MobileNet + CLIP + Fine:
   *   40 / 40 / 20
   *
   * MobileNet + CLIP:
   *   50 / 50
   *
   * MobileNet + Fine:
   *   66.67 / 33.33
   *
   * CLIP + Fine:
   *   66.67 / 33.33
   *
   * MobileNet only:
   *   100%
   *
   * CLIP only:
   *   100%
   *
   * Fine only:
   *   100%
   */
  const availableWeightTotal =
    (
      hasMobileNet
        ? configuredMobileNetWeight
        : 0
    ) +
    (
      hasClip
        ? configuredClipWeight
        : 0
    ) +
    (
      hasFineVisual
        ? configuredFineVisualWeight
        : 0
    );


  let mobileNetWeight = 0;
  let clipWeight = 0;
  let fineVisualWeight = 0;

  if (
    availableWeightTotal > 0
  ) {

    mobileNetWeight =
      hasMobileNet
        ? configuredMobileNetWeight /
          availableWeightTotal
        : 0;

    clipWeight =
      hasClip
        ? configuredClipWeight /
          availableWeightTotal
        : 0;

    fineVisualWeight =
      hasFineVisual
        ? configuredFineVisualWeight /
          availableWeightTotal
        : 0;
  }


  /*
   * Calculate final visual percentage.
   */
  let percentage = null;

  let model = 'none';


  if (
    availableWeightTotal > 0
  ) {

    percentage = 0;

    if (
      hasMobileNet
    ) {
      percentage +=
        mobileNetPercentage *
        mobileNetWeight;
    }

    if (
      hasClip
    ) {
      percentage +=
        clipPercentage *
        clipWeight;
    }

    if (
      hasFineVisual
    ) {
      percentage +=
        fineVisualPercentage *
        fineVisualWeight;
    }


    const modelParts = [];

    if (hasMobileNet) {
      modelParts.push(
        'MobileNetV2'
      );
    }

    if (hasClip) {
      modelParts.push(
        'CLIP'
      );
    }

    if (hasFineVisual) {
      modelParts.push(
        'Fine Visual AI'
      );
    }

    model =
      modelParts.join(
        ' + '
      );
  }


  /*
   * ---------------------------------------------------------
   * CLIP visual recognition / attribute consistency
   * ---------------------------------------------------------
   *
   * Embedding similarity can say two bottles look similar
   * even when one is visually small and the other is visually
   * large. Use the CLIP zero-shot attributes as an additional
   * contradiction check.
   */
  const lostVisual =
    lost?.visualRecognition ||
    lost?.visual_recognition ||
    {};

  const foundVisual =
    found?.visualRecognition ||
    found?.visual_recognition ||
    {};

  const lostObject =
    safeString(
      lostVisual.objectType ||
      lostVisual.object_type
    ).toLowerCase();

  const foundObject =
    safeString(
      foundVisual.objectType ||
      foundVisual.object_type
    ).toLowerCase();

  const lostBinaryBottleSize =
    safeString(
      lostVisual?.bottleSizeBinary?.label ||
      lostVisual?.bottle_size_binary?.label
    ).toLowerCase();

  const foundBinaryBottleSize =
    safeString(
      foundVisual?.bottleSizeBinary?.label ||
      foundVisual?.bottle_size_binary?.label
    ).toLowerCase();

  const lostSize =
    safeString(
      lostBinaryBottleSize ||
      lostVisual.sizeClass ||
      lostVisual.size_class
    ).toLowerCase();

  const foundSize =
    safeString(
      foundBinaryBottleSize ||
      foundVisual.sizeClass ||
      foundVisual.size_class
    ).toLowerCase();

  const normalizeVisualConfidence = value => {
    if (value === null || value === undefined || value === '') return 0;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    // AI service versions have emitted confidence as both 0-1 and 0-100.
    // Normalize before applying thresholds so 40% is not mistaken for 4000%.
    return Math.max(0, Math.min(1, numeric > 1 ? numeric / 100 : numeric));
  };

  const normalizeVisualColor = (value) => {
    const color = safeString(value)
      .toLowerCase()
      .trim()
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ");

    // Choose the first color mentioned in the label, not the first color
    // in a fixed priority list (which could mistake black trim for a pink item).
    const match = color.match(/\b(black|white|gray|grey|silver|red|blue|green|yellow|orange|brown|pink|purple)\b/i);
    if (match) {
      const canonical = match[1].toLowerCase();
      // Gray and silver are visually adjacent and should not create a hard
      // color contradiction from small lighting/exposure differences alone.
      return ['grey', 'silver'].includes(canonical) ? 'gray' : canonical;
    }

    return color;
  };

  const lostColor = normalizeVisualColor(lostVisual.color);
  const foundColor = normalizeVisualColor(foundVisual.color);

  const lostObjectConfidence = normalizeVisualConfidence(
    lostVisual.objectConfidence ?? lostVisual.object_confidence
  );

  const foundObjectConfidence = normalizeVisualConfidence(
    foundVisual.objectConfidence ?? foundVisual.object_confidence
  );

  const lostSizeConfidence = normalizeVisualConfidence(
    lostVisual?.bottleSizeBinary?.confidence ??
    lostVisual?.bottle_size_binary?.confidence ??
    lostVisual.sizeConfidence ?? lostVisual.size_confidence
  );

  const foundSizeConfidence = normalizeVisualConfidence(
    foundVisual?.bottleSizeBinary?.confidence ??
    foundVisual?.bottle_size_binary?.confidence ??
    foundVisual.sizeConfidence ?? foundVisual.size_confidence
  );

  const lostColorConfidence = normalizeVisualConfidence(
    lostVisual.colorConfidence ?? lostVisual.color_confidence
  );

  const foundColorConfidence = normalizeVisualConfidence(
    foundVisual.colorConfidence ?? foundVisual.color_confidence
  );

  const strongObjectEvidence =
    lostObject &&
    foundObject &&
    lostObjectConfidence >= 0.45 &&
    foundObjectConfidence >= 0.45;

  const strongSizeEvidence =
    lostSize &&
    foundSize &&
    lostSizeConfidence >= 0.45 &&
    foundSizeConfidence >= 0.45;

  const strongColorEvidence =
    lostColor &&
    foundColor &&
    lostColorConfidence >= 0.55 &&
    foundColorConfidence >= 0.55;

  // Compare foreground-object colour independently of CLIP's whole-image
  // colour label. This helps detect a black item against a white item even
  // when descriptions and CLIP embeddings are otherwise highly similar.
  const foregroundColorEvidence = details => {
    const visualDetails = details || {};
    const candidate = visualDetails.foreground_color || visualDetails.foregroundColor || {};
    const label = safeString(candidate.label || candidate.name)
      .toLowerCase()
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const confidence = normalizeVisualConfidence(candidate.confidence);
    // Normalize shade descriptors before declaring a contradiction. Image
    // lighting, shadows and camera white balance commonly turn gray into
    // light gray/dark gray. Keep genuinely different base colors distinct.
    const shadeNormalized = label
      .replace(/^(very light|light|pale|medium|dark|deep)\s+/, '')
      .replace(/\s+(very light|light|pale|medium|dark|deep)$/, '')
      .trim();
    const canonical = ['grey', 'silver'].includes(shadeNormalized)
      ? 'gray'
      : shadeNormalized;
    return {
      label: canonical,
      confidence,
      available: candidate.available !== false && Boolean(canonical) && canonical !== 'unknown'
    };
  };
  const lostForegroundColor = foregroundColorEvidence(lostVisualDetails);
  const foundForegroundColor = foregroundColorEvidence(foundVisualDetails);
  const strongForegroundColorEvidence = Boolean(
    lostForegroundColor.available && foundForegroundColor.available &&
    lostForegroundColor.confidence >= 0.65 && foundForegroundColor.confidence >= 0.65
  );
  const foregroundColorConflict = Boolean(
    strongForegroundColorEvidence &&
    lostForegroundColor.label !== foundForegroundColor.label &&
    // Treat black/white and other clearly distinct basic colour names as a
    // contradiction. Nearby tones (gray/silver) are intentionally normalized.
    !(new Set([lostForegroundColor.label, foundForegroundColor.label]).size === 1)
  );

  const objectConflict =
    Boolean(
      strongObjectEvidence &&
      lostObject !== foundObject &&
      !(
        (lostObject === 'water_bottle' &&
          foundObject === 'bottle') ||
        (lostObject === 'bottle' &&
          foundObject === 'water_bottle')
      )
    );

  const sizeConflict =
    Boolean(
      strongSizeEvidence &&
      lostSize !== foundSize &&
      (
        (
          lostSize === 'small' &&
          foundSize === 'large'
        ) ||
        (
          lostSize === 'large' &&
          foundSize === 'small'
        ) ||
        (
          lostSize === 'very_small' &&
          (
            foundSize === 'large' ||
            foundSize === 'very_large'
          )
        ) ||
        (
          foundSize === 'very_small' &&
          (
            lostSize === 'large' ||
            lostSize === 'very_large'
          )
        ) ||
        (
          lostSize === 'very_large' &&
          (
            foundSize === 'small' ||
            foundSize === 'very_small'
          )
        ) ||
        (
          foundSize === 'very_large' &&
          (
            lostSize === 'small' ||
            lostSize === 'very_small'
          )
        )
      )
    );

  const colorConflict = Boolean(
    (strongColorEvidence && lostColor !== foundColor) ||
    foregroundColorConflict
  );

  let visualContradictionPenalty = 0;

  if (objectConflict) {
    visualContradictionPenalty += 20;
  }

  if (sizeConflict) {
    visualContradictionPenalty += 18;
  }

  if (colorConflict) {
    // Image-only color estimates are heuristic and can be affected by
    // lighting, white balance, shadows, or background leakage. Keep a small
    // review penalty here; the score policy below applies the stronger cap
    // only when report-provided primary colors explicitly conflict.
    visualContradictionPenalty += 4;
  }

  // A difference in heuristic scratch screening is only a review signal.
  if (scratchMismatch) {
    visualContradictionPenalty += 4;
  }

  const visualContradiction =
    objectConflict ||
    sizeConflict ||
    colorConflict;


  /*
   * Convert final visual percentage into the existing
   * 10-point visual contribution.
   */
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
     * Fine Visual AI.
     */
    fineVisualPercentage:
      fineVisualPercentage === null
        ? null
        : Math.round(
            fineVisualPercentage * 10
          ) / 10,

    fineVisualDetails,
    scratchScreening,


    /*
     * Hybrid weights.
     */
    mobileNetWeight,

    clipWeight,

    fineVisualWeight,

    model,
    distinctImageSources,
    identicalMobileNetEmbeddings: distinctImageSources && exactVectorMatch(
      lost?.imageEmbedding, found?.imageEmbedding
    ),
    identicalClipEmbeddings: distinctImageSources && exactVectorMatch(
      lost?.clipEmbedding, found?.clipEmbedding
    ),
    identicalFineVisualSignature: Boolean(
      distinctImageSources && hasFineVisual &&
      Number(fineVisualPercentage) >= 99.9 &&
      Number(fineVisualDetails?.shapeSimilarityPercentage) >= 99.9 &&
      Number(fineVisualDetails?.colorSimilarityPercentage) >= 99.9 &&
      Number(fineVisualDetails?.regionSimilarityPercentage) >= 99.9 &&
      Number(fineVisualDetails?.foregroundSimilarityPercentage) >= 99.9
    ),
    mobileNetProvenanceValid,
    clipProvenanceValid,
    embeddingSources: {
      lostMobileNet: lostMobileModel || 'legacy/unspecified',
      foundMobileNet: foundMobileModel || 'legacy/unspecified',
      lostClip: lostClipModel || 'legacy/unspecified',
      foundClip: foundClipModel || 'legacy/unspecified'
    },


    /*
     * Human-readable visual recognition.
     */
    visualRecognition: {
      lost: lostVisual,
      found: foundVisual
    },

    objectConflict,
    sizeConflict,
    colorConflict,
    foregroundColorConflict,
    foregroundColorEvidence: {
      lost: lostForegroundColor,
      found: foundForegroundColor,
      reliableEnoughToFlag: strongForegroundColorEvidence
    },
    visualContradiction,
    visualContradictionPenalty,
    scratchScreening
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


function detectItemObjectFamily(
  item = {},
  visual = {}
) {

  const text = [
    item.name,
    item.itemName,
    item.title,
    item.desc,
    item.description,
    ...(Array.isArray(item.detectedLabels)
      ? item.detectedLabels
      : [])
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const visualObject = String(
    visual?.objectType ||
    visual?.object_type ||
    ''
  )
    .toLowerCase()
    .replace(/-/g, '_')
    .trim();

  const source = `${text} ${visualObject}`;

  /*
   * Order matters.
   * More specific names are checked before generic terms.
   */

  if (
    /\b(motorcycle\s+helmet|crash\s+helmet|helmet)\b/i
      .test(source)
  ) {
    return 'helmet';
  }

  if (
    /\b(water\s*bottle|water_bottle|bottle|flask|thermos|sipper)\b/i
      .test(source)
  ) {
    return 'bottle';
  }

  if (
    /\b(wristwatch|wrist\s*watch|smartwatch|smart\s*watch|watch)\b/i
      .test(source)
  ) {
    return 'watch';
  }

  if (
    /\b(wallet|purse\s*wallet|cardholder|card\s*holder)\b/i
      .test(source)
  ) {
    return 'wallet';
  }

  if (
    /\b(backpack|back\s*pack|schoolbag|school\s*bag|rucksack|bag)\b/i
      .test(source)
  ) {
    return 'bag';
  }

  if (
    /\b(phone|mobile|cellphone|cell\s*phone|smartphone|smart\s*phone)\b/i
      .test(source)
  ) {
    return 'phone';
  }

  if (
    /\b(mouse|computer\s+mouse|gaming\s+mouse|wireless\s+mouse|wired\s+mouse|trackball\s+mouse)\b/i
      .test(source)
  ) {
    return 'mouse';
  }
  if (
    /\b(macbook|laptop|notebook\s*computer|computer\s+notebook)\b/i
      .test(source)
  ) {
    return 'laptop';
  }

  if (
    /\b(paper\s+notebook|school\s+notebook|notebook|notepad|exercise\s+book|copybook|copy\s+book|writing\s+notebook|ruled\s+notebook|spiral\s+notebook|composition\s+(?:notebook|book))\b/i
      .test(source)
  ) {
    return 'paper_notebook';
  }

  if (
    /\b(tablet|ipad)\b/i
      .test(source)
  ) {
    return 'tablet';
  }

  if (
    /\b(headphones|headphone|earbuds|earbud|earphones|earphone)\b/i
      .test(source)
  ) {
    return 'headphone';
  }

  if (
    /\b(pendrive|pen\s*drive|usb\s*drive|flash\s*drive|thumb\s*drive|memory\s*stick)\b/i
      .test(source)
  ) {
    return 'pendrive';
  }

  // Cables, wall adapters and chargers are components of the same
  // charging-accessory kit. Treating them as unrelated object families
  // caused false conflicts for multi-part lost/found reports.
  if (
    /\b(charger|charging\s*adapter|power\s*adapter|usb\s*adapter|adapter|charging\s*cable|charge\s*cable|cable|charging\s*cord|power\s*cord)\b/i
      .test(source)
  ) {
    return 'charging_accessory';
  }
  if (
    /\b(keys|keychain|key\s*chain|key)\b/i
      .test(source)
  ) {
    return 'key';
  }

  if (
    /\b(glasses|spectacles|eyeglasses|sunglasses)\b/i
      .test(source)
  ) {
    return 'glasses';
  }

  if (
    /\b(shoe|shoes|sneaker|sneakers|footwear)\b/i
      .test(source)
  ) {
    return 'shoe';
  }

  return null;
}


/*
 * Determine the item's MAIN color, not every color mentioned in its
 * description. For example, a silver helmet may have a black visor and
 * black trim; those secondary colors must not make it appear to match a
 * black helmet.
 */
function extractPrimaryColor(item = {}) {
  const aliases = {
    grey: 'gray',
    'dark grey': 'gray',
    'light grey': 'gray',
    'dark gray': 'gray',
    'light gray': 'gray'
  };
  const colorPattern = '(silver|gray|grey|black|white|red|blue|green|yellow|orange|pink|purple|brown|gold)';
  const canonical = value => {
    const raw = safeString(value).toLowerCase().trim().replace(/[-_]/g, ' ');
    const match = raw.match(new RegExp(`\\b${colorPattern}\\b`, 'i'));
    if (!match) return null;
    const color = match[1].toLowerCase();
    return aliases[color] || color;
  };

  const description = [item.desc, item.description, item.details, item.features]
    .map(safeString)
    .filter(Boolean)
    .join(' ');

  // For multi-part items, prefer an explicitly described component color.
  // Example: a white adapter with a red cable must be treated as a red cable,
  // even if the title is stale and still says "Black Charging Cable".
  const cableColorPatterns = [
    new RegExp(`\\b(?:charging\\s+)?(?:cable|cord|wire)\\s+(?:is|looks|appears|color\\s*(?:is|:|=)?)\\s*${colorPattern}\\b`, 'i'),
    new RegExp(`\\b(?:color\\s+(?:of\\s+)?(?:the\\s+)?(?:charging\\s+)?(?:cable|cord|wire)\\s*(?:is|:|=)?\\s*)${colorPattern}\\b`, 'i'),
    new RegExp(`\\b${colorPattern}(?:[-\\s]+(?:braided|charger|charging|power|usb|data|type[\\s-]?c))*\\s+(?:charging\\s+)?(?:cable|cord|wire)\\b`, 'i')
  ];
  for (const pattern of cableColorPatterns) {
    const match = description.match(pattern);
    if (match) {
      const color = match[1].toLowerCase();
      return aliases[color] || color;
    }
  }

  // A dedicated structured color field is normally the strongest text signal,
  // after any explicit component-specific description above.
  const structured = canonical(item.color);
  if (structured) return structured;

  // Item titles usually name the item's primary color first.
  const title = safeString(item.name || item.itemName || item.title);
  const titleColor = canonical(title);
  if (titleColor) return titleColor;

  // Prefer colors attached to the shell/body/main object, not visor/trim.
  const primaryPatterns = [
    new RegExp(`\\b${colorPattern}(?:[- ]colou?red)?\\s+(?:outer\\s+)?(?:shell|body|main body|helmet|motorcycle helmet|backpack|bag|wallet|phone|laptop|bottle|watch)\\b`, 'i'),
    new RegExp(`\\b(?:main|primary|overall)\\s+colou?r\\s*(?:is|:|=)?\\s*${colorPattern}\\b`, 'i'),
    new RegExp(`\\b(?:helmet|item|shell|body|backpack|bag|wallet|phone|laptop|bottle|watch)\\s+(?:is|looks|appears)\\s+(?:primarily\\s+)?${colorPattern}\\b`, 'i')
  ];
  for (const pattern of primaryPatterns) {
    const match = description.match(pattern);
    if (match) {
      const color = match[1].toLowerCase();
      return aliases[color] || color;
    }
  }

  // Last resort: first color mentioned in the description.
  return canonical(description);
}


/* =========================================================
 * FINAL MATCH SCORE
 * ========================================================= */
function calculateMatchScore(
  lost = {},
  found = {}
) {

  /*
   * HARD ITEM OBJECT-FAMILY GATE.
   *
   * A different object must never become a candidate merely
   * because it was found in the same location or has a high
   * embedding similarity.
   *
   * Examples:
   *
   *   water bottle -> watch  = REJECT
   *   watch -> bottle         = REJECT
   *   watch -> watch          = ALLOW
   *   bottle -> bottle        = ALLOW
   *
   * If an object family cannot be determined confidently,
   * normal matching is allowed.
   */
  // Use explicit report text as the primary source of object identity.
  // Classifier labels are considered separately because they can be wrong.
  const getReportText = (item = {}) => ({
    name: item.name,
    itemName: item.itemName,
    title: item.title,
    desc: item.desc,
    description: item.description
  });

  const lostVisual =
    lost.visualRecognition || lost.visual_recognition ||
    lost.visualDetails || lost.visual_details || {};
  const foundVisual =
    found.visualRecognition || found.visual_recognition ||
    found.visualDetails || found.visual_details || {};

  const lostTextFamily = detectItemObjectFamily(getReportText(lost));
  const foundTextFamily = detectItemObjectFamily(getReportText(found));
  const lostVisualFamily = detectItemObjectFamily({}, lostVisual);
  const foundVisualFamily = detectItemObjectFamily({}, foundVisual);

  const normalizeFamilyGateConfidence = value => {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return numeric > 1 ? numeric / 100 : numeric;
  };
  const lostVisualConfidence = normalizeFamilyGateConfidence(
    lostVisual.objectConfidence ?? lostVisual.object_confidence
  );
  const foundVisualConfidence = normalizeFamilyGateConfidence(
    foundVisual.objectConfidence ?? foundVisual.object_confidence
  );

  // Explicit incompatible report descriptions remain a hard rejection.
  const textFamilyConflict = Boolean(
    lostTextFamily && foundTextFamily && lostTextFamily !== foundTextFamily
  );

  // A classifier-only conflict is decisive only when both predictions
  // carry explicit high confidence. Missing confidence is not proof.
  const confidentVisualFamilyConflict = Boolean(
    lostVisualFamily && foundVisualFamily &&
    lostVisualFamily !== foundVisualFamily &&
    lostVisualConfidence !== null && foundVisualConfidence !== null &&
    lostVisualConfidence >= 0.75 && foundVisualConfidence >= 0.75
  );

  const objectFamilyConflict = textFamilyConflict || confidentVisualFamilyConflict;
  const lostObjectFamily = lostTextFamily || lostVisualFamily;
  const foundObjectFamily = foundTextFamily || foundVisualFamily;

  if (objectFamilyConflict) {
    const conflictLostFamily = textFamilyConflict ? lostTextFamily : lostVisualFamily;
    const conflictFoundFamily = textFamilyConflict ? foundTextFamily : foundVisualFamily;
    return {
      score: 0,
      confidence: 'low',
      matchEligible: false,
      identityConflict: true,
      identityConflictReason: `Different object types: ${conflictLostFamily} vs ${conflictFoundFamily}`,
      objectFamilyConflict: true,
      lostObjectFamily: conflictLostFamily,
      foundObjectFamily: conflictFoundFamily,
      reasons: [
        `Rejected: incompatible object types (${conflictLostFamily} vs ${conflictFoundFamily})`
      ],
      scores: {
        category: 0,
        nameText: 0,
        description: 0,
        location: 0,
        date: 0,
        properties: 0,
        imageLabels: 0,
        cnnImage: 0
      }
    };
  }

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

  // If a structured color is merely repeating the AI foreground-color estimate
  // and the report text contains no color, do not promote that image estimate
  // into a confirmed report conflict. Keep normal structured report colors
  // (including cases without foreground-image evidence) as explicit evidence.
  const hasTextColor = item => /\b(silver|gray|grey|black|white|red|blue|green|yellow|orange|pink|purple|brown|gold)\b/i.test(
    [item?.name, item?.itemName, item?.title, item?.desc, item?.description, item?.details, item?.features]
      .map(safeString).join(' ')
  );
  const canonicalImageColor = value => {
    const match = safeString(value).toLowerCase().match(/\b(black|white|gray|grey|silver|red|blue|green|yellow|orange|brown|pink|purple)\b/);
    if (!match) return '';
    return match[1] === 'grey' ? 'gray' : match[1];
  };
  const imageDerivedColorOnly = item => Boolean(
    item?.visualDetails?.foreground_color?.available &&
    !hasTextColor(item) &&
    canonicalImageColor(item?.color) &&
    canonicalImageColor(item?.color) === canonicalImageColor(item?.visualDetails?.foreground_color?.label)
  );
  const lostPrimaryColor = imageDerivedColorOnly(lost)
    ? extractPrimaryColor({ ...lost, color: undefined })
    : extractPrimaryColor(lost);
  const foundPrimaryColor = imageDerivedColorOnly(found)
    ? extractPrimaryColor({ ...found, color: undefined })
    : extractPrimaryColor(found);
  const reportedPrimaryColorConflict = Boolean(
    lostPrimaryColor &&
    foundPrimaryColor &&
    lostPrimaryColor !== foundPrimaryColor
  );

  // A multi-part item can legitimately contain different colors on different
  // components (for example, a red charging cable with a white wall adapter).
  // Do not treat its component colors as a whole-item contradiction when the
  // combined reports explicitly describe both components and both colors.
  const combinedItemDescription = [
    lost?.name, lost?.itemName, lost?.desc, lost?.description, lost?.details, lost?.features,
    found?.name, found?.itemName, found?.desc, found?.description, found?.details, found?.features
  ].map(safeString).join(' ').toLowerCase();
  const isChargingAccessory = /\b(charger|charging|power\s*adapter|wall\s*adapter|usb\s*cable)\b/i.test(
    [lost?.name, lost?.itemName, lost?.category, lost?.type, found?.name, found?.itemName, found?.category, found?.type, combinedItemDescription].map(safeString).join(' ')
  );
  const hasCableComponent = /\b(cable|cord|wire|lead)\b/i.test(combinedItemDescription);
  const hasAdapterComponent = /\b(adaptor|adapter|power\s*brick)\b/i.test(combinedItemDescription);
  const mentionsBothReportedColors = Boolean(
    lostPrimaryColor && foundPrimaryColor &&
    new RegExp(`\\b${lostPrimaryColor}\\b`, 'i').test(combinedItemDescription) &&
    new RegExp(`\\b${foundPrimaryColor}\\b`, 'i').test(combinedItemDescription)
  );
  const explicitCableColorFromDescription = item => {
    const description = [item?.desc, item?.description, item?.details, item?.features]
      .map(safeString).filter(Boolean).join(' ');
    const colorPattern = '(silver|gray|grey|black|white|red|blue|green|yellow|orange|pink|purple|brown|gold)';
    const patterns = [
      new RegExp(`\\b${colorPattern}(?:[-\\s]+(?:braided|charger|charging|power|usb|data|type[\\s-]?c))*\\s+(?:charging\\s+)?(?:cable|cord|wire|lead)\\b`, 'i'),
      new RegExp(`\\b(?:charging\\s+)?(?:cable|cord|wire|lead)\\s+(?:is|looks|appears|color\\s*(?:is|:|=)?)\\s*${colorPattern}\\b`, 'i')
    ];
    for (const pattern of patterns) {
      const match = description.match(pattern);
      if (match) return match[1].toLowerCase() === 'grey' ? 'gray' : match[1].toLowerCase();
    }
    return '';
  };
  const lostCableColor = explicitCableColorFromDescription(lost);
  const foundCableColor = explicitCableColorFromDescription(found);
  const explicitCableColorConflict = Boolean(lostCableColor && foundCableColor && lostCableColor !== foundCableColor);
  const multiComponentColorDifference = Boolean(
    reportedPrimaryColorConflict && isChargingAccessory && hasCableComponent &&
    hasAdapterComponent && mentionsBothReportedColors && !explicitCableColorConflict
  );

  // Resolve confidence consistently because the Python service has emitted
  // both 0..1 and 0..100 confidence values across versions.
  const normalizeEvidenceConfidence = value => {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return numeric > 1 ? numeric / 100 : numeric;
  };
  const normalizeColorLabel = value => {
    const match = safeString(value).toLowerCase().replace(/[_-]+/g, ' ')
      .match(/\b(black|white|gray|grey|silver|red|blue|green|yellow|orange|brown|pink|purple)\b/);
    if (!match) return '';
    return match[1] === 'grey' ? 'gray' : match[1];
  };
  const lostReportedVisual = lost.visualRecognition || lost.visual_recognition || {};
  const foundReportedVisual = found.visualRecognition || found.visual_recognition || {};
  const lostModelColor = normalizeColorLabel(lostReportedVisual.color);
  const foundModelColor = normalizeColorLabel(foundReportedVisual.color);
  const lostModelColorConfidence = normalizeEvidenceConfidence(
    lostReportedVisual.colorConfidence ?? lostReportedVisual.color_confidence
  );
  const foundModelColorConfidence = normalizeEvidenceConfidence(
    foundReportedVisual.colorConfidence ?? foundReportedVisual.color_confidence
  );
  // Image colour recognition is an estimate, not ground truth. Preserve
  // explicit report-field disagreement for scoring and review even when
  // image classifiers predict the same colour.
  const strongVisualColorAgreement = Boolean(
    lostModelColor && foundModelColor &&
    lostModelColor === foundModelColor &&
    lostModelColorConfidence !== null && foundModelColorConfidence !== null &&
    lostModelColorConfidence >= 0.65 && foundModelColorConfidence >= 0.65
  );
  const visualColorAgreementOverridesReportConflict = false;
  const primaryColorConflict = Boolean(
    reportedPrimaryColorConflict && !visualColorAgreementOverridesReportConflict && !multiComponentColorDifference
  );

  // A raw embedding cosine can be very high for visually similar categories
  // (e.g. two chargers) without establishing that the same physical item is
  // present. When report-derived primary colors explicitly conflict, preserve
  // raw model scores for audit, but cap the visual score used by the hybrid
  // matcher and its 10-point contribution. This prevents a generic embedding
  // from receiving full points despite contradictory item evidence.
  if (primaryColorConflict && image.percentage !== null) {
    image.rawPercentage = image.percentage;
    image.rawPoints = image.points;
    image.percentage = Math.min(image.percentage, 65);
    image.points = Math.min(image.points, 6);
    image.contradictionCapApplied = true;
  } else {
    image.rawPercentage = image.percentage;
    image.rawPoints = image.points;
    image.contradictionCapApplied = false;
  }

  const anyColorConflict = primaryColorConflict || image.colorConflict;
  const normalizeVisualColorLabel = value => {
    const normalized = safeString(value)
      .toLowerCase()
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const match = normalized.match(/\b(black|white|gray|grey|silver|red|blue|green|yellow|orange|brown|pink|purple)\b/i);
    if (!match) return '';
    return match[1].toLowerCase() === 'grey' ? 'gray' : match[1].toLowerCase();
  };
  const lostVisualColorLabel = normalizeVisualColorLabel(image.visualRecognition?.lost?.color);
  const foundVisualColorLabel = normalizeVisualColorLabel(image.visualRecognition?.found?.color);
  const visualColorLabelsDiffer = Boolean(
    lostVisualColorLabel && foundVisualColorLabel &&
    lostVisualColorLabel !== foundVisualColorLabel
  );
  const uncertainVisualColorDifference = Boolean(
    visualColorLabelsDiffer && !anyColorConflict
  );
  const colorEvidenceUncertain = anyColorConflict || uncertainVisualColorDifference;

  const effectivePropertiesScore = colorEvidenceUncertain
    ? (() => {
        const d = properties.details;
        const components = [];
        // Only an explicit report-color disagreement zeros the color-property
        // evidence. An image-only disagreement is uncertain: retain at most
        // half credit rather than treating a visual heuristic as ground truth.
        const colorEvidenceScore = primaryColorConflict ? 0 : Math.min(d.color, 0.5);

        if (d.lost.colors.length || d.found.colors.length) {
          components.push({ score: colorEvidenceScore, weight: 0.35 });
        }
        if (d.lost.brands.length || d.found.brands.length) {
          components.push({ score: d.brand, weight: 0.15 });
        }
        if (d.lost.objectTypes.length || d.found.objectTypes.length) {
          components.push({ score: d.objectType, weight: 0.35 });
        }
        if (d.lost.features.length || d.found.features.length) {
          components.push({ score: d.features, weight: 0.15 });
        }

        const totalWeight = components.reduce((sum, c) => sum + c.weight, 0);
        return totalWeight
          ? components.reduce((sum, c) => sum + c.score * c.weight, 0) / totalWeight
          : 0;
      })()
    : properties.score;

  /*
   * =========================================================
   * EXPLICIT IDENTITY CONFLICT GATE
   * =========================================================
   *
   * Strong textual properties are identity evidence.
   *
   * Different primary colors are scored as a contradiction and
   * sent for manual review rather than hard-rejected: a photo can
   * be mis-lit, and descriptions may mention secondary colors.
   * A confirmed different brand on both records remains a hard gate.
   * Missing information is treated as UNKNOWN, not conflict.
   */

  const lostExplicitProperties =
    properties?.details?.lost || {};

  const foundExplicitProperties =
    properties?.details?.found || {};

  const lostExplicitBrands =
    new Set(
      (lostExplicitProperties.brands || [])
        .map(normalizeBrandName)
        .filter(Boolean)
    );

  const foundExplicitBrands =
    new Set(
      (foundExplicitProperties.brands || [])
        .map(normalizeBrandName)
        .filter(Boolean)
    );

  for (const brand of extractImageBrandCandidates(lost)) {
    lostExplicitBrands.add(normalizeBrandName(brand));
  }
  for (const brand of extractImageBrandCandidates(found)) {
    foundExplicitBrands.add(normalizeBrandName(brand));
  }

  const explicitBrandConflict =
    Boolean(
      lostExplicitBrands.size &&
      foundExplicitBrands.size &&
      ![...lostExplicitBrands].some(
        brand =>
          foundExplicitBrands.has(brand)
      )
    );

  if (
    explicitBrandConflict
  ) {

    const conflictReasons = [];

    if (
      explicitBrandConflict
    ) {
      conflictReasons.push(
        `Different explicit brands: ${[
          ...lostExplicitBrands
        ].join(', ')} vs ${[
          ...foundExplicitBrands
        ].join(', ')}`
      );
    }

    return {
      score: 0,
      confidence: 'low',
      matchEligible: false,
      identityConflict: true,

      identityConflictReason:
        conflictReasons.join('; '),

      explicitBrandConflict,

      reasons: [
        'Rejected: explicit item identity conflict',
        ...conflictReasons
      ],

      breakdown: {
        category: 0,
        nameText: 0,
        description: 0,
        location: 0,
        date: 0,
        properties: 0,
        imageLabels: 0,
        cnnImage: 0
      },

      nlpSimilarity: 0,
      nlpSimilarityPercentage: 0,
      imageSimilarity: 0,
      imageSimilarityPercentage: 0,
      propertySimilarity: 0,
      locationSimilarity: 0
    };
  }

  const scores = {

    category:
      categoryScore(
        getCategoryValue(lost),
        getCategoryValue(found)
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
        effectivePropertiesScore *
        W.properties
      ),

    imageLabels:
      labelScore(
        lost,
        found
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
  const baseComponentTotal =
    Object.values(scores)
      .reduce(
        (sum, value) =>
          sum + value,
        0
      );


  let score = baseComponentTotal;

  /*
   * Category mismatch remains a strong
   * negative signal.
   */


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
   * Visual contradiction penalty.
   *
   * This is deliberately outside the 10-point visual
   * contribution. A strong attribute contradiction such as
   * SMALL bottle vs LARGE bottle must be able to reduce an
   * otherwise high text/embedding match.
   */
  const nonColorVisualPenalty = Math.max(
    0,
    Number(image.visualContradictionPenalty || 0) - (image.colorConflict ? 4 : 0)
  );
  const colorContradictionPenalty = primaryColorConflict && image.colorConflict
    ? 16
    : primaryColorConflict
      ? 10
      : image.colorConflict
        ? 4
        : 0;
  const finalVisualContradictionPenalty =
    nonColorVisualPenalty + colorContradictionPenalty;

  if (finalVisualContradictionPenalty > 0) {
    score -= finalVisualContradictionPenalty;
  }


  /*
   * HARD OBJECT IDENTITY GATE.
   *
   * A strong visual object conflict means the two items
   * are different object types.
   *
   * Example:
   *   watch vs bottle = reject
   *   watch vs phone  = reject
   *
   * Color, brand, material and size remain normal
   * matching signals and are NOT hard rejection rules.
   */
  if (
    image.objectConflict
  ) {

    score = 0;
  }

  /*
   * Visual-evidence consistency adjustment.
   * If both items produced a usable visual comparison, the final score must
   * reflect it instead of allowing text/property similarity alone to yield
   * 100%. A 0% visual comparison scales the score to at most 50%; 100% leaves
   * it unchanged. Missing/unavailable visual evidence does not penalize.
   * This is a similarity adjustment, not a probability of item identity.
   */
  const visualSimilarityForScore = image.percentage;
  let visualEvidenceFactor = null;
  if (
    visualSimilarityForScore !== null &&
    visualSimilarityForScore !== undefined &&
    Number.isFinite(Number(visualSimilarityForScore))
  ) {
    const boundedVisualSimilarity = Math.max(
      0,
      Math.min(100, Number(visualSimilarityForScore))
    );
    visualEvidenceFactor = 0.5 + 0.5 * (boundedVisualSimilarity / 100);
    score = Math.round(score * visualEvidenceFactor);
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

  const internalTextSimilarityPercentage = Math.round(combinedSimilarity * 100);
  let recommendedScoreCap = 100;
  const recommendedScoreCapReasons = [];
  if (internalTextSimilarityPercentage < 45) {
    recommendedScoreCap = Math.min(recommendedScoreCap, 64);
    recommendedScoreCapReasons.push(
      `Combined text evidence is ${internalTextSimilarityPercentage}%, below the 45% threshold; maximum score limited to 64% (SBERT semantic similarity is a separate metric).`
    );
  }
  if (primaryColorConflict) {
    // A conflict explicitly present in the lost/found report fields is stronger
    // evidence than an image-only color classifier output.
    recommendedScoreCap = Math.min(recommendedScoreCap, 62);
    recommendedScoreCapReasons.push(
      'Reported primary colors conflict; maximum score limited to 62% pending manual review.'
    );
  } else if (image.colorConflict || uncertainVisualColorDifference) {
    // Image-derived gray/white or other color differences are review signals,
    // not ground truth. Do not apply the confirmed-report-conflict cap to
    // heuristic image labels alone.
    recommendedScoreCap = Math.min(recommendedScoreCap, 82);
    recommendedScoreCapReasons.push(
      'Image-derived color estimates differ; this is uncertain visual evidence, so manual review is recommended and the maximum score is 82%.'
    );
  }
  if (primaryColorConflict && image.colorConflict) {
    recommendedScoreCap = Math.min(recommendedScoreCap, 58);
    recommendedScoreCapReasons.push(
      'Reported primary-color conflict is supported by image analysis; maximum score limited to 58%.'
    );
  }
  // A strong, confidence-qualified physical size contradiction must not be
  // overwhelmed by shared category, location, date, or generic embeddings.
  // It remains reviewable because perspective can affect apparent size.
  if (image.sizeConflict) {
    recommendedScoreCap = Math.min(recommendedScoreCap, 55);
    recommendedScoreCapReasons.push(
      'Strong visual size conflict detected; maximum score limited to 55% pending manual comparison of the actual item dimensions.'
    );
  }
  const scoreBeforeRecommendedCap = score;
  score = Math.min(score, recommendedScoreCap);

  // Low-confidence object labels should prompt a human check, but must not
  // change the numeric score or override the existing object-family gate.
  // Read the original item predictions here: the `lostObject`/`foundObject`
  // locals used by the visual-contradiction helper are scoped to that helper.
  const lostVisualForReview =
    lost?.visualRecognition || lost?.visual_recognition || {};
  const foundVisualForReview =
    found?.visualRecognition || found?.visual_recognition || {};
  const lostReviewObject = safeString(
    lostVisualForReview.objectType || lostVisualForReview.object_type
  ).trim();
  const foundReviewObject = safeString(
    foundVisualForReview.objectType || foundVisualForReview.object_type
  ).trim();
  const lostReviewConfidenceRaw =
    lostVisualForReview.objectConfidence ?? lostVisualForReview.object_confidence;
  const foundReviewConfidenceRaw =
    foundVisualForReview.objectConfidence ?? foundVisualForReview.object_confidence;
  // Classifiers in older service versions sometimes emit confidence on a
  // 0-100 scale, while newer versions emit 0-1. Normalize both forms.
  const normalizeObjectConfidence = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return numeric > 1 ? numeric / 100 : numeric;
  };
  const lostReviewConfidence = normalizeObjectConfidence(lostReviewConfidenceRaw);
  const foundReviewConfidence = normalizeObjectConfidence(foundReviewConfidenceRaw);
  const uncertainVisualObject = Boolean(
    lostReviewObject &&
    foundReviewObject &&
    ((lostReviewConfidence !== null && lostReviewConfidence < 0.45) ||
      (foundReviewConfidence !== null && foundReviewConfidence < 0.45))
  );

  const reviewRecommended = Boolean(
    internalTextSimilarityPercentage < 45 ||
    anyColorConflict ||
    (reportedPrimaryColorConflict && !multiComponentColorDifference) ||
    uncertainVisualColorDifference ||
    image.scratchScreening?.mismatch ||
    uncertainVisualObject ||
    image.sizeConflict ||
    image.objectConflict
  );
  const reviewReasons = [];
  if (uncertainVisualObject) {
    const formatObjectConfidence = value => value === null
      ? 'not available'
      : `${Math.round(value * 100)}%`;
    reviewReasons.push(
      `Low-confidence visual object prediction (lost: ${formatObjectConfidence(lostReviewConfidence)}; found: ${formatObjectConfidence(foundReviewConfidence)}; review threshold: 45%); manual review recommended`
    );
  }
  if (primaryColorConflict) {
    reviewReasons.push(`Primary color differs: ${lostPrimaryColor} vs ${foundPrimaryColor}`);
  }
  if (image.colorConflict) {
    reviewReasons.push('Computer vision detected a possible color difference');
  } else if (uncertainVisualColorDifference) {
    reviewReasons.push(`Visual color labels differ with insufficient confidence: ${lostVisualColorLabel} vs ${foundVisualColorLabel}`);
  }
  if (internalTextSimilarityPercentage < 45) {
    reviewReasons.push(
      `Low combined text similarity (${internalTextSimilarityPercentage}%; below the 45% review threshold; separate from SBERT semantic similarity)`
    );
  }
  if (image.scratchScreening?.mismatch) {
    reviewReasons.push('Scratch-like mark screening differs between images; manual visual review recommended');
  }
  if (image.sizeConflict) {
    reviewReasons.push('Strong visual size difference detected; candidate score capped at 55% pending manual review. Camera perspective can affect apparent size.');
  }

  // Do not let strong text/brand/color scores hide an unresolved object
  // identity. The UI can surface a low-confidence warning from visualDetails
  // even when the old visualRecognition confidence fields are absent; therefore
  // use the measured property evidence as an independent safety gate too.
  // Charging-kit components are grouped into one family to avoid hard rejection,
  // but a zero object-type similarity still requires review and caps the score.
  const objectTypeEvidenceMissing = Number(properties?.details?.objectType ?? 0) <= 0;
  const hasVisualObjectPrediction = Boolean(
    lostReviewObject || foundReviewObject ||
    lost?.visualDetails?.objectType || lost?.visual_details?.object_type ||
    found?.visualDetails?.objectType || found?.visual_details?.object_type
  );
  // Low-confidence visual predictions alone are a review signal, not proof
  // that the item identity is unresolved. Keep the 69% cap for genuinely
  // missing object-type evidence when a visual prediction/family exists. This
  // avoids capping a strong text/property match merely because camera angle,
  // lighting, or crop lowers classifier confidence.
  const unresolvedObjectIdentity = Boolean(
    objectTypeEvidenceMissing && (
      hasVisualObjectPrediction ||
      (lostObjectFamily && foundObjectFamily && lostObjectFamily === foundObjectFamily)
    )
  );
  if (unresolvedObjectIdentity) {
    recommendedScoreCap = Math.min(recommendedScoreCap, 69);
    recommendedScoreCapReasons.push(
      'Object-type property evidence is missing; maximum score limited to 69% until the item type can be verified.'
    );
    score = Math.min(score, recommendedScoreCap);
    if (!reviewReasons.some(reason => /object type evidence is unresolved/i.test(reason))) {
      reviewReasons.push(
        uncertainVisualObject
          ? 'Object type evidence is unresolved and visual predictions are low-confidence; score capped pending manual review'
          : 'Object type similarity is 0%; score capped pending manual review'
      );
    }
  }

  // Audio products are especially easy to confuse: white wired in-ear
  // earphones and white over-ear headphones share color/category words but
  // are structurally different. If the two image classifiers disagree in
  // confidence this sharply, never let text/location boosts create a high
  // candidate. Keep it reviewable rather than hard-rejecting uncertain AI.
  const audioFamily = lostObjectFamily === 'headphone' && foundObjectFamily === 'headphone';
  const asymmetricAudioVisualConfidence = Boolean(
    audioFamily && lostReviewConfidence !== null && foundReviewConfidence !== null &&
    ((lostReviewConfidence < 0.45 && foundReviewConfidence >= 0.75) ||
     (foundReviewConfidence < 0.45 && lostReviewConfidence >= 0.75))
  );
  if (asymmetricAudioVisualConfidence) {
    recommendedScoreCap = Math.min(recommendedScoreCap, 59);
    recommendedScoreCapReasons.push(
      'Audio-device visual identity confidence is inconsistent; maximum score limited to 59% pending manual comparison of the original photos.'
    );
    score = Math.min(score, recommendedScoreCap);
    reviewReasons.push(
      'Audio-device image predictions have sharply different confidence (one below 45%, the other at least 75%); compare wired/in-ear versus over-ear structure before confirming.'
    );
  }

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


  if (properties.details.color > 0 && !colorEvidenceUncertain) { reasons.push('Color appears to match'); }

  if (primaryColorConflict) {
    reasons.push(`Primary color differs: ${lostPrimaryColor} vs ${foundPrimaryColor}; manual review recommended`);
  } else if (multiComponentColorDifference) {
    reasons.push(`Different reported colors (${lostPrimaryColor} and ${foundPrimaryColor}) are treated as component colors for a multi-part charging accessory; compare the cable and adapter separately`);
  } else if (visualColorAgreementOverridesReportConflict) {
    reasons.push(`Reported colors differ (${lostPrimaryColor} vs ${foundPrimaryColor}), but both image color estimates agree on ${lostModelColor}; verify the report fields`);
  }

  if (image.colorConflict && !primaryColorConflict) {
    reasons.push('Computer vision detected a possible color difference; manual review recommended');
  }

  if (internalTextSimilarityPercentage < 45) {
    reasons.push(`Low combined text evidence (${internalTextSimilarityPercentage}%; separate from SBERT semantic similarity); manual review recommended`);
  }


  if (
    properties.details.objectType > 0
  ) {

    reasons.push(
      'Object type appears to match'
    );
  }


  const sharedDistinctiveFeatures = (
    properties.details.lost.features || []
  ).filter(feature =>
    (properties.details.found.features || []).includes(feature)
  );
  if (sharedDistinctiveFeatures.length) {
    reasons.push(
      `Shared distinctive features: ${sharedDistinctiveFeatures.join(', ')}`
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
  if (image.identicalMobileNetEmbeddings || image.identicalClipEmbeddings) {
    reasons.push(
      'Warning: identical image-embedding vectors were found for different photo sources; verify image-to-item mapping and cached embeddings'
    );
  }
  if (image.identicalFineVisualSignature) {
    reasons.push(
      'Warning: fine-visual descriptors are nearly identical across different photo sources; verify image extraction and compare original photos'
    );
  }
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



  if (
    image.visualRecognition?.lost?.objectType &&
    image.visualRecognition?.found?.objectType
  ) {

    reasons.push(
      `AI object recognition: ${image.visualRecognition.lost.objectType} vs ${image.visualRecognition.found.objectType}`
    );
  }


  const lostDisplayedSize =
    image.visualRecognition?.lost?.bottleSizeBinary?.label ||
    image.visualRecognition?.lost?.bottle_size_binary?.label ||
    image.visualRecognition?.lost?.sizeClass;

  const foundDisplayedSize =
    image.visualRecognition?.found?.bottleSizeBinary?.label ||
    image.visualRecognition?.found?.bottle_size_binary?.label ||
    image.visualRecognition?.found?.sizeClass;

  if (
    lostDisplayedSize &&
    foundDisplayedSize
  ) {

    reasons.push(
      `AI visual size: ${lostDisplayedSize} vs ${foundDisplayedSize}`
    );
  }


  if (
    image.visualRecognition?.lost?.color &&
    image.visualRecognition?.found?.color
  ) {
    const lostColorLabel = safeString(
      image.visualRecognition.lost.color
    ).trim();
    const foundColorLabel = safeString(
      image.visualRecognition.found.color
    ).trim();
    const canonicalColorLabel = value => {
      const normalized = safeString(value)
        .toLowerCase()
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const match = normalized.match(/\b(black|white|gray|grey|silver|red|blue|green|yellow|orange|brown|pink|purple)\b/i);
      if (match) {
        return match[1].toLowerCase() === "grey"
          ? "gray"
          : match[1].toLowerCase();
      }
      return normalized;
    };

    const lostCanonicalColor = canonicalColorLabel(lostColorLabel);
    const foundCanonicalColor = canonicalColorLabel(foundColorLabel);

    if (lostCanonicalColor === foundCanonicalColor) {
      let colorAgreementExplanation;
      if (multiComponentColorDifference) {
        colorAgreementExplanation =
          `AI visual color estimates agree: ${lostCanonicalColor} (image estimate only; red and white describe different charging-accessory components, so compare the cable and adapter separately)`;
      } else if (primaryColorConflict) {
        colorAgreementExplanation =
          `AI visual color estimates agree: ${lostCanonicalColor} (image estimate only; the explicit reported primary-color conflict remains unresolved)`;
      } else {
        colorAgreementExplanation =
          `AI visual color estimates agree: ${lostCanonicalColor} (image estimate only; not proof of item identity)`;
      }
      reasons.push(colorAgreementExplanation);
    } else if (image.colorConflict) {
      reasons.push(
        `AI visual color conflict: ${lostCanonicalColor} vs ${foundCanonicalColor}`
      );
    } else {
      reasons.push(
        `AI visual color labels differ, but confidence is insufficient to confirm a conflict: ${lostCanonicalColor} vs ${foundCanonicalColor}`
      );
    }
  }


  if (
    image.objectConflict
  ) {

    reasons.push(
      'AI detected a conflicting object type'
    );
  }


  if (
    image.sizeConflict
  ) {

    reasons.push(
      'AI detected a strong visual size difference'
    );
  }


  if (image.foregroundColorConflict && image.foregroundColorEvidence) {
    reasons.push(
      `Foreground object colour conflict: ${image.foregroundColorEvidence.lost.label} vs ${image.foregroundColorEvidence.found.label} (heuristic image estimate; check lighting and background)`
    );
  }

  if (
    image.colorConflict
  ) {

    reasons.push(
      'AI detected a visual color difference; confidence may be limited'
    );
  }


  if (image.scratchScreening?.available) {
    const lostMark = image.scratchScreening.lost?.possible_mark;
    const foundMark = image.scratchScreening.found?.possible_mark;
    if (image.scratchScreening.mismatch) {
      reasons.push(`Scratch-like mark screening differs (lost=${lostMark ?? 'unknown'}, found=${foundMark ?? 'unknown'}); this is a heuristic signal and manual visual review is recommended`);
    } else if (lostMark === true && foundMark === true) {
      reasons.push('Possible scratch-like marks were detected in both images (heuristic only; not proof of item identity)');
    } else if (lostMark === false && foundMark === false) {
      reasons.push('No scratch-like marks were detected in either image by the heuristic screen (not proof of item identity)');
    }
  }

  /*
   * Fine-grained visual evidence.
   */
  if (
    image.fineVisualDetails &&
    image.fineVisualDetails.available
  ) {

    const fine =
      image.fineVisualDetails;

    if (
      fine.percentage != null
    ) {
      reasons.push(
        'Fine visual detail similarity ' +
        fine.percentage +
        '%'
      );
    }

    if (
      fine.shapeSimilarityPercentage != null
    ) {
      reasons.push(
        'AI shape similarity ' +
        fine.shapeSimilarityPercentage +
        '%'
      );
    }

    if (
      fine.colorSimilarityPercentage != null
    ) {
      reasons.push(
        'AI colour structure similarity ' +
        fine.colorSimilarityPercentage +
        '%'
      );
    }

    if (
      fine.regionSimilarityPercentage != null
    ) {
      reasons.push(
        'AI local-region similarity ' +
        fine.regionSimilarityPercentage +
        '%'
      );
    }

    if (
      fine.foregroundSimilarityPercentage != null
    ) {
      reasons.push(
        'AI foreground geometry similarity ' +
        fine.foregroundSimilarityPercentage +
        '%'
      );
    }

    if (
      fine.ocrSimilarityPercentage != null
    ) {
      reasons.push(
        'AI visible-text similarity ' +
        fine.ocrSimilarityPercentage +
        '%'
      );
    }

    const mismatches =
      Array.isArray(
        fine.mismatches
      )
        ? fine.mismatches
        : [];

    const seenMismatchMessages = new Set();
    mismatches
      .slice(0, 3)
      .forEach(
        mismatch => {

          const message =
            typeof mismatch === 'string'
              ? mismatch
              : (
                  mismatch?.message ||
                  mismatch?.description ||
                  mismatch?.reason ||
                  mismatch?.detail ||
                  ''
                );

          if (
            String(message).trim()
          ) {

            const normalizedMessage = String(message).trim().toLowerCase();
            if (seenMismatchMessages.has(normalizedMessage)) return;
            seenMismatchMessages.add(normalizedMessage);
            reasons.push(
              'AI local visual difference: ' +
              String(message)
            );
          }
        }
      );
  }


  /*
   * Human-readable property breakdown.
   */
  const propertyBreakdown = {

    color:
      Math.round(
        (anyColorConflict
          ? 0
          : uncertainVisualColorDifference
            ? Math.min(properties.details.color, 0.5)
            : properties.details.color) * 100
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

    scoreAudit: {
      baseComponentTotal,
      sharedTextBoost,
      locationContextBoost,
      visualContradictionPenalty: finalVisualContradictionPenalty,
      primaryColorConflict,
      reportedPrimaryColorConflict,
      multiComponentColorDifference,
      visualColorAgreementOverridesReportConflict,
      internalTextSimilarityPercentage,
      visualSimilarityForScore,
      visualEvidenceFactor,
      scoreBeforeRecommendedCap,
      recommendedScoreCap,
      recommendedScoreCapReasons: [...new Set(recommendedScoreCapReasons)],
      reviewRecommended,
      finalScore: score
    },

    confidence,

    reasons,
    primaryColorConflict,
    reportedPrimaryColorConflict,
    multiComponentColorDifference,
    visualColorAgreementOverridesReportConflict,
    primaryColorLost: lostPrimaryColor,
    primaryColorFound: foundPrimaryColor,
    reviewRecommended,
    reviewReasons,
    recommendedScoreCap,
    visualColorConflict: image.colorConflict,
    visualColorLabelsDiffer,
    uncertainVisualColorDifference,
    scratchScreening: image.scratchScreening,


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
        effectivePropertiesScore * 100
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
     * Fine Visual AI.
     */
    fineVisualSimilarityPercentage:
      image.fineVisualPercentage,

    fineVisualDetails:
      image.fineVisualDetails,


    /*
     * Final hybrid visual score.
     */
    visualSimilarityPercentage:
      image.percentage,

    rawVisualSimilarityPercentage:
      image.rawPercentage ?? image.percentage,

    visualContradictionCapApplied:
      Boolean(image.contradictionCapApplied),

    visualModel:
      image.model,


    /*
     * Visual model weights.
     */
    visualWeights: {

      mobileNetV2:
        image.mobileNetWeight,

      clip:
        image.clipWeight,

      fineVisual:
        image.fineVisualWeight
    },


    /*
     * Visual recognition.
     */
    visualRecognition:
      image.visualRecognition,

    visualObjectConflict:
      image.objectConflict,

    visualSizeConflict:
      image.sizeConflict,

    visualColorConflict:
      image.colorConflict,

    visualForegroundColorEvidence:
      image.foregroundColorEvidence,

    visualForegroundColorConflict:
      Boolean(image.foregroundColorConflict),

    visualContradiction:
      image.visualContradiction,

    visualContradictionPenalty:
      finalVisualContradictionPenalty,

    visualDiagnostics: {
      distinctImageSources: image.distinctImageSources,
      identicalMobileNetEmbeddings: image.identicalMobileNetEmbeddings,
      identicalClipEmbeddings: image.identicalClipEmbeddings,
      identicalFineVisualSignature: image.identicalFineVisualSignature
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

      mobileNetV2:
        image.mobileNetPercentage === null
          ? 0
          : Math.round(
              (
                image.mobileNetPercentage /
                100
              ) *
              W.cnnImage *
              image.mobileNetWeight
            * 10
            ) / 10,

      clip:
        image.clipPercentage === null
          ? 0
          : Math.round(
              (
                image.clipPercentage /
                100
              ) *
              W.cnnImage *
              image.clipWeight
            * 10
            ) / 10,

      fineVisual:
        image.fineVisualPercentage === null
          ? 0
          : Math.round(
              (
                image.fineVisualPercentage /
                100
              ) *
              W.cnnImage *
              image.fineVisualWeight
            * 10
            ) / 10,

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
  // Exported for focused regression tests of embedding provenance and null safety.
  cnnScore,
  normalizeBrand: normalizeBrandName,
  extractProperties,
  W
};
