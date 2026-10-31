import { performance } from "node:perf_hooks";
import { normalized } from "./text-features";
import { DEFAULT_OPTIONS, type EmbeddingOptions, type Provider } from "./types";
export class Embeddings {
  private cache = new Map<string, { vector: number[]; tokens: number }>();
  private ready = false; private closed = false; private busy = false;
  metadata: Record<string, unknown> = {};
  readonly stats = { initializationMs: 0, inferenceMs: 0, modelCalls: 0, cacheHits: 0, cacheMisses: 0, evictions: 0, truncatedUniqueTexts: 0, peakWorkerRssBytes: 0 };
  readonly options: EmbeddingOptions;
  constructor(readonly provider: Provider, options = DEFAULT_OPTIONS) {
    if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 32 || !Number.isInteger(options.cacheEntries) || options.cacheEntries < 1 || options.cacheEntries > 2048 || !Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 300000) throw new Error("Invalid embedding bounds");
    this.options = {...options};
  }
  private async deadline<T>(work: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([work(), new Promise<never>((_,reject) => { timer=setTimeout(()=>{this.closed=true;this.cache.clear();this.provider.terminate();reject(new Error("Embedding deadline exceeded; worker terminated"));},this.options.timeoutMs); })]); }
    finally { clearTimeout(timer); }
  }
  async encode(texts: readonly string[]): Promise<{ vectors: number[][]; tokenCounts: number[] }> {
    if (this.closed || this.busy) throw new Error("Embedding service closed or busy");
    if (texts.length > 1000 || texts.some(t => typeof t !== "string" || !t.startsWith("query: ") || t.length <= 7 || t.length > 2048 || t.includes("\0"))) throw new Error("Invalid approved text batch");
    this.busy=true;
    try {
      if (!this.ready) { const start=performance.now();this.metadata=await this.deadline(()=>this.provider.initialize());this.stats.initializationMs=performance.now()-start;this.ready=true; }
      const unique=[...new Set(texts)], resolved=new Map<string,{vector:number[];tokens:number}>();
      for(const t of unique){const old=this.cache.get(t);if(old){this.stats.cacheHits++;this.cache.delete(t);this.cache.set(t,old);resolved.set(t,old);}else this.stats.cacheMisses++;}
      const missing=unique.filter(t=>!resolved.has(t));
      for(let i=0;i<missing.length;i+=this.options.batchSize){
        const batch=missing.slice(i,i+this.options.batchSize),start=performance.now();
        const result=await this.deadline(()=>this.provider.embed(batch));this.stats.inferenceMs+=performance.now()-start;this.stats.modelCalls++;
        if(result.vectors.length!==batch.length || result.tokenCounts.length!==batch.length || result.tokenCounts.some(n=>!Number.isInteger(n)||n<1)) throw new Error("Invalid model batch output");
        this.stats.peakWorkerRssBytes=Math.max(this.stats.peakWorkerRssBytes,result.rssBytes??0);
        batch.forEach((text,n)=>{const item={vector:normalized(result.vectors[n]),tokens:result.tokenCounts[n]};resolved.set(text,item);this.cache.set(text,item);if(item.tokens>512)this.stats.truncatedUniqueTexts++;while(this.cache.size>this.options.cacheEntries){this.cache.delete(this.cache.keys().next().value!);this.stats.evictions++;}});
      }
      return {vectors:texts.map(t=>[...resolved.get(t)!.vector]),tokenCounts:texts.map(t=>resolved.get(t)!.tokens)};
    } catch(error){this.closed=true;this.cache.clear();this.provider.terminate();throw error;} finally {this.busy=false;}
  }
  async close(): Promise<void> { this.closed=true;this.cache.clear();try{await this.deadline(()=>this.provider.dispose());}finally{this.provider.terminate();} }
}
