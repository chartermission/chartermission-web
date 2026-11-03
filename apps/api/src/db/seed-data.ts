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
};

/** Demo accounts for development and staging. All share DEMO_PASSWORD. */
export const DEMO_PASSWORD = 'charter-mission-demo';

export const MEMBERS: SeedMember[] = [
  { key: 'owais', name: 'Owais Iqbal', handle: 'owais-iqbal', email: 'owais@example.com', headline: 'Founder · Dubai, UAE', country: 'AE', city: 'Dubai', tone: 'primary', roles: ['super_admin'], organisation: 'HyseTech Software Design' },
  { key: 'team', name: 'Charter Mission', handle: 'charter-mission', email: 'team@example.com', headline: 'Official platform team', country: 'GB', city: 'London', tone: 'primary', staff: true, roles: ['platform_admin'] },
  { key: 'aisha', name: 'Aisha Mohammed', handle: 'aisha-mohammed', email: 'aisha@example.com', headline: 'Community moderator', country: 'NG', city: 'Abuja', tone: 'info', roles: ['moderator'] },
  { key: 'amara', name: 'Amara Okafor', handle: 'amara-okafor', email: 'amara@example.com', headline: 'Founder, Lagos AgriHub', country: 'NG', city: 'Lagos', tone: 'accent', verified: true, organisation: 'Lagos AgriHub', bio: 'Agronomist turned founder. Lagos AgriHub connects 4,000+ smallholder farmers to cold storage and export buyers in Ghana, Côte d’Ivoire and the UK.' },
  { key: 'kwame', name: 'Kwame Mensah', handle: 'kwame-mensah', email: 'kwame@example.com', headline: 'Product Lead, PayBridge', country: 'GH', city: 'Accra', tone: 'success', verified: true, organisation: 'PayBridge' },
  { key: 'wanjiru', name: 'Wanjiru Kamau', handle: 'wanjiru-kamau', email: 'wanjiru@example.com', headline: 'Climate Policy Analyst', country: 'KE', city: 'Nairobi', tone: 'info' },
  { key: 'leila', name: 'Leila Benali', handle: 'leila-benali', email: 'leila@example.com', headline: 'Trade Economist', country: 'MA', city: 'Casablanca', tone: 'info', verified: true },
  { key: 'thabo', name: 'Thabo Nkosi', handle: 'thabo-nkosi', email: 'thabo@example.com', headline: 'Renewable energy engineer', country: 'ZA', city: 'Johannesburg', tone: 'warning' },
  { key: 'fatou', name: 'Fatou Diallo', handle: 'fatou-diallo', email: 'fatou@example.com', headline: 'Fintech investor', country: 'SN', city: 'Dakar', tone: 'accent' },
  { key: 'yohannes', name: 'Yohannes Tesfaye', handle: 'yohannes-tesfaye', email: 'yohannes@example.com', headline: 'Health-tech founder', country: 'ET', city: 'Addis Ababa', tone: 'info' },
  { key: 'chinedu', name: 'Chinedu Eze', handle: 'chinedu-eze', email: 'chinedu@example.com', headline: 'Product Designer', country: 'GB', city: 'London', tone: 'success' },
];
