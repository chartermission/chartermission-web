import { utcDayOfYear } from './text.js';

/**
 * The daily prompt card (GET /home/moments). One prompt per UTC day, in a fixed rotation,
 * written for a pan-African network of professionals, founders and changemakers.
 * Answering is an ordinary post carrying #DailyPrompt (contracts DAILY_PROMPT_TAG).
 *
 * Guidelines for adding prompts: open questions anyone can answer from experience, no
 * politics or religion, no clichés, and nothing that asks people to share private details.
 * Keep ids stable (the seed has sample answers keyed by id).
 */
export type DailyPrompt = { id: string; text: string };

export const DAILY_PROMPTS: readonly DailyPrompt[] = [
  { id: 'first-break', text: 'Who gave you your first real professional break, and what did they see in you?' },
  { id: 'skill-this-year', text: 'What is one skill you picked up this year that changed how you work?' },
  { id: 'local-problem', text: 'Name a problem in your city that you think is quietly solvable. What would it take?' },
  { id: 'mentor-advice', text: 'What is the best piece of advice a mentor gave you that you only understood years later?' },
  { id: 'small-win', text: 'Share a small win from this week that nobody else noticed.' },
  { id: 'cross-border', text: 'What is one thing that would make working across African borders easier for you tomorrow?' },
  { id: 'founder-mistake', text: 'What early mistake taught you the most about building something from scratch?' },
  { id: 'climate-practice', text: 'What climate-friendly practice have you seen work in a business or community near you?' },
  { id: 'learning-resource', text: 'Which book, course or podcast would you hand to someone starting out in your field?' },
  { id: 'chapter-idea', text: 'If you could run one event for your chapter next month, what would it be?' },
  { id: 'hire-for', text: 'When you hire or pick collaborators, what quality do you look for that is not on a CV?' },
  { id: 'unsung-sector', text: 'Which sector in your country deserves far more attention than it gets?' },
  { id: 'teach-in-an-hour', text: 'What could you teach a newcomer to this network in under an hour?' },
  { id: 'tool-you-love', text: 'What simple tool or habit saves you the most time each week?' },
  { id: 'young-self', text: 'What would you tell yourself on the first day of your career?' },
  { id: 'diaspora-bridge', text: 'For those living abroad: what is the most useful way you have stayed connected to work back home?' },
  { id: 'education-access', text: 'What is one change that would help more young people in your community finish their education?' },
  { id: 'proud-collab', text: 'Tell us about a collaboration you are proud of. What made it work?' },
  { id: 'trade-route', text: 'Which product made in Africa do you wish more people around the world knew about?' },
  { id: 'resilience', text: 'What keeps you going on the weeks when the work feels slow?' },
  { id: 'data-decision', text: 'Share a time when a small piece of data changed a big decision.' },
  { id: 'local-hero', text: 'Who is someone in your community doing quietly remarkable work? Give them a shout-out.' },
  { id: 'funding-lesson', text: 'What have you learned about raising money, grants or support that you wish you had known sooner?' },
  { id: 'five-years', text: 'What do you hope your field looks like in five years, and what are you doing to get it there?' },
  { id: 'question-for-network', text: 'What is one question you would love this network to help you answer right now?' },
  { id: 'rest-ritual', text: 'How do you rest and recharge after an intense stretch of work?' },
  { id: 'language-work', text: 'How do the languages you speak shape the way you work with people?' },
  { id: 'first-customer', text: 'How did you find your first customer, partner or beneficiary?' },
  { id: 'open-door', text: 'What is one door you could open for someone in this community this month?' },
  { id: 'celebrate-team', text: 'Name someone on your team or in your circle who deserves recognition this week, and why.' },
];

/** Today's prompt (UTC), rotating by day of the year. */
export function promptFor(d: Date = new Date()): DailyPrompt {
  return DAILY_PROMPTS[(utcDayOfYear(d) - 1) % DAILY_PROMPTS.length]!;
}
