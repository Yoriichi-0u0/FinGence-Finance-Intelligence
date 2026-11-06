'use client';
import { useEffect, useRef, useState } from 'react';
import { createVideoPlayback, type VideoPhase } from './video-playback';
import { LoaderCircle, Play, RotateCcw } from 'lucide-react';
export function DemoVideo() {
 const video=useRef<HTMLVideoElement>(null);
 const [phase,setPhase]=useState<VideoPhase>('preview');
 const playback=useRef<ReturnType<typeof createVideoPlayback>|null>(null);
 useEffect(()=>{playback.current=createVideoPlayback(()=>video.current,setPhase);},[]);
 const started=phase!=='preview',loading=phase==='loading',error=phase==='error';
 return <div className="fg-video fg-cinema" aria-label="FinGence project demonstration player">
 <video ref={video} controls={started&&!error} preload="none" playsInline poster="/media/fingence-demo-poster.png" tabIndex={started?0:-1} aria-label="FinGence 2.0 project demonstration" onPlaying={()=>playback.current?.playing()} onWaiting={()=>playback.current?.waiting()} onPause={()=>playback.current?.paused()} onEnded={()=>playback.current?.ended()} onError={()=>playback.current?.fail()}><source src="/media/fingence-demo.mp4" type="video/mp4" onError={()=>playback.current?.fail()}/>Your browser does not support video playback.</video>
 {!started&&!error&&<div className="fg-video-preview"><div className="fg-video-caption"><span>FinGence 2.0 Demo <span>· 1:59.8</span></span><h3>Watch FinGence in Action</h3><p>Financial Processing · Reconciliation · Insights</p><small>Recorded product demonstration · fictional sample data</small></div><button type="button" className="fg-video-play" aria-label="Play FinGence demonstration" onClick={()=>void playback.current?.start()}><Play size={32} fill="currentColor" aria-hidden="true"/></button></div>}
 {loading&&!error&&<div className="fg-video-loading" role="status"><LoaderCircle size={22} className="animate-spin" aria-hidden="true"/>Loading demonstration…</div>}
 {error&&<div className="fg-video-error" role="alert"><h3>Unable to play the demonstration</h3><p>Please try again. You can still explore FinGence through Sign Up or Data.</p><button type="button" className="ov-button" onClick={()=>void playback.current?.start()}><RotateCcw size={16} aria-hidden="true"/>Retry video</button></div>}
 </div>;
}
