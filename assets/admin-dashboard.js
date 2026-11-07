import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cfg=window.ADENTECH_AUTH_CONFIG||{},message=document.querySelector("#message"),mfa=document.querySelector("#mfa"),dashboard=document.querySelector("#dashboard");
if(!cfg.supabaseUrl||cfg.supabaseUrl.includes("YOUR-PROJECT")||!cfg.supabaseAnonKey||cfg.supabaseAnonKey.includes("YOUR_")){message.textContent="Administrator sign-in is not configured. Complete the Supabase setup before enabling this dashboard.";}
else{
 const supabase=createClient(cfg.supabaseUrl,cfg.supabaseAnonKey);
 const {data:{session}}=await supabase.auth.getSession();
 if(!session){location.href="login.html";}
 else{
  const role=session.user.app_metadata?.role;
  if(role!=="admin"){message.textContent="Access denied. This account is not an authorised administrator.";}
  else{
   const {data:aal,error:aalError}=await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
   if(aalError){message.textContent="Could not verify your MFA status. Access is blocked.";}
   else if(aal.currentLevel!=="aal2"){
    const {data:factors}=await supabase.auth.mfa.listFactors();
    const verified=(factors?.totp||[]).find(f=>f.status==="verified");
    if(!verified){
     const {data:enrol,error}=await supabase.auth.mfa.enroll({factorType:"totp",friendlyName:"AdenTech admin authenticator"});
     if(error){message.textContent=error.message;}else{mfa.hidden=false;document.querySelector("#qr").innerHTML=enrol.totp.qr_code;window.factorId=enrol.id;message.textContent="Scan the QR code with an authenticator app, then enter its six-digit code.";}
    }else{
     const {data:challenge,error}=await supabase.auth.mfa.challenge({factorId:verified.id});
     if(error){message.textContent=error.message;}else{mfa.hidden=false;window.factorId=verified.id;window.challengeId=challenge.id;document.querySelector("#qr").textContent="Enter the current code from your authenticator app.";message.textContent="MFA verification is required before dashboard access.";}
    }
   }else{await loadDashboard();}
  }
 }
 async function loadDashboard(){mfa.hidden=true;dashboard.hidden=false;message.textContent="Administrator access verified with MFA.";const {data,error}=await supabase.from("service_requests").select("reference,kind,subject,status,created_at,customer_email").order("created_at",{ascending:false});const target=document.querySelector("#requests");if(error){target.textContent="Could not load requests. Check database policies and setup.";}else if(!data.length){target.textContent="No requests are recorded yet.";}else{target.replaceChildren(...data.map(item=>{const el=document.createElement("article");el.className="request";const h=document.createElement("h3");h.textContent=(item.reference||"Request")+" — "+(item.subject||"No subject");const p=document.createElement("p");p.textContent=(item.customer_email||"Customer")+" · "+(item.kind||"Enquiry")+" · "+new Date(item.created_at).toLocaleString("en-GB");const s=document.createElement("span");s.className="status";s.textContent=item.status||"Received";el.append(h,p,s);return el;}));}}
 document.querySelector("#verify-mfa").addEventListener("click",async()=>{const code=document.querySelector("#totp").value.trim();if(!/^\d{6}$/.test(code)){message.textContent="Enter the six-digit code from your authenticator app.";return;}try{if(!window.challengeId){const {data:challenge,error}=await supabase.auth.mfa.challenge({factorId:window.factorId});if(error)throw error;window.challengeId=challenge.id;}const {error}=await supabase.auth.mfa.verify({factorId:window.factorId,challengeId:window.challengeId,code});if(error)throw error;await loadDashboard();}catch(err){message.textContent=err.message||"MFA verification failed.";window.challengeId=null;}});
}
document.querySelector("#signout").addEventListener("click",async()=>{if(cfg.supabaseUrl&&!cfg.supabaseUrl.includes("YOUR-PROJECT")){const supabase=createClient(cfg.supabaseUrl,cfg.supabaseAnonKey);await supabase.auth.signOut();}location.href="login.html";});