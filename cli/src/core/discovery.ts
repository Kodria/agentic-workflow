// src/core/discovery.ts
import fs from 'fs';
import path from 'path';
import { contentRoots, readRegistryManifest } from './registries';

export interface SkillArtifact {
    name: string;
    path: string;
    description: string;
    /** Path del artifact de un root anterior que este tapó (override declarado en awm-registry.json). */
    overrode?: string;
}

export interface WorkflowArtifact {
    name: string;
    path: string;
    description: string;
    /** Path del artifact de un root anterior que este tapó (override declarado en awm-registry.json). */
    overrode?: string;
}

export interface AgentArtifact {
    name: string;
    path: string;
    description: string;
    /** Path del artifact de un root anterior que este tapó (override declarado en awm-registry.json). */
    overrode?: string;
}

/** Extracts the raw frontmatter text (between the --- delimiters), or null if the block is missing/malformed. CRLF-tolerant. */
export function matchFrontmatterBlock(raw: string): string | null {
    const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    return fmMatch ? fmMatch[1] : null;
}

/** Indicador de block scalar YAML en la linea de la clave: estilo (`>` folded
 *  / `|` literal) + chomping opcional (`-`/`+`) + indent explicito opcional +
 *  comentario final opcional. El texto NO esta en esta linea: vive en las
 *  indentadas que le siguen. Detalles verificados contra js-yaml, no asumidos:
 *   - el indicador de indentacion es UN SOLO digito 1-9 (ni `0` ni `10`);
 *   - `>- # nota` SI es valido (comentario tras el indicador) y su bloque se
 *     lee normal — antes esto caia al camino de escalar plano;
 *   - `>-basura` NO es valido: YAML lo rechaza y aca tampoco matchea, asi que
 *     no se ramifica a la logica de bloque con un header que no lo es. */
const BLOCK_SCALAR_HEADER = /^([>|])(?:([+-])?([1-9])?|([1-9])?([+-])?)(?:\s+#.*)?$/;

/** ¿Este valor de la linea de la clave es un indicador de block scalar?
 *  Exportada para que cualquier caller que necesite RAMIFICAR sobre "esto es
 *  un bloque" use exactamente el mismo criterio que el resolver — nunca una
 *  aproximacion propia (ver el comentario en export/transform.ts sobre el
 *  desacuerdo prefijo-vs-match-completo que causaba perdida de datos). */
export function isBlockScalarHeader(value: string): boolean {
    return BLOCK_SCALAR_HEADER.test(value.trim());
}

/**
 * Resuelve el valor de `description:` de un bloque de frontmatter, incluyendo
 * la forma block scalar (`description: >-` + lineas indentadas).
 *
 * Historia (regresion real): las dos copias previas de esta logica —
 * `readArtifactDescription` aca y `parseSkillSource` en
 * renderers/skill-source.ts — detectaban el indicador de block scalar y lo
 * colapsaban a `''`, tratando una forma YAML perfectamente valida como
 * "descripcion ausente". El texto real, en las lineas siguientes, no se leia
 * nunca. Efecto: `awm add <bundle> -a copilot|cursor` crasheaba contra el
 * skill `extract-design-md` del registry baseline (que usa exactamente esa
 * forma), y el listado de discovery mostraba su descripcion vacia. Unificado
 * en esta funcion para que ambos consumidores no puedan volver a divergir.
 *
 * Chomping (`-`/`+`) se acepta y se ignora a proposito: solo gobierna los
 * saltos de linea FINALES, que aca se recortan igual — para una descripcion
 * de una sola pieza la distincion no tiene efecto observable.
 */
export function readFrontmatterDescription(frontmatter: string): string {
    const lines = frontmatter.split(/\r?\n/);
    // Ancla en COLUMNA 0 a proposito: `description` en un frontmatter es
    // siempre una clave de nivel superior. Un `^\s*` aca haria que ganara un
    // `description:` INDENTADO — o sea uno anidado dentro de otro mapa, o una
    // linea de CONTENIDO de otro block scalar que casualmente empiece asi —
    // por delante del real. (Regresion introducida y atrapada en review: con
    // `^\s*`, un frontmatter con `metadata:\n  description: nota interna` y un
    // `description:` real mas abajo devolvia la nota interna.)
    const idx = lines.findIndex((l) => /^description\s*:/.test(l));
    if (idx === -1) return '';

    const keyIndent = 0;
    let val = lines[idx].replace(/^description\s*:/, '').trim();

    // Escalar plano MULTILINEA: `description: primera` seguido de lineas
    // indentadas SIN indicador de bloque tambien es YAML valido, y se pliega
    // con espacios igual que un `>`. Sin esto se devolvia solo la primera
    // linea, perdiendo el resto en silencio.
    if (val !== '' && !isBlockScalarHeader(val) && !/^['"]/.test(val)) {
        const cont: string[] = [];
        for (let i = idx + 1; i < lines.length; i++) {
            if (lines[i].trim() === '') break;
            if (lines[i].match(/^\s*/)![0].length <= keyIndent) break;
            cont.push(lines[i].trim());
        }
        if (cont.length > 0) val = [val, ...cont].join(' ');
    }

    const header = val.match(BLOCK_SCALAR_HEADER);
    if (header) {
        const isLiteral = header[1] === '|';
        // El bloque son las lineas ESTRICTAMENTE mas indentadas que la clave;
        // la primera linea no vacia con indentacion <= keyIndent lo termina
        // (tipicamente la siguiente clave del frontmatter). Las lineas en
        // blanco no cortan el bloque: pertenecen a el.
        const raw: string[] = [];
        for (let i = idx + 1; i < lines.length; i++) {
            if (lines[i].trim() === '') { raw.push(''); continue; }
            if (lines[i].match(/^\s*/)![0].length <= keyIndent) break;
            raw.push(lines[i]);
        }
        while (raw.length > 0 && raw[raw.length - 1] === '') raw.pop();
        const first = raw.find((l) => l !== '');
        if (first === undefined) return '';   // indicador sin contenido: genuinamente vacia

        // Indent explicito (`>2`) si el autor lo declaro; si no, el de la
        // primera linea no vacia, que es como YAML lo infiere.
        const declared = header[3] ?? header[4];
        const blockIndent = declared !== undefined
            ? keyIndent + Number(declared)
            : first.match(/^\s*/)![0].length;
        // Una linea con MENOS indentacion que la del bloque es YAML invalido
        // (js-yaml lanza "bad indentation"). Cortar a ciegas con .slice()
        // comeria caracteres reales y devolveria texto corrupto en silencio:
        // preferimos no inventar un valor y tratar el bloque como ilegible.
        if (raw.some((l) => l !== '' && l.match(/^\s*/)![0].length < blockIndent)) return '';
        const stripped = raw.map((l) => (l === '' ? '' : l.slice(blockIndent)));

        if (isLiteral) return stripped.join('\n').trim();

        // Folded (`>`): las lineas al nivel base del bloque se pliegan entre si
        // con un espacio, pero una linea MAS indentada que ese nivel NO se
        // pliega — conserva su salto de linea y su sangria (regla real de YAML,
        // la que permite incrustar una lista o un bloque de codigo dentro de un
        // folded). Una linea en blanco es un salto de parrafo, no un espacio.
        const out: string[] = [];
        let current: string[] = [];
        const flush = () => { if (current.length > 0) { out.push(current.join(' ')); current = []; } };
        for (const l of stripped) {
            if (l === '') { flush(); out.push(''); continue; }
            if (/^\s/.test(l)) { flush(); out.push(l); continue; }   // mas indentada: literal
            current.push(l.trim());
        }
        flush();
        // Los '' intermedios son separadores de parrafo; colapsarlos a un solo
        // salto reproduce el folding de YAML (una linea en blanco => "\n").
        return out.join('\n').replace(/\n{2,}/g, '\n').trim();
    }

    // Escalares entrecomillados: quitar las comillas NO alcanza, hay que
    // deshacer el escape propio de cada estilo. Encontrado por un test
    // diferencial contra js-yaml (defecto preexistente en la version que esta
    // funcion reemplaza, que solo cortaba las comillas):
    //  - single-quoted: YAML escapa un `'` literal DUPLICANDOLO ('') — el
    //    mismo hecho que export/transform.ts ya aplicaba al ESCRIBIR, pero
    //    que nadie deshacia al LEER, asi que "it''s" llegaba crudo al output.
    //  - double-quoted: es un superset de la string de JSON, asi que JSON.parse
    //    resuelve \n, \t, \", \\ y \uXXXX correctamente. Si el contenido usara
    //    una secuencia valida en YAML pero no en JSON, JSON.parse lanza y se
    //    degrada al valor sin comillas en vez de crashear.
    if (val.length >= 2 && val.startsWith("'") && val.endsWith("'")) {
        return val.slice(1, -1).replace(/''/g, "'").trim();
    }
    if (val.length >= 2 && val.startsWith('"') && val.endsWith('"')) {
        try {
            return String(JSON.parse(val)).trim();
        } catch {
            return val.slice(1, -1).trim();
        }
    }
    // Escalar plano: un `#` PRECEDIDO DE ESPACIO abre un comentario y no forma
    // parte del valor (un `#` pegado a texto, como en `C#`, si). Sin esto la
    // descripcion arrastraba el comentario del autor hasta el artefacto
    // renderizado. Solo aplica aca: dentro de comillas el `#` es literal, y
    // esas ramas ya retornaron arriba.
    return val.replace(/\s+#.*$/, '').trim();
}

export function readArtifactDescription(filePath: string): string {
    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const frontmatter = matchFrontmatterBlock(raw);
        if (frontmatter === null) return '';
        return readFrontmatterDescription(frontmatter);
    } catch {
        return '';
    }
}

function collisionError(kind: string, name: string, first: string, second: string): Error {
    return new Error(
        `Artifact name collision: ${kind} "${name}" exists in both ${first} and ${second}. ` +
        `Remove or rename one of them, or declare "${name}" in "overrides" of the later registry's awm-registry.json.`
    );
}

interface DiscoveredEntry {
    name: string;
    path: string;
    description: string;
    overrode?: string;
}

/** Inserta o resuelve colisión: override declarado en el root posterior → reemplaza
 *  (Map.set sobre key existente conserva la posición de inserción); no declarado → error. */
function mergeEntry(
    kind: string,
    byName: Map<string, DiscoveredEntry>,
    entry: DiscoveredEntry,
    rootOverrides: Set<string>
): void {
    const prev = byName.get(entry.name);
    if (!prev) {
        byName.set(entry.name, entry);
        return;
    }
    if (rootOverrides.has(entry.name)) {
        byName.set(entry.name, { ...entry, overrode: prev.path });
        return;
    }
    throw collisionError(kind, entry.name, prev.path, entry.path);
}

/**
 * Scans skills directories across all provided content roots and returns all valid skills.
 * A valid skill is a directory that contains a SKILL.md file.
 * Throws on name collision across roots unless the later root declares the name in its awm-registry.json overrides.
 */
export function discoverSkills(roots: string[] = contentRoots()): SkillArtifact[] {
    const byName = new Map<string, DiscoveredEntry>();
    for (const root of roots) {
        const dir = path.join(root, 'skills');
        if (!fs.existsSync(dir)) continue;
        const overrides = readRegistryManifest(root).overrides;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const skillPath = path.join(dir, entry.name);
            if (!fs.existsSync(path.join(skillPath, 'SKILL.md'))) continue;
            mergeEntry('skill', byName, {
                name: entry.name,
                path: skillPath,
                description: readArtifactDescription(path.join(skillPath, 'SKILL.md')),
            }, overrides);
        }
    }
    return Array.from(byName.values());
}

/**
 * Scans workflows directories across all provided content roots and returns all valid workflows.
 * A valid workflow is a .md file.
 * Throws on name collision across roots unless the later root declares the name in its awm-registry.json overrides.
 */
export function discoverWorkflows(roots: string[] = contentRoots()): WorkflowArtifact[] {
    const byName = new Map<string, DiscoveredEntry>();
    for (const root of roots) {
        const dir = path.join(root, 'workflows');
        if (!fs.existsSync(dir)) continue;
        const overrides = readRegistryManifest(root).overrides;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory() || !entry.name.endsWith('.md')) continue;
            const name = entry.name.replace('.md', '');
            const filePath = path.join(dir, entry.name);
            mergeEntry('workflow', byName, {
                name,
                path: filePath,
                description: readArtifactDescription(filePath),
            }, overrides);
        }
    }
    return Array.from(byName.values());
}

/**
 * Scans agents directories across all provided content roots and returns all valid agent profiles.
 * A valid agent is a .md file.
 * Throws on name collision across roots unless the later root declares the name in its awm-registry.json overrides.
 */
export function discoverAgents(roots: string[] = contentRoots()): AgentArtifact[] {
    const byName = new Map<string, DiscoveredEntry>();
    for (const root of roots) {
        const dir = path.join(root, 'agents');
        if (!fs.existsSync(dir)) continue;
        const overrides = readRegistryManifest(root).overrides;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory() || !entry.name.endsWith('.md')) continue;
            const name = entry.name.replace('.md', '');
            const filePath = path.join(dir, entry.name);
            mergeEntry('agent', byName, {
                name,
                path: filePath,
                description: readArtifactDescription(filePath),
            }, overrides);
        }
    }
    return Array.from(byName.values());
}

