export const ROOMS = [
  { value: "bed", label: "Suíte / quarto", en: "bedroom", vsa: "bed" },
  { value: "living", label: "Sala de estar", en: "living room", vsa: "living" },
  { value: "dining", label: "Sala de jantar", en: "dining room", vsa: "dining" },
  { value: "kitchen", label: "Cozinha", en: "kitchen", vsa: "kitchen" },
  { value: "home_office", label: "Escritório", en: "home office", vsa: "home_office" },
  { value: "outdoor", label: "Área externa", en: "outdoor area", vsa: "outdoor" },
  { value: "kids_room", label: "Quarto infantil", en: "kids room", vsa: "kids_room" },
  { value: "land", label: "Terreno (simulação)", en: "empty plot", vsa: null },
] as const;

export const STYLES = [
  { value: "modern", label: "Moderno contemporâneo", en: "modern contemporary", vsa: "modern" },
  { value: "luxury", label: "Luxo", en: "luxury", vsa: "luxury" },
  { value: "neoclassical", label: "Neoclássico", en: "neoclassical", vsa: null },
  { value: "minimalist", label: "Minimalista", en: "minimalist", vsa: null },
  { value: "tropical", label: "Tropical contemporâneo", en: "contemporary tropical", vsa: null },
  { value: "scandinavian", label: "Escandinavo", en: "scandinavian", vsa: "scandinavian" },
  { value: "industrial", label: "Industrial", en: "industrial", vsa: "industrial" },
  { value: "coastal", label: "Litorâneo", en: "coastal", vsa: "coastal" },
] as const;

export const EFFECTS = [
  { value: "rise", label: "Móveis surgindo do chão" },
  { value: "assemble", label: "Montagem automática" },
  { value: "slide", label: "Móveis deslizando" },
  { value: "particles", label: "Materialização (partículas)" },
  { value: "build", label: "Construção de casa" },
  { value: "reverse", label: "Móveis desaparecendo (reversão)" },
  { value: "renovate", label: "Reforma completa" },
] as const;

export type RoomValue = (typeof ROOMS)[number]["value"];
export type StyleValue = (typeof STYLES)[number]["value"];
export type EffectValue = (typeof EFFECTS)[number]["value"];

export const IMAGE_PROVIDERS = [
  { value: "gemini", label: "Gemini · Nano Banana" },
  { value: "virtual", label: "Virtual Staging AI" },
] as const;
export const VIDEO_PROVIDERS = [
  { value: "veo", label: "Google Veo 3.1 (Google Cloud)" },
  { value: "kling", label: "Kling AI" },
] as const;
export type ImageProvider = (typeof IMAGE_PROVIDERS)[number]["value"];
export type VideoProvider = (typeof VIDEO_PROVIDERS)[number]["value"];

export const GEMINI_IMAGE_MODELS = [
  "gemini-3.1-flash-lite-image",
  "gemini-3-pro-image",
  "gemini-3.1-flash-image",
] as const;
export const VEO_MODELS = ["veo-3.1-fast-generate-001", "veo-3.1-generate-001"] as const;
export const KLING_MODELS = ["kling-v2-5-turbo", "kling-v2-1", "kling-v1-6"] as const;

export const RATIOS = ["9:16", "16:9"] as const;
export const RESOLUTIONS = ["720p", "1080p"] as const;
export type Ratio = (typeof RATIOS)[number];
export type Resolution = (typeof RESOLUTIONS)[number];

/** Durations each provider accepts for first+last frame interpolation. */
export const DURATIONS: Record<VideoProvider, readonly number[]> = {
  veo: [8],
  kling: [5, 10],
};

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const IMAGE_MIMES = ["image/jpeg", "image/png"] as const;
export const BUCKET = "studio-media";

export const OFFICIAL_LINKS = {
  geminiKey: "https://aistudio.google.com/apikey",
  geminiDocs: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/video/generate-videos-from-first-and-last-frames",
  flow: "https://labs.google/fx/tools/flow",
  vsa: "https://virtualstagingai.app/",
  vsaDocs: "https://docs.virtualstagingai.app/v2-api/endpoints",
  kling: "https://app.klingai.com/global/dev",
  klingApp: "https://klingai.com/",
} as const;
