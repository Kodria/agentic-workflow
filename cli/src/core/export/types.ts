// cli/src/core/export/types.ts
//
// Tipos compartidos del motor de export (issue #9).
export interface ResolvedSkill {
  name: string;
  /** Ruta absoluta a skills/<name> en su content root. */
  dir: string;
  portable: boolean;
  /** Ruta a port.claude-ai.md si existe, null si no. */
  overridePath: string | null;
}

export interface ExportResolution {
  kind: 'bundle' | 'skill';
  requested: string;
  /** Solo las skills portables — las que se exportan. */
  skills: ResolvedSkill[];
  /** Modo bundle: nombres omitidos por no portables (visibles, R2.2). */
  skipped: string[];
}

/** Resultado del intento de zip: ok, o binario ausente (fallback R4.2). */
export interface ZipResult {
  ok: boolean;
  missing: boolean;
}
export type ZipFn = (cwd: string, zipName: string, folderName: string) => ZipResult;

export interface ExportSummary {
  /** Directorio target: <out>/claude-ai */
  outDir: string;
  exported: Array<{ name: string; dir: string; zip: string | null }>;
  skipped: string[];
  /** false si el binario zip no estaba disponible (imprime instrucción manual). */
  zipAvailable: boolean;
}
