import 'server-only';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/** scrypt (N=2^14, r=8, p=1, 64-byte key), stored as `scrypt$<salt>$<key>`. The database only ever sees this string. */
const derive = (password: string, salt: string) => new Promise<Buffer>((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));

export const PASSWORD_RULE = 'Use 12 to 128 characters.';
export const passwordAcceptable = (password: unknown): password is string => typeof password === 'string' && [...password].length >= 12 && [...password].length <= 128;

export async function hashPassword(password: string) {
    const salt = randomBytes(16).toString('base64url');
    return `scrypt$${salt}$${(await derive(password, salt)).toString('base64url')}`;
}
/** Verifies against a stored hash, or against a fixed dummy when there is none, so unknown emails take as long as known ones. */
const DUMMY = 'scrypt$AAAAAAAAAAAAAAAAAAAAAA$' + 'A'.repeat(86);
export async function verifyPassword(password: string, stored: string | null) {
    const [kind, salt, key] = (stored ?? DUMMY).split('$');
    if (kind !== 'scrypt' || !salt || !key) return false;
    const expected = Buffer.from(key, 'base64url'), actual = await derive(password, salt);
    return stored !== null && expected.length === actual.length && timingSafeEqual(expected, actual);
}
