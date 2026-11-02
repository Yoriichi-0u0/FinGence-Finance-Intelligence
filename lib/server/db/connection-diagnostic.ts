import 'server-only';
export type ConnectionStage='RUNTIME_CONFIGURATION'|'BROKER_CONFIGURATION'|'RUNTIME_POOL_ACQUISITION_AUTHENTICATION'|'BROKER_POOL_ACQUISITION_AUTHENTICATION'|'RUNTIME_FIRST_QUERY'|'BROKER_FIRST_QUERY'|'RUNTIME_CATALOG'|'BROKER_CATALOG';
/** Operator-only classification. Never serialize messages, URLs, causes or stacks. */
export function safeConnectionFailure(stage:ConnectionStage,error:unknown){
 const raw=error&&typeof error==='object'&&'code' in error?error.code:undefined;
 const network=['ECONNREFUSED','ECONNRESET','ETIMEDOUT','ENETUNREACH','ENOTFOUND','CERT_HAS_EXPIRED','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_VERIFY_LEAF_SIGNATURE'];
 const code=typeof raw==='string'&&(/^[0-9A-Z]{5}$/.test(raw)||network.includes(raw))?raw:'UNCLASSIFIED';
 const category=code==='28P01'?'AUTHENTICATION_REJECTED':code==='53300'?'CONNECTION_LIMIT':code==='42501'?'PERMISSION_DENIED':network.includes(code)?'NETWORK_OR_TLS':'UNCLASSIFIED_FAILURE';
 return {stage,code,category};
}
