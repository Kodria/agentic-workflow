// cli/src/core/context/strategies/config-instructions.ts
import fs from 'fs';
import path from 'path';
import { ProviderConfig } from '../../../providers';
import { InjectionInput, InjectionState } from '../types';
import { InjectionStrategy } from './strategy';
import { sha256 } from '../provider';

type OpencodeConfig = { $schema?: string; instructions?: string[]; [k: string]: unknown };

export class ConfigInstructionsStrategy implements InjectionStrategy {
    private cfgOf(provider: ProviderConfig): { configPath: string } {
        const inj = provider.injection;
        if (!inj || inj.type !== 'config-instructions') {
            throw new Error('ConfigInstructionsStrategy requires a config-instructions provider');
        }
        return { configPath: inj.configPath };
    }

    private read(configPath: string): OpencodeConfig {
        if (!fs.existsSync(configPath)) return { $schema: 'https://opencode.ai/config.json', instructions: [] };
        const raw = fs.readFileSync(configPath, 'utf-8');
        try {
            return JSON.parse(raw) as OpencodeConfig;
        } catch {
            throw new Error(`${configPath} is not valid JSON. Fix it manually, then re-run.`);
        }
    }

    private write(configPath: string, cfg: OpencodeConfig): void {
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
    }

    inject(input: InjectionInput, provider: ProviderConfig): void {
        const { configPath } = this.cfgOf(provider);
        const cfg = this.read(configPath);
        if (cfg.instructions !== undefined && !Array.isArray(cfg.instructions)) {
            throw new Error(`${configPath}: 'instructions' field must be an array. Fix it manually, then re-run.`);
        }
        const list = Array.isArray(cfg.instructions) ? cfg.instructions : [];
        if (!list.includes(input.ref.absPath)) list.push(input.ref.absPath);
        cfg.instructions = list;
        this.write(configPath, cfg);
    }

    remove(input: InjectionInput, provider: ProviderConfig): void {
        const { configPath } = this.cfgOf(provider);
        if (!fs.existsSync(configPath)) return;
        const cfg = this.read(configPath);
        cfg.instructions = (cfg.instructions ?? []).filter((e) => e !== input.ref.absPath);
        this.write(configPath, cfg);
    }

    status(input: InjectionInput, provider: ProviderConfig): InjectionState {
        const { configPath } = this.cfgOf(provider);
        if (!fs.existsSync(configPath)) return 'absent';
        const cfg = this.read(configPath);
        if (!(cfg.instructions ?? []).includes(input.ref.absPath)) return 'absent';
        if (!fs.existsSync(input.ref.absPath)) return 'stale';
        const onDisk = sha256(fs.readFileSync(input.ref.absPath, 'utf-8'));
        return onDisk === input.ref.contentHash ? 'injected' : 'stale';
    }
}
