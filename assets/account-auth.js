import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cfg=window.ADENTECH_AUTH_CONFIG||{};
const message=document.querySelector("#message");
const form=document.querySelector("#auth-form");
const password=document.querySelector("#password");
const submit=document.querySelector("#submit");
const loginTab=document.querySelector("#show-login");
const signupTab=document.querySelector("#show-signup");
if(!cfg.supabaseUrl||cfg.supabaseUrl.includes("YOUR-PROJECT")||!cfg.supabaseAnonKey||cfg.supabaseAnonKey.includes("YOUR_")){message.textContent="Account sign-in is not configured yet. The owner must complete the secure Supabase setup first.";form.hidden=true;document.querySelector("#reset").hidden=true;}
else{
 const supabase=createClient(cfg.supabaseUrl,cfg.supabaseAnonKey);
 let mode="login";
 function setMode(next){mode=next;loginTab.classList.toggle("active",mode==="login");signupTab.classList.toggle("active",mode==="signup");submit.textContent=mode==="login"?"Sign in":"Create account";password.autocomplete=mode==="login"?"current-password":"new-password";message.textContent="";}
 loginTab.addEventListener("click",()=>setMode("login"));signupTab.addEventListener("click",()=>setMode("signup"));
 form.addEventListener("submit",async e=>{e.preventDefault();submit.disabled=true;message.textContent="Please wait…";try{const email=document.querySelector("#email").value.trim();const pass=password.value;if(mode==="signup"){const {error}=await supabase.auth.signUp({email,password:pass,options:{emailRedirectTo:location.origin+location.pathname.replace("login.html","account.html")}});if(error)throw error;message.textContent="If registration is enabled, check your email to confirm your account before signing in.";}else{const {error}=await supabase.auth.signInWithPassword({email,password:pass});if(error)throw error;location.href="account.html";}}catch(err){message.textContent=err.message||"We could not complete sign-in.";}finally{submit.disabled=false;}});
 document.querySelector("#reset").addEventListener("click",async()=>{const email=document.querySelector("#email").value.trim();if(!email){message.textContent="Enter your email address first.";return;}const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname.replace("login.html","reset-password.html")});message.textContent=error?error.message:"If the account exists, a password reset email will be sent."});
 supabase.auth.getSession().then(({data})=>{if(data.session)location.href="account.html";});
}