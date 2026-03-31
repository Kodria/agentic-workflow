import { parseStoryMap, updateMiroFrameId } from '../../src/core/story-map-parser';

const SAMPLE_MARKDOWN = `---
project: Portal B2B
---

# Story Map — Portal B2B

## Goal
> Permitir a proveedores gestionar su relación con Cencosud

## Personas

### Proveedor
- **Rol:** Externo

## Backbone

### 🟡 Acceder al portal

#### 🔵 Task: Iniciar sesión
- **[MVP]** Como proveedor, quiero iniciar sesión con mi usuario y contraseña
- **[Release 2]** Como proveedor, quiero autenticarme con SSO

#### 🔵 Task: Seleccionar país y UN
- **[MVP]** Como proveedor, quiero seleccionar mi país al ingresar

### 🟡 Consultar mis datos

#### 🔵 Task: Ver dashboard
- **[MVP]** Como proveedor, quiero ver mis indicadores principales

## Release Summary

| Release | Stories |
|---------|---------|
| MVP | 3 |

## Changelog

- [2026-03-31] Sesión 1
`;

const MARKDOWN_WITH_FRAME_ID = `---
project: Portal B2B
miro_frame_id: "existing-id"
---

# Story Map — Portal B2B
`;

describe('parseStoryMap', () => {
    it('extracts project name from frontmatter', () => {
        const result = parseStoryMap(SAMPLE_MARKDOWN);
        expect(result.project).toBe('Portal B2B');
    });

    it('extracts goal text stripping the > prefix', () => {
        const result = parseStoryMap(SAMPLE_MARKDOWN);
        expect(result.goal).toBe('Permitir a proveedores gestionar su relación con Cencosud');
    });

    it('returns undefined miro_frame_id when not in frontmatter', () => {
        const result = parseStoryMap(SAMPLE_MARKDOWN);
        expect(result.miro_frame_id).toBeUndefined();
    });

    it('extracts miro_frame_id from frontmatter when present', () => {
        const result = parseStoryMap(MARKDOWN_WITH_FRAME_ID);
        expect(result.miro_frame_id).toBe('existing-id');
    });

    it('extracts activities in order', () => {
        const result = parseStoryMap(SAMPLE_MARKDOWN);
        expect(result.activities).toHaveLength(2);
        expect(result.activities[0].title).toBe('Acceder al portal');
        expect(result.activities[1].title).toBe('Consultar mis datos');
    });

    it('extracts tasks under each activity', () => {
        const result = parseStoryMap(SAMPLE_MARKDOWN);
        expect(result.activities[0].tasks).toHaveLength(2);
        expect(result.activities[0].tasks[0].title).toBe('Iniciar sesión');
        expect(result.activities[0].tasks[1].title).toBe('Seleccionar país y UN');
    });

    it('extracts stories with their release labels', () => {
        const result = parseStoryMap(SAMPLE_MARKDOWN);
        const stories = result.activities[0].tasks[0].stories;
        expect(stories).toHaveLength(2);
        expect(stories[0]).toEqual({ release: 'MVP', title: 'Como proveedor, quiero iniciar sesión con mi usuario y contraseña' });
        expect(stories[1]).toEqual({ release: 'Release 2', title: 'Como proveedor, quiero autenticarme con SSO' });
    });

    it('ignores content outside Backbone section', () => {
        const result = parseStoryMap(SAMPLE_MARKDOWN);
        expect(result.activities.every(a => !a.title.includes('Release') && !a.title.includes('Changelog'))).toBe(true);
    });

    it('falls back to title when project is absent from frontmatter', () => {
        const content = `---
goal: Some goal
---

# Story Map — Derived From Title

## Goal
> Some goal
`;
        const result = parseStoryMap(content);
        expect(result.project).toBe('Derived From Title');
    });

    it('falls back to Unknown when project and title are both absent', () => {
        const content = `---
goal: Some goal
---

## Goal
> Some goal
`;
        const result = parseStoryMap(content);
        expect(result.project).toBe('Unknown');
    });
});

describe('updateMiroFrameId', () => {
    it('adds miro_frame_id to existing frontmatter and result parses correctly', () => {
        const result = updateMiroFrameId(SAMPLE_MARKDOWN, 'new-frame-123');
        expect(result).toContain('miro_frame_id: "new-frame-123"');
        // Round-trip: the updated content should parse back to a valid StoryMap with the new id
        const parsed = parseStoryMap(result);
        expect(parsed.miro_frame_id).toBe('new-frame-123');
        expect(parsed.project).toBe('Portal B2B');
        expect(parsed.activities).toHaveLength(2);
    });

    it('replaces existing miro_frame_id', () => {
        const result = updateMiroFrameId(MARKDOWN_WITH_FRAME_ID, 'new-frame-456');
        expect(result).toContain('miro_frame_id: "new-frame-456"');
        expect(result).not.toContain('existing-id');
    });

    it('preserves the rest of the frontmatter and body', () => {
        const result = updateMiroFrameId(SAMPLE_MARKDOWN, 'new-frame-123');
        expect(result).toContain('project: Portal B2B');
        expect(result).toContain('# Story Map — Portal B2B');
    });
});
