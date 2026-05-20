var Y=Object.defineProperty;var Q=(d,a,u)=>a in d?Y(d,a,{enumerable:!0,configurable:!0,writable:!0,value:u}):d[a]=u;var h=(d,a,u)=>Q(d,typeof a!="symbol"?a+"":a,u);(function(){"use strict";const d=Object.freeze({volume:1,eqBands:Object.freeze([0,0,0,0,0,0,0,0,0,0]),isMono:!1,isEqEnabled:!1});var a=(t=>(t.APPLY_SETTINGS="APPLY_SETTINGS",t.GET_STATE="GET_STATE",t.SET_DEFAULT_SETTINGS="SET_DEFAULT_SETTINGS",t.ADD_RULE="ADD_RULE",t.UPDATE_RULE="UPDATE_RULE",t.DELETE_RULE="DELETE_RULE",t.TOGGLE_ENABLED="TOGGLE_ENABLED",t.CONTENT_READY="CONTENT_READY",t.REQUEST_SETTINGS="REQUEST_SETTINGS",t.STATE_CHANGED="STATE_CHANGED",t))(a||{});const u=Object.freeze([32,64,125,250,500,1e3,2e3,4e3,8e3,16e3]);class k{constructor(e){h(this,"ctx");h(this,"nodes");h(this,"isEqConnected",!1);h(this,"isPannerConnected",!1);h(this,"watchdogId",null);try{this.ctx=new AudioContext;const o=this.ctx.createMediaElementSource(e);o.connect(this.ctx.destination);const n=u.map((l,s)=>{const c=this.ctx.createBiquadFilter();return s===0?c.type="lowshelf":s===u.length-1?c.type="highshelf":c.type="peaking",c.frequency.value=l,c.Q.value=1.41,c.gain.value=0,c}),i=this.ctx.createStereoPanner();i.pan.value=0;const r=this.ctx.createGain();r.gain.value=d.volume,this.nodes={source:o,eqFilters:n,panner:i,gain:r},this.rebuildPipeline(d),this.ctx.state==="suspended"&&(console.log("[Audio-Engine] Context suspended by browser"),this.autoResume()),this.startWatchdog()}catch(o){if(console.error("[Audio-Engine-Error] AudioEngine constructor failed:",o.message,o),this.nodes&&this.nodes.source)try{this.nodes.source.connect(this.ctx.destination)}catch{}throw o}}rebuildPipeline(e){try{const{source:o,eqFilters:n,panner:i,gain:r}=this.nodes;this.disconnectAll();const l=this.ctx.destination;if(console.log(`[Audio-Engine-Trace] Rebuilding pipeline. Destination sampleRate: ${l.context.sampleRate}`),e.isEqEnabled&&!e.isMono){o.connect(n[0]);for(let s=0;s<n.length-1;s++)n[s].connect(n[s+1]);n[n.length-1].connect(r),r.connect(l),this.isEqConnected=!0,this.isPannerConnected=!1}else if(e.isEqEnabled&&e.isMono){o.connect(n[0]);for(let s=0;s<n.length-1;s++)n[s].connect(n[s+1]);n[n.length-1].connect(i),i.connect(r),r.connect(l),this.isEqConnected=!0,this.isPannerConnected=!0}else!e.isEqEnabled&&e.isMono?(o.connect(i),i.connect(r),r.connect(l),this.isEqConnected=!1,this.isPannerConnected=!0):(o.connect(r),r.connect(l),this.isEqConnected=!1,this.isPannerConnected=!1)}catch(o){console.error("[Audio-Engine-Error] rebuildPipeline failed:",o.message,o);try{this.disconnectAll(),this.nodes.source.connect(this.ctx.destination)}catch(n){console.error("[Audio-Engine-Error] Fallback connection failed:",n)}}}disconnectAll(){try{const{source:e,eqFilters:o,panner:n,gain:i}=this.nodes;try{e.disconnect()}catch{}for(const r of o)try{r.disconnect()}catch{}try{n.disconnect()}catch{}try{i.disconnect()}catch{}}catch(e){console.error("[Audio-Engine-Error] disconnectAll failed:",e.message,e)}}applySettings(e){try{console.log(`[Audio-Engine-Trace] AudioEngine applying settings. Volume: ${e.volume}, EQ Enabled: ${e.isEqEnabled}, Mono: ${e.isMono}`),console.log(`[Audio-Engine-Trace] Current AudioContext state: ${this.ctx.state}`),this.ctx.state==="suspended"&&(console.log("[Audio-Engine-Trace] AudioContext is suspended, resuming..."),this.ctx.resume().catch(n=>{console.error("[Audio-Engine-Error] Failed to resume AudioContext:",n)})),this.nodes.gain.gain.setTargetAtTime(e.volume,this.ctx.currentTime,.01),e.isEqEnabled&&e.eqBands.forEach((n,i)=>{const r=this.nodes.eqFilters[i];r&&r.gain.setTargetAtTime(n,this.ctx.currentTime,.01)}),e.isMono&&this.nodes.panner.pan.setTargetAtTime(0,this.ctx.currentTime,.01),(e.isEqEnabled!==this.isEqConnected||e.isMono!==this.isPannerConnected)&&this.rebuildPipeline(e)}catch(o){console.error("[Audio-Engine-Error] applySettings failed:",o.message,o)}}updateSettings(e){try{this.applySettings(e)}catch(o){console.error("[Audio-Engine-Error] updateSettings failed:",o.message,o)}}setVolume(e){try{this.nodes.gain.gain.setTargetAtTime(e,this.ctx.currentTime,.01)}catch(o){console.error("[Audio-Engine-Error] setVolume failed:",o.message,o)}}setEqBand(e,o){try{const n=this.nodes.eqFilters[e];if(!n)throw new RangeError(`[AudioEngine] Invalid band index: ${e}`);n.gain.setTargetAtTime(o,this.ctx.currentTime,.01)}catch(n){console.error("[Audio-Engine-Error] setEqBand failed:",n.message,n)}}autoResume(){try{this.ctx.state==="suspended"&&this.ctx.resume().catch(e=>{console.error("[Audio-Engine-Error] autoResume failed to resume context:",e.message,e)})}catch(e){console.error("[Audio-Engine-Error] autoResume execution threw:",e.message,e)}}startWatchdog(){try{if(this.watchdogId!==null)return;this.watchdogId=setInterval(()=>{try{if(this.ctx.state==="closed"){this.stopWatchdog();return}this.ctx.state==="suspended"?this.autoResume():this.ctx.state==="running"&&this.stopWatchdog()}catch(e){console.error("[Audio-Engine-Error] Watchdog interval callback threw:",e.message,e)}},500)}catch(e){console.error("[Audio-Engine-Error] startWatchdog failed:",e.message,e)}}stopWatchdog(){try{this.watchdogId!==null&&(clearInterval(this.watchdogId),this.watchdogId=null)}catch(e){console.error("[Audio-Engine-Error] stopWatchdog failed:",e.message,e)}}get state(){return this.ctx.state}get sampleRate(){return this.ctx.sampleRate}dispose(){try{this.stopWatchdog(),this.disconnectAll(),this.ctx.close().catch(e=>{console.error("[Audio-Engine-Error] Error closing AudioContext during dispose:",e.message,e)})}catch(e){console.error("[Audio-Engine-Error] dispose failed:",e.message,e)}}destroy(){this.dispose()}}const E=new Map;chrome.runtime.onMessage.addListener((t,e,o)=>{if(!C(t))return;const n=E.get(t.type);if(!n||n.length===0)return;if(t.type===a.GET_STATE){let r=!1;const l=[];for(const s of n)try{const c=s(t,e);c instanceof Promise?l.push(c.then(p=>{!r&&p!==void 0&&(r=!0,o(p))})):!r&&c!==void 0&&(r=!0,o(c))}catch(c){console.error("[EventBus] Handler error:",c)}if(l.length>0)return Promise.allSettled(l).then(()=>{r||(r=!0,o(void 0))}).catch(()=>{r||(r=!0,o(void 0))}),!0;r||(r=!0,o(void 0));return}else{for(const r of n)try{r(t,e)}catch(l){console.error("[EventBus] Handler error:",l)}o({success:!0});return}});function C(t){return typeof t=="object"&&t!==null&&"type"in t&&typeof t.type=="string"}async function D(t,e){return chrome.tabs.sendMessage(t,e)}async function I(t){return chrome.runtime.sendMessage(t)}function G(t,e){const o=t;return E.has(o)||E.set(o,[]),E.get(o).push(e),()=>{const n=E.get(o);if(!n)return;const i=n.indexOf(e);i!==-1&&n.splice(i,1)}}function U(t){E.delete(t)}const g={publish:I,publishToTab:D,subscribe:G,unsubscribeAll:U};console.log("[Audio-Engine] Content script loaded and listening");const f=new WeakMap;let A={...d},_=!1;function T(t){if(!(t.dataset.audioEngineHooked==="true"||f.has(t)))try{t.dataset.audioEngineHooked="true";const e=new k(t);e.applySettings(A),f.set(t,e),console.log("[Audio-Engine] AudioEngine attached to",t.tagName,t.src||t.currentSrc)}catch(e){delete t.dataset.audioEngineHooked,console.error("[Audio-Engine-Error] Failed to attach AudioEngine:",e.message,e)}}function b(t){const e=f.get(t);if(e)try{e.destroy(),f.delete(t),delete t.dataset.audioEngineHooked,console.log("[Audio-Engine] AudioEngine detached from",t.tagName)}catch(o){console.error("[Audio-Engine-Error] Failed to detach AudioEngine:",o.message,o)}}function w(){try{const t=document.querySelectorAll("video, audio");console.log(`[Audio-Engine] Scanning DOM — found ${t.length} media element(s)`),t.forEach(T)}catch(t){console.error("[Audio-Engine-Error] scanAndAttach failed:",t.message,t)}}const O=new MutationObserver(t=>{try{for(const e of t){for(const o of e.addedNodes){if(o.nodeType!==Node.ELEMENT_NODE)continue;const n=o;n instanceof HTMLMediaElement&&T(n),n.querySelectorAll("video, audio").forEach(T)}for(const o of e.removedNodes){if(o.nodeType!==Node.ELEMENT_NODE)continue;const n=o;n instanceof HTMLMediaElement&&b(n),n.querySelectorAll("video, audio").forEach(b)}}}catch(e){console.error("[Audio-Engine-Error] MutationObserver callback threw:",e.message,e)}});try{O.observe(document.documentElement,{childList:!0,subtree:!0}),console.log("[Audio-Engine] MutationObserver active on documentElement")}catch(t){console.error("[Audio-Engine-Error] Failed to start MutationObserver:",t.message,t)}let S=location.href;function v(){try{if(location.href===S)return;S=location.href,console.log("[Audio-Engine] SPA navigation detected — new URL:",S),g.publish({type:a.REQUEST_SETTINGS}).catch(t=>{console.error("[Audio-Engine-Error] REQUEST_SETTINGS publish failed:",t.message,t)})}catch(t){console.error("[Audio-Engine-Error] onUrlChange threw:",t.message,t)}}try{window.addEventListener("popstate",v);const t=history.pushState.bind(history),e=history.replaceState.bind(history);history.pushState=(...o)=>{t(...o),v()},history.replaceState=(...o)=>{e(...o),v()}}catch(t){console.error("[Audio-Engine-Error] History API patching failed:",t.message,t)}function L(t){try{A=t,console.log("[Audio-Engine] Applying settings to all engines:",t),document.querySelectorAll("video, audio").forEach(e=>{var o;try{(o=f.get(e))==null||o.applySettings(t)}catch(n){console.error("[Audio-Engine-Error] applySettings failed on element:",e.tagName,n.message,n)}})}catch(e){console.error("[Audio-Engine-Error] applyToAllEngines threw:",e.message,e)}}try{g.subscribe(a.APPLY_SETTINGS,t=>{try{console.log(`[Audio-Engine-Trace] Content received settings. Volume: ${t.payload.settings.volume}`),L(t.payload.settings)}catch(e){console.error("[Audio-Engine-Error] APPLY_SETTINGS handler threw:",e.message,e)}})}catch(t){console.error("[Audio-Engine-Error] Failed to subscribe to APPLY_SETTINGS:",t.message,t)}const P=[{key:"ArrowUp",shiftKey:!0,action:"VOLUME_UP"},{key:"ArrowDown",shiftKey:!0,action:"VOLUME_DOWN"},{key:"KeyE",shiftKey:!0,action:"TOGGLE_EQ"},{key:"KeyM",shiftKey:!0,action:"TOGGLE_MONO"},{key:"KeyR",shiftKey:!0,action:"RESET"}],N=.1,M=10,q=0;function R(t,e){return(t.code===e.key||t.key===e.key)&&!!t.shiftKey==!!e.shiftKey&&!!t.ctrlKey==!!e.ctrlKey&&!!t.altKey==!!e.altKey}function F(t){try{let e={...A};switch(t){case"VOLUME_UP":e={...e,volume:Math.min(e.volume+N,M)};break;case"VOLUME_DOWN":e={...e,volume:Math.max(e.volume-N,q)};break;case"TOGGLE_EQ":e={...e,isEqEnabled:!e.isEqEnabled};break;case"TOGGLE_MONO":e={...e,isMono:!e.isMono};break;case"RESET":e={...d};break}L(e),W(t,e),g.publish({type:a.SET_DEFAULT_SETTINGS,payload:{settings:e}}).catch(o=>{console.error("[Audio-Engine-Error] SET_DEFAULT_SETTINGS publish failed:",o.message,o)})}catch(e){console.error("[Audio-Engine-Error] handleHotkey threw for action",t,":",e.message,e)}}try{window.addEventListener("keydown",t=>{try{const e=t.target.tagName;if(e==="INPUT"||e==="TEXTAREA"||t.target.isContentEditable)return;for(const o of P)if(R(t,o)){t.preventDefault(),F(o.action);return}}catch(e){console.error("[Audio-Engine-Error] keydown handler threw:",e.message,e)}})}catch(t){console.error("[Audio-Engine-Error] Failed to register keydown listener:",t.message,t)}const H="__audio-engine-osd__",B=2200;let m=null,x=null,y=null;function K(){if(x)return x;try{const t=document.createElement("div");t.id=H,Object.assign(t.style,{position:"fixed",top:"0",left:"0",width:"0",height:"0",zIndex:"2147483647",pointerEvents:"none"});const e=t.attachShadow({mode:"closed"}),o=document.createElement("style");o.textContent=`
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
    `;const n=document.createElement("div");return n.id="osd",n.innerHTML=`
      <span id="osd-icon">🔊</span>
      <div id="osd-body">
        <div id="osd-label">Volume</div>
        <div id="osd-value">100%</div>
        <div id="osd-bar-track"><div id="osd-bar-fill"></div></div>
      </div>
    `,e.appendChild(o),e.appendChild(n),document.documentElement.appendChild(t),m=t,x=e,e}catch(t){throw console.error("[Audio-Engine-Error] ensureOsd DOM injection failed:",t.message,t),t}}function V(t,e){const o=Math.round(e.volume*100);switch(t){case"VOLUME_UP":case"VOLUME_DOWN":return{icon:e.volume===0?"🔇":e.volume<.5?"🔉":"🔊",label:"Volume",value:`${o}%`,fill:e.volume/M};case"TOGGLE_EQ":return{icon:"🎛️",label:"Equalizer",value:e.isEqEnabled?"Enabled":"Bypassed"};case"TOGGLE_MONO":return{icon:e.isMono?"🎙️":"🎧",label:"Audio Mode",value:e.isMono?"Mono":"Stereo"};case"RESET":return{icon:"↺",label:"Audio Engine",value:"Reset to Defaults"}}}function W(t,e){try{const o=K(),n=V(t,e),i=o.getElementById("osd"),r=o.getElementById("osd-icon"),l=o.getElementById("osd-label"),s=o.getElementById("osd-value"),c=o.getElementById("osd-bar-fill"),p=o.getElementById("osd-bar-track");r.textContent=n.icon,l.textContent=n.label,s.textContent=n.value,n.fill!==void 0?(p.style.display="",c.style.width=`${Math.round(n.fill*100)}%`):p.style.display="none",i.classList.add("visible"),y!==null&&clearTimeout(y),y=setTimeout(()=>{i.classList.remove("visible"),y=null},B)}catch(o){console.error("[Audio-Engine-Error] showOsd threw:",o.message,o)}}try{window.addEventListener("pagehide",()=>{try{O.disconnect(),document.querySelectorAll("video, audio").forEach(b),m==null||m.remove(),g.unsubscribeAll(a.APPLY_SETTINGS),console.log("[Audio-Engine] pagehide: teardown complete")}catch(t){console.error("[Audio-Engine-Error] pagehide teardown threw:",t.message,t)}})}catch(t){console.error("[Audio-Engine-Error] Failed to register pagehide listener:",t.message,t)}(function(){try{if(_)return;_=!0,g.publish({type:a.CONTENT_READY}).catch(e=>{console.error("[Audio-Engine-Error] CONTENT_READY publish failed:",e.message,e)}),document.readyState==="loading"?document.addEventListener("DOMContentLoaded",w,{once:!0}):w()}catch(e){console.error("[Audio-Engine-Error] boot() threw:",e.message,e)}})()})();
