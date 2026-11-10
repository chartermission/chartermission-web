/** Reference data for the seed (taxonomies, chapters, demo members). */

export const COUNTRIES: [string, string, string][] = [
  // Every ISO 3166-1 country. African countries carry their region; the rest are "Diaspora"
  // (shown as "Rest of the world" in country selects).
  ['DZ', 'Algeria', 'North Africa'], ['AO', 'Angola', 'Southern Africa'], ['BJ', 'Benin', 'West Africa'],
  ['BW', 'Botswana', 'Southern Africa'], ['BF', 'Burkina Faso', 'West Africa'], ['BI', 'Burundi', 'East Africa'],
  ['CV', 'Cabo Verde', 'West Africa'], ['CM', 'Cameroon', 'Central Africa'], ['CF', 'Central African Republic', 'Central Africa'],
  ['TD', 'Chad', 'Central Africa'], ['KM', 'Comoros', 'East Africa'], ['CG', 'Congo', 'Central Africa'],
  ['CI', "Côte d'Ivoire", 'West Africa'], ['CD', 'DR Congo', 'Central Africa'], ['DJ', 'Djibouti', 'East Africa'],
  ['EG', 'Egypt', 'North Africa'], ['GQ', 'Equatorial Guinea', 'Central Africa'], ['ER', 'Eritrea', 'East Africa'],
  ['SZ', 'Eswatini', 'Southern Africa'], ['ET', 'Ethiopia', 'East Africa'], ['GA', 'Gabon', 'Central Africa'],
  ['GM', 'Gambia', 'West Africa'], ['GH', 'Ghana', 'West Africa'], ['GN', 'Guinea', 'West Africa'],
  ['GW', 'Guinea-Bissau', 'West Africa'], ['KE', 'Kenya', 'East Africa'], ['LS', 'Lesotho', 'Southern Africa'],
  ['LR', 'Liberia', 'West Africa'], ['LY', 'Libya', 'North Africa'], ['MG', 'Madagascar', 'East Africa'],
  ['MW', 'Malawi', 'Southern Africa'], ['ML', 'Mali', 'West Africa'], ['MR', 'Mauritania', 'West Africa'],
  ['MU', 'Mauritius', 'East Africa'], ['MA', 'Morocco', 'North Africa'], ['MZ', 'Mozambique', 'Southern Africa'],
  ['NA', 'Namibia', 'Southern Africa'], ['NE', 'Niger', 'West Africa'], ['NG', 'Nigeria', 'West Africa'],
  ['RW', 'Rwanda', 'East Africa'], ['SN', 'Senegal', 'West Africa'], ['SC', 'Seychelles', 'East Africa'],
  ['SL', 'Sierra Leone', 'West Africa'], ['SO', 'Somalia', 'East Africa'], ['ZA', 'South Africa', 'Southern Africa'],
  ['SS', 'South Sudan', 'East Africa'], ['SD', 'Sudan', 'North Africa'], ['ST', 'São Tomé and Príncipe', 'Central Africa'],
  ['TZ', 'Tanzania', 'East Africa'], ['TG', 'Togo', 'West Africa'], ['TN', 'Tunisia', 'North Africa'],
  ['UG', 'Uganda', 'East Africa'], ['ZM', 'Zambia', 'Southern Africa'], ['ZW', 'Zimbabwe', 'Southern Africa'],
  ['AF', 'Afghanistan', 'Diaspora'], ['AL', 'Albania', 'Diaspora'], ['AS', 'American Samoa', 'Diaspora'],
  ['AD', 'Andorra', 'Diaspora'], ['AI', 'Anguilla', 'Diaspora'], ['AQ', 'Antarctica', 'Diaspora'],
  ['AG', 'Antigua and Barbuda', 'Diaspora'], ['AR', 'Argentina', 'Diaspora'], ['AM', 'Armenia', 'Diaspora'],
  ['AW', 'Aruba', 'Diaspora'], ['AU', 'Australia', 'Diaspora'], ['AT', 'Austria', 'Diaspora'],
  ['AZ', 'Azerbaijan', 'Diaspora'], ['BS', 'Bahamas', 'Diaspora'], ['BH', 'Bahrain', 'Diaspora'],
  ['BD', 'Bangladesh', 'Diaspora'], ['BB', 'Barbados', 'Diaspora'], ['BY', 'Belarus', 'Diaspora'],
  ['BE', 'Belgium', 'Diaspora'], ['BZ', 'Belize', 'Diaspora'], ['BM', 'Bermuda', 'Diaspora'],
  ['BT', 'Bhutan', 'Diaspora'], ['BO', 'Bolivia', 'Diaspora'], ['BA', 'Bosnia and Herzegovina', 'Diaspora'],
  ['BV', 'Bouvet Island', 'Diaspora'], ['BR', 'Brazil', 'Diaspora'], ['IO', 'British Indian Ocean Territory', 'Diaspora'],
  ['VG', 'British Virgin Islands', 'Diaspora'], ['BN', 'Brunei', 'Diaspora'], ['BG', 'Bulgaria', 'Diaspora'],
  ['KH', 'Cambodia', 'Diaspora'], ['CA', 'Canada', 'Diaspora'], ['BQ', 'Caribbean Netherlands', 'Diaspora'],
  ['KY', 'Cayman Islands', 'Diaspora'], ['CL', 'Chile', 'Diaspora'], ['CN', 'China', 'Diaspora'],
  ['CX', 'Christmas Island', 'Diaspora'], ['CC', 'Cocos (Keeling) Islands', 'Diaspora'], ['CO', 'Colombia', 'Diaspora'],
  ['CK', 'Cook Islands', 'Diaspora'], ['CR', 'Costa Rica', 'Diaspora'], ['HR', 'Croatia', 'Diaspora'],
  ['CU', 'Cuba', 'Diaspora'], ['CW', 'Curaçao', 'Diaspora'], ['CY', 'Cyprus', 'Diaspora'],
  ['CZ', 'Czechia', 'Diaspora'], ['DK', 'Denmark', 'Diaspora'], ['DM', 'Dominica', 'Diaspora'],
  ['DO', 'Dominican Republic', 'Diaspora'], ['EC', 'Ecuador', 'Diaspora'], ['SV', 'El Salvador', 'Diaspora'],
  ['EE', 'Estonia', 'Diaspora'], ['FK', 'Falkland Islands', 'Diaspora'], ['FO', 'Faroe Islands', 'Diaspora'],
  ['FJ', 'Fiji', 'Diaspora'], ['FI', 'Finland', 'Diaspora'], ['FR', 'France', 'Diaspora'],
  ['GF', 'French Guiana', 'Diaspora'], ['PF', 'French Polynesia', 'Diaspora'], ['TF', 'French Southern Territories', 'Diaspora'],
  ['GE', 'Georgia', 'Diaspora'], ['DE', 'Germany', 'Diaspora'], ['GI', 'Gibraltar', 'Diaspora'],
  ['GR', 'Greece', 'Diaspora'], ['GL', 'Greenland', 'Diaspora'], ['GD', 'Grenada', 'Diaspora'],
  ['GP', 'Guadeloupe', 'Diaspora'], ['GU', 'Guam', 'Diaspora'], ['GT', 'Guatemala', 'Diaspora'],
  ['GG', 'Guernsey', 'Diaspora'], ['GY', 'Guyana', 'Diaspora'], ['HT', 'Haiti', 'Diaspora'],
  ['HM', 'Heard and McDonald Islands', 'Diaspora'], ['HN', 'Honduras', 'Diaspora'], ['HK', 'Hong Kong', 'Diaspora'],
  ['HU', 'Hungary', 'Diaspora'], ['IS', 'Iceland', 'Diaspora'], ['IN', 'India', 'Diaspora'],
  ['ID', 'Indonesia', 'Diaspora'], ['IR', 'Iran', 'Diaspora'], ['IQ', 'Iraq', 'Diaspora'],
  ['IE', 'Ireland', 'Diaspora'], ['IM', 'Isle of Man', 'Diaspora'], ['IL', 'Israel', 'Diaspora'],
  ['IT', 'Italy', 'Diaspora'], ['JM', 'Jamaica', 'Diaspora'], ['JP', 'Japan', 'Diaspora'],
  ['JE', 'Jersey', 'Diaspora'], ['JO', 'Jordan', 'Diaspora'], ['KZ', 'Kazakhstan', 'Diaspora'],
  ['KI', 'Kiribati', 'Diaspora'], ['KW', 'Kuwait', 'Diaspora'], ['KG', 'Kyrgyzstan', 'Diaspora'],
  ['LA', 'Laos', 'Diaspora'], ['LV', 'Latvia', 'Diaspora'], ['LB', 'Lebanon', 'Diaspora'],
  ['LI', 'Liechtenstein', 'Diaspora'], ['LT', 'Lithuania', 'Diaspora'], ['LU', 'Luxembourg', 'Diaspora'],
  ['MO', 'Macao', 'Diaspora'], ['MY', 'Malaysia', 'Diaspora'], ['MV', 'Maldives', 'Diaspora'],
  ['MT', 'Malta', 'Diaspora'], ['MH', 'Marshall Islands', 'Diaspora'], ['MQ', 'Martinique', 'Diaspora'],
  ['YT', 'Mayotte', 'East Africa'], ['MX', 'Mexico', 'Diaspora'], ['FM', 'Micronesia', 'Diaspora'],
  ['MD', 'Moldova', 'Diaspora'], ['MC', 'Monaco', 'Diaspora'], ['MN', 'Mongolia', 'Diaspora'],
  ['ME', 'Montenegro', 'Diaspora'], ['MS', 'Montserrat', 'Diaspora'], ['MM', 'Myanmar', 'Diaspora'],
  ['NR', 'Nauru', 'Diaspora'], ['NP', 'Nepal', 'Diaspora'], ['NL', 'Netherlands', 'Diaspora'],
  ['NC', 'New Caledonia', 'Diaspora'], ['NZ', 'New Zealand', 'Diaspora'], ['NI', 'Nicaragua', 'Diaspora'],
  ['NU', 'Niue', 'Diaspora'], ['NF', 'Norfolk Island', 'Diaspora'], ['KP', 'North Korea', 'Diaspora'],
  ['MK', 'North Macedonia', 'Diaspora'], ['MP', 'Northern Mariana Islands', 'Diaspora'], ['NO', 'Norway', 'Diaspora'],
  ['OM', 'Oman', 'Diaspora'], ['PK', 'Pakistan', 'Diaspora'], ['PW', 'Palau', 'Diaspora'],
  ['PS', 'Palestine', 'Diaspora'], ['PA', 'Panama', 'Diaspora'], ['PG', 'Papua New Guinea', 'Diaspora'],
  ['PY', 'Paraguay', 'Diaspora'], ['PE', 'Peru', 'Diaspora'], ['PH', 'Philippines', 'Diaspora'],
  ['PN', 'Pitcairn', 'Diaspora'], ['PL', 'Poland', 'Diaspora'], ['PT', 'Portugal', 'Diaspora'],
  ['PR', 'Puerto Rico', 'Diaspora'], ['QA', 'Qatar', 'Diaspora'], ['RO', 'Romania', 'Diaspora'],
  ['RU', 'Russia', 'Diaspora'], ['RE', 'Réunion', 'East Africa'], ['BL', 'Saint Barthélemy', 'Diaspora'],
  ['SH', 'Saint Helena', 'Diaspora'], ['KN', 'Saint Kitts and Nevis', 'Diaspora'], ['LC', 'Saint Lucia', 'Diaspora'],
  ['MF', 'Saint Martin', 'Diaspora'], ['PM', 'Saint Pierre and Miquelon', 'Diaspora'], ['VC', 'Saint Vincent and the Grenadines', 'Diaspora'],
  ['WS', 'Samoa', 'Diaspora'], ['SM', 'San Marino', 'Diaspora'], ['SA', 'Saudi Arabia', 'Diaspora'],
  ['RS', 'Serbia', 'Diaspora'], ['SG', 'Singapore', 'Diaspora'], ['SX', 'Sint Maarten', 'Diaspora'],
  ['SK', 'Slovakia', 'Diaspora'], ['SI', 'Slovenia', 'Diaspora'], ['SB', 'Solomon Islands', 'Diaspora'],
  ['GS', 'South Georgia and the South Sandwich Islands', 'Diaspora'], ['KR', 'South Korea', 'Diaspora'], ['ES', 'Spain', 'Diaspora'],
  ['LK', 'Sri Lanka', 'Diaspora'], ['SR', 'Suriname', 'Diaspora'], ['SJ', 'Svalbard and Jan Mayen', 'Diaspora'],
  ['SE', 'Sweden', 'Diaspora'], ['CH', 'Switzerland', 'Diaspora'], ['SY', 'Syria', 'Diaspora'],
  ['TW', 'Taiwan', 'Diaspora'], ['TJ', 'Tajikistan', 'Diaspora'], ['TH', 'Thailand', 'Diaspora'],
  ['TL', 'Timor-Leste', 'Diaspora'], ['TK', 'Tokelau', 'Diaspora'], ['TO', 'Tonga', 'Diaspora'],
  ['TT', 'Trinidad and Tobago', 'Diaspora'], ['TM', 'Turkmenistan', 'Diaspora'], ['TC', 'Turks and Caicos Islands', 'Diaspora'],
  ['TV', 'Tuvalu', 'Diaspora'], ['TR', 'Türkiye', 'Diaspora'], ['UM', 'U.S. Outlying Islands', 'Diaspora'],
  ['VI', 'U.S. Virgin Islands', 'Diaspora'], ['UA', 'Ukraine', 'Diaspora'], ['AE', 'United Arab Emirates', 'Diaspora'],
  ['GB', 'United Kingdom', 'Diaspora'], ['US', 'United States', 'Diaspora'], ['UY', 'Uruguay', 'Diaspora'],
  ['UZ', 'Uzbekistan', 'Diaspora'], ['VU', 'Vanuatu', 'Diaspora'], ['VA', 'Vatican City', 'Diaspora'],
  ['VE', 'Venezuela', 'Diaspora'], ['VN', 'Vietnam', 'Diaspora'], ['WF', 'Wallis and Futuna', 'Diaspora'],
  ['EH', 'Western Sahara', 'North Africa'], ['YE', 'Yemen', 'Diaspora'], ['AX', 'Åland Islands', 'Diaspora'],
];

export const SECTORS = [
  'Agriculture & food', 'Climate & energy', 'Education', 'Finance & fintech', 'Health', 'Technology',
  'Trade & logistics', 'Creative industries', 'Public policy', 'Infrastructure', 'Manufacturing', 'Social impact',
];
export const SKILLS = [
  'Product management', 'Software engineering', 'Data analysis', 'Design', 'Marketing', 'Sales',
  'Fundraising', 'Policy research', 'Project management', 'Supply chain', 'Solar', 'Grid finance',
  'Partnerships', 'M&E', 'Public speaking', 'Mentoring', 'Legal', 'Accounting',
];
export const INTERESTS = [
  'AfCFTA and trade', 'Diaspora investment', 'Clean cooking', 'Youth employment', 'Women in leadership',
  'AgriTech', 'Fintech', 'African tech', 'Climate action', 'Health tech', 'Education access', 'Creative economy',
];
export const LANGUAGES = ['English', 'French', 'Arabic', 'Portuguese', 'Swahili', 'Hausa', 'Yoruba', 'Igbo', 'Amharic', 'Zulu', 'Wolof', 'Twi'];

/** Event categories (reference data, GET /events/categories), in display order. */
export const EVENT_CATEGORIES = ['Conference', 'Workshop', 'Webinar', 'Meet-up', 'Networking', 'Hackathon', 'Panel', 'Training'];

/** Course topics as [slug, name]; slugs match the Learning page filter values. */
export const COURSE_TOPICS: [string, string][] = [
  ['business', 'Business & trade'], ['tech', 'Tech & data'], ['leadership', 'Leadership'], ['climate', 'Climate'],
  ['finance', 'Finance'], ['policy', 'Policy'], ['health', 'Health'], ['agriculture', 'Agriculture'],
];

/** What the module seeders (seed-events, seed-learning) get: demo member ids by key and chapter ids by slug. */
export type SeedContext = { ids: Record<string, string>; chapters: Record<string, string> };

export const CHAPTERS: [string, string, string][] = [
  // One chapter per African country and per diaspora host country (decided Nov 2026: no city chapters).
  // Seeded once per CHAPTERS_SEED_VERSION, so chapters an admin removes stay removed.
  ['algeria', 'Algeria Chapter', 'DZ'], ['angola', 'Angola Chapter', 'AO'], ['benin', 'Benin Chapter', 'BJ'],
  ['botswana', 'Botswana Chapter', 'BW'], ['burkina-faso', 'Burkina Faso Chapter', 'BF'], ['burundi', 'Burundi Chapter', 'BI'],
  ['cabo-verde', 'Cabo Verde Chapter', 'CV'], ['cameroon', 'Cameroon Chapter', 'CM'], ['central-african-republic', 'Central African Republic Chapter', 'CF'],
  ['chad', 'Chad Chapter', 'TD'], ['comoros', 'Comoros Chapter', 'KM'], ['congo', 'Congo Chapter', 'CG'],
  ['cote-divoire', "Côte d'Ivoire Chapter", 'CI'], ['dr-congo', 'DR Congo Chapter', 'CD'], ['djibouti', 'Djibouti Chapter', 'DJ'],
  ['egypt', 'Egypt Chapter', 'EG'], ['equatorial-guinea', 'Equatorial Guinea Chapter', 'GQ'], ['eritrea', 'Eritrea Chapter', 'ER'],
  ['eswatini', 'Eswatini Chapter', 'SZ'], ['ethiopia', 'Ethiopia Chapter', 'ET'], ['gabon', 'Gabon Chapter', 'GA'],
  ['gambia', 'Gambia Chapter', 'GM'], ['ghana', 'Ghana Chapter', 'GH'], ['guinea', 'Guinea Chapter', 'GN'],
  ['guinea-bissau', 'Guinea-Bissau Chapter', 'GW'], ['kenya', 'Kenya Chapter', 'KE'], ['lesotho', 'Lesotho Chapter', 'LS'],
  ['liberia', 'Liberia Chapter', 'LR'], ['libya', 'Libya Chapter', 'LY'], ['madagascar', 'Madagascar Chapter', 'MG'],
  ['malawi', 'Malawi Chapter', 'MW'], ['mali', 'Mali Chapter', 'ML'], ['mauritania', 'Mauritania Chapter', 'MR'],
  ['mauritius', 'Mauritius Chapter', 'MU'], ['morocco', 'Morocco Chapter', 'MA'], ['mozambique', 'Mozambique Chapter', 'MZ'],
  ['namibia', 'Namibia Chapter', 'NA'], ['niger', 'Niger Chapter', 'NE'], ['nigeria', 'Nigeria Chapter', 'NG'],
  ['rwanda', 'Rwanda Chapter', 'RW'], ['senegal', 'Senegal Chapter', 'SN'], ['seychelles', 'Seychelles Chapter', 'SC'],
  ['sierra-leone', 'Sierra Leone Chapter', 'SL'], ['somalia', 'Somalia Chapter', 'SO'], ['south-africa', 'South Africa Chapter', 'ZA'],
  ['south-sudan', 'South Sudan Chapter', 'SS'], ['sudan', 'Sudan Chapter', 'SD'], ['sao-tome-and-principe', 'São Tomé and Príncipe Chapter', 'ST'],
  ['tanzania', 'Tanzania Chapter', 'TZ'], ['togo', 'Togo Chapter', 'TG'], ['tunisia', 'Tunisia Chapter', 'TN'],
  ['uganda', 'Uganda Chapter', 'UG'], ['zambia', 'Zambia Chapter', 'ZM'], ['zimbabwe', 'Zimbabwe Chapter', 'ZW'],
  ['united-kingdom', 'UK Diaspora Chapter', 'GB'], ['united-states', 'USA Diaspora Chapter', 'US'], ['canada', 'Canada Diaspora Chapter', 'CA'],
  ['france', 'France Diaspora Chapter', 'FR'], ['germany', 'Germany Diaspora Chapter', 'DE'], ['netherlands', 'Netherlands Diaspora Chapter', 'NL'],
  ['belgium', 'Belgium Diaspora Chapter', 'BE'], ['italy', 'Italy Diaspora Chapter', 'IT'], ['portugal', 'Portugal Diaspora Chapter', 'PT'],
  ['spain', 'Spain Diaspora Chapter', 'ES'], ['ireland', 'Ireland Diaspora Chapter', 'IE'], ['sweden', 'Sweden Diaspora Chapter', 'SE'],
  ['uae', 'UAE Diaspora Chapter', 'AE'], ['saudi-arabia', 'Saudi Arabia Diaspora Chapter', 'SA'], ['qatar', 'Qatar Diaspora Chapter', 'QA'],
  ['brazil', 'Brazil Diaspora Chapter', 'BR'], ['jamaica', 'Jamaica Diaspora Chapter', 'JM'], ['china', 'China Diaspora Chapter', 'CN'],
  ['australia', 'Australia Diaspora Chapter', 'AU'],
];

/**
 * Catalogues an admin can edit are seeded once per version (versions kept in platform_settings
 * "reference_seeds"), so an item an admin removes isn't re-created on the next start. Bump a
 * version to seed newly added items; existing rows are never overwritten.
 */
export const REFERENCE_SEED_VERSIONS = { chapters: 3, hashtags: 2, badges: 1 } as const;

/**
 * What each chapters version added, so a later version never redoes an earlier step on a database
 * that already has it (a chapter an admin removed must stay removed):
 *   2 = the list of chapters; 3 = each chapter's hashtag and About text.
 */
export const CHAPTERS_LIST_VERSION = 2;
export const CHAPTERS_PROFILE_VERSION = 3;

/** Curated topics: featured in onboarding and on the Topics page until real trends take over. */
export const FEATURED_HASHTAGS: [string, string][] = [
  ['AfCFTA', 'The African Continental Free Trade Area: trade, tariffs and cross-border business.'],
  ['AfricaRising', 'Growth stories, milestones and the people building Africa’s future.'],
  ['Diaspora', 'Africans abroad: investment, return, remittances and connecting home.'],
  ['StartupAfrica', 'Founders, funding rounds and lessons from African startups.'],
  ['Entrepreneurship', 'Starting, running and growing a business.'],
  ['FinTech', 'Payments, mobile money, banking and financial inclusion.'],
  ['AgriTech', 'Farming, food systems and technology for agriculture.'],
  ['HealthTech', 'Healthcare delivery, health systems and medical innovation.'],
  ['EdTech', 'Learning, skills and education technology.'],
  ['ClimateAction', 'Climate adaptation, resilience and the green transition.'],
  ['RenewableEnergy', 'Solar, wind, mini-grids and energy access.'],
  ['AI', 'Artificial intelligence and data: tools, policy and opportunities.'],
  ['DigitalTransformation', 'Digital public infrastructure and modernising organisations.'],
  ['WomenInTech', 'Women building and leading in technology.'],
  ['WomenInBusiness', 'Women founders, executives and investors.'],
  ['YouthLeadership', 'Young leaders, civic action and the next generation.'],
  ['Mentorship', 'Finding mentors, giving back and career guidance.'],
  ['CareerGrowth', 'Jobs, promotions, skills and career moves.'],
  ['Jobs', 'Openings and hiring across the network.'],
  ['Scholarships', 'Scholarships, fellowships and study opportunities.'],
  ['Investment', 'Capital, investors and deals across the continent.'],
  ['VentureCapital', 'VC funds, term sheets and early-stage investing.'],
  ['Trade', 'Import, export, logistics and market access.'],
  ['Infrastructure', 'Transport, ports, power and the built environment.'],
  ['Governance', 'Public policy, institutions and accountability.'],
  ['PanAfricanism', 'Unity, integration and shared African identity.'],
  ['CreativeEconomy', 'Music, film, fashion, art and the creative industries.'],
  ['Tourism', 'Travel, hospitality and destination Africa.'],
  ['FoodSecurity', 'Food supply, nutrition and resilient food systems.'],
  ['Manufacturing', 'Industry, value addition and made-in-Africa.'],
  ['SocialImpact', 'Non-profits, social enterprise and community projects.'],
  ['AfricaDay', 'Celebrating Africa Day (25 May) and the continent’s history.'],
];

/** Added in hashtags version 2: one topic per African region. */
export const REGION_HASHTAGS: [string, string][] = [
  ['WestAfrica', 'People, trade and ideas across West Africa.'],
  ['EastAfrica', 'People, trade and ideas across East Africa.'],
  ['NorthAfrica', 'People, trade and ideas across North Africa.'],
  ['SouthernAfrica', 'People, trade and ideas across Southern Africa.'],
  ['CentralAfrica', 'People, trade and ideas across Central Africa.'],
];

/** Featured topics by the hashtags version that introduced them. */
export const FEATURED_HASHTAG_SETS: { version: number; tags: [string, string][] }[] = [
  { version: 1, tags: FEATURED_HASHTAGS },
  { version: 2, tags: REGION_HASHTAGS },
];

export type SeedBadge = { slug: string; name: string; description: string; tone: 'primary' | 'accent' | 'warning' | 'info' | 'success'; icon: string };

/** Starter profile badges; admins can edit, disable or remove them and create more. */
export const BADGES: SeedBadge[] = [
  { slug: 'top-voice', name: 'Top Voice', description: 'Recognised for consistently valuable contributions to the community.', tone: 'accent', icon: 'flame' },
  { slug: 'founding-member', name: 'Founding Member', description: 'Joined Charter Mission before its public launch.', tone: 'warning', icon: 'flag' },
  { slug: 'partner', name: 'Partner', description: 'Represents an official Charter Mission partner organisation.', tone: 'primary', icon: 'building' },
  { slug: 'mentor', name: 'Mentor', description: 'Volunteers time to mentor other members.', tone: 'success', icon: 'lightbulb' },
  { slug: 'speaker', name: 'Speaker', description: 'Has spoken at a Charter Mission event.', tone: 'info', icon: 'message' },
  { slug: 'volunteer', name: 'Volunteer', description: 'Helps run chapters, events or programmes.', tone: 'success', icon: 'users' },
  { slug: 'investor', name: 'Investor', description: 'Invests in African businesses and founders.', tone: 'primary', icon: 'chart' },
];

export type SeedMember = {
  key: string;
  name: string;
  handle: string;
  email: string;
  headline: string;
  country: string;
  city: string;
  tone: 'tint' | 'primary' | 'accent' | 'success' | 'warning' | 'info';
  roles?: string[];
  staff?: boolean;
  verified?: boolean;
  bio?: string;
  organisation?: string;
  /** Account age at seed time (the home feed's "new members" use the join date). */
  joinedDaysAgo: number;
  /** Sector names from SECTORS. */
  sectors?: string[];
};

/** Demo accounts for development and staging. All share DEMO_PASSWORD. */
export const DEMO_PASSWORD = 'CharterMission@123';

export const MEMBERS: SeedMember[] = [
  { key: 'owais', name: 'Owais Iqbal', handle: 'owais-iqbal', email: 'owais@example.com', headline: 'Founder · Dubai, UAE', country: 'AE', city: 'Dubai', tone: 'primary', organisation: 'HyseTech Software Design', joinedDaysAgo: 420, sectors: ['Technology'] },
  { key: 'team', name: 'Charter Mission', handle: 'charter-mission', email: 'team@example.com', headline: 'Official platform team', country: 'GB', city: 'London', tone: 'primary', verified: true, joinedDaysAgo: 480 },
  { key: 'aisha', name: 'Aisha Mohammed', handle: 'aisha-mohammed', email: 'aisha@example.com', headline: 'Community organiser', country: 'NG', city: 'Abuja', tone: 'info', joinedDaysAgo: 300 },
  // A spam account whose posts, comment and story are reported: the Moderator's demo queue (seed-moderation.ts).
  { key: 'spammer', name: 'Easy Profits Hub', handle: 'easy-profits-hub', email: 'promo@example.com', headline: 'Daily crypto signals', country: 'NG', city: 'Lagos', tone: 'warning', joinedDaysAgo: 20 },
  // Staff accounts (admin console). Two-step verification is mandatory for them: the seed presets a known
  // secret outside production (seed-accounts.ts; keys in the demo accounts PDF). The Ambassador Manager's
  // countries (Nigeria, Ghana, Kenya) are set in seed-ambassadors.ts.
  { key: 'superAdmin', name: 'Super Admin', handle: 'cm-super-admin', email: 'admin@chartermission.com', headline: 'Charter Mission platform team', country: 'AE', city: 'Dubai', tone: 'primary', staff: true, roles: ['super_admin'], joinedDaysAgo: 500 },
  { key: 'platformAdmin', name: 'Platform Admin', handle: 'cm-platform-admin', email: 'platform-admin@chartermission.com', headline: 'Charter Mission platform team', country: 'GB', city: 'London', tone: 'primary', staff: true, roles: ['platform_admin'], joinedDaysAgo: 490 },
  { key: 'moderator', name: 'Moderator', handle: 'cm-moderator', email: 'moderator@chartermission.com', headline: 'Charter Mission moderation team', country: 'NG', city: 'Abuja', tone: 'info', staff: true, roles: ['moderator'], joinedDaysAgo: 320 },
  { key: 'ambManager', name: 'Ambassador Manager', handle: 'cm-ambassador-manager', email: 'amb-manager@chartermission.com', headline: 'Ambassador programme, Charter Mission', country: 'NG', city: 'Lagos', tone: 'accent', staff: true, joinedDaysAgo: 200 },
  { key: 'amara', name: 'Amara Okafor', handle: 'amara-okafor', email: 'amara@example.com', headline: 'Founder, Lagos AgriHub', country: 'NG', city: 'Lagos', tone: 'accent', verified: true, organisation: 'Lagos AgriHub', bio: 'Agronomist turned founder. Lagos AgriHub connects 4,000+ smallholder farmers to cold storage and export buyers in Ghana, Côte d’Ivoire and the UK.', joinedDaysAgo: 260, sectors: ['Agriculture & food', 'Trade & logistics'] },
  { key: 'kwame', name: 'Kwame Mensah', handle: 'kwame-mensah', email: 'kwame@example.com', headline: 'Product Lead, PayBridge', country: 'GH', city: 'Accra', tone: 'success', verified: true, organisation: 'PayBridge', bio: 'Product lead at PayBridge, building cross-border settlement for small exporters. Ten years in payments across Accra, Lagos and Nairobi; always happy to talk mobile money interoperability.', joinedDaysAgo: 240, sectors: ['Finance & fintech', 'Technology'] },
  { key: 'wanjiru', name: 'Wanjiru Kamau', handle: 'wanjiru-kamau', email: 'wanjiru@example.com', headline: 'Climate Policy Analyst', country: 'KE', city: 'Nairobi', tone: 'info', bio: 'Climate policy analyst tracking adaptation finance at county level. I co-organise the Kenya chapter’s clean-cooking work in Nairobi and love a good budget spreadsheet.', joinedDaysAgo: 210, sectors: ['Climate & energy', 'Public policy'] },
  { key: 'leila', name: 'Leila Benali', handle: 'leila-benali', email: 'leila@example.com', headline: 'Trade Economist', country: 'MA', city: 'Casablanca', tone: 'info', verified: true, bio: 'Trade economist specialising in rules of origin. I translate AfCFTA legal texts into checklists exporters can actually use.', joinedDaysAgo: 190, sectors: ['Trade & logistics', 'Public policy'] },
  { key: 'thabo', name: 'Thabo Nkosi', handle: 'thabo-nkosi', email: 'thabo@example.com', headline: 'Renewable energy engineer', country: 'ZA', city: 'Johannesburg', tone: 'warning', organisation: 'GreenGrid Africa', bio: 'Engineer and co-founder at GreenGrid Africa. We design solar micro-grids for villages and clinics, and train young installers along the way.', joinedDaysAgo: 170, sectors: ['Climate & energy', 'Infrastructure'] },
  { key: 'fatou', name: 'Fatou Diallo', handle: 'fatou-diallo', email: 'fatou@example.com', headline: 'Fintech investor', country: 'SN', city: 'Dakar', tone: 'accent', bio: 'Early-stage investor backing West African fintech and women-led funds. Office hours every Thursday for founders raising their first round.', joinedDaysAgo: 150, sectors: ['Finance & fintech', 'Social impact'] },
  { key: 'yohannes', name: 'Yohannes Tesfaye', handle: 'yohannes-tesfaye', email: 'yohannes@example.com', headline: 'Health-tech founder', country: 'ET', city: 'Addis Ababa', tone: 'info', bio: 'Founder of an offline-first clinic records app used in 60 health centres across Ethiopia. Previously a hospital pharmacist.', joinedDaysAgo: 120, sectors: ['Health', 'Technology'] },
  { key: 'chinedu', name: 'Chinedu Eze', handle: 'chinedu-eze', email: 'chinedu@example.com', headline: 'Product Designer', country: 'GB', city: 'London', tone: 'success', bio: 'Product designer in London working on tools for African exporters. Interested in design systems for low-bandwidth products and African languages.', joinedDaysAgo: 90, sectors: ['Technology', 'Creative industries'] },
  // Joined in the last fortnight: the home feed's "new members" card and welcome stats.
  { key: 'tunde', name: 'Tunde Bakare', handle: 'tunde-bakare', email: 'tunde@example.com', headline: 'Cold-chain logistics engineer', country: 'NG', city: 'Lagos', tone: 'warning', organisation: 'ColdLink NG', bio: 'Logistics engineer keeping produce cold from farm gate to port. Five years running reefer fleets in Lagos and Ogun; now building shared cold rooms for co-ops.', joinedDaysAgo: 2, sectors: ['Agriculture & food', 'Trade & logistics'] },
  { key: 'ngozi', name: 'Ngozi Adebayo', handle: 'ngozi-adebayo', email: 'ngozi@example.com', headline: 'Youth employment programme lead', country: 'NG', city: 'Lagos', tone: 'success', bio: 'I run paid apprenticeship programmes that place young people in agribusiness and logistics roles across Lagos State. Always looking for host employers.', joinedDaysAgo: 5, sectors: ['Education', 'Social impact'] },
  { key: 'kofi', name: 'Kofi Asante', handle: 'kofi-asante', email: 'kofi@example.com', headline: 'Solar mini-grid developer', country: 'GH', city: 'Kumasi', tone: 'accent', bio: 'Developing solar mini-grids for market towns in the Ashanti region. Interested in productive-use financing and pay-as-you-go models.', joinedDaysAgo: 7, sectors: ['Climate & energy'] },
  { key: 'zainab', name: 'Zainab Abdi', handle: 'zainab-abdi', email: 'zainab@example.com', headline: 'Health data scientist', country: 'KE', city: 'Nairobi', tone: 'info', bio: 'Data scientist working on maternal health dashboards for county health teams. I like turning messy clinic data into decisions.', joinedDaysAgo: 9, sectors: ['Health', 'Technology'] },
];
