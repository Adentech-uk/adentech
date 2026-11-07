import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cfg=window.ADENTECH_AUTH_CONFIG||{},form=document.querySelector("#reset-form"),message=document.querySelector("#message");
if(!cfg.supabaseUrl||cfg.supabaseUrl.includes("YOUR-PROJECT")||!cfg.supabaseAnonKey||cfg.supabaseAnonKey.includes("YOUR_")){message.textContent="Password reset is not configured yet.";form.hidden=true;}
else{
 const supabase=createClient(cfg.supabaseUrl,cfg.supabaseAnonKey);
 form.addEventListener("submit",async event=>{event.preventDefault();const password=document.querySelector("#password").value,confirm=document.querySelector("#confirm").value;if(password!==confirm){message.textContent="The passwords do not match.";return;}if(password.length<12){message.textContent="Use at least 12 characters.";return;}const {error}=await supabase.auth.updateUser({password});if(error){message.textContent=error.message;}else{message.textContent="Your password has been updated. You can now sign in.";form.hidden=true;}});
}