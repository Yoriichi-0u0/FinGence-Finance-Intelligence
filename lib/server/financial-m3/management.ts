import 'server-only';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { TransactionDatabase, SqlConnection } from '../db/postgres';
import { resolveM2Principal, hashLocalPassword, accountSuspended, type M2Role, type PrincipalLock } from '../ai-ingestion/m2/identity';
import { persistSecurityAuditEvent } from '../security/audit-store';
import type { SecurityAuditAction } from '../security/audit';
import type { M2Principal } from '../ai-ingestion/m2/identity';
async function auditManagement(tx: SqlConnection, p: M2Principal | null, action: SecurityAuditAction, target: string, type: 'organization_user' | 'organization_settings' = 'organization_settings') {
    await persistSecurityAuditEvent(tx, { actorId: p?.user_id ?? null, organizationId: p?.organization_id ?? null, action, outcome: 'success', targetType: type, targetId: target, requestId: null, approvalId: null });
}
export const applicationRoles = ['Finance', 'Technical (Management)', 'Admin'] as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function installM3Schema(db: TransactionDatabase) {
    const sql = await readFile('supabase/sql/v2-m3-local.sql', 'utf8');
    await db.transaction(async (tx) => { for (const statement of sql.replace(/--[^\n]*/g, '').split(';').filter(s => s.trim()))
        await tx.query(statement); });
}
export async function resolveM3Principal(tx: SqlConnection, token: string, finance = true, lock: PrincipalLock = 'SHARE') {
    const p = await resolveM2Principal(tx, token, finance, lock);
    const state = await tx.query('SELECT organization_id FROM fingence_m3.organization_states WHERE organization_id=$1 AND active FOR SHARE', [p.organization_id]);
    if (!state.rows.length)
        throw new Error('ACCESS_DENIED');
    return p;
}
/** OS-local account creation only; not a browser credential or authorization fallback. */
export async function provisionM3Account(db: TransactionDatabase, input: {
    email: string;
    password: string;
    organizationName?: string;
    organizationId?: string;
    role: M2Role;
}) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) || input.email.length > 200 || !applicationRoles.includes(input.role) || (!input.organizationId && !input.organizationName?.trim()) || (input.organizationId && !uuid.test(input.organizationId)))
        throw new Error('INVALID_LOCAL_ACCOUNT');
    const passwordHash = await hashLocalPassword(input.password), userId = randomUUID(), org = input.organizationId ?? randomUUID();
    await db.transaction(async (tx) => {
        if (input.organizationId) {
            if (!(await tx.query('SELECT organization_id FROM fingence_m3.organization_states WHERE organization_id=$1 AND active FOR SHARE', [org])).rows.length)
                throw new Error('ORGANIZATION_UNAVAILABLE');
        }
        else {
            await tx.query('INSERT INTO fingence_m2.organizations(id,name) VALUES($1,$2)', [org, input.organizationName!.trim().slice(0, 120)]);
            await tx.query('INSERT INTO fingence_m3.organization_states VALUES($1,true)', [org]);
        }
        await tx.query('INSERT INTO fingence_m2.users VALUES($1,$2,$3)', [userId, input.email.trim().toLowerCase(), passwordHash]);
        // Existing-organization enrollment starts inactive; an authorized Admin must activate it.
        await tx.query('INSERT INTO fingence_m2.memberships(user_id,organization_id,role,active) VALUES($1,$2,$3,$4)', [userId, org, input.role, !input.organizationId]);
        await auditManagement(tx, null, 'admin.configuration_changed', 'local-account-provisioned');
    });
    return { userId, organizationId: org, active: !input.organizationId };
}
/** Active Admin memberships whose account can still sign in. Caller holds the organization's advisory lock. */
export async function signableAdmins(tx: SqlConnection, organizationId: string) {
    const admins = (await tx.query<{ user_id: string }>("SELECT user_id::text FROM fingence_m2.memberships WHERE organization_id=$1 AND active AND role='Admin'", [organizationId])).rows;
    const signable: string[] = [];
    for (const { user_id } of admins)
        if (!(await accountSuspended(tx, user_id)))
            signable.push(user_id);
    return signable;
}
export type MembershipChange = { userId: string; role?: M2Role; active?: boolean; expectedVersion?: number };
export type MembershipOutcome = { status: 'UPDATED'; previous: { role: M2Role; active: boolean }; next: { role: M2Role; active: boolean } } | { status: 'REFUSED'; code: 'ACCESS_DENIED' | 'STALE_MEMBERSHIP' | 'LAST_ADMIN_PROTECTED' | 'MULTI_ORG_SELECTION_UNSUPPORTED' };
/**
 * Shared M3/M5 membership mutation. The caller holds the organization's advisory lock and has
 * resolved an active Admin actor in that organization. Every check precedes the first write.
 * Lock order matches identity reads: target sessions, then target membership.
 */
export async function applyMembershipChange(tx: SqlConnection, actor: M2Principal, input: MembershipChange, revokeOnly: boolean): Promise<MembershipOutcome> {
    await tx.query('SELECT token_hash FROM fingence_m2.sessions WHERE user_id=$1 AND organization_id=$2 FOR UPDATE', [input.userId, actor.organization_id]);
    const target = (await tx.query<{
        role: M2Role;
        active: boolean;
        version: number;
    }>('SELECT role,active,version FROM fingence_m2.memberships WHERE user_id=$1 AND organization_id=$2 FOR UPDATE', [input.userId, actor.organization_id])).rows[0];
    if (!target)
        return { status: 'REFUSED', code: 'ACCESS_DENIED' };
    const next = revokeOnly ? { role: target.role, active: target.active } : { role: input.role!, active: input.active! };
    if (!revokeOnly) {
        if (target.version !== input.expectedVersion)
            return { status: 'REFUSED', code: 'STALE_MEMBERSHIP' };
        if (target.role === 'Admin' && target.active && (!next.active || next.role !== 'Admin')) {
            const admins = await signableAdmins(tx, actor.organization_id);
            if (admins.includes(input.userId) && admins.length <= 1)
                return { status: 'REFUSED', code: 'LAST_ADMIN_PROTECTED' };
        }
        if (next.active && (await tx.query('SELECT organization_id FROM fingence_m2.memberships WHERE user_id=$1 AND organization_id<>$2 AND active', [input.userId, actor.organization_id])).rows.length)
            return { status: 'REFUSED', code: 'MULTI_ORG_SELECTION_UNSUPPORTED' };
        await tx.query('UPDATE fingence_m2.memberships SET role=$3,active=$4,version=version+1 WHERE user_id=$1 AND organization_id=$2', [input.userId, actor.organization_id, next.role, next.active]);
    }
    await tx.query('UPDATE fingence_m2.sessions SET revoked=true WHERE user_id=$1 AND organization_id=$2', [input.userId, actor.organization_id]);
    return { status: 'UPDATED', previous: { role: target.role, active: target.active }, next };
}
/** Local OS owner lifecycle operation. No financial HTTP route exposes this function. `within` runs in the same transaction. */
export async function setLocalOrganizationActive(db: TransactionDatabase, organizationId: string, active: boolean, within?: (tx: SqlConnection) => Promise<void>) {
    if (!uuid.test(organizationId) || typeof active !== 'boolean')
        throw new Error('INVALID_ORGANIZATION');
    await db.transaction(async (tx) => {
        await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [organizationId]);
        // Match identity read lock order: session/membership rows before organization state.
        // No organization-state lock is held while waiting for an in-flight financial read.
        await tx.query('SELECT token_hash FROM fingence_m2.sessions WHERE organization_id=$1 FOR UPDATE', [organizationId]);
        await tx.query('SELECT user_id FROM fingence_m2.memberships WHERE organization_id=$1 FOR UPDATE', [organizationId]);
        if ((await tx.query('UPDATE fingence_m3.organization_states SET active=$2 WHERE organization_id=$1 RETURNING organization_id', [organizationId, active])).rowCount !== 1)
            throw new Error('ORGANIZATION_UNAVAILABLE');
        // Activation never silently reinstates old membership or sessions.
        if (!active) {
            await tx.query('UPDATE fingence_m2.memberships SET active=false,version=version+1 WHERE organization_id=$1', [organizationId]);
            await tx.query('UPDATE fingence_m2.sessions SET revoked=true WHERE organization_id=$1', [organizationId]);
        }
        await within?.(tx);
        await auditManagement(tx, null, 'admin.configuration_changed', 'local-organization-lifecycle');
    });
}
export function createManagementService(db: TransactionDatabase) {
    async function mutate(token: string, input: {
        userId: string;
        role?: M2Role;
        active?: boolean;
        expectedVersion?: number;
    }, revokeOnly: boolean) {
        if (!uuid.test(input.userId) || (!revokeOnly && (!applicationRoles.includes(input.role!) || typeof input.active !== 'boolean' || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion! < 1)))
            throw new Error('INVALID_MEMBERSHIP');
        // Preflight is server-resolved and releases its row locks. Re-authorize after the org lock.
        const scope = await db.transaction(tx => resolveM3Principal(tx, token, false));
        return db.transaction(async (tx) => {
            await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [scope.organization_id]);
            // Exclusive actor locks: a self-targeted change never upgrades a share lock held alongside logout.
            const p = await resolveM3Principal(tx, token, false, 'NO KEY UPDATE');
            if (p.role !== 'Admin' || p.organization_id !== scope.organization_id)
                throw new Error('ACCESS_DENIED');
            const outcome = await applyMembershipChange(tx, p, input, revokeOnly);
            if (outcome.status === 'REFUSED')
                throw new Error(outcome.code);
            await auditManagement(tx, p, revokeOnly ? 'admin.configuration_changed' : 'authorization.role_changed', input.userId, 'organization_user');
            return { status: 'UPDATED' as const, sessionsRevoked: true };
        });
    }
    return {
        async overview(token: string) {
            return db.transaction(async (tx) => {
                const p = await resolveM3Principal(tx, token, false);
                if (p.role === 'Finance')
                    throw new Error('ACCESS_DENIED');
                const jobs = (await tx.query<{
                    state: string;
                    count: number;
                }>('SELECT state,count(*)::int AS count FROM fingence_m2.jobs WHERE organization_id=$1 GROUP BY state ORDER BY state', [p.organization_id])).rows;
                const members = p.role === 'Admin' ? (await tx.query('SELECT m.user_id::text AS "userId",u.email,m.role,m.active,m.version FROM fingence_m2.memberships m JOIN fingence_m2.users u ON u.id=m.user_id WHERE m.organization_id=$1 ORDER BY u.email', [p.organization_id])).rows : null;
                await auditManagement(tx, p, p.role === 'Admin' ? 'security_logs.read' : 'dashboard.read', 'local-management');
                return { scope: { userId: p.user_id, organizationId: p.organization_id, role: p.role, membershipVersion: p.version }, jobs, members, financialAccess: false, organizationLifecycle: 'OS_LOCAL_OWNER_ONLY' };
            });
        },
        membership: (token: string, input: {
            userId: string;
            role: M2Role;
            active: boolean;
            expectedVersion: number;
        }) => mutate(token, input, false),
        revoke: (token: string, userId: string) => mutate(token, { userId }, true),
    };
}
