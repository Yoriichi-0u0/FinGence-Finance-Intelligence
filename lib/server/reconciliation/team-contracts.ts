import 'server-only';

/** Trusted server composition dependency owned by the security integration.
 * This interface does not authenticate a request or create an identity.
 * Implementations must validate identity/session lifecycle, active Finance
 * membership and organization state, then issue a short-lived DB-recognized
 * capability for exactly that principal. Revoke/close it after the operation.
 * The financial runtime must not have capability-issuance privileges.
 * Never obtain organization, role or ownership from request-supplied claims.
 */
export interface FinanceAdmission<IdentityContext> {
    withFinance<T>(identity: IdentityContext, operation: (databaseCapability: string) => Promise<T>): Promise<T>;
}

/** The current financial service expects a 43-character base64url capability,
 * hashed transaction-locally and validated by the approved database principal
 * function. This is a required DB interface, not a JWT/session implementation.
 * A different team authority must adapt that boundary with reviewed RLS tests.
 */
export const TEAM_INTEGRATION_CONTRACT = {
    version: 'db04-team-boundary/1',
    identity: 'TRUSTED_SERVER_FINANCE_ADMISSION_REQUIRED',
    ingestion: 'db04-trusted-ingestion/1',
    read: 'db04-backend-read/1',
    productionEnabled: false,
} as const;
