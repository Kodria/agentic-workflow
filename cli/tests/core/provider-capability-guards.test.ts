// Regresion: un provider que estructuralmente NO puede recibir un artefacto en
// cierto scope (hoy: copilot en global — no tiene descubrimiento de skills a
// nivel usuario) hacia TIRAR el plan entero, rompiendo el comando para todos
// los demas agentes de la maquina.
//
// Sintoma confirmado contra el binario real:
//     awm init -a claude-code -y && awm init -a copilot -y && awm update
//     → Artifact reconciliation failed: skill global scope is not supported by Copilot
//     exit=1
// El comando moria ANTES del re-sync de hooks, asi que claude-code dejaba de
// recibir actualizaciones — y no existe comando para deshabilitar un agente,
// mientras `awm doctor` seguia diciendo "healthy".
//
// La causa era una asimetria de guarda clasica: el `.filter()` interno de
// `assertCompleteSharedGroup` ya toleraba el caso, pero la linea de arriba
// —que corre primero— no.
import path from 'path';
import { planInstall } from '../../src/core/install-planner';
import type { ArtifactIntent } from '../../src/core/install-planner';

const skill: ArtifactIntent = {
    name: 'using-awm', type: 'skill', installName: 'using-awm', sourcePath: '/tmp/reg/skills/using-awm',
};

describe('planInstall: un provider incapaz no puede romper el plan de los demas', () => {
    it('scope global con copilot habilitado: planifica para los capaces y saltea copilot', () => {
        const plan = planInstall({
            artifacts: [skill],
            selectedAgents: ['claude-code', 'copilot'],
            enabledAgents: ['claude-code', 'copilot'],
            scope: 'global',
            projectRoot: '/tmp/proj',
            method: 'symlink',
        });
        const owners = plan.operations.flatMap((op) => op.owners);
        expect(owners).toContain('claude-code');
        expect(owners).not.toContain('copilot');
    });

    it('no tira aunque copilot este habilitado pero no seleccionado (el caso de awm update)', () => {
        expect(() => planInstall({
            artifacts: [skill],
            selectedAgents: ['claude-code'],
            enabledAgents: ['claude-code', 'copilot'],
            scope: 'global',
            projectRoot: '/tmp/proj',
            method: 'symlink',
        })).not.toThrow();
    });

    it('peticion EXPLICITA de copilot en global: sigue tirando CON la explicacion', () => {
        // Aca no hay a quien saltear — el usuario pidio justo esa combinacion, y
        // lo que necesita es leer por que no se puede, no un exito silencioso.
        expect(() => planInstall({
            artifacts: [skill],
            selectedAgents: ['copilot'],
            enabledAgents: ['copilot'],
            scope: 'global',
            projectRoot: '/tmp/proj',
            method: 'symlink',
        })).toThrow(/per-project|not supported/i);
    });

    it('copilot en scope local SI recibe el artefacto (su unico scope valido)', () => {
        const plan = planInstall({
            artifacts: [skill],
            selectedAgents: ['copilot'],
            enabledAgents: ['copilot'],
            scope: 'local',
            projectRoot: '/tmp/proj',
            method: 'symlink',
        });
        expect(plan.operations).toHaveLength(1);
        // `path.join`, no un literal con '/': `physicalTarget` construye la ruta con el
        // separador de la plataforma, asi que en Windows el destino real es
        // `.github\instructions` y la asercion POSIX-hardcodeada fallaba sobre un
        // destino perfectamente correcto.
        expect(plan.operations[0].targetPath).toContain(path.join('.github', 'instructions'));
        expect(plan.operations[0].targetPath).toContain('using-awm.instructions.md');
    });

    it('el grupo compartido (opencode + codex) se sigue exigiendo completo', () => {
        // La guarda no debe aflojar R14: ambos resuelven a ~/.agents/skills, asi
        // que seleccionar solo uno seguiria siendo un cambio divergente.
        expect(() => planInstall({
            artifacts: [skill],
            selectedAgents: ['codex'],
            enabledAgents: ['codex', 'opencode'],
            scope: 'global',
            projectRoot: '/tmp/proj',
            method: 'symlink',
        })).toThrow(/shared skill target/i);
    });
});
