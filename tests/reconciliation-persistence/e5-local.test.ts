import {it,expect} from 'vitest';
import {resolve} from 'node:path';
import {LocalE5Provider} from '../../lib/server/reconciliation/ai03/model-loader';
it.skipIf(process.env.DB04_E5_SMOKE!=='1')('executes pinned offline E5 without financial acceptance or frozen evaluation',async()=>{
 const provider=new LocalE5Provider(resolve('../ai03-runtime'),resolve('../ai03-models/761b726dd34fb83930e26aab4e9ac3899aa1fa78'));
 try {
  const metadata=await provider.initialize();expect(metadata.offline).toBe(true);
  const result=await provider.embed(['query: Synthetic cash settlement','query: Synthetic cash settlement']);
  expect(result.vectors).toHaveLength(2);expect(result.vectors[0]).toHaveLength(384);
  expect(result.vectors[0].every(Number.isFinite)).toBe(true);
  expect(result.vectors[0]).toEqual(result.vectors[1]);
 }finally{await provider.dispose();}
},120000);
