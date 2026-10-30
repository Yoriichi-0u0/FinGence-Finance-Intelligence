import 'server-only';
/** One local session cookie per stacked launcher: cookies are host-scoped, not port-scoped. Read at module load. */
export function localSessionCookieName(financialConsumers = false) {
    if (process.env.FINGENCE_M5_LOCAL === '1')
        return 'fingence_m5_session';
    if (process.env.FINGENCE_M4_LOCAL === '1')
        return 'fingence_m4_session';
    return financialConsumers || process.env.FINGENCE_M3_LOCAL === '1' ? 'fingence_m3_session' : 'fingence_m2_session';
}
