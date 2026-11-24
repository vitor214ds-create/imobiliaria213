import { EFFECTS, ROOMS, STYLES, type EffectValue, type RoomValue, type StyleValue } from "./constants";

const EFFECT_TEXT: Record<EffectValue, string> = {
  rise: "Furniture gradually rises from the floor and assembles smoothly into its final position.",
  assemble: "Individual furniture components smoothly assemble into complete furniture.",
  slide: "Furniture slides into the room and settles into its final position.",
  particles: "Subtle luminous particles materialize into realistic furniture.",
  build:
    "A house is progressively constructed from foundation to completed building; preserve surrounding terrain, streets and neighboring buildings.",
  reverse: "Furniture and accessories smoothly retract into the floor, revealing the empty room.",
  renovate: "The original interior smoothly transforms into the renovated interior shown in the final reference.",
};

export const NEGATIVE_PROMPT =
  "warping, flicker, floating objects, duplicated furniture, architectural changes, abrupt cuts, camera rotation";

export function stagePrompt(room: RoomValue, style: StyleValue): string {
  const r = ROOMS.find((x) => x.value === room) ?? ROOMS[0];
  const s = STYLES.find((x) => x.value === style) ?? STYLES[0];
  if (room === "land") {
    return `Create a photorealistic conceptual house on this empty plot in ${s.en} style. Preserve the surrounding terrain, buildings, camera position, perspective and natural lighting. Respect the plot boundaries.`;
  }
  return `Furnish this ${r.en} in ${s.en} style. Preserve the exact architecture, room dimensions, walls, ceiling, floor, windows, doors, camera position, framing, perspective and lighting. Add realistic furniture and decor with natural contact shadows and accurate scale. Photorealistic real estate photography. Do not modify architecture.`;
}

export function videoPrompt(effect: EffectValue): string {
  const e = EFFECT_TEXT[effect] ?? EFFECT_TEXT.rise;
  return `${e} Use the supplied first and final frames. Fixed angle of view, stable composition, smooth slow motion, realistic shadows and lighting. Preserve architecture, perspective and proportions. No warping, flickering, duplicate furniture, floating objects, abrupt cuts or camera rotation. Match the final reference.`;
}

export const effectLabel = (v: EffectValue) => EFFECTS.find((e) => e.value === v)?.label ?? v;
