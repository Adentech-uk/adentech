import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cfg=window.ADENTECH_AUTH_CONFIG||{};
const requests=document.querySelector("#requests"),identity=document.querySelector("#identity");
if(!cfg.supabaseUrl||cfg.supabaseUrl.includes("YOUR-PROJECT")||!cfg.supabaseAnonKey||cfg.supabaseAnonKey.includes("YOUR_")){requests.textContent="Customer accounts are not configured yet."; }
else{
 const supabase=createClient(cfg.supabaseUrl,cfg.supabaseAnonKey);
 const {data:{session}}=await supabase.auth.getSession();
 if(!session){location.href="login.html";}else{
 identity.textContent="Signed in as "+session.user.email;
 const {data,error}=await supabase.from("service_requests").select("reference,kind,subject,status,created_at").order("created_at",{ascending:false});
 if(error){requests.textContent="We could not load your requests. Please try again later.";}
 else if(!data.length){requests.innerHTML='<p class="empty">No requests are linked to this account yet. When you submit a request while signed in, it will appear here.</p>';}
 else{requests.replaceChildren(...data.map(item=>{const article=document.createElement("article");article.className="request";const title=document.createElement("h3");title.textContent=item.subject||"AdenTech request";const meta=document.createElement("p");meta.textContent=(item.reference||"Pending reference")+" · "+(item.kind==="quote"?"Quote request":"Enquiry")+" · "+new Date(item.created_at).toLocaleDateString("en-GB");const status=document.createElement("span");status.className="status";status.textContent=item.status||"Received";article.append(title,meta,status);return article;}));}
 }
}
document.querySelector("#signout").addEventListener("click",async()=>{if(cfg.supabaseUrl&&!cfg.supabaseUrl.includes("YOUR-PROJECT")){const supabase=createClient(cfg.supabaseUrl,cfg.supabaseAnonKey);await supabase.auth.signOut();}location.href="login.html";});