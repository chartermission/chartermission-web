import net from 'node:net';
import { env } from '../config/env.js';

/** The standard EICAR anti-virus test string. */
export const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

export type ScanResult = { clean: true } | { clean: false; signature: string };

/**
 * Malware scan before a file is shown (CM-FED-02, spec 6.3).
 *
 * With CLAMAV_HOST set, the bytes are streamed to clamd over TCP (INSTREAM).
 * Without it, only a built-in EICAR signature check runs: that is for
 * development and tests. PRODUCTION MUST SET CLAMAV_HOST.
 * A scanner error throws, so the file stays pending and the job retries (fail closed).
 */
export async function scanBuffer(data: Buffer): Promise<ScanResult> {
  const { CLAMAV_HOST, CLAMAV_PORT } = env();
  if (CLAMAV_HOST) return clamdInstream(data, CLAMAV_HOST, CLAMAV_PORT);
  return data.includes(EICAR) ? { clean: false, signature: 'Eicar-Test-Signature' } : { clean: true };
}

export function clamdInstream(data: Buffer, host: string, port: number, timeoutMs = 30_000): Promise<ScanResult> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const chunks: Buffer[] = [];
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error('clamd timed out')));
    socket.on('error', reject);
    socket.on('data', (c: Buffer) => chunks.push(c));
    socket.on('close', () => {
      const reply = Buffer.concat(chunks).toString('utf8').replace(/\0/g, '').trim();
      if (/:\s*OK$/.test(reply)) return resolve({ clean: true });
      const found = /:\s*(.+)\s+FOUND$/.exec(reply);
      if (found) return resolve({ clean: false, signature: found[1]! });
      reject(new Error(`Unexpected clamd reply: ${reply.slice(0, 200)}`));
    });
    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      const size = 64 * 1024;
      for (let i = 0; i < data.length; i += size) {
        const chunk = data.subarray(i, i + size);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(chunk.length);
        socket.write(len);
        socket.write(chunk);
      }
      socket.end(Buffer.alloc(4));
    });
  });
}
