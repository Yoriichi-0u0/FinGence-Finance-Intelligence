import 'server-only';
import type { PoolConfig } from 'pg';
export interface ApprovedDevelopmentTarget {
    projectRef: string;
    productionProjectRef: string;
    isolation: 'ISOLATED_BRANCH' | 'SEPARATE_PROJECT';
    approvalReference: string;
    database: string;
    runtimeRole: string;
}
/** Trusted operator configuration only; never accepts approval from an HTTP request.
 * Direct targets only. Pooler support requires independent role/project binding.
 * This guard validates configuration; it does not prove catalog or identity compatibility.
 */
export function assertHostedDevelopmentTarget(config: PoolConfig, target: ApprovedDevelopmentTarget) {
    if (!target || !/^[a-z0-9]{20}$/.test(target.projectRef)
        || !/^[a-z0-9]{20}$/.test(target.productionProjectRef)
        || target.projectRef === target.productionProjectRef
        || !['ISOLATED_BRANCH', 'SEPARATE_PROJECT'].includes(target.isolation)
        || !target.approvalReference?.trim()
        || !target.runtimeRole || ['postgres', 'supabase_admin', 'service_role'].includes(target.runtimeRole)
        || config.host !== `db.${target.projectRef}.supabase.co`
        || config.port !== 5432 || config.database !== target.database
        || config.user !== target.runtimeRole
        || typeof config.ssl !== 'object' || config.ssl === null
        || config.ssl.rejectUnauthorized !== true) throw Error('APPROVED_ISOLATED_TARGET_REQUIRED');
}
