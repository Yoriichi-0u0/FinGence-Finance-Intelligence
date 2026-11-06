import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {readFileSync} from 'node:fs';
import {normalizeCashSource} from '../../lib/server/poc-reconciliation/normalize';
import {digest} from '../../lib/server/reconciliation/processing';
import {adaptTrustedIngestion,createTrustedIngestionService,TRUSTED_INGESTION_VERSION} from '../../lib/server/reconciliation/trusted-ingestion';
function fixture(){
 const bank={bytes:readFileSync(new URL('./fixtures/bank.csv',import.meta.url)),filename:'bank.csv'},ledger={bytes:readFileSync(new URL('./fixtures/ledger.csv',import.meta.url)),filename:'ledger.csv'};
 return {registry:{bank:digest(bank.bytes),ledger:digest(ledger.bytes)},input:{version:TRUSTED_INGESTION_VERSION,contract:'cash-source-v1' as const,documents:[{document:bank,verified:normalizeCashSource(bank.bytes,'bank',bank.filename)},{document:ledger,verified:normalizeCashSource(ledger.bytes,'ledger',ledger.filename)}]}};
}
it('accepts verified cash output only with exact registered bytes and original row provenance',()=>{
 const f=fixture(),r=adaptTrustedIngestion(f.input,f.registry);expect(r.supported).toBe(true);if(r.supported){expect(digest(r.bank.bytes)).toBe(f.registry.bank);expect(r.bank.bytes).not.toBe(f.input.documents[0].document.bytes);}
});
it.each(['sha256','sourceId','filename'])('rejects missing or changed %s evidence',field=>{
 const f=fixture();(f.input.documents[0].verified as unknown as Record<string,unknown>)[field]='';expect(adaptTrustedIngestion(f.input,f.registry)).toMatchObject({supported:false,reason:'INVALID_SOURCE_PROVENANCE'});
});
it.each(['signedCents','recordId','date','row'])('rejects invented canonical %s',field=>{
 const f=fixture();(f.input.documents[0].verified.rows[0] as unknown as Record<string,unknown>)[field]='forged';expect(adaptTrustedIngestion(f.input,f.registry).supported).toBe(false);
});
it('rejects conflicting roles and unregistered raw content',()=>{
 const f=fixture();f.input.documents[0].verified.kind='ledger';expect(adaptTrustedIngestion(f.input,f.registry)).toMatchObject({reason:'CONFLICTING_SOURCE_CLASSIFICATION'});
 const g=fixture();g.input.documents[0].document.bytes=Buffer.from('unsupported');expect(adaptTrustedIngestion(g.input,g.registry)).toMatchObject({supported:false});
});
it('never infers a role from a filename and rejects duplicate source roles',()=>{
 const f=fixture();f.input.documents[0].document.filename='ledger.csv';f.input.documents[0].verified.filename='ledger.csv';expect(adaptTrustedIngestion(f.input,f.registry).supported).toBe(true);
 const duplicate=fixture();duplicate.input.documents[1]=duplicate.input.documents[0];expect(adaptTrustedIngestion(duplicate.input,duplicate.registry)).toMatchObject({supported:false,reason:'CONFLICTING_SOURCE_CLASSIFICATION'});
});
it('rejects individually valid documents whose financial scopes conflict',()=>{
 const f=fixture();const document=f.input.documents[0].document;
 document.bytes=Buffer.from(document.bytes.toString().replaceAll('BUS-001','BUS-002'));
 f.registry.bank=digest(document.bytes);f.input.documents[0].verified=normalizeCashSource(document.bytes,'bank',document.filename);
 expect(adaptTrustedIngestion(f.input,f.registry)).toMatchObject({supported:false,reason:'INVALID_SOURCE_PROVENANCE'});
});
it.each(['VALID','WARNING','REJECTED'])('does not cast C1 %s labels or V2 acceptance into trusted roles',async status=>{
 const transaction=vi.fn();const service=createTrustedIngestionService({transaction,close:async()=>{}});
 expect(await service.process('not-used',{schema_version:'0.1',ruleset_version:'0.1',datasets:[{source_system:'BANK',normalized:[{ingestion_status:status}]}]})).toMatchObject({supported:false,reason:'UNSUPPORTED_CONTRACT_OR_CLASSIFICATION'});
 expect(await service.process('not-used',{version:'v2-verification-0.2',accepted:[{status}]})).toMatchObject({supported:false});expect(transaction).not.toHaveBeenCalled();
});
