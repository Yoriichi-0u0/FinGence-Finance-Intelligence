// Node-only isolated worker. No downloads, installation, remote inference or dataset access.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const [runtimeRoot,modelRoot]=process.argv.slice(2);
const expected=JSON.parse(fs.readFileSync(new URL('./model-config.json',import.meta.url),'utf8'));
let extractor;
async function digest(file){const hash=createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);return hash.digest('hex');}
process.on('message',async message=>{
 try{
  let value;
  if(message.op==='initialize'){
   const pkg=JSON.parse(fs.readFileSync(path.join(runtimeRoot,'node_modules/@huggingface/transformers/package.json'),'utf8'));
   if(pkg.version!==expected.libraryVersion)throw new Error('Inference library version mismatch');
   for(const [file,hash] of Object.entries(expected.filesSHA256)){if(await digest(path.join(modelRoot,file))!==hash)throw new Error('Pinned model file checksum mismatch: '+file);}
   const tokenizerConfig=JSON.parse(fs.readFileSync(path.join(modelRoot,'tokenizer_config.json'),'utf8'));
   if(tokenizerConfig.model_max_length!==512)throw new Error('Tokenizer maximum length mismatch');
   const {env,pipeline}=await import(pathToFileURL(path.join(runtimeRoot,'node_modules/@huggingface/transformers',pkg.exports.node.import.default)).href);
   globalThis.fetch=async()=>{throw new Error('Offline worker: network access denied');};
   env.allowRemoteModels=false;env.allowLocalModels=true;
   extractor=await pipeline('feature-extraction',modelRoot,{dtype:'fp32',device:'cpu',local_files_only:true,session_options:{intraOpNumThreads:1,interOpNumThreads:1,executionMode:'sequential'}});
   value={modelRepository:expected.modelRepository,revision:expected.revision,tokenizerRevision:expected.tokenizerRevision,library:expected.library,libraryVersion:pkg.version,precision:'fp32',provider:'cpu',dimension:384,pooling:'attention-mask-aware mean',normalization:'L2',maxTokens:512,offline:true,node:process.version,platform:process.platform,arch:process.arch,weightSHA256:expected.weightSHA256,tokenizerSHA256:expected.tokenizerSHA256};
  }else if(message.op==='embed'){
   if(!extractor||!Array.isArray(message.texts)||message.texts.length>32||message.texts.some(t=>typeof t!=='string'||!t.startsWith('query: ')||t.length>2048))throw new Error('Invalid worker input');
   const tokenCounts=[];
   for(const text of message.texts){const tokens=await extractor.tokenizer(text,{truncation:false,padding:false});tokenCounts.push(Number(tokens.input_ids.dims.at(-1)));}
   // Pinned v4 feature-extraction pipeline uses tokenizer's verified 512-token limit.
   const tensor=await extractor(message.texts,{pooling:'mean',normalize:true});
   value={vectors:tensor.tolist(),tokenCounts,rssBytes:process.memoryUsage().rss};
  }else if(message.op==='dispose'){await extractor?.dispose();extractor=undefined;value={disposed:true};}
  else throw new Error('Unknown worker operation');
  process.send?.({ok:true,value});
 }catch(error){process.send?.({ok:false,error:error instanceof Error?error.message:'Worker failure'});}
});
process.on('disconnect',()=>process.exit(0));
