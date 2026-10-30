import 'server-only';
import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import type { SqlConnection, TransactionDatabase } from '../../db/postgres';
import { persistSecurityAuditEvent } from '../../security/audit-store';
import type { SecurityAuditAction } from '../../security/audit';
export type M2Role = 'Finance' | 'Technical (Management)' | 'Admin';
export type M2Principal = {
    user_id: string;
    organization_id: string;
    role: M2Role;
    version: number;
};
export const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');
const derive = (password: string, salt: string) => new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
export async function auditM2(tx: SqlConnection, principal: M2Principal | null, action: SecurityAuditAction, target: string, outcome: 'success' | 'denied' | 'failure' = 'success') {
    await persistSecurityAuditEvent(tx, { actorId: principal?.user_id ?? null, organizationId: principal?.organization_id ?? null, action, outcome, targetType: action.startsWith('auth.') || action === 'admin.configuration_changed' ? 'auth_session' : action === 'persistence_attempt.created' ? 'persistence_attempt' : 'ingestion_batch', targetId: target, requestId: null, approvalId: null });
}
export async function resolveM2Principal(tx: SqlConnection, token: string, finance = true): Promise<M2Principal> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token))
        throw new Error('ACCESS_DENIED');
    const r = await tx.query<M2Principal>(`SELECT s.user_id::text,s.organization_id::text,m.role,m.version FROM fingence_m2.sessions s JOIN fingence_m2.memberships m USING(user_id,organization_id)
  WHERE s.token_hash=$1 AND NOT s.revoked AND s.expires_at>clock_timestamp() AND m.active AND s.membership_version=m.version FOR SHARE OF s,m`, [tokenHash(token)]);
    const principal = r.rows[0];
    if (!principal || (finance && principal.role !== 'Finance'))
        throw new Error('ACCESS_DENIED');
    return principal;
}
/** OS-local provisioning only. Never called by a financial HTTP request. No fallback account. */
export async function provisionM2Account(db: TransactionDatabase, input: {
    email: string;
    password: string;
    organizationName: string;
    role?: M2Role;
}) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) || input.email.length > 200 || input.password.length < 12 || input.password.length > 128 || !input.organizationName.trim())
        throw new Error('INVALID_LOCAL_ACCOUNT');
    const salt = randomBytes(16).toString('hex'), hash = (await derive(input.password, salt)).toString('hex');
    const userId = randomUUID(), organizationId = randomUUID();
    await db.transaction(async (tx) => { await tx.query('INSERT INTO fingence_m2.organizations VALUES($1,$2)', [organizationId, input.organizationName.trim().slice(0, 120)]); await tx.query('INSERT INTO fingence_m2.users VALUES($1,$2,$3)', [userId, input.email.trim().toLowerCase(), salt + ':' + hash]); await tx.query('INSERT INTO fingence_m2.memberships(user_id,organization_id,role) VALUES($1,$2,$3)', [userId, organizationId, input.role ?? 'Finance']); });
    return { userId, organizationId };
}
export function createM2Identity(db: TransactionDatabase) {
    return {
        async login(email: string, password: string) {
            if (email.length > 200 || password.length > 128)
                throw new Error('ACCESS_DENIED');
            const user = await db.transaction(async (tx) => (await tx.query<{
                id: string;
                password_hash: string;
            }>('SELECT id::text,password_hash FROM fingence_m2.users WHERE email=$1', [email.trim().toLowerCase()])).rows[0]);
            const [salt, expected] = (user?.password_hash ?? ('0'.repeat(32) + ':' + '0'.repeat(128))).split(':');
            const actual = await derive(password, salt);
            if (!user || !timingSafeEqual(actual, Buffer.from(expected, 'hex'))) {
                await db.transaction(tx => auditM2(tx, null, 'auth.sign_in_failed', 'local-session', 'denied'));
                throw new Error('ACCESS_DENIED');
            }
            const token = randomBytes(32).toString('base64url');
            return db.transaction(async (tx) => {
                const memberships = await tx.query<M2Principal>('SELECT user_id::text,organization_id::text,role,version FROM fingence_m2.memberships WHERE user_id=$1 AND active FOR SHARE', [user.id]);
                if (memberships.rows.length !== 1)
                    throw new Error('ACCESS_DENIED');
                const principal = memberships.rows[0];
                await tx.query("INSERT INTO fingence_m2.sessions VALUES($1,$2,$3,clock_timestamp()+interval '30 minutes',false,$4)", [tokenHash(token), user.id, principal.organization_id, principal.version]);
                await auditM2(tx, principal, 'auth.sign_in', 'local-session');
                return { token, principal };
            });
        },
        session: (token: string) => db.transaction(async (tx) => { const p = await resolveM2Principal(tx, token, false); return { role: p.role, organizationId: p.organization_id, userId: p.user_id, membershipVersion: p.version }; }),
        logout: (token: string) => db.transaction(async (tx) => { const p = await resolveM2Principal(tx, token, false); await tx.query('UPDATE fingence_m2.sessions SET revoked=true WHERE token_hash=$1', [tokenHash(token)]); await auditM2(tx, p, 'admin.configuration_changed', 'session-revoked'); }),
    };
}
