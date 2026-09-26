import express from "express";
import cookieSession from "cookie-session";
import { google } from "googleapis";
import { getApps, initializeApp as initializeFirebaseAdmin, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging as getAdminMessaging } from "firebase-admin/messaging";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import dns from "dns/promises";
import net from "net";

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express(), PORT=process.env.PORT||3000;
app.set("trust proxy",1);
const SESSION_SECRET=process.env.SESSION_SECRET;
if(process.env.NODE_ENV==="production" && !SESSION_SECRET){console.error("SESSION_SECRET is required in production");process.exit(1);}
app.disable("x-powered-by");
app.use((req,res,next)=>{res.setHeader("X-Content-Type-Options","nosniff");res.setHeader("Referrer-Policy","strict-origin-when-cross-origin");res.setHeader("X-Frame-Options","SAMEORIGIN");next()});
const requestCounts=new Map();
app.use((req,res,next)=>{if(!req.path.startsWith("/auth/")&&!req.path.startsWith("/api/"))return next();const now=Date.now(),key=`${req.ip}:${req.path}`;const old=requestCounts.get(key)||{t:now,n:0};if(now-old.t>60000){old.t=now;old.n=0}old.n++;requestCounts.set(key,old);if(old.n>120)return res.status(429).json({error:"RATE_LIMITED",message:"Too many requests. Wait a minute and try again."});next()});
app.use(express.json({limit:"2mb",verify:(req,res,buf)=>{req.rawBody=Buffer.from(buf)}}));
app.use(cookieSession({
  name:"flipcloud_session",
  secret:SESSION_SECRET||"development-only-change-me",
  httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",
  maxAge:7*24*60*60*1000
}));
app.use(express.static(publicPath()));

function publicPath(){return path.join(__dirname,"public")}
app.get("/api/health",(req,res)=>res.json({ok:true,service:"flipcloud",time:new Date().toISOString()}));
function firebaseAdminReady(){
 return Boolean(process.env.FIREBASE_PROJECT_ID&&process.env.FIREBASE_CLIENT_EMAIL&&process.env.FIREBASE_PRIVATE_KEY);
}
let firestore=null, adminMessaging=null, adminAuth=null;
if(firebaseAdminReady()){
 try{
  const adminApp=getApps().length?getApps()[0]:initializeFirebaseAdmin({credential:cert({projectId:process.env.FIREBASE_PROJECT_ID,clientEmail:process.env.FIREBASE_CLIENT_EMAIL,privateKey:process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g,"\n")})});
  firestore=getFirestore(adminApp);
  adminMessaging=getAdminMessaging(adminApp);
  adminAuth=getAdminAuth(adminApp);
 }catch(e){console.error("Firebase Admin initialization failed:",e.message)}
}
async function saveDoc(collection,id,data){if(!firestore)return false;await firestore.collection(collection).doc(id).set(data,{merge:true});return true}
async function getDoc(collection,id){if(!firestore)return null;const snap=await firestore.collection(collection).doc(id).get();return snap.exists?snap.data():null}

// Complimentary Flipcloud Pro access: this exact email and this exact GitHub
// username never pay. Checked before any Flutterwave call is made.
const COMPLIMENTARY_EMAILS=new Set(["ilemobayotolulope11092003@gmail.com"]);
const COMPLIMENTARY_GITHUB_USERNAMES=new Set(["wytzbot"]);
function isComplimentaryEmail(email){return COMPLIMENTARY_EMAILS.has(String(email||"").trim().toLowerCase())}
function isComplimentaryGithubUsername(username){return COMPLIMENTARY_GITHUB_USERNAMES.has(String(username||"").trim().toLowerCase())}
function sessionIsComplimentary(req){
 return isComplimentaryEmail(req.session?.user?.email)
  || isComplimentaryEmail(req.session?.github?.email)
  || isComplimentaryGithubUsername(req.session?.github?.username);
}

const GOOGLE_SCOPES=[
 "openid","email","profile",
 "https://www.googleapis.com/auth/cloudplatformprojects.readonly",
 "https://www.googleapis.com/auth/serviceusage"
];

const PAGES=[
 {id:"dashboard",name:"Dashboard",keywords:["home","projects","overview","cloud"]},
 {id:"tools",name:"Developer Tools",keywords:["scanner","analyzer","project health","requirements"]},
 {id:"apis",name:"API Catalog",keywords:["api","services","enable","google"]},
 {id:"github",name:"GitHub Integration",keywords:["github","repository","code","login"]},
 {id:"website",name:"Website Scanner",keywords:["website","site","scan","url","seo","firebase","sdk"]},
 {id:"notifications",name:"Notifications",keywords:["fcm","push","alerts","browser"]},
 {id:"docs",name:"Setup Guide",keywords:["guide","permissions","costs","documentation"]},
 {id:"billing",name:"Billing",keywords:["pricing","subscription","pro","payment","flutterwave"]},
 {id:"privacy",name:"Privacy Policy",keywords:["privacy","data","policy"]},
 {id:"terms",name:"Terms of Service",keywords:["terms","legal","service"]},
 {id:"support",name:"Support",keywords:["help","support","contact","issue"]},
 {id:"setup",name:"Setup Guide",keywords:["setup","configuration","oauth","firebase","flutterwave"]}
];


const FLW_TOKEN_URL="https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token";
const FLW_V4_BASE=process.env.FLW_BASE_URL || (process.env.FLW_ENV==="production"
  ?"https://f4bexperience.flutterwave.com"
  :"https://developersandbox-api.flutterwave.com");
const PLANS={
  monthly:{amount:3.99,currency:"USD",ngnAmount:4500,interval:"monthly",label:"Monthly"},
  yearly:{amount:30,currency:"USD",ngnAmount:40000,interval:"yearly",label:"Yearly"}
};
let flwToken={value:null,expiresAt:0};

function requireFlwConfig(){
  if(!process.env.FLW_CLIENT_ID||!process.env.FLW_CLIENT_SECRET)
    throw Object.assign(new Error("Flutterwave v4 credentials are not configured."),{status:503});
}
async function getFlwToken(){
  requireFlwConfig();
  if(flwToken.value && Date.now()<flwToken.expiresAt-60000)return flwToken.value;
  const body=new URLSearchParams({
    client_id:process.env.FLW_CLIENT_ID,
    client_secret:process.env.FLW_CLIENT_SECRET,
    grant_type:"client_credentials"
  });
  const r=await fetch(FLW_TOKEN_URL,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body});
  const d=await r.json().catch(()=>({}));
  if(!r.ok||!d.access_token)throw Object.assign(new Error(d.error_description||d.message||"Flutterwave authentication failed."),{status:502});
  flwToken={value:d.access_token,expiresAt:Date.now()+Number(d.expires_in||600)*1000};
  return flwToken.value;
}
function flwHeaders(token,idempotency){
  const trace=`flipcloud-${Date.now()}-${Math.random().toString(36).slice(2,12)}`;
  return {
    Authorization:`Bearer ${token}`,"Content-Type":"application/json",
    "X-Trace-Id":trace,"X-Idempotency-Key":idempotency||`${Date.now()}${Math.random().toString(36).slice(2,14)}`
  };
}
async function flwV4(endpoint,options={}){
  const token=await getFlwToken();
  const r=await fetch(FLW_V4_BASE+endpoint,{...options,headers:{...flwHeaders(token,options.idempotencyKey),...(options.headers||{})}});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw Object.assign(new Error(d?.error?.message||d?.message||d?.error_description||`Flutterwave request failed (${r.status}).`),{status:r.status,data:d});
  return d;
}

const API_CATALOG=[
 {id:"resource-manager",name:"Cloud Resource Manager",service:"cloudresourcemanager.googleapis.com",keywords:["project","projects","cloud","resource","manager"]},
 {id:"service-usage",name:"Service Usage",service:"serviceusage.googleapis.com",keywords:["api","enable","disable","service","services"]},
 {id:"firebase",name:"Firebase Management",service:"firebase.googleapis.com",keywords:["firebase","app","project","android","ios","web"]},
 {id:"firestore",name:"Cloud Firestore",service:"firestore.googleapis.com",keywords:["firestore","database","nosql","db"]},
 {id:"fcm",name:"Firebase Cloud Messaging",service:"fcm.googleapis.com",keywords:["notification","push","fcm","messaging"]},
 {id:"identity-toolkit",name:"Identity Toolkit",service:"identitytoolkit.googleapis.com",keywords:["auth","authentication","login","signup","identity"]},
 {id:"iam",name:"Cloud IAM",service:"iam.googleapis.com",keywords:["iam","permission","role","access","service account"]},
 {id:"iam-credentials",name:"IAM Credentials",service:"iamcredentials.googleapis.com",keywords:["credentials","token","service account","impersonation"]},
 {id:"cloud-billing",name:"Cloud Billing",service:"cloudbilling.googleapis.com",keywords:["billing","bill","budget","cost"]},
 {id:"secret-manager",name:"Secret Manager",service:"secretmanager.googleapis.com",keywords:["secret","keys","password","credentials"]},
 {id:"compute",name:"Compute Engine",service:"compute.googleapis.com",keywords:["compute","vm","server","virtual machine"]},
 {id:"run",name:"Cloud Run",service:"run.googleapis.com",keywords:["cloud run","container","deploy","serverless"]},
 {id:"storage",name:"Cloud Storage",service:"storage.googleapis.com",keywords:["storage","bucket","files","object"]},
 {id:"pubsub",name:"Pub/Sub",service:"pubsub.googleapis.com",keywords:["queue","event","pubsub","message"]},
 {id:"sheets",name:"Google Sheets API",service:"sheets.googleapis.com",keywords:["sheet","spreadsheet","google sheets"]},
 {id:"drive",name:"Google Drive API",service:"drive.googleapis.com",keywords:["drive","file","files","document"]},
 {id:"gmail",name:"Gmail API",service:"gmail.googleapis.com",keywords:["gmail","email","mail"]},
 {id:"youtube",name:"YouTube Data API",service:"youtube.googleapis.com",keywords:["youtube","video","channel","creator"]},
 {id:"maps",name:"Maps JavaScript API",service:"maps.googleapis.com",keywords:["maps","map","location","places"]},
 {id:"translate",name:"Cloud Translation",service:"translate.googleapis.com",keywords:["translate","language","translation"]},
 {id:"vision",name:"Cloud Vision",service:"vision.googleapis.com",keywords:["vision","ocr","image","text recognition"]},
 {id:"speech",name:"Speech-to-Text",service:"speech.googleapis.com",keywords:["speech","voice","audio","transcription"]},
 {id:"texttospeech",name:"Text-to-Speech",service:"texttospeech.googleapis.com",keywords:["tts","voice","speech","audio"]},
 {id:"vertex",name:"Vertex AI",service:"aiplatform.googleapis.com",keywords:["ai","gemini","vertex","machine learning","model"]}
];

function oauth(){
 return new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID,process.env.GOOGLE_CLIENT_SECRET,process.env.GOOGLE_REDIRECT_URI);
}
function oauthConfigured(){return Boolean(process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET&&process.env.GOOGLE_REDIRECT_URI)}
function safeGoogleError(e,fallback){
 const status=e?.response?.status||e?.code;
 const message=e?.response?.data?.error?.message||e?.errors?.[0]?.message||e?.message||fallback;
 return {status,message};
}
function requireGoogle(req,res,next){
 if(!req.session.google) return res.status(401).json({error:"SESSION_EXPIRED",message:"Your Google session expired. Sign in again to continue."});
 const c=oauth(); c.setCredentials(req.session.google);
 c.on("tokens",t=>req.session.google={...req.session.google,...t});
 req.googleAuth=c; next();
}
function errorPayload(e,fallback){
 return {error:e?.errors?.[0]?.message||e?.response?.data?.error?.message||e?.message||fallback};
}

app.get("/auth/google",(req,res)=>{
 if(!oauthConfigured()) return res.redirect("/?error=oauth_not_configured");
 const state=crypto.randomBytes(24).toString("hex");
 req.session.oauthState=state;
 res.redirect(oauth().generateAuthUrl({access_type:"offline",prompt:"consent",state,scope:GOOGLE_SCOPES}));
});
app.get("/auth/google/callback",async(req,res)=>{
 try{
  if(!oauthConfigured()) return res.redirect("/?error=oauth_not_configured");
  if(!req.query.code) return res.redirect("/?error=oauth_missing_code");
  if(!req.session.oauthState || req.query.state!==req.session.oauthState) return res.redirect("/?error=oauth_state_mismatch");
  delete req.session.oauthState;
  const {tokens}=await oauth().getToken(req.query.code);
  if(!tokens.refresh_token && !req.session.google?.refresh_token) return res.redirect("/?error=oauth_no_refresh_token");
  req.session.google={...req.session.google,...tokens};
  try{const auth=oauth();auth.setCredentials(tokens);const profile=await google.oauth2({version:"v2",auth}).userinfo.get();req.session.user={email:profile.data.email||"",name:profile.data.name||""};}catch{}
  res.redirect("/?connected=1");
 }catch(e){console.error(e);res.redirect("/?error=oauth_failed")}
});
app.post("/auth/logout",(req,res)=>{req.session=null;res.json({success:true})});
app.get("/api/session",(req,res)=>res.json({
 connected:!!req.session.google,expiresAt:req.session.google?.expiry_date||null,
 github:req.session.github?{connected:true,username:req.session.github.username}:{connected:false}
}));

app.post("/api/github-session",async(req,res)=>{
 const {idToken,username}=req.body||{};
 const cleanUsername=String(username||"").trim().toLowerCase();
 if(!cleanUsername||!/^[a-z0-9-]{1,39}$/.test(cleanUsername))
  return res.status(400).json({error:"INVALID_GITHUB_USERNAME",message:"A valid GitHub username is required."});
 if(!idToken||typeof idToken!=="string")
  return res.status(400).json({error:"INVALID_TOKEN",message:"A Firebase ID token is required."});
 if(!adminAuth)
  return res.status(503).json({error:"IDENTITY_VERIFICATION_NOT_CONFIGURED",message:"Server-side identity verification is not configured yet. Add the Firebase Admin environment variables."});
 try{
  const decoded=await adminAuth.verifyIdToken(idToken);
  if(decoded.firebase?.sign_in_provider!=="github.com")
   return res.status(400).json({error:"NOT_GITHUB_SESSION",message:"This sign-in was not performed with GitHub."});
  req.session.github={uid:decoded.uid,username:cleanUsername,email:String(decoded.email||"").toLowerCase(),verifiedAt:new Date().toISOString()};
  res.json({success:true,username:cleanUsername,complimentary:sessionIsComplimentary(req)});
 }catch(e){res.status(401).json({error:"TOKEN_VERIFICATION_FAILED",message:"Flipcloud could not verify this GitHub sign-in."})}
});

app.get("/api/catalog",(req,res)=>res.json({items:API_CATALOG}));
app.get("/api/search",(req,res)=>{
 const q=String(req.query.q||"").trim().toLowerCase();
 if(!q)return res.json({results:[]});
 const terms=q.split(/\s+/).filter(Boolean);
 const scoreItem=(x,fields)=>({x,score:terms.reduce((n,t)=>n+(fields.some(v=>v.includes(t))?1:0),0)});
 const apiResults=API_CATALOG.map(x=>scoreItem(x,[x.name,x.id,x.service,...x.keywords].map(String).map(v=>v.toLowerCase())))
  .filter(r=>r.score).sort((a,b)=>b.score-a.score).slice(0,15).map(r=>({...r.x,type:"api",target:"apis"}));
 const pageResults=PAGES.map(x=>scoreItem(x,[x.name,x.id,...x.keywords].map(v=>v.toLowerCase())))
  .filter(r=>r.score).sort((a,b)=>b.score-a.score).slice(0,8).map(r=>({...r.x,type:"page",target:r.x.id}));
 res.json({results:[...pageResults,...apiResults].slice(0,20)});
});

app.get("/api/projects",requireGoogle,async(req,res)=>{
 try{
   const crm=google.cloudresourcemanager({version:"v1",auth:req.googleAuth});
   const r=await crm.projects.list({pageSize:100});
   res.json({projects:(r.data.projects||[]).map(p=>({projectId:p.projectId,name:p.name,projectNumber:p.projectNumber,lifecycleState:p.lifecycleState}))});
 }catch(e){res.status(502).json(errorPayload(e,"Unable to read Google Cloud projects."))}
});

app.get("/api/services/:projectId",requireGoogle,async(req,res)=>{
 if(!/^[a-z0-9-]{6,30}$/.test(req.params.projectId||"")) return res.status(400).json({error:"INVALID_PROJECT",message:"That project ID is invalid."});
 try{
  const su=google.serviceusage({version:"v1",auth:req.googleAuth});
  const r=await su.services.list({parent:`projects/${req.params.projectId}`,filter:"state:ENABLED",pageSize:200});
  res.json({services:(r.data.services||[]).map(x=>x.config?.name).filter(Boolean)});
 }catch(e){res.status(502).json(errorPayload(e,"Unable to inspect enabled APIs."))}
});

app.post("/api/enable-api",requireGoogle,async(req,res)=>{
 const {projectId,service}=req.body||{};
 if(!/^[a-z0-9-]{6,30}$/.test(projectId||""))return res.status(400).json({error:"INVALID_PROJECT",message:"Choose a valid Google Cloud project."});
 if(!/^[a-z0-9.-]+\.googleapis\.com$/.test(service||""))return res.status(400).json({error:"INVALID_SERVICE",message:"That is not a valid Google API service name."});
 try{
  const su=google.serviceusage({version:"v1",auth:req.googleAuth});
  const r=await su.services.enable({name:`projects/${projectId}/services/${service}`});
  res.json({success:true,service,operation:r.data});
 }catch(e){res.status(502).json(errorPayload(e,"Google rejected the API enable request. Check the project's IAM permissions and billing status."))}
});

app.post("/api/batch-enable",requireGoogle,async(req,res)=>{
 const {projectId,services}=req.body||{};
 if(!/^[a-z0-9-]{6,30}$/.test(projectId||"")||!Array.isArray(services)||!services.length||services.length>20)
  return res.status(400).json({error:"INVALID_REQUEST",message:"Provide one project and 1–20 valid services."});
 const clean=[...new Set(services.filter(s=>/^[a-z0-9.-]+\.googleapis\.com$/.test(s)))];
 if(!clean.length)return res.status(400).json({error:"INVALID_SERVICES",message:"No valid Google API services were supplied."});
 try{
  const su=google.serviceusage({version:"v1",auth:req.googleAuth});
  const r=await su.services.batchEnable({parent:`projects/${projectId}`,requestBody:{serviceIds:clean}});
  await sendSessionNotification(req,"Flipcloud setup","Google accepted your API setup request. Recheck the project shortly.");
  res.json({success:true,operation:r.data,requested:clean});
 }catch(e){res.status(502).json(errorPayload(e,"Batch API setup failed. Review IAM permissions and billing."))}
});


app.get("/api/billing/plans",(req,res)=>res.json({plans:PLANS,recurring:"v4 tokenized card charges"}));

function requireBillingInternal(req,res,next){
 const key=process.env.FLIPCLOUD_INTERNAL_BILLING_KEY;
 if(!key)return res.status(503).json({error:"BILLING_INTERNAL_NOT_CONFIGURED",message:"Internal billing operations are not enabled."});
 const supplied=String(req.headers["x-flipcloud-billing-key"]||"");
 if(supplied.length!==key.length||!crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(key)))return res.status(403).json({error:"FORBIDDEN",message:"This billing operation is server-only."});
 next();
}

app.post("/api/billing/v4/customer",requireBillingInternal,async(req,res)=>{
  try{
    const {email,name,phone}=req.body||{};
    if(!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({error:"INVALID_EMAIL",message:"Enter a valid billing email."});
    const names=String(name||"Customer").trim().split(/\s+/);
    const d=await flwV4("/customers",{method:"POST",body:JSON.stringify({
      email,name:{first:names[0]||"Customer",last:names.slice(1).join(" ")||"User"},
      ...(phone?{phone:{country_code:"234",number:String(phone).replace(/\D/g,"").replace(/^234/,"")}}:{})
    })});
    res.json({success:true,data:d.data});
  }catch(e){res.status(e.status||502).json({error:"FLUTTERWAVE_ERROR",message:e.message,data:e.data})}
});

app.post("/api/billing/v4/recurring-charge",requireBillingInternal,async(req,res)=>{
  try{
    const {customerId,paymentMethodId,plan,email}=req.body||{};
    if(!customerId||!paymentMethodId||!PLANS[plan])return res.status(400).json({error:"INVALID_BILLING_REQUEST",message:"A customer ID, payment method ID and valid plan are required."});
    const p=PLANS[plan];
    // v4 recurring charges require a previously-created/tokenized payment method.
    const reference=`FLIP-${plan}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const d=await flwV4("/charges",{method:"POST",idempotencyKey:reference,body:JSON.stringify({
      reference,amount:p.ngnAmount,currency:"NGN",customer_id:customerId,payment_method_id:paymentMethodId,
      recurring:true,description:`Flipcloud ${p.label} subscription`,
      meta:{product:"flipcloud",plan,customer_email:email||""}
    })});
    res.json({success:d?.status==="success",data:d.data||d});
  }catch(e){res.status(e.status||502).json({error:"FLUTTERWAVE_ERROR",message:e.message,data:e.data})}
});

app.get("/api/billing/v4/charge/:id",requireBillingInternal,async(req,res)=>{
  try{const d=await flwV4(`/charges/${encodeURIComponent(req.params.id)}`,{method:"GET"});res.json({success:true,data:d.data||d})}
  catch(e){res.status(e.status||502).json({error:"FLUTTERWAVE_ERROR",message:e.message,data:e.data})}
});

app.post("/api/billing/hosted-subscription",async(req,res)=>{
  // Flutterwave's documented Payment Plan/Hosted Checkout subscription enrollment is currently exposed
  // through its Standard v3 checkout API. v4 recurring charges are used after a tokenized payment method exists.
  try{
    const {email,name,plan}=req.body||{};
    if(!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!PLANS[plan])
      return res.status(400).json({error:"INVALID_BILLING_REQUEST",message:"Provide a valid email and choose Monthly or Yearly."});
    if(isComplimentaryEmail(email)||sessionIsComplimentary(req)){
      const p=PLANS[plan];
      const sub={email:email.toLowerCase(),plan,status:"active",amount:0,currency:p.currency,complimentary:true,updatedAt:new Date().toISOString()};
      await saveDoc("subscriptions",email.toLowerCase(),sub).catch(e=>console.error("Complimentary subscription persistence failed:",e.message));
      req.session.subscription=sub;
      return res.json({success:true,complimentary:true,message:"This account has complimentary Flipcloud Pro access. It has been activated — no payment required."});
    }
    if(!process.env.FLW_PUBLIC_KEY||!process.env.FLW_SECRET_KEY||!process.env.FLW_MONTHLY_PLAN_ID||!process.env.FLW_YEARLY_PLAN_ID||!process.env.FLW_REDIRECT_URL)
      return res.status(503).json({error:"CHECKOUT_NOT_CONFIGURED",message:"Flutterwave checkout needs public/secret credentials, both Payment Plan IDs and a production redirect URL."});
    const planId=plan==="monthly"?process.env.FLW_MONTHLY_PLAN_ID:process.env.FLW_YEARLY_PLAN_ID;
    const tx=`flipcloud-${plan}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const r=await fetch("https://api.flutterwave.com/v3/payments",{method:"POST",headers:{"Authorization":`Bearer ${process.env.FLW_SECRET_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({
      tx_ref:tx,amount:plan==="monthly"?4500:40000,currency:"NGN",
      redirect_url:process.env.FLW_REDIRECT_URL,
      customer:{email,name:name||"Flipcloud Customer"},payment_plan:Number(planId),
      payment_options:"card",meta:{product:"flipcloud",plan}
    })});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||!d?.data?.link)throw Object.assign(new Error(d?.message||"Flutterwave checkout could not be created."),{status:502,data:d});
    req.session.pendingBilling={txRef:tx,plan,email,name:name||"Flipcloud Customer",amount:plan==="monthly"?4500:40000,currency:"NGN",createdAt:Date.now()};
    res.json({success:true,link:d.data.link,reference:tx,plan});
  }catch(e){res.status(e.status||502).json({error:"CHECKOUT_ERROR",message:e.message,data:e.data})}
});

app.get("/billing-callback",async(req,res)=>{
 const txId=String(req.query.transaction_id||"");
 const status=String(req.query.status||"");
 const pending=req.session.pendingBilling;
 let verified=false, reason="Payment was not verified.";
 try{
  if(status==="successful"&&/^\d+$/.test(txId)&&pending){
   const r=await fetch(`https://api.flutterwave.com/v3/transactions/${txId}/verify`,{headers:{Authorization:`Bearer ${process.env.FLW_SECRET_KEY}`}});
   const d=await r.json().catch(()=>({})); const x=d.data||{};
   const ref=String(x.tx_ref||""); const amount=Number(x.amount); const currency=String(x.currency||"");
   verified=r.ok&&d.status==="success"&&x.status==="successful"&&ref===pending.txRef&&amount===Number(pending.amount)&&currency===pending.currency;
   reason=verified?"Payment verified successfully.":"Payment returned but did not pass server-side verification.";
   if(verified){
    const sub={email:pending.email,plan:pending.plan,status:"active",amount:pending.amount,currency:pending.currency,transactionId:String(x.id||txId),txRef:pending.txRef,updatedAt:new Date().toISOString()};
    await saveDoc("subscriptions",pending.email.toLowerCase(),sub);
    req.session.subscription=sub;
    delete req.session.pendingBilling;
   }
  }
 }catch(e){console.error("Billing callback verification failed:",e.message);reason="We could not verify the payment right now. Your payment will be reconciled from the webhook."}
 res.send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Flipcloud Billing</title><style>body{font:16px system-ui;display:grid;place-items:center;min-height:100vh;background:#fafafa}.box{max-width:520px;padding:28px;background:#fff;border:1px solid #ddd;border-radius:20px}a{color:#000}</style><div class="box"><h1>${verified?"Pro activated":"Payment processing"}</h1><p>${reason} ${txId?`Reference: ${txId}`:""}</p><a href="/">Return to Flipcloud</a></div>`);
});

app.get("/api/billing/status",async(req,res)=>{
 const email=String(req.session.user?.email||req.session.github?.email||req.session.subscription?.email||"").toLowerCase();
 if(sessionIsComplimentary(req))
  return res.json({active:true,plan:"complimentary",renewal:null,email:email||null,complimentary:true});
 if(!email)return res.json({active:false,source:"not-signed-in"});
 const sub=await getDoc("subscriptions",email).catch(()=>null);
 const local=req.session.subscription; const current=sub||local;
 const active=Boolean(current&&current.status==="active");
 res.json({active,plan:active?current.plan:null,renewal:active?current.updatedAt:null,email});
});

app.get("/api/billing/verify/:transactionId",async(req,res)=>{
 try{
  if(!process.env.FLW_SECRET_KEY)return res.status(503).json({error:"BILLING_NOT_CONFIGURED",message:"Flutterwave secret key is not configured."});
  const id=String(req.params.transactionId||"");if(!/^\d+$/.test(id))return res.status(400).json({error:"INVALID_TRANSACTION",message:"Invalid transaction ID."});
  const r=await fetch(`https://api.flutterwave.com/v3/transactions/${id}/verify`,{headers:{Authorization:`Bearer ${process.env.FLW_SECRET_KEY}`}});const d=await r.json().catch(()=>({}));
  if(!r.ok)return res.status(r.status).json({error:"FLUTTERWAVE_ERROR",message:d.message||"Transaction verification failed."});
  res.json({success:d.status==="success",data:d.data||null});
 }catch(e){res.status(e.status||502).json({error:"VERIFY_ERROR",message:e.message})}
});

app.post("/flw-webhook",async(req,res)=>{
  const secret=process.env.FLW_SECRET_HASH;
  const v4Signature=req.headers["flutterwave-signature"];
  const legacySignature=req.headers["verif-hash"];
  let valid=false;
  if(secret && v4Signature && req.rawBody){
    const expected=crypto.createHmac("sha256",secret).update(req.rawBody).digest("base64");
    valid=Buffer.byteLength(expected)===Buffer.byteLength(String(v4Signature)) && crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(String(v4Signature)));
  } else if(secret && process.env.FLW_ALLOW_V3_WEBHOOK==="true" && legacySignature){
    valid=crypto.timingSafeEqual(Buffer.from(String(legacySignature)),Buffer.from(String(secret)));
  }
  if(!valid) return res.status(401).end();
  const event=req.body||{};
  const data=event.data||{};
  const meta=data.meta||{}; const email=String(meta.customer_email||data.customer?.email||"").toLowerCase();
  const txRef=String(data.tx_ref||data.reference||"");
  const plan=meta.plan||((Number(data.amount)===40000)?"yearly":(Number(data.amount)===4500?"monthly":null));
  const paymentStatus=String(data.status||event.type||event.event||"").toLowerCase();
  if(email&&plan){
   const active=["successful","completed","charge.completed","subscription.payment_successful","payment_successful"].some(x=>paymentStatus.includes(x));
   await saveDoc("subscriptions",email,{email,plan,status:active?"active":"past_due",amount:Number(data.amount)||0,currency:data.currency||"NGN",txRef,transactionId:String(data.id||data.transaction_id||""),updatedAt:new Date().toISOString(),eventType:event.type||event.event||"unknown"}).catch(e=>console.error("Subscription persistence failed:",e.message));
  }
  console.log("Verified Flutterwave webhook:",event.type||event.event||"unknown",data.id||data.transaction_id||"");
  return res.status(200).json({received:true});
});

async function isPrivateHost(hostname){
 const h=hostname.toLowerCase().replace(/\.$/,"");
 if(h==="localhost"||h.endsWith(".localhost")||h.endsWith(".local")||h.endsWith(".internal"))return true;
 const ip=net.isIP(h); if(ip===4){const p=h.split(".").map(Number);return p[0]===10||p[0]===127||p[0]===169&&p[1]===254||p[0]===172&&p[1]>=16&&p[1]<=31||p[0]===192&&p[1]===168||p[0]===0||p[0]>=224}
 if(ip===6)return h==="::1"||h.startsWith("fc")||h.startsWith("fd")||h.startsWith("fe80:")||h==="::";
 try{const records=await dns.lookup(h,{all:true});const flags=await Promise.all(records.map(r=>isPrivateHost(r.address)));return flags.some(Boolean)}catch{return true}
}
async function fetchWebsite(url){
 let current=new URL(url);
 for(let i=0;i<4;i++){
  if(await isPrivateHost(current.hostname))throw Object.assign(new Error("Private host"),{code:"PRIVATE_HOST"});
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),5000);
  let r;try{r=await fetch(current,{redirect:"manual",signal:controller.signal,headers:{"user-agent":"Flipcloud-Website-Scanner/1.0"}})}finally{clearTimeout(timer)}
  if([301,302,303,307,308].includes(r.status)){
   const loc=r.headers.get("location");if(!loc)break;current=new URL(loc,current);if(!["http:","https:"].includes(current.protocol))throw Object.assign(new Error("Unsupported redirect protocol"),{code:"BAD_REDIRECT"});continue;
  }
  return {r,current};
 }
 throw new Error("Too many redirects");
}
app.post("/api/website-scan",async(req,res)=>{
 const raw=String(req.body?.url||"").trim();let target;
 try{target=new URL(raw)}catch{return res.status(400).json({error:"INVALID_URL",message:"Enter a complete website URL, for example https://example.com."})}
 if(!["http:","https:"].includes(target.protocol))return res.status(400).json({error:"INVALID_URL",message:"Only HTTP and HTTPS websites can be scanned."});
 if(target.username||target.password)return res.status(400).json({error:"INVALID_URL",message:"URLs with embedded usernames or passwords are not allowed."});
 try{
  const {r,current}=await fetchWebsite(target.href); const ct=r.headers.get("content-type")||"";
  const text=ct.includes("text/html")?(await r.text()).slice(0,1000000):""; const lower=text.toLowerCase(); const has=re=>re.test(lower);
  const links=[...text.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)].slice(0,200).map(m=>m[1]);
  const scripts=(text.match(/<script\b/gi)||[]).length;
  let robots=false,sitemap=false;
  const checks=await Promise.all(["robots.txt","sitemap.xml"].map(async name=>{try{const u=new URL("/"+name,current);const rr=await fetchWebsite(u.href);return [name,rr.r.status>=200&&rr.r.status<400]}catch{return [name,false]}}));
  for(const [name,ok] of checks){if(name==="robots.txt")robots=ok;if(name==="sitemap.xml")sitemap=ok}
  const result={url:current.href,status:r.status,contentType:ct,https:current.protocol==="https:",checks:{title:has(/<title\b[^>]*>\s*[^<]+<\/title>/),description:has(/<meta[^>]+name=["']description["']/),viewport:has(/<meta[^>]+name=["']viewport["']/),canonical:has(/<link[^>]+rel=["']canonical["']/),openGraph:has(/<meta[^>]+property=["']og:/),sitemap:sitemap||links.some(x=>/sitemap\.xml/i.test(x)),robots:robots||links.some(x=>/robots\.txt/i.test(x)),manifest:has(/<link[^>]+rel=["']manifest["']/),firebase:has(/firebase/i),googleSignIn:has(/google.{0,30}(signin|accounts|identity)/),fcm:has(/firebase.{0,30}(messaging|fcm)/),analytics:has(/gtag|googletagmanager|google-analytics/i),maps:has(/maps\.googleapis|google maps/i)},scripts};
  await sendSessionNotification(req,"Website scan complete",`${current.hostname} has finished scanning.`);
  res.json({success:true,result});
 }catch(e){res.status(502).json({error:e.code==="PRIVATE_HOST"?"BLOCKED_HOST":"SCAN_FAILED",message:e.code==="PRIVATE_HOST"?"Local or private network addresses cannot be scanned.":e.code==="BAD_REDIRECT"?"The website redirected to an unsupported protocol.":e.name==="AbortError"?"The website took too long to respond.":"Flipcloud could not fetch that website. Make sure it is publicly reachable over HTTPS."})}
});

app.post("/api/analyze",async(req,res)=>{
 const {code="",files=[]}=req.body||{};
 const text=[code,...(Array.isArray(files)?files.map(f=>f.content||f.path||""):[])].join("\n").toLowerCase();
 const rules=[
  ["firebase auth",["firebaseauth","getauth(","firebase/auth"],["identitytoolkit.googleapis.com","firebase.googleapis.com"]],
  ["firestore",["getfirestore","firebasefirestore","cloud_firestore","firestore"],["firestore.googleapis.com","firebase.googleapis.com"]],
  ["fcm",["firebase-messaging","getmessaging","firebase_messaging","messaging"],["fcm.googleapis.com","firebase.googleapis.com"]],
  ["google sign-in",["google-signin","googlesignin","googleaccounts"],["identitytoolkit.googleapis.com","iap.googleapis.com"]],
  ["storage",["cloud storage","storage.bucket","firebase storage","firebase_storage"],["storage.googleapis.com","firebasestorage.googleapis.com"]],
  ["youtube",["youtube data api","youtube.googleapis.com","googleapis.com/youtube"],["youtube.googleapis.com"]],
  ["maps",["google maps","maps.googleapis.com","google_maps_flutter"],["maps.googleapis.com"]],
  ["sheets",["sheets.googleapis.com","google sheets"],["sheets.googleapis.com"]],
  ["drive",["drive.googleapis.com","google drive"],["drive.googleapis.com"]]
 ];
 const detected=[];
 for(const [name,need,services] of rules)if(need.some(x=>text.includes(x)))detected.push({name,services});
 await sendSessionNotification(req,"Code analysis complete",detected.length?`${detected.length} requirement group${detected.length===1?"":"s"} detected.`:"No supported Google requirements detected.");
 res.json({detected,confidence:detected.length?"rule-based":"none",note:"Analysis is deterministic; no paid AI call is required."});
});

async function sendSessionNotification(req,title,body){
 if(!adminMessaging||!req.session.fcmToken)return false;
 try{await adminMessaging.send({token:req.session.fcmToken,notification:{title,body},data:{source:"flipcloud"}});return true}
 catch(e){if(["messaging/registration-token-not-registered","messaging/invalid-registration-token"].includes(e.code))req.session.fcmToken=null;return false}
}

app.post("/api/fcm-token",async(req,res)=>{
 const {token}=req.body||{};
 if(!token||typeof token!=="string"||token.length<20||token.length>4096)return res.status(400).json({error:"INVALID_TOKEN",message:"FCM did not return a valid registration token."});
 req.session.fcmToken=token;
 const email=String(req.session.user?.email||"").toLowerCase();
 if(email) await saveDoc("fcmTokens",crypto.createHash("sha256").update(`${email}:${token}`).digest("hex"),{email,token,updatedAt:new Date().toISOString(),userAgent:String(req.headers["user-agent"]||"").slice(0,300)}).catch(e=>console.error("FCM persistence failed:",e.message));
 res.json({success:true,persistent:Boolean(firestore),message:firestore?"Alerts are registered on this browser.":"Alerts are registered for this session; add Firebase Admin variables for persistent delivery."});
});
app.get("/api/fcm-status",async(req,res)=>{const email=String(req.session.user?.email||"").toLowerCase();res.json({registered:!!req.session.fcmToken,persistent:Boolean(firestore),email:email||null});});

app.post("/api/fcm-test",async(req,res)=>{
 if(!adminMessaging)return res.status(503).json({error:"FCM_SERVER_NOT_CONFIGURED",message:"Server-side FCM delivery is not configured yet."});
 const token=req.session.fcmToken; if(!token)return res.status(400).json({error:"NO_FCM_TOKEN",message:"Enable alerts on this browser first."});
 try{const id=await adminMessaging.send({token,notification:{title:"Flipcloud test alert",body:"Push notifications are working."},data:{type:"test",source:"flipcloud"}});res.json({success:true,id});}
 catch(e){if(["messaging/registration-token-not-registered","messaging/invalid-registration-token"].includes(e.code)){req.session.fcmToken=null;return res.status(410).json({error:"FCM_TOKEN_INVALID",message:"This browser token has expired. Enable alerts again."});}res.status(502).json({error:"FCM_SEND_FAILED",message:"Flipcloud could not deliver the test notification."});}
});

app.get("/privacy",(req,res)=>res.sendFile(path.join(publicPath(),"privacy.html")));
app.get("/terms",(req,res)=>res.sendFile(path.join(publicPath(),"terms.html")));
app.get("/support",(req,res)=>res.sendFile(path.join(publicPath(),"support.html")));
app.get("/setup",(req,res)=>res.sendFile(path.join(publicPath(),"setup.html")));
app.use((req,res,next)=>{
 if(req.method!=="GET"||req.path.startsWith("/api/")||req.path.startsWith("/auth/")) return res.status(404).json({error:"NOT_FOUND",message:"The requested Flipcloud endpoint was not found."});
 res.sendFile(path.join(publicPath(),"index.html"));
});
app.use((err,req,res,next)=>{
 if(err instanceof SyntaxError && "body" in err) return res.status(400).json({error:"INVALID_JSON",message:"The request body is not valid JSON."});
 console.error(err);
 if(res.headersSent) return next(err);
 res.status(500).json({error:"SERVER_ERROR",message:"Flipcloud hit an unexpected server error. Try again; if it continues, check the server logs."});
});
const server=app.listen(PORT,()=>console.log(`Flipcloud listening on ${PORT}`));
for(const signal of ["SIGTERM","SIGINT"])process.on(signal,()=>server.close(()=>process.exit(0)));
