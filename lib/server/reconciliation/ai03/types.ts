/** Compatible inference boundary only; no research cohort/date-policy casts. */
export interface Provider {
 kind:'PRETRAINED_E5'|'UNIT_TEST_ONLY';
 initialize():Promise<Record<string,unknown>>;
 embed(texts:readonly string[]):Promise<{vectors:number[][];tokenCounts:number[];rssBytes?:number}>;
 terminate():void;dispose():Promise<void>;
}
