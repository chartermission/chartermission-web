/*
 * Country and chapter names arrive from the API in English ("Nigeria", "Nigeria Chapter",
 * "Australia Diaspora Chapter"). The JSX runtime recognises them like interface sentences and
 * prints them in the page language, using the browser's own country names.
 * The list mirrors the countries table (apps/api/src/db/seed-data.ts).
 */

const COUNTRY_CODES = new Map<string, string>([
  ["Algeria", "DZ"],
  ["Angola", "AO"],
  ["Benin", "BJ"],
  ["Botswana", "BW"],
  ["Burkina Faso", "BF"],
  ["Burundi", "BI"],
  ["Cabo Verde", "CV"],
  ["Cameroon", "CM"],
  ["Central African Republic", "CF"],
  ["Chad", "TD"],
  ["Comoros", "KM"],
  ["Congo", "CG"],
  ["Côte d'Ivoire", "CI"],
  ["DR Congo", "CD"],
  ["Djibouti", "DJ"],
  ["Egypt", "EG"],
  ["Equatorial Guinea", "GQ"],
  ["Eritrea", "ER"],
  ["Eswatini", "SZ"],
  ["Ethiopia", "ET"],
  ["Gabon", "GA"],
  ["Gambia", "GM"],
  ["Ghana", "GH"],
  ["Guinea", "GN"],
  ["Guinea-Bissau", "GW"],
  ["Kenya", "KE"],
  ["Lesotho", "LS"],
  ["Liberia", "LR"],
  ["Libya", "LY"],
  ["Madagascar", "MG"],
  ["Malawi", "MW"],
  ["Mali", "ML"],
  ["Mauritania", "MR"],
  ["Mauritius", "MU"],
  ["Morocco", "MA"],
  ["Mozambique", "MZ"],
  ["Namibia", "NA"],
  ["Niger", "NE"],
  ["Nigeria", "NG"],
  ["Rwanda", "RW"],
  ["Senegal", "SN"],
  ["Seychelles", "SC"],
  ["Sierra Leone", "SL"],
  ["Somalia", "SO"],
  ["South Africa", "ZA"],
  ["South Sudan", "SS"],
  ["Sudan", "SD"],
  ["São Tomé and Príncipe", "ST"],
  ["Tanzania", "TZ"],
  ["Togo", "TG"],
  ["Tunisia", "TN"],
  ["Uganda", "UG"],
  ["Zambia", "ZM"],
  ["Zimbabwe", "ZW"],
  ["Afghanistan", "AF"],
  ["Albania", "AL"],
  ["American Samoa", "AS"],
  ["Andorra", "AD"],
  ["Anguilla", "AI"],
  ["Antarctica", "AQ"],
  ["Antigua and Barbuda", "AG"],
  ["Argentina", "AR"],
  ["Armenia", "AM"],
  ["Aruba", "AW"],
  ["Australia", "AU"],
  ["Austria", "AT"],
  ["Azerbaijan", "AZ"],
  ["Bahamas", "BS"],
  ["Bahrain", "BH"],
  ["Bangladesh", "BD"],
  ["Barbados", "BB"],
  ["Belarus", "BY"],
  ["Belgium", "BE"],
  ["Belize", "BZ"],
  ["Bermuda", "BM"],
  ["Bhutan", "BT"],
  ["Bolivia", "BO"],
  ["Bosnia and Herzegovina", "BA"],
  ["Bouvet Island", "BV"],
  ["Brazil", "BR"],
  ["British Indian Ocean Territory", "IO"],
  ["British Virgin Islands", "VG"],
  ["Brunei", "BN"],
  ["Bulgaria", "BG"],
  ["Cambodia", "KH"],
  ["Canada", "CA"],
  ["Caribbean Netherlands", "BQ"],
  ["Cayman Islands", "KY"],
  ["Chile", "CL"],
  ["China", "CN"],
  ["Christmas Island", "CX"],
  ["Cocos (Keeling) Islands", "CC"],
  ["Colombia", "CO"],
  ["Cook Islands", "CK"],
  ["Costa Rica", "CR"],
  ["Croatia", "HR"],
  ["Cuba", "CU"],
  ["Curaçao", "CW"],
  ["Cyprus", "CY"],
  ["Czechia", "CZ"],
  ["Denmark", "DK"],
  ["Dominica", "DM"],
  ["Dominican Republic", "DO"],
  ["Ecuador", "EC"],
  ["El Salvador", "SV"],
  ["Estonia", "EE"],
  ["Falkland Islands", "FK"],
  ["Faroe Islands", "FO"],
  ["Fiji", "FJ"],
  ["Finland", "FI"],
  ["France", "FR"],
  ["French Guiana", "GF"],
  ["French Polynesia", "PF"],
  ["French Southern Territories", "TF"],
  ["Georgia", "GE"],
  ["Germany", "DE"],
  ["Gibraltar", "GI"],
  ["Greece", "GR"],
  ["Greenland", "GL"],
  ["Grenada", "GD"],
  ["Guadeloupe", "GP"],
  ["Guam", "GU"],
  ["Guatemala", "GT"],
  ["Guernsey", "GG"],
  ["Guyana", "GY"],
  ["Haiti", "HT"],
  ["Heard and McDonald Islands", "HM"],
  ["Honduras", "HN"],
  ["Hong Kong", "HK"],
  ["Hungary", "HU"],
  ["Iceland", "IS"],
  ["India", "IN"],
  ["Indonesia", "ID"],
  ["Iran", "IR"],
  ["Iraq", "IQ"],
  ["Ireland", "IE"],
  ["Isle of Man", "IM"],
  ["Israel", "IL"],
  ["Italy", "IT"],
  ["Jamaica", "JM"],
  ["Japan", "JP"],
  ["Jersey", "JE"],
  ["Jordan", "JO"],
  ["Kazakhstan", "KZ"],
  ["Kiribati", "KI"],
  ["Kuwait", "KW"],
  ["Kyrgyzstan", "KG"],
  ["Laos", "LA"],
  ["Latvia", "LV"],
  ["Lebanon", "LB"],
  ["Liechtenstein", "LI"],
  ["Lithuania", "LT"],
  ["Luxembourg", "LU"],
  ["Macao", "MO"],
  ["Malaysia", "MY"],
  ["Maldives", "MV"],
  ["Malta", "MT"],
  ["Marshall Islands", "MH"],
  ["Martinique", "MQ"],
  ["Mayotte", "YT"],
  ["Mexico", "MX"],
  ["Micronesia", "FM"],
  ["Moldova", "MD"],
  ["Monaco", "MC"],
  ["Mongolia", "MN"],
  ["Montenegro", "ME"],
  ["Montserrat", "MS"],
  ["Myanmar", "MM"],
  ["Nauru", "NR"],
  ["Nepal", "NP"],
  ["Netherlands", "NL"],
  ["New Caledonia", "NC"],
  ["New Zealand", "NZ"],
  ["Nicaragua", "NI"],
  ["Niue", "NU"],
  ["Norfolk Island", "NF"],
  ["North Korea", "KP"],
  ["North Macedonia", "MK"],
  ["Northern Mariana Islands", "MP"],
  ["Norway", "NO"],
  ["Oman", "OM"],
  ["Pakistan", "PK"],
  ["Palau", "PW"],
  ["Palestine", "PS"],
  ["Panama", "PA"],
  ["Papua New Guinea", "PG"],
  ["Paraguay", "PY"],
  ["Peru", "PE"],
  ["Philippines", "PH"],
  ["Pitcairn", "PN"],
  ["Poland", "PL"],
  ["Portugal", "PT"],
  ["Puerto Rico", "PR"],
  ["Qatar", "QA"],
  ["Romania", "RO"],
  ["Russia", "RU"],
  ["Réunion", "RE"],
  ["Saint Barthélemy", "BL"],
  ["Saint Helena", "SH"],
  ["Saint Kitts and Nevis", "KN"],
  ["Saint Lucia", "LC"],
  ["Saint Martin", "MF"],
  ["Saint Pierre and Miquelon", "PM"],
  ["Saint Vincent and the Grenadines", "VC"],
  ["Samoa", "WS"],
  ["San Marino", "SM"],
  ["Saudi Arabia", "SA"],
  ["Serbia", "RS"],
  ["Singapore", "SG"],
  ["Sint Maarten", "SX"],
  ["Slovakia", "SK"],
  ["Slovenia", "SI"],
  ["Solomon Islands", "SB"],
  ["South Georgia and the South Sandwich Islands", "GS"],
  ["South Korea", "KR"],
  ["Spain", "ES"],
  ["Sri Lanka", "LK"],
  ["Suriname", "SR"],
  ["Svalbard and Jan Mayen", "SJ"],
  ["Sweden", "SE"],
  ["Switzerland", "CH"],
  ["Syria", "SY"],
  ["Taiwan", "TW"],
  ["Tajikistan", "TJ"],
  ["Thailand", "TH"],
  ["Timor-Leste", "TL"],
  ["Tokelau", "TK"],
  ["Tonga", "TO"],
  ["Trinidad and Tobago", "TT"],
  ["Turkmenistan", "TM"],
  ["Turks and Caicos Islands", "TC"],
  ["Tuvalu", "TV"],
  ["Türkiye", "TR"],
  ["U.S. Outlying Islands", "UM"],
  ["U.S. Virgin Islands", "VI"],
  ["Ukraine", "UA"],
  ["United Arab Emirates", "AE"],
  ["United Kingdom", "GB"],
  ["United States", "US"],
  ["Uruguay", "UY"],
  ["Uzbekistan", "UZ"],
  ["Vanuatu", "VU"],
  ["Vatican City", "VA"],
  ["Venezuela", "VE"],
  ["Vietnam", "VN"],
  ["Wallis and Futuna", "WF"],
  ["Western Sahara", "EH"],
  ["Yemen", "YE"],
  ["Åland Islands", "AX"],
]);

// Short names some chapters use.
COUNTRY_CODES.set("UK", "GB");
COUNTRY_CODES.set("USA", "US");
COUNTRY_CODES.set("UAE", "AE");

const CHAPTER = /^(.+?) (Diaspora )?Chapter$/;

/** Whether a piece of text is a country or chapter name the runtime can translate. */
export function isPlaceName(text: string): boolean {
  if (COUNTRY_CODES.has(text)) return true;
  const match = CHAPTER.exec(text);
  return Boolean(match && COUNTRY_CODES.has(match[1]));
}

/**
 * Names Node and browsers disagree on (their ICU data differ), fixed so the server-rendered page
 * and the browser print the same text.
 */
const FIXED: Record<string, Record<string, string>> = {
  fr: { FK: "Îles Malouines", HK: "Hong Kong", MO: "Macao", PS: "Palestine" },
  ar: { FK: "جزر فوكلاند", HK: "هونغ كونغ", MO: "ماكاو", PS: "فلسطين" },
};

const names = new Map<string, Intl.DisplayNames | null>();
function regionName(intlTag: string, code: string): string | undefined {
  const fixed = FIXED[intlTag.slice(0, 2)]?.[code];
  if (fixed) return fixed;
  if (!names.has(intlTag)) {
    try {
      names.set(intlTag, new Intl.DisplayNames([intlTag], { type: "region" }));
    } catch {
      names.set(intlTag, null);
    }
  }
  try {
    return names.get(intlTag)?.of(code) ?? undefined;
  } catch {
    return undefined;
  }
}

/** The name in the page language, or undefined when the text is not a known place. */
export function translatePlace(text: string, intlTag: string, t: (key: string, vars?: Record<string, string>) => string): string | undefined {
  const code = COUNTRY_CODES.get(text);
  if (code) return regionName(intlTag, code) ?? text;
  const match = CHAPTER.exec(text);
  const chapterCode = match && COUNTRY_CODES.get(match[1]);
  if (!match || !chapterCode) return undefined;
  const country = regionName(intlTag, chapterCode) ?? match[1];
  return match[2] ? t("{country} Diaspora Chapter", { country }) : t("{country} Chapter", { country });
}

/** A country's name from its code, in the page language. */
export function countryNameOf(code: string | null | undefined, intlTag: string): string | null {
  if (!code) return null;
  return regionName(intlTag, code.toUpperCase()) ?? code;
}

/**
 * Phrases the API composes in English around a name ("Trending in Nigeria", "Also works in
 * Health"). Each prefix maps to the dictionary sentence that carries the name.
 */
const PHRASES: [prefix: string, sentence: string][] = [
  ["Trending in ", "Trending in {place}"],
  ["Also works in ", "Also works in {name}"],
  ["Also skilled in ", "Also skilled in {name}"],
  ["Also interested in ", "Also interested in {name}"],
  ["Also follows ", "Also follows {name}"],
  ["Also in ", "Also in {name}"],
];

/** Whether the text is one of those phrases. */
export function isPhrase(text: string): boolean {
  return PHRASES.some(([prefix]) => text.startsWith(prefix) && text.length > prefix.length);
}

/** The phrase in the page language, or undefined when the text is not one of them. */
export function translatePhrase(text: string, intlTag: string, t: (key: string, vars?: Record<string, string>) => string): string | undefined {
  const match = PHRASES.find(([prefix]) => text.startsWith(prefix) && text.length > prefix.length);
  if (!match) return undefined;
  const [prefix, sentence] = match;
  const rest = text.slice(prefix.length);
  const name = translatePlace(rest, intlTag, t) ?? t(rest);
  return t(sentence, sentence.includes("{place}") ? { place: name } : { name });
}

/** A sentence variable shown in the page language when it is a country or chapter name. */
export function placeVar(value: string, intlTag: string, t: (key: string, vars?: Record<string, string>) => string): string {
  return isPlaceName(value) ? (translatePlace(value, intlTag, t) ?? value) : value;
}
