import {
  DURATIONS,
  GEMINI_IMAGE_MODELS,
  IMAGE_MIMES,
  KLING_MODELS,
  MAX_IMAGE_BYTES,
  RATIOS,
  RESOLUTIONS,
  ROOMS,
  STYLES,
  VEO_MODELS,
  type ImageProvider,
  type VideoProvider,
} from "./constants";

export function validateImageFile(file: { type: string; size: number }): string | null {
  if (!(IMAGE_MIMES as readonly string[]).includes(file.type)) return "Envie uma imagem JPG ou PNG.";
  if (file.size > MAX_IMAGE_BYTES) return "A imagem deve ter no máximo 10 MB.";
  if (file.size === 0) return "Arquivo vazio.";
  return null;
}

/** Detects real MIME from magic bytes (never trusts the file extension). */
export function sniffImageMime(bytes: Uint8Array): "image/png" | "image/jpeg" | null {
  if (bytes.length >= 24 && [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((b,i)=>bytes[i]===b) && String.fromCharCode(...bytes.slice(12,16))==="IHDR") return "image/png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

/** Reads width/height from PNG or JPEG headers. */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const mime = sniffImageMime(bytes);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const safeSize = (width:number,height:number) => width>0 && height>0 && width<=16384 && height<=16384 && width*height<=50_000_000 ? {width,height}:null;
  if (mime === "image/png" && bytes.length >= 24) return safeSize(dv.getUint32(16),dv.getUint32(20));
  if (mime === "image/jpeg") {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const marker = bytes[i + 1]!;
      if(marker===0xd9 || marker===0xda) break;
      if(marker===0xff || marker===0x01 || (marker>=0xd0 && marker<=0xd8)){i+=marker===0xff?1:2;continue;}
      const len = dv.getUint16(i + 2);
      if(len<2 || i+2+len>bytes.length) return null;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return len>=8?safeSize(dv.getUint16(i + 7),dv.getUint16(i + 5)):null;
      }
      i += 2 + len;
    }
  }
  return null;
}

export function sameAspect(a: { width: number; height: number }, b: { width: number; height: number }, tol = 0.04) {
  return Math.abs(a.width / a.height - b.width / b.height) <= tol;
}

/** Orientation of an image vs. the requested video ratio. */
export function ratioMatches(size: { width: number; height: number }, ratio: string) {
  const target=ratio==="9:16"?9/16:ratio==="16:9"?16/9:0;
  return target>0 && size.height>0 && Math.abs(size.width/size.height-target)/target<=0.025;
}

export type VideoOptions = {
  provider: VideoProvider;
  model: string;
  ratio: string;
  resolution: string;
  duration: number;
};

export function validateVideoOptions(o: VideoOptions): string | null {
  if (!["veo", "kling"].includes(o.provider)) return "Gerador de vídeo inválido.";
  if (!DURATIONS[o.provider].includes(o.duration))
    return o.provider === "veo"
      ? "O Veo com primeiro e último frame exige 8 segundos."
      : "O Kling aceita 5 ou 10 segundos.";
  if (o.provider === "veo" && !(VEO_MODELS as readonly string[]).includes(o.model)) return "Modelo Veo inválido.";
  if (o.provider === "kling" && !(KLING_MODELS as readonly string[]).includes(o.model)) return "Modelo Kling inválido.";
  if (!(RATIOS as readonly string[]).includes(o.ratio)) return "Formato inválido.";
  if (!(RESOLUTIONS as readonly string[]).includes(o.resolution)) return "Resolução inválida.";
  return null;
}

export function validateStageOptions(o: { provider: ImageProvider; model: string; room: string; style: string }): string | null {
  if (!ROOMS.some((r) => r.value === o.room)) return "Ambiente inválido.";
  if (!STYLES.some((s) => s.value === o.style)) return "Estilo inválido.";
  if (o.provider === "gemini") {
    if (!(GEMINI_IMAGE_MODELS as readonly string[]).includes(o.model)) return "Modelo Gemini inválido.";
    return null;
  }
  if (o.provider === "virtual") {
    const room = ROOMS.find((r) => r.value === o.room);
    const style = STYLES.find((s) => s.value === o.style);
    if (!room?.vsa || !style?.vsa) return "Esse ambiente ou estilo não existe no Virtual Staging AI; use o Gemini.";
    return null;
  }
  return "Gerador de imagem inválido.";
}

export function validatePrompt(p: unknown): string {
  if (typeof p !== "string" || !p.trim()) throw new Error("Informe um prompt.");
  if (p.length > 3000) throw new Error("O prompt deve ter até 3000 caracteres.");
  return p.trim();
}

/** Only these hosts may be fetched when downloading provider results (anti-SSRF). */
const MEDIA_HOSTS = /(^|\.)(googleapis\.com|googleusercontent\.com|virtualstagingai\.app|klingai\.com|kling\.ai|kwai\.net|kuaishou\.com|klingai\.net|cloudfront\.net)$/;
export function assertProviderMediaUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error("URL de mídia inválida."); }
  if (u.protocol !== "https:" || u.username || u.password || u.port || !MEDIA_HOSTS.test(u.hostname))
    throw new Error("URL de mídia do provedor não reconhecida.");
  return u;
}
