import 'server-only';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { TransactionDatabase, SqlConnection } from '../db/postgres';
import { resolveM2Principal, hashLocalPassword, type M2Role } from '../ai-ingestion/m2/identity';
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
export async function resolveM3Principal(tx: SqlConnection, token: string, finance = true) {
    const p = await resolveM2Principal(tx, token, finance);
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
/** Local OS owner lifecycle operation. No financial HTTP route exposes this function. */
export async function setLocalOrganizationActive(db: TransactionDatabase, organizationId: string, active: boolean) {
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
            const p = await resolveM3Principal(tx, token, false);
            if (p.role !== 'Admin' || p.organization_id !== scope.organization_id)
                throw new Error('ACCESS_DENIED');
            const target = (await tx.query<{
                role: M2Role;
                active: boolean;
                version: number;
            }>('SELECT role,active,version FROM fingence_m2.memberships WHERE user_id=$1 AND organization_id=$2 FOR UPDATE', [input.userId, p.organization_id])).rows[0];
            if (!target)
                throw new Error('ACCESS_DENIED');
            if (!revokeOnly) {
                if (target.version !== input.expectedVersion)
                    throw new Error('STALE_MEMBERSHIP');
                if (target.role === 'Admin' && target.active && (!input.active || input.role !== 'Admin')) {
                    const admins = await tx.query('SELECT user_id FROM fingence_m2.memberships WHERE organization_id=$1 AND active AND role=\'Admin\'', [p.organization_id]);
                    if (admins.rows.length <= 1)
                        throw new Error('LAST_ADMIN_PROTECTED');
                }
                if (input.active && (await tx.query('SELECT organization_id FROM fingence_m2.memberships WHERE user_id=$1 AND organization_id<>$2 AND active', [input.userId, p.organization_id])).rows.length)
                    throw new Error('MULTI_ORG_SELECTION_UNSUPPORTED');
                await tx.query('UPDATE fingence_m2.memberships SET role=$3,active=$4,version=version+1 WHERE user_id=$1 AND organization_id=$2', [input.userId, p.organization_id, input.role, input.active]);
            }
            await tx.query('UPDATE fingence_m2.sessions SET revoked=true WHERE user_id=$1 AND organization_id=$2', [input.userId, p.organization_id]);
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
