import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cfg=window.ADENTECH_AUTH_CONFIG||{},message=document.querySelector("#message"),mfa=document.querySelector("#mfa"),dashboard=document.querySelector("#dashboard");
const statuses=["received","under_review","awaiting_customer","quote_draft","approved","completed","closed"];
let supabase;
if(!cfg.supabaseUrl||cfg.supabaseUrl.includes("YOUR-PROJECT")||!cfg.supabaseAnonKey||cfg.supabaseAnonKey.includes("YOUR_")){message.textContent="Administrator sign-in is not configured. Complete the Supabase setup before enabling this dashboard.";}
else{
 supabase=createClient(cfg.supabaseUrl,cfg.supabaseAnonKey);
 const {data:{session}}=await supabase.auth.getSession();
 if(!session){location.href="login.html";}
 else if(session.user.app_metadata?.role!=="admin"){message.textContent="Access denied. This account is not an authorised administrator.";}
 else{
  const {data:aal,error:aalError}=await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if(aalError){message.textContent="Could not verify your MFA status. Access is blocked.";}
  else if(aal.currentLevel!=="aal2"){
   const {data:factors,error}=await supabase.auth.mfa.listFactors();
   if(error){message.textContent="Could not load MFA factors. Access is blocked.";}
   else{
    const verified=(factors?.totp||[]).find(f=>f.status==="verified");
    if(!verified){
     const {data:enrol,error:enrolError}=await supabase.auth.mfa.enroll({factorType:"totp",friendlyName:"AdenTech admin authenticator"});
     if(enrolError){message.textContent=enrolError.message;}
     else{mfa.hidden=false;const qr=document.createElement("img");qr.alt="Authenticator app setup QR code";qr.src=enrol.totp.qr_code;qr.width=220;qr.height=220;document.querySelector("#qr").replaceChildren(qr);const manual=document.createElement("p");manual.textContent="Manual setup key: "+enrol.totp.secret;document.querySelector("#qr").append(manual);window.factorId=enrol.id;message.textContent="Scan the QR code with an authenticator app, then enter its six-digit code.";}
    }else{
     const {data:challenge,error:challengeError}=await supabase.auth.mfa.challenge({factorId:verified.id});
     if(challengeError){message.textContent=challengeError.message;}
     else{mfa.hidden=false;window.factorId=verified.id;window.challengeId=challenge.id;document.querySelector("#qr").textContent="Enter the current code from your authenticator app.";message.textContent="MFA verification is required before dashboard access.";}
    }
   }
  }else{await loadDashboard();}
 }
}
async function loadDashboard(){
 mfa.hidden=true;dashboard.hidden=false;message.textContent="Administrator access verified with MFA.";
 const {data,error}=await supabase.from("service_requests").select("reference,kind,subject,status,created_at,customer_email").order("created_at",{ascending:false});
 const target=document.querySelector("#requests");
 if(error){target.textContent="Could not load requests. Check database policies and setup.";return;}
 if(!data.length){target.textContent="No requests are recorded yet.";return;}
 target.replaceChildren(...data.map(item=>{
  const el=document.createElement("article");el.className="request";
  const h=document.createElement("h3");h.textContent=(item.reference||"Request")+" — "+(item.subject||"No subject");
  const p=document.createElement("p");p.textContent=(item.customer_email||"Customer")+" · "+(item.kind||"Enquiry")+" · "+new Date(item.created_at).toLocaleString("en-GB");
  const select=document.createElement("select");select.setAttribute("aria-label","Update status for "+(item.reference||"request"));
  statuses.forEach(value=>{const option=document.createElement("option");option.value=value;option.textContent=value.replaceAll("_"," ");option.selected=value===(item.status||"received");select.append(option);});
  const button=document.createElement("button");button.type="button";button.className="link";button.textContent="Save status";
  button.addEventListener("click",async()=>{button.disabled=true;const {error:updateError}=await supabase.from("service_requests").update({status:select.value,updated_at:new Date().toISOString()}).eq("reference",item.reference);button.disabled=false;if(updateError){message.textContent="Status was not changed. Check the admin policy and MFA session.";}else{message.textContent="Request "+item.reference+" updated.";await loadDashboard();}});
  el.append(h,p,select,button);return el;
 }));
}
document.querySelector("#verify-mfa").addEventListener("click",async()=>{
 const code=document.querySelector("#totp").value.trim();
 if(!/^\d{6}$/.test(code)){message.textContent="Enter the six-digit code from your authenticator app.";return;}
 try{
  if(!window.challengeId){const {data:challenge,error}=await supabase.auth.mfa.challenge({factorId:window.factorId});if(error)throw error;window.challengeId=challenge.id;}
  const {error}=await supabase.auth.mfa.verify({factorId:window.factorId,challengeId:window.challengeId,code});
  if(error)throw error;await loadDashboard();
 }catch(err){message.textContent=err.message||"MFA verification failed.";window.challengeId=null;}
});
document.querySelector("#signout").addEventListener("click",async()=>{if(supabase)await supabase.auth.signOut();location.href="login.html";});
