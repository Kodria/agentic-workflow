// cli/src/core/context/strategies/config-instructions.ts
import fs from 'fs';
import path from 'path';
import { ProviderConfig } from '../../../providers';
import { InjectionInput, InjectionState } from '../types';
import { InjectionStrategy } from './strategy';
import { sha256 } from '../provider';

type OpencodeConfig = { $schema?: string; [k: string]: unknown };

export class ConfigInstructionsStrategy implements InjectionStrategy {
    private cfgOf(provider: ProviderConfig): { configPath: string; field: string } {
        const inj = provider.injection;
        if (!inj || inj.type !== 'config-instructions') {
            throw new Error('ConfigInstructionsStrategy requires a config-instructions provider');
        }
        return { configPath: inj.configPath, field: inj.field };
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
        const { configPath, field } = this.cfgOf(provider);
        const cfg = this.read(configPath);
        const current = cfg[field];
        if (current !== undefined && !Array.isArray(current)) {
            throw new Error(`${configPath}: '${field}' field must be an array. Fix it manually, then re-run.`);
        }
        const list: string[] = Array.isArray(current) ? current : [];
        if (!list.includes(input.ref.absPath)) list.push(input.ref.absPath);
        cfg[field] = list;
        this.write(configPath, cfg);
    }

    remove(input: InjectionInput, provider: ProviderConfig): void {
        const { configPath, field } = this.cfgOf(provider);
        if (!fs.existsSync(configPath)) return;
        const cfg = this.read(configPath);
        const current = cfg[field];
        if (current !== undefined && !Array.isArray(current)) {
            throw new Error(`${configPath}: '${field}' field must be an array. Fix it manually, then re-run.`);
        }
        cfg[field] = (Array.isArray(current) ? current : []).filter((e: string) => e !== input.ref.absPath);
        this.write(configPath, cfg);
    }

    status(input: InjectionInput, provider: ProviderConfig): InjectionState {
        const { configPath, field } = this.cfgOf(provider);
        if (!fs.existsSync(configPath)) return 'absent';
        const cfg = this.read(configPath);
        const list = cfg[field];
        if (!Array.isArray(list) || !list.includes(input.ref.absPath)) return 'absent';
        if (!fs.existsSync(input.ref.absPath)) return 'stale';
        const onDisk = sha256(fs.readFileSync(input.ref.absPath, 'utf-8'));
        return onDisk === input.ref.contentHash ? 'injected' : 'stale';
    }
}
