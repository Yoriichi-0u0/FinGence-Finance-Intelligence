import 'server-only';
import { randomBytes, randomUUID } from 'node:crypto';
import type { SqlConnection, TransactionDatabase } from '../db/postgres';
import { hashLocalPassword, tokenHash, type M2Principal, type M2Role } from '../ai-ingestion/m2/identity';
import { applicationRoles, applyMembershipChange, resolveM3Principal, setLocalOrganizationActive, signableAdmins } from '../financial-m3/management';
import { persistSecurityAuditEvent } from '../security/audit-store';
import type { SecurityAuditAction, SecurityAuditTargetType } from '../security/audit';

export type AdministrationRefusal = 'UNAVAILABLE' | 'STALE_MEMBERSHIP' | 'LAST_ADMIN_PROTECTED' | 'ALREADY_MEMBER' | 'STALE_ACCOUNT' | 'STALE_INVITATION' | 'INVITATION_UNAVAILABLE' | 'PASSWORD_POLICY';
export type Refused = { status: 'REFUSED'; code: AdministrationRefusal };
export type AdministrationMember = { userId: string; email: string; role: M2Role; active: boolean; version: number; accountActive: boolean; activeSessions: number };
export type AdministrationInvitation = { id: string; email: string; role: M2Role; issuer: 'ADMIN' | 'OS_BOOTSTRAP' | 'OS_RECOVERY'; state: 'PENDING' | 'ACCEPTED' | 'REVOKED'; createdAt: string; expiresAt: string; expired: boolean };
export type AdministrationOverview = {
    status: 'OK';
    view: 'ADMIN' | 'OPERATIONAL';
    scope: { userId: string; organizationId: string; role: M2Role; membershipVersion: number };
    organization: { id: string; name: string };
    jobs: { state: string; count: number }[];
    members: AdministrationMember[] | null;
    invitations: AdministrationInvitation[] | null;
    financialAccess: false;
    organizationLifecycle: 'OS_LOCAL_OWNER_ONLY';
};
export type AdministrationAuditEntry = { occurredAt: string; action: string; outcome: string; targetType: string | null; targetId: string | null; actorEmail: string | null; targetEmail: string | null };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const codeFormat = /^[A-Za-z0-9_-]{43}$/;
const refused = (code: AdministrationRefusal): Refused => ({ status: 'REFUSED', code });
const iso = (value: unknown) => new Date(value as string).toISOString();
function normalizedEmail(value: unknown) {
    if (typeof value !== 'string')
        return null;
    const email = value.trim().toLowerCase();
    return email.length >= 3 && email.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}
function invalid(): never { throw new Error('INVALID_ADMINISTRATION_INPUT'); }
/** Same key as M3 membership changes and organization lifecycle, so all of them serialize per organization. */
const lockOrganization = (tx: SqlConnection, organizationId: string) => tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [organizationId]);
async function audit(tx: SqlConnection, actorId: string | null, organizationId: string, action: SecurityAuditAction, outcome: 'success' | 'denied' | 'failure', targetType: SecurityAuditTargetType, targetId: string) {
    await persistSecurityAuditEvent(tx, { actorId, organizationId, action, outcome, targetType, targetId, requestId: null, approvalId: null });
}
/** A security denial: generic to the caller, durable in the actor's own organization. */
async function deny(tx: SqlConnection, actor: M2Principal, targetType: SecurityAuditTargetType, targetId: string) {
    await audit(tx, actor.user_id, actor.organization_id, 'authorization.denied', 'denied', targetType, targetId);
    return refused('UNAVAILABLE');
}
/** An authorized Admin's attempt that a state check refused, recorded under the attempted action. */
async function fail(tx: SqlConnection, actor: M2Principal, action: SecurityAuditAction, target: [SecurityAuditTargetType, string], code: AdministrationRefusal) {
    await audit(tx, actor.user_id, actor.organization_id, action, 'failure', ...target);
    return refused(code);
}
async function issueOwnerInvitation(tx: SqlConnection, organizationId: string, email: string, issuer: 'OS_BOOTSTRAP' | 'OS_RECOVERY') {
    const id = randomUUID(), code = randomBytes(32).toString('base64url');
    for (const row of (await tx.query<{ id: string }>("UPDATE fingence_m5.invitations SET state='REVOKED' WHERE organization_id=$1 AND email=$2 AND state='PENDING' RETURNING id::text", [organizationId, email])).rows)
        await audit(tx, null, organizationId, 'membership.invitation_revoked', 'success', 'organization_user', row.id);
    const expires = (await tx.query<{ expires_at: unknown }>("INSERT INTO fingence_m5.invitations(id,organization_id,email,role,issuer,token_hash,expires_at) VALUES ($1,$2,$3,'Admin',$4,$5,clock_timestamp()+interval '24 hours') RETURNING expires_at", [id, organizationId, email, issuer, tokenHash(code)])).rows[0].expires_at;
    await audit(tx, null, organizationId, 'membership.invited', 'success', 'organization_user', id);
    return { organizationId, invitationId: id, code, expiresAt: iso(expires) };
}

/** OS-owner only (CLI). Creates an organization whose first Admin becomes active only by redeeming this one-time code. */
export async function bootstrapOrganization(db: TransactionDatabase, input: { name: string; adminEmail: string }) {
    const name = typeof input.name === 'string' ? input.name.trim() : '', email = normalizedEmail(input.adminEmail);
    if (!name || name.length > 120 || !email)
        throw new Error('INVALID_LOCAL_ORGANIZATION');
    const organizationId = randomUUID();
    return db.transaction(async (tx) => {
        await tx.query('INSERT INTO fingence_m2.organizations(id,name) VALUES($1,$2)', [organizationId, name]);
        await tx.query('INSERT INTO fingence_m3.organization_states VALUES($1,true)', [organizationId]);
        return issueOwnerInvitation(tx, organizationId, email, 'OS_BOOTSTRAP');
    });
}
/** OS-owner recovery (CLI), explicitly confirmed with the organization ID and only when no Admin can sign in. */
export async function issueRecoveryAdmin(db: TransactionDatabase, input: { organizationId: string; adminEmail: string; confirmation: string }) {
    const email = normalizedEmail(input.adminEmail);
    if (typeof input.organizationId !== 'string' || !uuid.test(input.organizationId) || !email)
        throw new Error('INVALID_LOCAL_ORGANIZATION');
    if (input.confirmation !== input.organizationId)
        throw new Error('RECOVERY_CONFIRMATION_REQUIRED');
    return db.transaction(async (tx) => {
        await lockOrganization(tx, input.organizationId);
        if (!(await tx.query('SELECT 1 FROM fingence_m3.organization_states WHERE organization_id=$1 AND active FOR SHARE', [input.organizationId])).rows.length)
            throw new Error('ORGANIZATION_UNAVAILABLE');
        if ((await signableAdmins(tx, input.organizationId)).length)
            throw new Error('ACTIVE_ADMIN_PRESENT');
        return issueOwnerInvitation(tx, input.organizationId, email, 'OS_RECOVERY');
    });
}
/** OS-owner lifecycle (CLI). Deactivation also revokes pending enrollment codes in the same transaction. */
export function setOrganizationActive(db: TransactionDatabase, organizationId: string, active: boolean) {
    return setLocalOrganizationActive(db, organizationId, active, async (tx) => {
        if (active)
            return;
        for (const row of (await tx.query<{ id: string }>("UPDATE fingence_m5.invitations SET state='REVOKED' WHERE organization_id=$1 AND state='PENDING' RETURNING id::text", [organizationId])).rows)
            await audit(tx, null, organizationId, 'membership.invitation_revoked', 'success', 'organization_user', row.id);
    });
}

export function createTenantAdministration(db: TransactionDatabase) {
    /**
     * Preflight finds the organization without retaining locks. The mutation then takes the
     * organization lock, re-resolves the actor with exclusive row locks (never upgraded later),
     * and refuses non-Admins with a durable denial. Invalid sessions throw without an audit row.
     */
    async function administer<T>(token: string, target: [SecurityAuditTargetType, string], work: (tx: SqlConnection, actor: M2Principal) => Promise<T | Refused>): Promise<T | Refused> {
        const scope = await db.transaction(tx => resolveM3Principal(tx, token, false));
        return db.transaction(async (tx) => {
            await lockOrganization(tx, scope.organization_id);
            const actor = await resolveM3Principal(tx, token, false, 'NO KEY UPDATE');
            if (actor.organization_id !== scope.organization_id)
                throw new Error('ACCESS_DENIED');
            if (actor.role !== 'Admin')
                return deny(tx, actor, ...target);
            return work(tx, actor);
        });
    }
    return {
        overview: (token: string) => db.transaction(async (tx): Promise<AdministrationOverview | Refused> => {
            const p = await resolveM3Principal(tx, token, false);
            if (p.role === 'Finance')
                return deny(tx, p, 'organization_settings', 'administration');
            const jobs = (await tx.query<{ state: string; count: number }>('SELECT state,count(*)::int AS count FROM fingence_m2.jobs WHERE organization_id=$1 GROUP BY state ORDER BY state', [p.organization_id])).rows;
            const organization = (await tx.query<{ id: string; name: string }>('SELECT id::text,name FROM fingence_m2.organizations WHERE id=$1', [p.organization_id])).rows[0];
            const base = { status: 'OK' as const, scope: { userId: p.user_id, organizationId: p.organization_id, role: p.role, membershipVersion: p.version }, organization, jobs, financialAccess: false as const, organizationLifecycle: 'OS_LOCAL_OWNER_ONLY' as const };
            if (p.role !== 'Admin') {
                await audit(tx, p.user_id, p.organization_id, 'dashboard.read', 'success', 'organization_settings', 'administration');
                return { ...base, view: 'OPERATIONAL', members: null, invitations: null };
            }
            const members = (await tx.query<AdministrationMember>(`SELECT m.user_id::text AS "userId",u.email,m.role,m.active,m.version,
  NOT EXISTS (SELECT 1 FROM fingence_m5.account_suspensions a WHERE a.user_id=m.user_id) AS "accountActive",
  (SELECT count(*)::int FROM fingence_m2.sessions s WHERE s.user_id=m.user_id AND s.organization_id=m.organization_id AND NOT s.revoked AND s.expires_at>clock_timestamp() AND s.membership_version=m.version) AS "activeSessions"
  FROM fingence_m2.memberships m JOIN fingence_m2.users u ON u.id=m.user_id WHERE m.organization_id=$1 ORDER BY u.email`, [p.organization_id])).rows;
            const invitations = (await tx.query<AdministrationInvitation>(`SELECT id::text,email,role,issuer,state,created_at AS "createdAt",expires_at AS "expiresAt",(state='PENDING' AND expires_at<=clock_timestamp()) AS expired
  FROM fingence_m5.invitations WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 50`, [p.organization_id])).rows.map(row => ({ ...row, createdAt: iso(row.createdAt), expiresAt: iso(row.expiresAt) }));
            await audit(tx, p.user_id, p.organization_id, 'dashboard.read', 'success', 'organization_settings', 'administration');
            return { ...base, view: 'ADMIN', members, invitations };
        }),
        auditLog: (token: string) => db.transaction(async (tx): Promise<{ status: 'OK'; events: AdministrationAuditEntry[] } | Refused> => {
            const p = await resolveM3Principal(tx, token, false);
            if (p.role !== 'Admin')
                return deny(tx, p, 'security_log', 'organization-audit');
            // Names resolve only through this organization's memberships/invitations; other tenants stay opaque identifiers.
            const events = (await tx.query<AdministrationAuditEntry>(`SELECT e.occurred_at AS "occurredAt",e.action,e.outcome,e.target_type AS "targetType",e.target_id AS "targetId",au.email AS "actorEmail",COALESCE(tu.email,iv.email) AS "targetEmail"
  FROM public.security_audit_events e
  LEFT JOIN fingence_m2.memberships am ON am.user_id::text=e.actor_id AND am.organization_id=$1
  LEFT JOIN fingence_m2.users au ON au.id=am.user_id
  LEFT JOIN fingence_m2.memberships tm ON tm.user_id::text=e.target_id AND tm.organization_id=$1
  LEFT JOIN fingence_m2.users tu ON tu.id=tm.user_id
  LEFT JOIN fingence_m5.invitations iv ON iv.id::text=e.target_id AND iv.organization_id=$1
  WHERE e.organization_id=$2 ORDER BY e.id DESC LIMIT 100`, [p.organization_id, p.organization_id])).rows.map(row => ({ ...row, occurredAt: iso(row.occurredAt) }));
            await audit(tx, p.user_id, p.organization_id, 'security_logs.read', 'success', 'security_log', 'organization-audit');
            return { status: 'OK', events };
        }),
        invite(token: string, input: { email: unknown; role: unknown }) {
            const email = normalizedEmail(input.email), role = input.role as M2Role;
            if (!email || !applicationRoles.includes(role))
                invalid();
            return administer(token, ['organization_settings', 'enrollment'], async (tx, actor): Promise<{ status: 'INVITED'; invitation: { id: string; email: string; role: M2Role; expiresAt: string }; code: string } | Refused> => {
                if ((await tx.query('SELECT 1 FROM fingence_m2.memberships m JOIN fingence_m2.users u ON u.id=m.user_id WHERE m.organization_id=$1 AND u.email=$2', [actor.organization_id, email])).rows.length)
                    return fail(tx, actor, 'membership.invited', ['organization_settings', 'enrollment'], 'ALREADY_MEMBER');
                for (const row of (await tx.query<{ id: string }>("UPDATE fingence_m5.invitations SET state='REVOKED' WHERE organization_id=$1 AND email=$2 AND state='PENDING' RETURNING id::text", [actor.organization_id, email])).rows)
                    await audit(tx, actor.user_id, actor.organization_id, 'membership.invitation_revoked', 'success', 'organization_user', row.id);
                const id = randomUUID(), code = randomBytes(32).toString('base64url');
                const expires = (await tx.query<{ expires_at: unknown }>("INSERT INTO fingence_m5.invitations(id,organization_id,email,role,issuer,created_by,token_hash,expires_at) VALUES ($1,$2,$3,$4,'ADMIN',$5,$6,clock_timestamp()+interval '24 hours') RETURNING expires_at", [id, actor.organization_id, email, role, actor.user_id, tokenHash(code)])).rows[0].expires_at;
                await audit(tx, actor.user_id, actor.organization_id, 'membership.invited', 'success', 'organization_user', id);
                return { status: 'INVITED', invitation: { id, email, role, expiresAt: iso(expires) }, code };
            });
        },
        revokeInvitation(token: string, invitationId: unknown) {
            if (typeof invitationId !== 'string' || !uuid.test(invitationId))
                invalid();
            return administer(token, ['organization_user', invitationId], async (tx, actor): Promise<{ status: 'REVOKED' } | Refused> => {
                const row = (await tx.query<{ state: string }>('SELECT state FROM fingence_m5.invitations WHERE id=$1 AND organization_id=$2 FOR UPDATE', [invitationId, actor.organization_id])).rows[0];
                if (!row)
                    return deny(tx, actor, 'organization_user', invitationId);
                if (row.state !== 'PENDING')
                    return fail(tx, actor, 'membership.invitation_revoked', ['organization_user', invitationId], 'STALE_INVITATION');
                await tx.query("UPDATE fingence_m5.invitations SET state='REVOKED' WHERE id=$1", [invitationId]);
                await audit(tx, actor.user_id, actor.organization_id, 'membership.invitation_revoked', 'success', 'organization_user', invitationId);
                return { status: 'REVOKED' };
            });
        },
        changeMembership(token: string, input: { userId: unknown; role: unknown; active: unknown; expectedVersion: unknown }) {
            const { userId, role, active, expectedVersion } = input;
            if (typeof userId !== 'string' || !uuid.test(userId) || !applicationRoles.includes(role as M2Role) || typeof active !== 'boolean' || typeof expectedVersion !== 'number' || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
                invalid();
            return administer(token, ['organization_user', userId], async (tx, actor): Promise<{ status: 'UPDATED'; sessionsRevoked: true } | Refused> => {
                const outcome = await applyMembershipChange(tx, actor, { userId, role: role as M2Role, active, expectedVersion }, false);
                if (outcome.status === 'REFUSED')
                    return outcome.code === 'STALE_MEMBERSHIP' || outcome.code === 'LAST_ADMIN_PROTECTED' ? fail(tx, actor, 'authorization.role_changed', ['organization_user', userId], outcome.code) : deny(tx, actor, 'organization_user', userId);
                const actions: SecurityAuditAction[] = [];
                if (outcome.previous.role !== outcome.next.role)
                    actions.push('authorization.role_changed');
                if (outcome.previous.active !== outcome.next.active)
                    actions.push(outcome.next.active ? 'membership.activated' : 'membership.deactivated');
                for (const action of actions.length ? actions : ['session.revoked' as const])
                    await audit(tx, actor.user_id, actor.organization_id, action, 'success', 'organization_user', userId);
                return { status: 'UPDATED', sessionsRevoked: true };
            });
        },
        revokeSessions(token: string, userId: unknown) {
            if (typeof userId !== 'string' || !uuid.test(userId))
                invalid();
            return administer(token, ['organization_user', userId], async (tx, actor): Promise<{ status: 'UPDATED'; sessionsRevoked: true } | Refused> => {
                if ((await applyMembershipChange(tx, actor, { userId }, true)).status === 'REFUSED')
                    return deny(tx, actor, 'organization_user', userId);
                await audit(tx, actor.user_id, actor.organization_id, 'session.revoked', 'success', 'organization_user', userId);
                return { status: 'UPDATED', sessionsRevoked: true };
            });
        },
        /** Account (sign-in) state, separate from membership. Only for accounts wholly owned by this organization. */
        setAccountActive(token: string, input: { userId: unknown; active: unknown }) {
            const { userId, active } = input;
            if (typeof userId !== 'string' || !uuid.test(userId) || typeof active !== 'boolean')
                invalid();
            return administer(token, ['organization_user', userId], async (tx, actor): Promise<{ status: 'UPDATED'; sessionsRevoked: boolean } | Refused> => {
                const org = actor.organization_id, action = active ? 'account.reactivated' : 'account.deactivated';
                // Unlocked probe first: rows of a user outside this organization are never locked.
                if (!(await tx.query('SELECT 1 FROM fingence_m2.memberships WHERE user_id=$1 AND organization_id=$2', [userId, org])).rows.length)
                    return deny(tx, actor, 'organization_user', userId);
                // Identity read order: sessions, memberships, then account state.
                await tx.query('SELECT token_hash FROM fingence_m2.sessions WHERE user_id=$1 FOR UPDATE', [userId]);
                const memberships = (await tx.query<{ organization_id: string }>('SELECT organization_id::text FROM fingence_m2.memberships WHERE user_id=$1 FOR UPDATE', [userId])).rows;
                if (!memberships.length || memberships.some(m => m.organization_id !== org))
                    return deny(tx, actor, 'organization_user', userId);
                const suspended = (await tx.query('SELECT 1 FROM fingence_m5.account_suspensions WHERE user_id=$1 FOR UPDATE', [userId])).rows.length > 0;
                if (suspended !== active)
                    return fail(tx, actor, action, ['organization_user', userId], 'STALE_ACCOUNT');
                if (!active) {
                    const admins = await signableAdmins(tx, org);
                    if (admins.includes(userId) && admins.length <= 1)
                        return fail(tx, actor, action, ['organization_user', userId], 'LAST_ADMIN_PROTECTED');
                    await tx.query('INSERT INTO fingence_m5.account_suspensions(user_id,suspended_by) VALUES ($1,$2)', [userId, actor.user_id]);
                    await tx.query('UPDATE fingence_m2.sessions SET revoked=true WHERE user_id=$1', [userId]);
                }
                else
                    // Reactivation restores sign-in only; sessions and membership state are never reinstated.
                    await tx.query('DELETE FROM fingence_m5.account_suspensions WHERE user_id=$1', [userId]);
                await audit(tx, actor.user_id, org, action, 'success', 'organization_user', userId);
                return { status: 'UPDATED', sessionsRevoked: !active };
            });
        },
        /**
         * Unauthenticated redemption. Organization, email and role come from the invitation, never the
         * browser. Admin-issued codes create an inactive membership; only OS-owner codes activate an Admin.
         * Every failure is the same generic refusal. No session is created.
         */
        async enroll(input: { code: unknown; email: unknown; password: unknown }): Promise<{ status: 'ENROLLED'; membershipActive: boolean } | Refused> {
            if (typeof input.password !== 'string' || input.password.length < 12 || input.password.length > 128)
                return refused('PASSWORD_POLICY');
            const email = normalizedEmail(input.email);
            if (typeof input.code !== 'string' || !codeFormat.test(input.code) || !email)
                return refused('INVITATION_UNAVAILABLE');
            const passwordHash = await hashLocalPassword(input.password), hash = tokenHash(input.code);
            const organizationId = (await db.transaction(tx => tx.query<{ organization_id: string }>('SELECT organization_id::text FROM fingence_m5.invitations WHERE token_hash=$1', [hash]))).rows[0]?.organization_id;
            // An unknown code cannot be attributed to an organization; it is refused without an audit row.
            if (!organizationId)
                return refused('INVITATION_UNAVAILABLE');
            return db.transaction(async (tx) => {
                await lockOrganization(tx, organizationId);
                await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('fingence-m5-email:'||$1,0))", [email]);
                const invitation = (await tx.query<{ id: string; email: string; role: M2Role; issuer: string; state: string; current: boolean }>('SELECT id::text,email,role,issuer,state,expires_at>clock_timestamp() AS current FROM fingence_m5.invitations WHERE token_hash=$1 AND organization_id=$2 FOR UPDATE', [hash, organizationId])).rows[0];
                const organizationActive = (await tx.query('SELECT 1 FROM fingence_m3.organization_states WHERE organization_id=$1 AND active FOR SHARE', [organizationId])).rows.length > 0;
                const accountExists = (await tx.query('SELECT 1 FROM fingence_m2.users WHERE email=$1', [email])).rows.length > 0;
                if (!invitation || invitation.state !== 'PENDING' || !invitation.current || invitation.email !== email || !organizationActive || accountExists) {
                    await audit(tx, null, organizationId, 'authorization.denied', 'denied', 'organization_settings', 'enrollment');
                    return refused('INVITATION_UNAVAILABLE');
                }
                const userId = randomUUID(), active = invitation.issuer !== 'ADMIN';
                await tx.query('INSERT INTO fingence_m2.users VALUES($1,$2,$3)', [userId, email, passwordHash]);
                await tx.query('INSERT INTO fingence_m2.memberships(user_id,organization_id,role,active) VALUES($1,$2,$3,$4)', [userId, organizationId, invitation.role, active]);
                await tx.query("UPDATE fingence_m5.invitations SET state='ACCEPTED',accepted_user_id=$2 WHERE id=$1", [invitation.id, userId]);
                await audit(tx, userId, organizationId, 'membership.enrolled', 'success', 'organization_user', userId);
                if (active)
                    await audit(tx, null, organizationId, 'membership.activated', 'success', 'organization_user', userId);
                return { status: 'ENROLLED', membershipActive: active };
            });
        },
    };
}
export type TenantAdministration = ReturnType<typeof createTenantAdministration>;
