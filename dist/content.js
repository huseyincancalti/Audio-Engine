var k=Object.defineProperty;var C=(t,e,n)=>e in t?k(t,e,{enumerable:!0,configurable:!0,writable:!0,value:n}):t[e]=n;var l=(t,e,n)=>C(t,typeof e!="symbol"?e+"":e,n);import{D as p,E as u,M as h}from"./chunks/index.js";const T=Object.freeze([32,64,125,250,500,1e3,2e3,4e3,8e3,16e3]);class I{constructor(e){l(this,"ctx");l(this,"nodes");l(this,"isEqConnected",!1);l(this,"isPannerConnected",!1);l(this,"watchdogId",null);this.ctx=new AudioContext;const n=this.ctx.createMediaElementSource(e),o=T.map((r,a)=>{const c=this.ctx.createBiquadFilter();return a===0?c.type="lowshelf":a===T.length-1?c.type="highshelf":c.type="peaking",c.frequency.value=r,c.Q.value=1.41,c.gain.value=0,c}),s=this.ctx.createStereoPanner();s.pan.value=0;const i=this.ctx.createGain();i.gain.value=p.volume,this.nodes={source:n,eqFilters:o,panner:s,gain:i},this.rebuildPipeline(p),this.startWatchdog()}rebuildPipeline(e){const{source:n,eqFilters:o,panner:s,gain:i}=this.nodes;this.disconnectAll();const r=this.ctx.destination;if(e.isEqEnabled&&!e.isMono){n.connect(o[0]);for(let a=0;a<o.length-1;a++)o[a].connect(o[a+1]);o[o.length-1].connect(i),i.connect(r),this.isEqConnected=!0,this.isPannerConnected=!1}else if(e.isEqEnabled&&e.isMono){n.connect(o[0]);for(let a=0;a<o.length-1;a++)o[a].connect(o[a+1]);o[o.length-1].connect(s),s.connect(i),i.connect(r),this.isEqConnected=!0,this.isPannerConnected=!0}else!e.isEqEnabled&&e.isMono?(n.connect(s),s.connect(i),i.connect(r),this.isEqConnected=!1,this.isPannerConnected=!0):(n.connect(i),i.connect(r),this.isEqConnected=!1,this.isPannerConnected=!1)}disconnectAll(){const{source:e,eqFilters:n,panner:o,gain:s}=this.nodes;try{e.disconnect()}catch{}for(const i of n)try{i.disconnect()}catch{}try{o.disconnect()}catch{}try{s.disconnect()}catch{}}applySettings(e){this.nodes.gain.gain.setTargetAtTime(e.volume,this.ctx.currentTime,.01),e.isEqEnabled&&e.eqBands.forEach((o,s)=>{const i=this.nodes.eqFilters[s];i&&i.gain.setTargetAtTime(o,this.ctx.currentTime,.01)}),e.isMono&&this.nodes.panner.pan.setTargetAtTime(0,this.ctx.currentTime,.01),(e.isEqEnabled!==this.isEqConnected||e.isMono!==this.isPannerConnected)&&this.rebuildPipeline(e)}setVolume(e){this.nodes.gain.gain.setTargetAtTime(e,this.ctx.currentTime,.01)}setEqBand(e,n){const o=this.nodes.eqFilters[e];if(!o)throw new RangeError(`[AudioEngine] Invalid band index: ${e}`);o.gain.setTargetAtTime(n,this.ctx.currentTime,.01)}autoResume(){this.ctx.state==="suspended"&&this.ctx.resume().catch(e=>{console.warn("[AudioEngine] autoResume failed:",e)})}startWatchdog(){this.watchdogId===null&&(this.watchdogId=setInterval(()=>{if(this.ctx.state==="closed"){this.stopWatchdog();return}this.ctx.state==="suspended"?this.autoResume():this.ctx.state==="running"&&this.stopWatchdog()},500))}stopWatchdog(){this.watchdogId!==null&&(clearInterval(this.watchdogId),this.watchdogId=null)}get state(){return this.ctx.state}get sampleRate(){return this.ctx.sampleRate}destroy(){this.stopWatchdog(),this.disconnectAll(),this.ctx.close().catch(e=>{console.warn("[AudioEngine] Error closing AudioContext:",e)})}}const d=new WeakMap;let b={...p},w=!1;function m(t){if(!d.has(t))try{const e=new I(t);e.applySettings(b),d.set(t,e),console.debug("[Content] AudioEngine attached to",t.tagName,t.src||t.currentSrc)}catch(e){console.debug("[Content] Skipping DRM-protected element:",e.message)}}function y(t){const e=d.get(t);e&&(e.destroy(),d.delete(t))}function S(){document.querySelectorAll("video, audio").forEach(m)}const A=new MutationObserver(t=>{for(const e of t){for(const n of e.addedNodes){if(n.nodeType!==Node.ELEMENT_NODE)continue;const o=n;o instanceof HTMLMediaElement&&m(o),o.querySelectorAll("video, audio").forEach(m)}for(const n of e.removedNodes){if(n.nodeType!==Node.ELEMENT_NODE)continue;const o=n;o instanceof HTMLMediaElement&&y(o),o.querySelectorAll("video, audio").forEach(y)}}});A.observe(document.documentElement,{childList:!0,subtree:!0});let M=location.href;function v(){location.href!==M&&(M=location.href,u.publish({type:h.REQUEST_SETTINGS}).catch(()=>{}))}window.addEventListener("popstate",v);const q=history.pushState.bind(history),N=history.replaceState.bind(history);history.pushState=(...t)=>{q(...t),v()};history.replaceState=(...t)=>{N(...t),v()};function _(t){b=t,document.querySelectorAll("video, audio").forEach(e=>{var n;(n=d.get(e))==null||n.applySettings(t)})}u.subscribe(h.APPLY_SETTINGS,t=>{_(t.payload.settings)});const D=[{key:"ArrowUp",shiftKey:!0,action:"VOLUME_UP"},{key:"ArrowDown",shiftKey:!0,action:"VOLUME_DOWN"},{key:"KeyE",shiftKey:!0,action:"TOGGLE_EQ"},{key:"KeyM",shiftKey:!0,action:"TOGGLE_MONO"},{key:"KeyR",shiftKey:!0,action:"RESET"}],O=.1,L=10,U=0;function P(t,e){return(t.code===e.key||t.key===e.key)&&!!t.shiftKey==!!e.shiftKey&&!!t.ctrlKey==!!e.ctrlKey&&!!t.altKey==!!e.altKey}function G(t){let e={...b};switch(t){case"VOLUME_UP":e={...e,volume:Math.min(e.volume+O,L)};break;case"VOLUME_DOWN":e={...e,volume:Math.max(e.volume-O,U)};break;case"TOGGLE_EQ":e={...e,isEqEnabled:!e.isEqEnabled};break;case"TOGGLE_MONO":e={...e,isMono:!e.isMono};break;case"RESET":e={...p};break}_(e),W(t,e),u.publish({type:h.SET_DEFAULT_SETTINGS,payload:{settings:e}}).catch(()=>{})}window.addEventListener("keydown",t=>{const e=t.target.tagName;if(!(e==="INPUT"||e==="TEXTAREA"||t.target.isContentEditable)){for(const n of D)if(P(t,n)){t.preventDefault(),G(n.action);return}}});const R="__audio-engine-osd__",K=2200;let E=null,g=null,f=null;function B(){if(g)return g;const t=document.createElement("div");t.id=R,Object.assign(t.style,{position:"fixed",top:"0",left:"0",width:"0",height:"0",zIndex:"2147483647",pointerEvents:"none"});const e=t.attachShadow({mode:"closed"}),n=document.createElement("style");n.textContent=`
    :host { all: initial; }

    #osd {
      position: fixed;
      top: 24px;
      left: 50%;
      transform: translateX(-50%) translateY(-12px);
      min-width: 260px;
      max-width: 420px;
      padding: 12px 20px;
      border-radius: 14px;
      background: rgba(10, 10, 20, 0.82);
      backdrop-filter: blur(18px) saturate(180%);
      -webkit-backdrop-filter: blur(18px) saturate(180%);
      border: 1px solid rgba(255, 255, 255, 0.10);
      box-shadow:
        0 8px 32px rgba(0, 0, 0, 0.45),
        0 1px 0 rgba(255, 255, 255, 0.06) inset;
      font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
      font-size: 13px;
      color: #f0f0f5;
      display: flex;
      align-items: center;
      gap: 14px;
      opacity: 0;
      pointer-events: none;
      transition:
        opacity 180ms ease,
        transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1);
      will-change: opacity, transform;
    }

    #osd.visible {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }

    #osd-icon {
      font-size: 18px;
      flex-shrink: 0;
      line-height: 1;
    }

    #osd-body {
      display: flex;
      flex-direction: column;
      gap: 6px;
      flex: 1;
      min-width: 0;
    }

    #osd-label {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: rgba(255, 255, 255, 0.45);
    }

    #osd-value {
      font-size: 15px;
      font-weight: 700;
      color: #ffffff;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    #osd-bar-track {
      width: 100%;
      height: 4px;
      border-radius: 2px;
      background: rgba(255, 255, 255, 0.12);
      overflow: hidden;
    }

    #osd-bar-fill {
      height: 100%;
      border-radius: 2px;
      background: linear-gradient(90deg, #6c63ff, #48cfad);
      transition: width 140ms ease;
      width: 10%;
    }
  `;const o=document.createElement("div");return o.id="osd",o.innerHTML=`
    <span id="osd-icon">🔊</span>
    <div id="osd-body">
      <div id="osd-label">Volume</div>
      <div id="osd-value">100%</div>
      <div id="osd-bar-track"><div id="osd-bar-fill"></div></div>
    </div>
  `,e.appendChild(n),e.appendChild(o),document.documentElement.appendChild(t),E=t,g=e,e}function V(t,e){const n=Math.round(e.volume*100);switch(t){case"VOLUME_UP":case"VOLUME_DOWN":return{icon:e.volume===0?"🔇":e.volume<.5?"🔉":"🔊",label:"Volume",value:`${n}%`,fill:e.volume/L};case"TOGGLE_EQ":return{icon:"🎛️",label:"Equalizer",value:e.isEqEnabled?"Enabled":"Bypassed"};case"TOGGLE_MONO":return{icon:e.isMono?"🎙️":"🎧",label:"Audio Mode",value:e.isMono?"Mono":"Stereo"};case"RESET":return{icon:"↺",label:"Audio Engine",value:"Reset to Defaults"}}}function W(t,e){const n=B(),o=V(t,e),s=n.getElementById("osd"),i=n.getElementById("osd-icon"),r=n.getElementById("osd-label"),a=n.getElementById("osd-value"),c=n.getElementById("osd-bar-fill"),x=n.getElementById("osd-bar-track");i.textContent=o.icon,r.textContent=o.label,a.textContent=o.value,o.fill!==void 0?(x.style.display="",c.style.width=`${Math.round(o.fill*100)}%`):x.style.display="none",s.classList.add("visible"),f!==null&&clearTimeout(f),f=setTimeout(()=>{s.classList.remove("visible"),f=null},K)}window.addEventListener("pagehide",()=>{A.disconnect(),document.querySelectorAll("video, audio").forEach(y),E==null||E.remove(),u.unsubscribeAll(h.APPLY_SETTINGS)});(function(){w||(w=!0,u.publish({type:h.CONTENT_READY}).catch(()=>{}),document.readyState==="loading"?document.addEventListener("DOMContentLoaded",S,{once:!0}):S())})();
