import { fork, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Provider } from "./types";
/** Dedicated killable CPU worker. Loading never installs a package or downloads weights. */
export class LocalE5Provider implements Provider {
  readonly kind = "PRETRAINED_E5" as const;
  private child?: ChildProcess;
  private pending?: { resolve:(v: unknown)=>void; reject:(e:Error)=>void };
  private stopped=false;
  constructor(private readonly runtimeRoot:string,private readonly modelRoot:string){}
  private request(message:object):Promise<unknown>{
    if(!this.child || this.stopped || this.pending) return Promise.reject(new Error("Model worker unavailable/busy"));
    return new Promise((resolve,reject)=>{this.pending={resolve,reject};this.child!.send(message,error=>{if(error){this.pending=undefined;reject(new Error("Model worker transport failed"));}});});
  }
  async initialize():Promise<Record<string,unknown>>{
    if(this.child || this.stopped)throw new Error("Model provider already initialized/closed");
    if(!existsSync(resolve(this.runtimeRoot,"node_modules/@huggingface/transformers/package.json"))||!existsSync(resolve(this.modelRoot,"onnx/model.onnx")))throw new Error("BLOCKED: approved runtime/model not installed locally");
    const workerOptions={execArgv:["--max-old-space-size=2048"],silent:true,windowsHide:true};
    this.child=fork(fileURLToPath(new URL("./model-worker.mjs",import.meta.url)),[resolve(this.runtimeRoot),resolve(this.modelRoot)],workerOptions);
    this.child.on("message",(message:unknown)=>{if(!this.pending)return;const pending=this.pending;this.pending=undefined;const m=message as {ok?:boolean;value?:unknown;error?:string};if(m.ok)pending.resolve(m.value);else pending.reject(new Error(m.error??"Model worker failure"));});
    this.child.on("error",()=>this.terminate());this.child.on("exit",()=>{this.stopped=true;this.pending?.reject(new Error("Model worker exited"));this.pending=undefined;});
    // Drain bounded diagnostics without logging input text or growing an output buffer.
    this.child.stdout?.resume();this.child.stderr?.resume();
    return await this.request({op:"initialize"}) as Record<string,unknown>;
  }
  async embed(texts:readonly string[]){return await this.request({op:"embed",texts}) as {vectors:number[][];tokenCounts:number[];rssBytes:number};}
  terminate():void{this.stopped=true;this.pending?.reject(new Error("Model worker terminated"));this.pending=undefined;this.child?.kill();}
  async dispose():Promise<void>{if(!this.stopped&&this.child){try{await this.request({op:"dispose"});}finally{this.terminate();}}}
}
