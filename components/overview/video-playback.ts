export type VideoPhase = 'preview' | 'loading' | 'playing' | 'paused' | 'error';
type Media = Pick<HTMLVideoElement,'play'|'pause'|'load'|'focus'|'currentTime'>;
/** UI-only media lifecycle; no processing or financial state. */
export function createVideoPlayback(getMedia:()=>Media|null,changed:(phase:VideoPhase)=>void) {
 let phase:VideoPhase='preview',attempt=0;
 const set=(next:VideoPhase)=>{phase=next;changed(next);};
 return {
  async start() {
   const media=getMedia();if(!media)return;
   const current=++attempt,retry=phase==='error';set('loading');
   try {if(retry)media.load();media.currentTime=0;await media.play();if(current!==attempt)return;set('playing');media.focus();}
   catch {if(current===attempt)set('error');}
  },
  playing(){if(phase!=='preview'&&phase!=='error')set('playing');},
  waiting(){if(phase==='playing')set('loading');},
  paused(){if(phase==='playing'||phase==='loading')set('paused');},
  fail(){attempt++;set('error');getMedia()?.pause();},
  ended(){attempt++;set('preview');const media=getMedia();if(media){media.pause();media.currentTime=0;media.load();}},
 };
}
