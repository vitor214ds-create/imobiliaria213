import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { BUCKET, MAX_IMAGE_BYTES, ROOMS, STYLES } from "./constants";
import { bytesToBase64 } from "./encoding";
import { imageSize, ratioMatches, sameAspect, sniffImageMime, validatePrompt, validateStageOptions, validateVideoOptions } from "./validation";
import {
  cloudAuth, ProviderError, downloadProviderMedia, geminiCheck, geminiStage, klingCheck, klingJwt, klingPoll, klingStart,
  veoPoll, veoStart, vsaCheck, vsaPoll, vsaStart, type InlineImage, type PollResult,
} from "./providers.server";

type Ctx = { supabase: any; userId: string };

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}
function need(name: string, label: string): string {
  const v = env(name);
  if (!v) throw new Error(`${label} não configurado. Adicione o segredo ${name} em Configurações do projeto → Secrets.`);
  return v;
}
async function klingToken() {
  return klingJwt(need("KLING_ACCESS_KEY", "Kling (Access Key)"), need("KLING_SECRET_KEY", "Kling (Secret Key)"));
}
const friendly = (e: unknown) => (e instanceof Error ? e.message : "Erro inesperado.").slice(0, 500);

async function loadImage(ctx: Ctx, path: string | null | undefined, label: string) {
  if (!path || !path.startsWith(`${ctx.userId}/`)) throw new Error(`${label} ausente.`);
  const { data, error } = await ctx.supabase.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`Não foi possível ler ${label.toLowerCase()}.`);
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error(`${label} acima de 10 MB.`);
  const mime = sniffImageMime(bytes);
  if (!mime) throw new Error(`${label} precisa ser JPG ou PNG válido.`);
  const size = imageSize(bytes);
  if (!size) throw new Error(`Não foi possível ler as dimensões de ${label.toLowerCase()}.`);
  return { inline: { mimeType: mime, data: bytesToBase64(bytes) } as InlineImage, size };
}

async function ownerOnly(ctx: Ctx) {
 const allowed = need("STUDIO_OWNER_USER_ID","ID do proprietário");
 if(ctx.userId!==allowed) throw new Error("Geração automática disponível apenas ao proprietário autorizado.");
}
async function loadProject(ctx: Ctx, id: string) {
  const { data, error } = await ctx.supabase.from("studio_projects").select("*").eq("id", id).maybeSingle();
  if (error || !data) throw new Error("Projeto não encontrado.");
  return data;
}

async function createJob(ctx: Ctx, row: Record<string, unknown>) {
  const { data, error } = await ctx.supabase.from("studio_jobs").insert({ ...row, user_id: ctx.userId, status: "running" }).select("*").single();
  if (!error) return { job: data, existing: false };
  if (error.code === "23505") {
    const { data: same } = await ctx.supabase.from("studio_jobs").select("*").eq("idempotency_key", row["idempotency_key"]).maybeSingle();
    if (same) return { job: same, existing: true };
    throw new Error("Já existe uma geração deste tipo em andamento. Aguarde ou cancele antes de iniciar outra.");
  }
  throw new Error("Não foi possível registrar a tarefa.");
}

async function updateJob(ctx: Ctx, id: string, patch: Record<string, unknown>) {
  await ctx.supabase.from("studio_jobs").update(patch).eq("id", id);
}

async function storeResult(ctx: Ctx, job: any, bytes: Uint8Array, mime: string) {
  const ext = mime === "video/mp4" ? "mp4" : mime === "image/png" ? "png" : "jpg";
  const path = `${ctx.userId}/${job.project_id}/${job.kind}-${job.id}.${ext}`;
  const { error } = await ctx.supabase.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: true });
  if (error) throw new Error("Falha ao salvar o resultado no armazenamento privado.");
  await ctx.supabase.from("studio_projects").update(job.kind === "stage" ? { last_path: path } : { video_path: path }).eq("id", job.project_id);
  await updateJob(ctx, job.id, { status: "done", result_path: path, error: null });
  return path;
}

const publicJob = (j: any) => ({
  id: j.id as string, kind: j.kind as string, provider: j.provider as string, status: j.status as string,
  error: (j.error ?? null) as string | null, resultPath: (j.result_path ?? null) as string | null,
  projectId: j.project_id as string, createdAt: j.created_at as string, providerTaskId: (j.provider_task_id ?? null) as string | null,
});

/* ---------- Connections ---------- */
export const connectionStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({context}) => { await ownerOnly(context as unknown as Ctx); return ({
    gemini: !!env("GEMINI_API_KEY"),
    veo: !!env("GOOGLE_SERVICE_ACCOUNT_JSON"),
    virtual: !!env("VSA_API_KEY"),
    kling: !!env("KLING_ACCESS_KEY") && !!env("KLING_SECRET_KEY"),
  }); });

export const checkConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ provider: z.enum(["gemini", "veo", "virtual", "kling"]) }))
  .handler(async ({ data, context }) => {
    await ownerOnly(context as unknown as Ctx);
    try {
      if (data.provider === "veo") { await cloudAuth(need("GOOGLE_SERVICE_ACCOUNT_JSON","Google Cloud")); return {ok:true,message:"Autenticação Google Cloud válida; confirme permissões e faturamento."}; }
      if (data.provider === "gemini") {
        const key = need("GEMINI_API_KEY", "Gemini");
        await geminiCheck(key);
        return { ok: true, message: "Chave válida no Gemini API. A geração depende de faturamento, cotas e acesso ao modelo." };
      }
      if (data.provider === "virtual") {
        const d: any = await vsaCheck(need("VSA_API_KEY", "Virtual Staging AI"));
        const limit = d?.photoLimit?.staging;
        return { ok: true, message: `Chave válida.${limit !== undefined ? ` Limite de staging: ${limit}.` : ""}` };
      }
      await klingCheck(await klingToken());
      return { ok: true, message: "Token JWT aceito pelo Kling. A geração depende de saldo em recursos." };
    } catch (e) {
      return { ok: false, message: friendly(e) };
    }
  });

/* ---------- Stage (decoração) ---------- */
export const startStage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({
    projectId: z.string().uuid(), idempotencyKey: z.string().min(8).max(80),
    provider: z.enum(["gemini", "virtual"]), model: z.string().max(80),
    room: z.string().max(40), style: z.string().max(40), prompt: z.string().max(3000),
  }))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await ownerOnly(ctx);
    const err = validateStageOptions(data);
    if (err) throw new Error(err);
    const prompt = validatePrompt(data.prompt);
    const project = await loadProject(ctx, data.projectId);
    const first = await loadImage(ctx, project.first_path, "Foto original");
    const key = data.provider === "gemini" ? need("GEMINI_API_KEY", "Gemini") : need("VSA_API_KEY", "Virtual Staging AI");
    const { job, existing } = await createJob(ctx, {
      project_id: project.id, kind: "stage", provider: data.provider, model: data.provider === "gemini" ? data.model : null,
      idempotency_key: data.idempotencyKey, input: { room: data.room, style: data.style },
    });
    if (existing) return publicJob(job);
    try {
      if (data.provider === "gemini") {
        const out = await geminiStage({ key, model: data.model, prompt, image: first.inline });
        const bytes = Uint8Array.from(atob(out.data), (c) => c.charCodeAt(0));
        const mime = sniffImageMime(bytes);
        if (!mime) throw new ProviderError("O Gemini retornou um formato de imagem não suportado.");
        const path = await storeResult(ctx, job, bytes, mime);
        return publicJob({ ...job, status: "done", result_path:path });
      }
      const { data: signed, error } = await ctx.supabase.storage.from(BUCKET).createSignedUrl(project.first_path, 900);
      if (error || !signed?.signedUrl) throw new Error("Não foi possível gerar link temporário da foto.");
      const room = ROOMS.find((r) => r.value === data.room)!.vsa!;
      const style = STYLES.find((s) => s.value === data.style)!.vsa!;
      const id = await vsaStart({ key, imageUrl: signed.signedUrl, room, style });
      await updateJob(ctx, job.id, { provider_task_id: id });
      return publicJob({ ...job, provider_task_id: id });
    } catch (e) {
      await updateJob(ctx, job.id, { status: "error", error: friendly(e) });
      throw new Error(friendly(e));
    }
  });

/* ---------- Video ---------- */
export const startVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({
    projectId: z.string().uuid(), idempotencyKey: z.string().min(8).max(80),
    provider: z.enum(["veo", "kling"]), model: z.string().max(80), effect: z.string().max(40),
    ratio: z.string().max(8), resolution: z.string().max(8), duration: z.number().int(), prompt: z.string().max(3000),
  }))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await ownerOnly(ctx);
    const err = validateVideoOptions(data);
    if (err) throw new Error(err);
    const prompt = validatePrompt(data.prompt);
    const project = await loadProject(ctx, data.projectId);
    const a = await loadImage(ctx, project.first_path, "Frame inicial");
    const b = await loadImage(ctx, project.last_path, "Frame final");
    if (!sameAspect(a.size, b.size)) throw new Error("Os dois frames precisam ter a mesma proporção.");
    if (data.provider === "veo" && !ratioMatches(a.size, data.ratio))
      throw new Error(`As imagens não combinam com o formato ${data.ratio}. Gire os frames ou troque o formato.`);
    const [first, last] = data.effect === "reverse" ? [b.inline, a.inline] : [a.inline, b.inline];
    const key = data.provider === "veo" ? need("GOOGLE_SERVICE_ACCOUNT_JSON", "Google Cloud Veo") : null;
    const token = data.provider === "kling" ? await klingToken() : null;
    const { job, existing } = await createJob(ctx, {
      project_id: project.id, kind: "video", provider: data.provider, model: data.model,
      idempotency_key: data.idempotencyKey,
      input: { effect: data.effect, ratio: data.ratio, resolution: data.resolution, duration: data.duration },
      deadline_at: new Date(Date.now() + 20 * 60_000).toISOString(),
    });
    if (existing) return publicJob(job);
    try {
      const id = key
        ? await veoStart({ key, model: data.model, prompt, first, last, aspectRatio: data.ratio, resolution: data.resolution, durationSeconds: data.duration })
        : await klingStart({ token: token!, model: data.model, prompt, first, last, duration: data.duration });
      await updateJob(ctx, job.id, { provider_task_id: id });
      return publicJob({ ...job, provider_task_id: id });
    } catch (e) {
      await updateJob(ctx, job.id, { status: "error", error: friendly(e) });
      throw new Error(friendly(e));
    }
  });

/* ---------- Poll (one short provider check per request) ---------- */
export const pollJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ jobId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await ownerOnly(ctx);
    const { data: job } = await ctx.supabase.from("studio_jobs").select("*").eq("id", data.jobId).maybeSingle();
    if (!job) throw new Error("Tarefa não encontrada.");
    if (job.status !== "running" && job.status !== "queued") return publicJob(job);
    if (new Date(job.deadline_at).getTime() < Date.now()) {
      const msg = `Tempo de espera excedido. A tarefa ${job.provider_task_id ?? ""} pode continuar no provedor; verifique antes de repetir.`;
      await updateJob(ctx, job.id, { status: "timeout", error: msg });
      return publicJob({ ...job, status: "timeout", error: msg });
    }
    if (!job.provider_task_id) return publicJob(job);
    await updateJob(ctx, job.id, { polls: (job.polls ?? 0) + 1 });
    try {
      let r: PollResult;
      let dlHeaders: Record<string, string> | undefined;
      if (job.provider === "virtual") r = await vsaPoll({ key: need("VSA_API_KEY", "Virtual Staging AI"), id: job.provider_task_id });
      else if (job.provider === "veo") {
        const key = need("GOOGLE_SERVICE_ACCOUNT_JSON", "Google Cloud Veo");
        r = await veoPoll({ key, operation: job.provider_task_id });

      } else if (job.provider === "kling") r = await klingPoll({ token: await klingToken(), id: job.provider_task_id });
      else return publicJob(job);
      if (r.state === "running") return publicJob(job);
      if (r.state === "error") {
        await updateJob(ctx, job.id, { status: "error", error: r.message });
        return publicJob({ ...job, status: "error", error: r.message });
      }
      const isVideo = job.kind === "video";
      const { bytes, mime } = "bytes" in r ? {bytes:r.bytes,mime:"video/mp4"} : await downloadProviderMedia(r.url, { headers: dlHeaders, max: isVideo ? undefined : 10 * 1024 * 1024 });
      const finalMime = isVideo ? (bytes.length>12 && String.fromCharCode(...bytes.slice(4,8))==="ftyp" ? "video/mp4" : null) : sniffImageMime(bytes);
      if (!finalMime) throw new ProviderError(`Formato de resultado inesperado (${mime || "desconhecido"}).`);
      const path = await storeResult(ctx, job, bytes, finalMime);
      return publicJob({ ...job, status: "done", result_path: path });
    } catch (e) {
      // Transient errors keep the job running so polling can resume later.
      if (e instanceof ProviderError && /rede|5\d\d/.test(e.message)) return publicJob({ ...job, error: friendly(e) });
      await updateJob(ctx, job.id, { status: "error", error: friendly(e) });
      return publicJob({ ...job, status: "error", error: friendly(e) });
    }
  });

export const cancelJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ jobId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await ownerOnly(ctx);
    await ctx.supabase.from("studio_jobs").update({ status: "error", error: "Acompanhamento cancelado pelo usuário. A tarefa pode continuar (e ser cobrada) no provedor." })
      .eq("id", data.jobId).in("status", ["queued", "running"]);
    return { ok: true };
  });
