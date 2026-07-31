import { execFileSync } from 'node:child_process';

// AGENTS.md: execFileSync con array de args — nunca execSync con string.
// El timeout de 10s es pragmático para `--version`/`--help` (consulta puntual,
// no un job de verificación — la constraint "sin timeout terminal" del brief
// aplica a verificaciones, no a esta inspección); si dispara, se REGISTRA como
// no-verificable, no se interpreta como fallo del binario.
const LIMIT = 8192; // retención acotada (constraint de privacidad del brief)

function inspectOne(bin) {
  const out = { present: false };
  for (const flag of ['--version', '--help']) {
    try {
      const raw = execFileSync(bin, [flag], { encoding: 'utf-8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] });
      out.present = true;
      out[flag === '--version' ? 'version' : 'help'] = raw.slice(0, LIMIT);
    } catch (e) {
      if (e.code === 'ENOENT') {
        return { present: false, state: 'no-verificable-aquí', detail: 'binario ausente' };
      }
      out[flag] = `no-verificable-aquí: ${e.code ?? e.message}`.slice(0, 200);
    }
  }
  if (out.help) {
    out.modelFlagHints = out.help
      .split('\n')
      .filter((l) => /--?model\b|--?m\b|effort/i.test(l))
      .slice(0, 10);
  }
  out.state = out.present ? 'soportado' : 'no-verificable-aquí';
  return out;
}

export function probeCliInspection() {
  return {
    claude: inspectOne('claude'),
    codex: inspectOne('codex'),
    opencode: inspectOne('opencode'),
  };
}
