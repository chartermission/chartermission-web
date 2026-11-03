/**
 * The most common passwords from public breach corpora, lower-cased (CM-AUTH-05).
 * Always rejected, even when the HIBP range check is disabled or unreachable.
 * Short entries are kept because they are also matched with digits/symbols stripped
 * from the ends (e.g. "password12345!" → "password").
 */
export const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  '123456', '123456789', '12345678', '1234567890', '12345', '1234567', '123123', '111111', '000000', '654321',
  '123321', '666666', '121212', '112233', '7777777', '987654321', '123456789012', '1234567890123', '12345678910', '0123456789',
  '1q2w3e4r', '1q2w3e4r5t', '1q2w3e4r5t6y', '1qaz2wsx', '1qaz2wsx3edc', 'zaq12wsx', 'q1w2e3r4', 'q1w2e3r4t5y6', 'qwe123', 'qweasdzxc',
  'password', 'password1', 'password12', 'password123', 'password1234', 'password12345', 'passw0rd', 'p@ssw0rd', 'p@ssword', 'pass1234',
  'passwordpassword', 'mypassword', 'newpassword', 'secretpassword', 'password!', 'password123!', 'changeme', 'changeme123', 'temppassword', 'default',
  'qwerty', 'qwerty123', 'qwerty1234', 'qwerty12345', 'qwertyuiop', 'qwertyuiop123', 'qwertyuiopasdf', 'qwertyqwerty', 'qazwsx', 'qazwsxedc',
  'asdfgh', 'asdfghjkl', 'asdfghjkl123', 'asdf1234', 'zxcvbnm', 'zxcvbnm123', 'azerty', 'azerty123', 'abc123', 'abcd1234',
  'abcdef', 'abcdefg', 'abcdefgh', 'abcdefghijkl', 'abcdefghijklmnop', 'abc123456789', 'aaaaaa', 'aaaaaaaaaaaa', 'a1b2c3d4', 'a1b2c3d4e5f6',
  'iloveyou', 'iloveyou1', 'iloveyou123', 'iloveyou1234', 'iloveyouforever', 'loveyou', 'lovely', 'loveme', 'lovelove', 'sweetheart',
  'letmein', 'letmein123', 'letmein12345', 'welcome', 'welcome1', 'welcome123', 'welcome12345', 'welcometothejungle', 'hello', 'hello123',
  'hello12345678', 'helloworld', 'helloworld123', 'admin', 'admin123', 'admin1234', 'administrator', 'administrator1', 'root', 'rootroot',
  'superman', 'superman123', 'batman', 'batman123', 'spiderman', 'starwars', 'starwars123', 'pokemon', 'naruto', 'whatever',
  'football', 'football1', 'football123', 'football1234', 'baseball', 'baseball123', 'basketball', 'soccer', 'soccer123', 'hockey',
  'monkey', 'monkey123', 'dragon', 'dragon123', 'master', 'master123', 'shadow', 'sunshine', 'sunshine123', 'princess',
  'princess123', 'michael', 'michael123', 'jennifer', 'jessica', 'charlie', 'charlie123', 'jordan', 'jordan23', 'daniel',
  'trustno1', 'trustno1trustno1', 'freedom', 'freedom123', 'flower', 'computer', 'computer123', 'internet', 'samsung', 'samsung123',
  'mustang', 'harley', 'ranger', 'buster', 'tigger', 'cookie', 'chocolate', 'butterfly', 'purple', 'summer',
  'summer2024', 'summer2025', 'summer2026', 'winter2025', 'spring2026', 'autumn2026', 'january2026', 'december2025', 'october2026', 'november2026',
  'nigeria', 'nigeria123', 'nigeria1234', 'lagos123', 'ghana123', 'kenya123', 'nairobi123', 'africa', 'africa123', 'southafrica',
  'chartermission', 'chartermission1', 'chartermission123', 'charter', 'charter123', 'mission', 'mission123', 'jesus', 'jesus123', 'jesuschrist',
  'blessed', 'blessing', 'godisgood', 'godislove', 'praisegod', 'allahuakbar', 'bismillah', 'iloveyoujesus', 'amen1234', 'faithful',
  'qwerty123456', 'asdfqwer', '1234qwer', 'qwer1234', 'zaq1zaq1', '!qaz2wsx', '1qazxsw2', 'q1w2e3', 'passpass', 'test1234',
  'testtest', 'test123456', 'guest', 'guest123', 'user', 'user1234', 'login', 'login123', 'secret', 'secret123',
  'correcthorsebatterystaple', 'ihatemylife', 'baby123', 'babygirl', 'princesa', 'matrix', 'access', 'access123', 'yankees', 'liverpool',
  'arsenal', 'chelsea', 'manchester', 'manutd', 'barcelona', 'realmadrid', 'ronaldo7', 'messi10', 'zxcvbn', 'asd123',
]);

/** True when the password is a common one, ignoring case and trailing/leading digits or symbols. */
export function isCommonPassword(password: string): boolean {
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return true;
  const core = lower.replace(/^[^a-z]+|[^a-z]+$/g, '');
  if (core.length > 0 && COMMON_PASSWORDS.has(core)) return true;
  // One repeated character or a repeated short block ("abcabcabcabc").
  if (/^(.{1,4})\1+$/.test(lower)) return true;
  return false;
}
