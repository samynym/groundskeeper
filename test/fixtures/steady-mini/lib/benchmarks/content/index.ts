import { hipArthroscopyFai } from "./hip-arthroscopy-fai.js";
export const procedureContents = [hipArthroscopyFai];
export function getProcedureContent(slug: string) { return procedureContents.find((c) => c.slug === slug) ?? null; }
