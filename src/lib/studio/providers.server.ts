/**
 * Official provider adapters. Pure functions: keys and fetch are injected so they
 * can be tested with mocks. Never log keys, tokens or full provider payloads.
 */
import { base64Url, base64UrlString, base64ToBytes } from "./encoding";
import { assertProviderMediaUrl } from "./validation";
import { MAX_VIDEO_BYTES } from "./constants";
import { NEGATIVE_PROMPT } from "./prompts";

type Fetch = typeof fetch;
export type InlineImage = { mimeType: string; data: string };

export const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
export const VSA_BASE = "https://api.virtualstagingai.app/v2";
export const KLING_BASE = "https://api-singapore.klingai.com/v1";

export class ProviderError extends Error {}

async function call(f: Fetch, url: string, init: RequestInit & { json?: unknown } = {}) {
  const headers = new Headers(init.headers);
  let body = init.body;
  if (init.json !== undefined) { headers.set("Content-Type", "application/json"); body = JSON.stringify(init.json); }
  let r: Response;
  try {
    r = await f(url, { ...(init as RequestInit), headers, body: body ?? null, redirect: "error", signal: AbortSignal.timeout(55_000) });
  } catch (e) {
    throw new ProviderError("Falha de rede ao contatar o provedor: " + (e instanceof Error ? e.name : "erro"));
  }
  const d = (await r.json().catch(() => ({}))) as Record<string, any>;
  const klingCode = typeof d["code"] === "number" && d["code"] !== 0;
  if (!r.ok || klingCode) {
    const msg = "verifique credenciais, saldo, cotas e modelo";
    throw new ProviderError(`Provedor retornou ${r.status}: ${msg}`);
  }
  return d;
}

/* ---------------- Gemini · Nano Banana ---------------- */
export async function geminiCheck(key: string, f: Fetch = fetch) {
  await call(f, `${GEMINI_BASE}/models?pageSize=1`, { headers: { "x-goog-api-key": key } });
}
export async function geminiStage(
  p: { key: string; model: string; prompt: string; image: InlineImage },
  f: Fetch = fetch,
): Promise<InlineImage> {
  const d = await call(f, `${GEMINI_BASE}/models/${encodeURIComponent(p.model)}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": p.key },
    json: {
      contents: [{ parts: [{ text: p.prompt }, { inlineData: p.image }] }],
      generationConfig: { responseModalities: ["IMAGE"] },
    },
  });
  const parts = (d["candidates"] ?? []).flatMap((c: any) => c?.content?.parts ?? []);
  const img = parts.map((x: any) => x?.inlineData ?? x?.inline_data).find((x: any) => x?.data);
  if (!img) {
    const reason = d["promptFeedback"]?.blockReason ?? d["candidates"]?.[0]?.finishReason;
    throw new ProviderError("O Gemini não retornou imagem" + (reason ? ` (${reason})` : "") + ".");
  }
  return { mimeType: img.mimeType ?? img.mime_type ?? "image/png", data: img.data };
}

/* ---------------- Veo 3.1: Google Cloud stable ---------------- */
export type PollResult = { state: "running" } | { state: "done"; url: string } | { state: "done"; bytes: Uint8Array } | { state: "error"; message: string };
export async function cloudAuth(raw: string, f: Fetch = fetch) {
  let account: { project_id?: string; client_email?: string; private_key?: string };
  try { account = JSON.parse(raw); } catch { throw new ProviderError("GOOGLE_SERVICE_ACCOUNT_JSON inválido."); }
  const { project_id: project, client_email: email, private_key: pem } = account;
  if (!project || !/^[a-z][a-z0-9-]{4,62}$/.test(project) || !email || !pem) throw new ProviderError("Conta de serviço Google incompleta.");
  const now = Math.floor(Date.now()/1000);
  const header = base64UrlString(JSON.stringify({alg:"RS256",typ:"JWT"}));
  const claim = base64UrlString(JSON.stringify({iss:email,scope:"https://www.googleapis.com/auth/cloud-platform",aud:"https://oauth2.googleapis.com/token",iat:now,exp:now+3600}));
  const der = base64ToBytes(pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,""));
  const key = await crypto.subtle.importKey("pkcs8", der as Uint8Array<ArrayBuffer>, {name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,new TextEncoder().encode(header+"."+claim)));
  const assertion = header+"."+claim+"."+base64Url(sig);
  const r = await f("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion}),redirect:"error",signal:AbortSignal.timeout(20000)});
  const d = await r.json().catch(()=>({}));
  if(!r.ok || typeof d.access_token !== "string") throw new ProviderError("Google Cloud não aceitou a conta de serviço.");
  return {project, token:d.access_token as string};
}
function cloudModel(project:string,model:string) {
  if(!/^[a-z][a-z0-9-]{4,62}$/.test(project) || !["veo-3.1-fast-generate-001","veo-3.1-generate-001"].includes(model)) throw new ProviderError("Modelo ou projeto inválido.");
  return "projects/"+project+"/locations/us-central1/publishers/google/models/"+model;
}
const CLOUD = "https://us-central1-aiplatform.googleapis.com/v1/";
export async function veoStart(p:{key:string;model:string;prompt:string;first:InlineImage;last:InlineImage;aspectRatio:string;resolution:string;durationSeconds:number}, f:Fetch=fetch) {
  const auth=await cloudAuth(p.key,f), model=cloudModel(auth.project,p.model);
  const d=await call(f,CLOUD+model+":predictLongRunning",{method:"POST",headers:{Authorization:"Bearer "+auth.token},json:{
    instances:[{prompt:p.prompt,image:{bytesBase64Encoded:p.first.data,mimeType:p.first.mimeType},lastFrame:{bytesBase64Encoded:p.last.data,mimeType:p.last.mimeType}}],
    parameters:{aspectRatio:p.aspectRatio,resolution:p.resolution,durationSeconds:p.durationSeconds,sampleCount:1,generateAudio:false,negativePrompt:NEGATIVE_PROMPT,personGeneration:"disallow"}
  }});
  const name=d["name"];if(typeof name!=="string"||!name.startsWith(model+"/operations/")||!/^[\w-]+$/.test(name.slice(model.length+12)))throw new ProviderError("Operação Veo inválida.");
  return name;
}
export async function veoPoll(p:{key:string;operation:string},f:Fetch=fetch):Promise<PollResult>{
  const auth=await cloudAuth(p.key,f);
  const match=p.operation.match(/^projects\/([^/]+)\/locations\/us-central1\/publishers\/google\/models\/([^/]+)\/operations\/([\w-]+)$/);
  if(!match||match[1]!==auth.project||!match[2])throw new ProviderError("Operação Veo inválida.");
  const model=cloudModel(auth.project,match[2]);
  const d=await call(f,CLOUD+model+":fetchPredictOperation",{method:"POST",headers:{Authorization:"Bearer "+auth.token},json:{operationName:p.operation}});
  if(d["error"])return {state:"error",message:"O Google Cloud informou falha na geração."};
  if(!d["done"])return {state:"running"};
  const v=d["response"]?.videos?.[0];
  if(typeof v?.bytesBase64Encoded!=="string")return {state:"error",message:"O Veo concluiu sem vídeo inline. Verifique filtros e limites."};
  if(v.bytesBase64Encoded.length>MAX_VIDEO_BYTES*1.4)throw new ProviderError("Vídeo acima do limite.");
  return {state:"done",bytes:base64ToBytes(v.bytesBase64Encoded)};
}

/* ---------------- Virtual Staging AI v2 ---------------- */
export async function vsaCheck(key: string, f: Fetch = fetch) {
  return call(f, `${VSA_BASE}/user`, { headers: { Authorization: `Api-Key ${key}` } });
}
export async function vsaStart(p: { key: string; imageUrl: string; room: string; style: string }, f: Fetch = fetch) {
  const d = await call(f, `${VSA_BASE}/renders`, {
    method: "POST",
    headers: { Authorization: `Api-Key ${p.key}` },
    json: {
      image_url: p.imageUrl,
      config: { type: "staging", add_furniture: { room_type: p.room, style: p.style }, add_virtually_staged_watermark: true },
      variation_count: 1,
      wait_for_completion: false,
    },
  });
  if (typeof d["id"] !== "string") throw new ProviderError("O Virtual Staging AI não retornou ID.");
  return d["id"] as string;
}
export async function vsaPoll(p: { key: string; id: string }, f: Fetch = fetch): Promise<PollResult> {
  const d = await call(f, `${VSA_BASE}/renders/${encodeURIComponent(p.id)}?include_variations=true`, { headers: { Authorization: `Api-Key ${p.key}` } });
  const items: any[] = d["variations"]?.items ?? [];
  const done = items.find((x) => x?.status === "done");
  if (done) {
    const r = Array.isArray(done.result) ? done.result[0] : done.result;
    if (!r?.url) return { state: "error", message: "Render concluído sem URL." };
    return { state: "done", url: r.url };
  }
  if (items.length && items.every((x) => ["error", "deleted"].includes(x?.status))) return { state: "error", message: "O Virtual Staging AI falhou." };
  return { state: "running" };
}

/* ---------------- Kling (JWT HS256 from Access Key + Secret Key) ---------------- */
export async function klingJwt(accessKey: string, secretKey: string, now = Math.floor(Date.now() / 1000)) {
  const header = base64UrlString(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64UrlString(JSON.stringify({ iss: accessKey, exp: now + 1800, nbf: now - 5 }));
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secretKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${header}.${payload}`)));
  return `${header}.${payload}.${base64Url(sig)}`;
}
export async function klingCheck(token: string, f: Fetch = fetch) {
  await call(f, `${KLING_BASE}/videos/image2video?pageNum=1&pageSize=1`, { headers: { Authorization: `Bearer ${token}` } });
}
export async function klingStart(
  p: { token: string; model: string; prompt: string; first: InlineImage; last: InlineImage; duration: number },
  f: Fetch = fetch,
) {
  const d = await call(f, `${KLING_BASE}/videos/image2video`, {
    method: "POST",
    headers: { Authorization: `Bearer ${p.token}` },
    json: {
      model_name: p.model,
      mode: "pro",
      image: p.first.data,
      image_tail: p.last.data,
      prompt: p.prompt,
      negative_prompt: NEGATIVE_PROMPT,
      duration: String(p.duration),
    },
  });
  const id = d["data"]?.task_id;
  if (typeof id !== "string") throw new ProviderError("O Kling não retornou ID da tarefa.");
  return id;
}
export async function klingPoll(p: { token: string; id: string }, f: Fetch = fetch): Promise<PollResult> {
  const d = await call(f, `${KLING_BASE}/videos/image2video/${encodeURIComponent(p.id)}`, { headers: { Authorization: `Bearer ${p.token}` } });
  const t = d["data"];
  if (t?.task_status === "failed") return { state: "error", message: String(t.task_status_msg ?? "O Kling falhou.").slice(0, 300) };
  if (t?.task_status === "succeed") {
    const url = t.task_result?.videos?.[0]?.url;
    return url ? { state: "done", url } : { state: "error", message: "O Kling não retornou vídeo." };
  }
  return { state: "running" };
}

/* ---------------- Safe media download ---------------- */
export async function downloadProviderMedia(rawUrl: string, opts: { headers?: Record<string, string> | undefined; max?: number | undefined } = {}, f: Fetch = fetch) {
  const u = assertProviderMediaUrl(rawUrl);
  // Gemini file URIs are followed by a redirect to googleusercontent; allow only manual hop checks.
  let r = await f(u, { headers: opts.headers ?? {}, redirect: "manual", signal: AbortSignal.timeout(55_000) });
  if (r.status >= 300 && r.status < 400) {
    const loc = r.headers.get("location");
    if (!loc) throw new ProviderError("Redirecionamento inválido.");
    const next = assertProviderMediaUrl(new URL(loc, u).toString());
    r = await f(next, { redirect: "error", signal: AbortSignal.timeout(55_000) });
  }
  if (!r.ok) throw new ProviderError(`Não foi possível baixar a mídia (${r.status}).`);
  const len = Number(r.headers.get("content-length") ?? 0);
  const max = opts.max ?? MAX_VIDEO_BYTES;
  if (len > max) throw new ProviderError("Arquivo acima do limite.");
  if (!r.body) throw new ProviderError("O provedor não retornou mídia.");
  const reader=r.body.getReader(), chunks:Uint8Array[]=[];let total=0;
  try {while(true){const part=await reader.read();if(part.done)break;total+=part.value.length;if(total>max){await reader.cancel();throw new ProviderError("Arquivo acima do limite.");}chunks.push(part.value);}} finally {reader.releaseLock();}
  const bytes=new Uint8Array(total);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}
  return { bytes, mime: (r.headers.get("content-type") ?? "").split(";")[0] ?? "" };
}

export const inlineToBytes = (i: InlineImage) => base64ToBytes(i.data);
