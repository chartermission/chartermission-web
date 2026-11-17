import { z } from 'zod';

/** A base URL without a trailing slash, so paths can be appended with a plain "+". */
const baseUrl = z
  .string()
  .url()
  .transform((v) => v.replace(/\/+$/, ''));

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(4100),
  /** Where Claude reaches this server, e.g. https://mcp.chartermission.com. Also the OAuth issuer. */
  PUBLIC_URL: baseUrl,
  /** The API on the internal network, e.g. http://cm-api:4000/api/v1. */
  API_INTERNAL_URL: baseUrl,
  /** The member app: consent page and links in tool results, e.g. https://chartermission.com. */
  WEB_URL: baseUrl,
});

export type Config = z.infer<typeof EnvSchema>;

/** Reads and checks the environment once at start; a bad value stops the process with a clear list. */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment for the MCP server:\n${lines.join('\n')}`);
  }
  return parsed.data;
}
