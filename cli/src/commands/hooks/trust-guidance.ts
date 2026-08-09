// Texto accionable para un hook instalado que nunca corrio.
//
// Vive aparte de `index.ts` a proposito: ese modulo registra comandos y arrastra medio
// CLI al importarlo, asi que un test que solo quiere leer este texto no deberia pagar eso.
import { AgentTarget } from '../../providers';

/**
 * Que hacer con un hook instalado que nunca corrio.
 *
 * `doctor` emitia el codigo `open-hooks-trust` y NADA mas — ni en la referencia del CLI,
 * ni en la salida, ni en la doc. El usuario leia `→ open-hooks-trust` y no tenia ninguna
 * accion que tomar. Un remedio que no se puede ejecutar no es un remedio.
 *
 * El texto de abajo es el que Codex 0.146.0 muestra de verdad, copiado de una corrida
 * observada — no una parafrasis de lo que suponemos que dice.
 */
export function pendingTrustGuidance(agent: AgentTarget): string[] {
    if (agent === 'codex') {
        return [
            'El hook esta instalado y registrado, pero Codex todavia no lo ejecuto.',
            'Abri una sesion de Codex en cualquier proyecto: va a mostrar',
            '',
            '    Hooks need review',
            '    1 hook is new or changed.',
            '    Hooks can run outside the sandbox after you trust them.',
            '',
            'Elegi "Trust all and continue". Desde esa sesion el hook corre y este',
            'comando pasa a HEALTHY. Si elegis "Continue without trusting", no corre.',
        ];
    }
    return [
        'El hook esta instalado y bien formado, pero nunca se lo vio correr.',
        'Abri una sesion del agente; si sigue igual, no se esta disparando.',
    ];
}
