const $=s=>document.querySelector(s);
const notice=t=>{$("#notice").textContent=t||""};
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

$("#menuBtn").onclick=()=>{$("#drawer").classList.add("open");$("#drawer").setAttribute("aria-hidden","false")};
$("#closeMenu").onclick=()=>{$("#drawer").classList.remove("open");$("#drawer").setAttribute("aria-hidden","true")};

async function api(url,opt={}){
 const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(),30000);
 let r,d={};
 try{r=await fetch(url,{...opt,signal:controller.signal}); try{d=await r.json()}catch{}}
 catch(e){if(e.name==="AbortError")throw new Error("The request timed out. Check your connection and try again."); throw new Error("Network request failed. Check your connection and try again.")}
 finally{clearTimeout(timeout)}
 if(!r.ok){
  if(r.status===401) throw new Error("SESSION_EXPIRED");
  if(r.status===402){const err=new Error(d.message||"Upgrade required");err.upgrade=true;err.data=d;err.status=402;throw err;}
  const err=new Error(d.message||d.error||`Request failed (${r.status})`); err.status=r.status; throw err;
 }
 return d;
}

async function loadProjects(){
 try{
  notice("Loading projects…");
  const d=await api("/api/projects");
  const s=$("#projectSelect");s.innerHTML='<option value="">Select a project</option>';
  d.projects.forEach(p=>{const o=document.createElement("option");o.value=p.projectId;o.textContent=`${p.name||p.projectId} — ${p.projectId}`;s.appendChild(o)});
  $("#projectCount").textContent=d.projects.length;
  notice(`${d.projects.length} project${d.projects.length===1?"":"s"} ready.`);
 }catch(e){notice(e.message==="SESSION_EXPIRED"?"Session expired — sign in again.":e.message)}
}
$("#projectsBtn").onclick=loadProjects;
$("#logoutBtn").onclick=async()=>{try{await api("/auth/logout",{method:"POST"});window.location.href="/"}catch(e){fail("Sign out failed",e)}};
async function loadSession(){
 try{const d=await api("/api/session");if(d.connected){$("#connect").textContent="Google connected";$("#connect").classList.remove("primary");$("#logoutBtn").hidden=false;await loadProjects();} }catch{}
}
loadSession();

async function inspect(){
 const p=$("#projectSelect").value;if(!p)return showModal("Project required","Choose a Google Cloud project before inspecting it.",()=>{});
 try{
  const d=await api("/api/services/"+encodeURIComponent(p));
  $("#health").innerHTML=`<div class="item"><b>${d.services.length}</b> enabled services found.</div>`+
   d.services.slice(0,12).map(x=>`<div class="item">${esc(x)}</div>`).join("");
 }catch(e){fail("Inspection failed",e)}
}
$("#inspectBtn").onclick=inspect;

async function batch(){
 const p=$("#projectSelect").value;if(!p)return showModal("Project required","Select a project first.",()=>{});
 const recommended=["firebase.googleapis.com","identitytoolkit.googleapis.com","firestore.googleapis.com","fcm.googleapis.com"];
 try{
  const current=await api("/api/services/"+encodeURIComponent(p));
  const missing=recommended.filter(x=>!current.services.includes(x));
  if(!missing.length)return notice("All recommended Firebase services are already enabled.");
  showModal("Enable recommended services",`Flipcloud will request permission to enable ${missing.length} recommended service${missing.length===1?"":"s"}. You can ignore this action.`,async()=>{
   try{const result=await api("/api/batch-enable",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId:p,services:missing})});notice(result.operation?.name?"Google accepted the request. Recheck the project in a moment.":"Google accepted the request.");setTimeout(inspect,1200)}catch(e){showModal("Google rejected the request",e.message+" Check IAM permissions and billing for this project.",()=>{})}
  },true);
 }catch(e){fail("Could not inspect project",e)}
}
$("#batchBtn").onclick=batch;

async function scan(){
 const code=$("#code").value;if(!code.trim())return showModal("Nothing to analyze","Paste code, package names or configuration first.",()=>{});
 try{
  const d=await api("/api/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code})});
  $("#scan").innerHTML=d.detected.length?d.detected.map(x=>`<div class="item"><b>${esc(x.name)}</b><br>${x.services.map(esc).join(", ")}</div>`).join(""):"<div class='item'>No supported Google requirements detected yet.</div>";
 }catch(e){fail("Analysis failed",e)}
}
$("#scanBtn").onclick=scan;

async function catalog(filter=""){
 try{
  const d=await api("/api/catalog"); const items=filter?d.items.filter(x=>[x.name,x.id,x.service,...x.keywords].join(" ").toLowerCase().includes(filter.toLowerCase())):d.items; $("#catalog").innerHTML=items.map(x=>`<div class="api"><strong>${esc(x.name)}</strong><code>${esc(x.service)}</code><div>${esc(x.keywords.slice(0,4).join(" · "))}</div></div>`).join("");
 }catch(e){$("#catalog").textContent=e.message}
}
$("#catalogBtn").onclick=catalog;catalog();

let timer;
document.addEventListener("click",e=>{if(!e.target.closest(".header-search")) $("#searchResults").classList.remove("show")});
$("#search").addEventListener("input",()=>{
 clearTimeout(timer);const q=$("#search").value.trim();if(!q){$("#searchResults").classList.remove("show");return}
 timer=setTimeout(async()=>{
  try{const d=await api("/api/search?q="+encodeURIComponent(q));const box=$("#searchResults");box.innerHTML=d.results.length?d.results.map(x=>`<button data-id="${x.id}" data-target="${x.target||"apis"}" data-type="${x.type||"api"}"><b>${esc(x.name)}</b><br><small>${esc(x.type==="page"?"Page":x.service)} · ${esc(x.keywords.slice(0,3).join(" · "))}</small></button>`).join(""):"<button>No matching Flipcloud tool or API.</button>";box.classList.add("show");box.querySelectorAll("[data-id]").forEach(b=>b.onclick=()=>{const target=b.dataset.target||"apis";location.hash=target;$("#searchResults").classList.remove("show"); if(b.dataset.type==="api") catalog($("#search").value)})}catch{}
 },120);
});

function showModal(title,text,action,showEnable=false){
 const m=$("#modal");m.hidden=false;$("#modalTitle").textContent=title;$("#modalText").textContent=text;
 $("#modalEnable").style.display=showEnable?"inline-flex":"none";
 $("#modalIgnore").onclick=()=>{m.hidden=true};
 $("#modalClose").onclick=()=>{m.hidden=true};
 $("#modalEnable").onclick=async()=>{m.hidden=true;await action()};
}

$("#notifyBtn").onclick=async()=>{
 try{
  if(!("Notification" in window))throw new Error("This browser does not support web notifications.");
  if(Notification.permission==="denied")throw new Error("Notifications are blocked for this site. Open browser site settings and allow notifications.");
  const p=await Notification.requestPermission();if(p!=="granted")throw new Error("Notification permission was not granted.");
  const {initializeApp}=await import("https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js");
  const {getMessaging,getToken,isSupported}=await import("https://www.gstatic.com/firebasejs/12.3.0/firebase-messaging.js");
  const {firebaseConfig,fcmVapidKey}=await import("/firebase-config.js");
  if(!(await isSupported()))throw new Error("FCM Web Push is not supported in this browser.");
  const app=initializeApp(firebaseConfig),m=getMessaging(app),reg=await navigator.serviceWorker.register("/firebase-messaging-sw.js");
  const token=await getToken(m,{vapidKey:fcmVapidKey,serviceWorkerRegistration:reg});
  if(!token)throw new Error("FCM did not return a registration token.");
  await api("/api/fcm-token",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token})});
  $("#notifyState").textContent="Alerts enabled on this browser.";$("#notifyTestBtn").hidden=false;
 }catch(e){$("#notifyState").textContent=e.message}
};
$("#notifyTestBtn").onclick=async()=>{const b=$("#notifyTestBtn");b.disabled=true;try{const d=await api("/api/fcm-test",{method:"POST"});$("#notifyState").textContent=d.success?"Test notification sent.":"Test notification could not be sent."}catch(e){fail("Notification test failed",e)}finally{b.disabled=false}};

const websiteScanBtn=$("#websiteScanBtn");
if(websiteScanBtn) websiteScanBtn.onclick=async()=>{
 const url=$("#websiteUrl").value.trim(); if(!url)return $("#websiteState").textContent="Enter your website URL first.";
 websiteScanBtn.disabled=true;$("#websiteState").textContent="Scanning public website…";$("#websiteResults").textContent="";$("#websiteDeep").textContent="";
 try{
  const d=await api("/api/website-scan",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url})});
  const rows=Object.entries(d.result.checks).map(([k,v])=>`<div class="item"><b>${esc(k)}</b><span> ${v===true?"✓":v===false?"Not detected":"—"}</span></div>`).join("");
  $("#websiteResults").innerHTML=rows+`<div class="item">HTTP ${d.result.status} · ${esc(d.result.contentType||"unknown content type")} · ${d.result.scripts} scripts detected</div>`;
  if(d.deep){
   const sec=Object.entries(d.deep.security).map(([k,v])=>`<div class="item"><b>${esc(k)}</b> ${v?"✓":"Missing"}</div>`).join("");
   const stack=Object.entries(d.deep.stack).filter(([,v])=>v).map(([k])=>esc(k)).join(", ")||"none detected";
   const c=d.deep.content;
   $("#websiteDeep").innerHTML=`<h3>Deep scan <span class="lock">Pro</span></h3><b>Security headers</b>${sec}<div class="item"><b>Google/Firebase stack</b> ${stack}</div><div class="item"><b>Content</b> ${c.imagesTotal} images (${c.imagesMissingAlt} without alt) · ${c.h1Count} h1 · lang ${c.lang?"set":"missing"}${c.mixedContent?" · mixed content found":""}</div>`+(d.deep.tips.length?`<div class="item"><b>Fix next</b><br>${d.deep.tips.map(esc).join("<br>")}</div>`:"");
  }else if(d.deepLocked){
   const p=d.deepPreview||{missing:0,total:6};
   $("#websiteDeep").innerHTML=`<div class="locked-note"><b>${p.missing} of ${p.total} security headers are missing.</b><br>Pro shows which ones, your detected Google/Firebase stack, accessibility gaps and a fix list. <button class="pill" id="deepUnlock">Unlock deep scan</button></div>`;
   $("#deepUnlock").onclick=()=>showUpgrade({message:"Deep website scan shows exactly which security headers are missing, your Google/Firebase stack and a prioritized fix list.",data:window.flipStatus?{trialAvailable:window.flipStatus.trial?.available}:{}});
  }
  $("#websiteState").textContent="Scan complete.";loadBillingStatus();
 }catch(e){if(e.upgrade){$("#websiteState").textContent="";showUpgrade(e)}else $("#websiteState").textContent=e.message}
 finally{websiteScanBtn.disabled=false}
};


if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});

(async()=>{
 const p=new URLSearchParams(location.search); const e=p.get("error");
 if(p.get("connected")){await loadBillingStatus();}
 if(e){const messages={oauth_not_configured:"Google OAuth is not configured on the server.",oauth_failed:"Google sign-in failed. Try again.",oauth_state_mismatch:"Google sign-in security check failed. Start sign-in again.",oauth_missing_code:"Google did not return an authorization code.",oauth_no_refresh_token:"Google did not return offline access. Reconnect and approve access."}; showModal("Sign-in issue",messages[e]||"An authentication error occurred.",()=>{}); history.replaceState({},"",location.pathname)}
})();

let touchStartX=0;
document.addEventListener("touchstart",e=>{touchStartX=e.touches[0].clientX},{passive:true});
document.addEventListener("touchend",e=>{const dx=e.changedTouches[0].clientX-touchStartX;if(Math.abs(dx)<55)return;const drawer=$("#drawer");if(dx<0&&touchStartX>window.innerWidth-70){drawer.classList.add("open");drawer.setAttribute("aria-hidden","false")}if(dx>0&&drawer.classList.contains("open")){drawer.classList.remove("open");drawer.setAttribute("aria-hidden","true")}}, {passive:true});

let selectedPlan="monthly";
const billingModal=$("#billingModal");
async function loadBillingStatus(){
 try{const d=await api("/api/billing/status");window.flipStatus=d;renderStatus(d)}
 catch{$("#billingState").textContent="Subscription status is temporarily unavailable."}
}
loadBillingStatus();
window.flipcloudRefreshBilling=loadBillingStatus;
function openBilling(plan){selectedPlan=plan;billingModal.hidden=false;$("#billingFormError").textContent="";$("#billingEmail").focus()}
$("#billingClose").onclick=()=>billingModal.hidden=true;
$("#billingCancel").onclick=()=>billingModal.hidden=true;
document.querySelectorAll(".planBtn").forEach(btn=>btn.addEventListener("click",()=>openBilling(btn.dataset.plan)));
$("#billingContinue").onclick=async()=>{
 const email=$("#billingEmail").value.trim(), name=$("#billingName").value.trim();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){$("#billingFormError").textContent="Enter a valid billing email.";return}
 const btn=$("#billingContinue"), state=$("#billingState"); btn.disabled=true; state.textContent="Creating secure checkout…";
 try{
  const d=await api("/api/billing/hosted-subscription",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,plan:selectedPlan,name:name||"Flipcloud Customer",currency:"NGN"})});
  if(d.complimentary){billingModal.hidden=true;btn.disabled=false;await loadBillingStatus();return}
  if(!d.link)throw new Error("Flutterwave returned no checkout link.");
  billingModal.hidden=true;window.location.href=d.link;
 }
 catch(e){$("#billingFormError").textContent=e.message;state.textContent="Checkout could not be started.";btn.disabled=false}
};


/* ---------- Pro: upgrade prompt, status, presets, Cost Guard, exports ---------- */
function fail(title,e){ if(e&&e.upgrade)showUpgrade(e); else showModal(title,e?.message||String(e),()=>{}) }
const upModal=$("#upgradeModal");
function showUpgrade(e){
 const d=e.data||{};const st=window.flipStatus||{};
 const canTrial=d.trialAvailable||st.trial?.available;
 $("#upgradeTitle").textContent=d.error==="LIMIT_REACHED"?"You've hit today's free limit":"Unlock with Pro";
 $("#upgradeText").textContent=(e.message||"This is a Pro feature.")+(canTrial?` Start a free ${st.trial?.days||7}-day trial, no card needed.`:(st.email?"":" Sign in with Google or GitHub to start a free trial."));
 $("#upgradeTrial").hidden=!canTrial;
 upModal.hidden=false;
}
$("#upgradeClose").onclick=$("#upgradeLater").onclick=()=>upModal.hidden=true;
$("#upgradePlans").onclick=()=>{upModal.hidden=true;$("#billing").scrollIntoView({behavior:"smooth"})};
async function startTrial(){
 try{const d=await api("/api/trial/start",{method:"POST"});upModal.hidden=true;notice(d.message||"Trial started.");await loadBillingStatus()}
 catch(e){upModal.hidden=true;showModal("Trial unavailable",e.message,()=>{})}
}
$("#upgradeTrial").onclick=startTrial;$("#trialBtn").onclick=startTrial;

function renderStatus(d){
 const badge=$("#planBadge");badge.hidden=false;badge.className="planbadge"+(d.active?" pro":"");
 const fmt=iso=>new Date(iso).toLocaleDateString(undefined,{month:"short",day:"numeric"});
 let label,line;
 if(d.active){
  label=d.source==="trial"?`Pro trial · ends ${fmt(d.trial.endsAt)}`:d.complimentary?"Pro · complimentary":`Pro · ${d.plan} plan`;
  line=d.source==="trial"?`Pro trial active until ${fmt(d.trial.endsAt)}. Subscribe below to keep Pro afterwards.`:d.complimentary?"Pro active · complimentary access":`Pro active · ${d.plan} plan`;
  badge.innerHTML=esc(label);
 }else{
  const u=d.usage||{};const left=k=>u[k]?Math.max(0,u[k].limit-u[k].used):null;
  badge.innerHTML=`Free plan${left("scan")!==null?` · ${left("scan")} scans left today`:""} <button id="badgeUp">Upgrade</button>`;
  $("#badgeUp").onclick=()=>$("#billing").scrollIntoView({behavior:"smooth"});
  line=d.email?(d.trial?.used?"Your free trial has ended. Subscribe to unlock Pro again.":"No active Pro subscription found."):"Sign in with Google or GitHub to see subscription status.";
 }
 $("#billingState").textContent=line;
 $("#trialRow").hidden=!(d.trial&&d.trial.available&&!d.active);
 $("#proToolsBadge").textContent=d.active?"Pro unlocked":"Free + Pro";
 loadPresets();
}

/* presets */
let presets=[],selPreset="firebase-starter";
async function loadPresets(){
 try{const d=await api("/api/presets");presets=d.presets;
  $("#presetList").innerHTML=presets.map(p=>`<button class="preset${p.id===selPreset?" sel":""}${p.locked?" locked":""}" data-id="${p.id}"><span><b>${esc(p.name)}</b><small>${esc(p.desc)} · ${p.count} APIs</small></span>${p.locked?'<span class="lock">Pro</span>':""}</button>`).join("");
  document.querySelectorAll(".preset").forEach(b=>b.onclick=()=>{
   const p=presets.find(x=>x.id===b.dataset.id);
   if(p.locked)return showUpgrade({message:`${p.name} is a Pro preset.`,data:{trialAvailable:window.flipStatus?.trial?.available}});
   selPreset=p.id;loadPresets();
  });
 }catch{}
}
$("#presetApply").onclick=async()=>{
 const sel=$("#projectSelect").value,all=$("#presetAll").checked;
 const ids=all?[...$("#projectSelect").options].map(o=>o.value).filter(Boolean).slice(0,10):(sel?[sel]:[]);
 if(!ids.length)return showModal("Project required","Load your projects and select one first.",()=>{});
 const p=presets.find(x=>x.id===selPreset);
 showModal(`Apply "${p.name}"`,`Flipcloud will enable ${p.count} APIs on ${ids.length} project${ids.length===1?"":"s"}. Enabling a service doesn't make it free; usage charges apply on your project.`,async()=>{
  $("#presetState").textContent="Applying…";
  try{
   const d=await api("/api/presets/apply",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({presetId:selPreset,projectIds:ids})});
   const ok=d.results.filter(r=>r.ok).length,bad=d.results.filter(r=>!r.ok);
   $("#presetState").innerHTML=`<div class="item">${ok} of ${d.results.length} project${d.results.length===1?"":"s"} accepted. Recheck in a moment.</div>`+bad.map(r=>`<div class="item"><b>${esc(r.projectId)}</b>: ${esc(r.error)}</div>`).join("");
  }catch(e){$("#presetState").textContent="";fail("Preset failed",e)}
 },true);
};

/* Cost Guard */
async function runAudit(){
 const p=$("#projectSelect").value;if(!p)return showModal("Project required","Select a project first.",()=>{});
 const box=$("#auditResults");box.textContent="Auditing…";
 try{
  const d=await api("/api/audit/"+encodeURIComponent(p));
  const head=`<div class="score">${d.score}<small>/100</small></div><div class="bar"><i style="width:${d.score}%"></i></div><div>${d.total} enabled · ${d.counts.high} high · ${d.counts.medium} medium cost risk · ${d.counts.security} security-sensitive</div>`;
  if(d.pro){
   box.innerHTML=head+d.findings.map(f=>`<div class="item finding"><span><span class="risk ${f.risk}">${f.risk}</span> <b>${esc(f.name)}</b><br><small style="letter-spacing:0;font-weight:500">${esc(f.note)}</small></span>${f.protected?"":`<button class="pill dis" data-s="${esc(f.service)}">Disable</button>`}</div>`).join("")||"<div class='item'>Nothing risky found. Nice.</div>";
   box.querySelectorAll(".dis").forEach(b=>b.onclick=()=>showModal("Disable service",`Disable ${b.dataset.s} on ${p}? Anything using it will stop working. Google blocks this if another service depends on it.`,async()=>{
    try{await api("/api/disable-api",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId:p,service:b.dataset.s,confirm:true})});notice("Disable requested. Re-run the audit shortly.");setTimeout(runAudit,1500)}
    catch(e){fail("Could not disable",e)}
   },true));
  }else{
   box.innerHTML=head+(d.locked?`<div class="locked-note"><b>${d.locked} service${d.locked===1?"":"s"} flagged.</b> See which ones, why they matter and disable them in one tap with Pro. <button class="pill" id="auditUnlock">Unlock Cost Guard</button></div>`:"<div class='item'>Nothing flagged. Nice.</div>");
   const u=$("#auditUnlock");if(u)u.onclick=()=>showUpgrade({message:"Cost Guard shows exactly which services can run up a bill and lets you disable them in one tap.",data:{trialAvailable:window.flipStatus?.trial?.available}});
  }
 }catch(e){box.textContent="";fail("Audit failed",e)}
}
$("#auditBtn").onclick=runAudit;

/* exports */
document.querySelectorAll(".exportBtn").forEach(b=>b.onclick=async()=>{
 const p=$("#projectSelect").value;if(!p)return showModal("Project required","Select a project first.",()=>{});
 try{
  const d=await api(`/api/export/${encodeURIComponent(p)}?format=${b.dataset.format}`);
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([d.content],{type:"text/plain"}));a.download=d.filename;document.body.appendChild(a);a.click();a.remove();
  $("#exportState").textContent=`Downloaded ${d.filename}`;
 }catch(e){fail("Export failed",e)}
});
