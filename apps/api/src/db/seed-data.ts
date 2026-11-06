/** Reference data for the seed (taxonomies, chapters, demo members). */

export const COUNTRIES: [string, string, string][] = [
  ['DZ', 'Algeria', 'North Africa'], ['AO', 'Angola', 'Southern Africa'], ['BJ', 'Benin', 'West Africa'],
  ['BW', 'Botswana', 'Southern Africa'], ['BF', 'Burkina Faso', 'West Africa'], ['BI', 'Burundi', 'East Africa'],
  ['CV', 'Cabo Verde', 'West Africa'], ['CM', 'Cameroon', 'Central Africa'], ['CF', 'Central African Republic', 'Central Africa'],
  ['TD', 'Chad', 'Central Africa'], ['KM', 'Comoros', 'East Africa'], ['CG', 'Congo', 'Central Africa'],
  ['CD', 'DR Congo', 'Central Africa'], ['CI', "Côte d'Ivoire", 'West Africa'], ['DJ', 'Djibouti', 'East Africa'],
  ['EG', 'Egypt', 'North Africa'], ['GQ', 'Equatorial Guinea', 'Central Africa'], ['ER', 'Eritrea', 'East Africa'],
  ['SZ', 'Eswatini', 'Southern Africa'], ['ET', 'Ethiopia', 'East Africa'], ['GA', 'Gabon', 'Central Africa'],
  ['GM', 'Gambia', 'West Africa'], ['GH', 'Ghana', 'West Africa'], ['GN', 'Guinea', 'West Africa'],
  ['GW', 'Guinea-Bissau', 'West Africa'], ['KE', 'Kenya', 'East Africa'], ['LS', 'Lesotho', 'Southern Africa'],
  ['LR', 'Liberia', 'West Africa'], ['LY', 'Libya', 'North Africa'], ['MG', 'Madagascar', 'East Africa'],
  ['MW', 'Malawi', 'Southern Africa'], ['ML', 'Mali', 'West Africa'], ['MR', 'Mauritania', 'West Africa'],
  ['MU', 'Mauritius', 'East Africa'], ['MA', 'Morocco', 'North Africa'], ['MZ', 'Mozambique', 'Southern Africa'],
  ['NA', 'Namibia', 'Southern Africa'], ['NE', 'Niger', 'West Africa'], ['NG', 'Nigeria', 'West Africa'],
  ['RW', 'Rwanda', 'East Africa'], ['ST', 'São Tomé and Príncipe', 'Central Africa'], ['SN', 'Senegal', 'West Africa'],
  ['SC', 'Seychelles', 'East Africa'], ['SL', 'Sierra Leone', 'West Africa'], ['SO', 'Somalia', 'East Africa'],
  ['ZA', 'South Africa', 'Southern Africa'], ['SS', 'South Sudan', 'East Africa'], ['SD', 'Sudan', 'North Africa'],
  ['TZ', 'Tanzania', 'East Africa'], ['TG', 'Togo', 'West Africa'], ['TN', 'Tunisia', 'North Africa'],
  ['UG', 'Uganda', 'East Africa'], ['ZM', 'Zambia', 'Southern Africa'], ['ZW', 'Zimbabwe', 'Southern Africa'],
  ['GB', 'United Kingdom', 'Diaspora'], ['US', 'United States', 'Diaspora'], ['CA', 'Canada', 'Diaspora'],
  ['FR', 'France', 'Diaspora'], ['DE', 'Germany', 'Diaspora'], ['NL', 'Netherlands', 'Diaspora'],
  ['BE', 'Belgium', 'Diaspora'], ['IT', 'Italy', 'Diaspora'], ['PT', 'Portugal', 'Diaspora'],
  ['ES', 'Spain', 'Diaspora'], ['IE', 'Ireland', 'Diaspora'], ['SE', 'Sweden', 'Diaspora'],
  ['AE', 'United Arab Emirates', 'Diaspora'], ['SA', 'Saudi Arabia', 'Diaspora'], ['QA', 'Qatar', 'Diaspora'],
  ['BR', 'Brazil', 'Diaspora'], ['JM', 'Jamaica', 'Diaspora'], ['CN', 'China', 'Diaspora'],
  ['AU', 'Australia', 'Diaspora'],
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
  ['lagos', 'Lagos Chapter', 'NG'], ['abuja', 'Abuja Chapter', 'NG'], ['accra', 'Accra Chapter', 'GH'],
  ['nairobi', 'Nairobi Chapter', 'KE'], ['johannesburg', 'Johannesburg Chapter', 'ZA'], ['dakar', 'Dakar Chapter', 'SN'],
  ['addis-ababa', 'Addis Ababa Chapter', 'ET'], ['casablanca', 'Casablanca Chapter', 'MA'],
  ['london-diaspora', 'London Diaspora Chapter', 'GB'], ['dubai-diaspora', 'Dubai Diaspora Chapter', 'AE'],
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
export const DEMO_PASSWORD = 'charter-mission-demo';

export const MEMBERS: SeedMember[] = [
  { key: 'owais', name: 'Owais Iqbal', handle: 'owais-iqbal', email: 'owais@example.com', headline: 'Founder · Dubai, UAE', country: 'AE', city: 'Dubai', tone: 'primary', roles: ['super_admin'], organisation: 'HyseTech Software Design', joinedDaysAgo: 420, sectors: ['Technology'] },
  { key: 'team', name: 'Charter Mission', handle: 'charter-mission', email: 'team@example.com', headline: 'Official platform team', country: 'GB', city: 'London', tone: 'primary', staff: true, roles: ['platform_admin'], joinedDaysAgo: 480 },
  { key: 'aisha', name: 'Aisha Mohammed', handle: 'aisha-mohammed', email: 'aisha@example.com', headline: 'Community moderator', country: 'NG', city: 'Abuja', tone: 'info', roles: ['moderator'], joinedDaysAgo: 300 },
  { key: 'amara', name: 'Amara Okafor', handle: 'amara-okafor', email: 'amara@example.com', headline: 'Founder, Lagos AgriHub', country: 'NG', city: 'Lagos', tone: 'accent', verified: true, organisation: 'Lagos AgriHub', bio: 'Agronomist turned founder. Lagos AgriHub connects 4,000+ smallholder farmers to cold storage and export buyers in Ghana, Côte d’Ivoire and the UK.', joinedDaysAgo: 260, sectors: ['Agriculture & food', 'Trade & logistics'] },
  { key: 'kwame', name: 'Kwame Mensah', handle: 'kwame-mensah', email: 'kwame@example.com', headline: 'Product Lead, PayBridge', country: 'GH', city: 'Accra', tone: 'success', verified: true, organisation: 'PayBridge', bio: 'Product lead at PayBridge, building cross-border settlement for small exporters. Ten years in payments across Accra, Lagos and Nairobi; always happy to talk mobile money interoperability.', joinedDaysAgo: 240, sectors: ['Finance & fintech', 'Technology'] },
  { key: 'wanjiru', name: 'Wanjiru Kamau', handle: 'wanjiru-kamau', email: 'wanjiru@example.com', headline: 'Climate Policy Analyst', country: 'KE', city: 'Nairobi', tone: 'info', bio: 'Climate policy analyst tracking adaptation finance at county level. I co-organise the Nairobi chapter’s clean-cooking work and love a good budget spreadsheet.', joinedDaysAgo: 210, sectors: ['Climate & energy', 'Public policy'] },
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
