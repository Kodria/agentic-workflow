import type { UnresolvedSensor } from './bootstrap';

/**
 * `sensor-a: missing-tool/tool-not-found; sensor-b: incompatible/...` — which
 * sensor and why. Before #172 an unresolvable sensor produced one code for the
 * whole pack, so an operator could not tell that the other sensors were fine.
 *
 * Its own module so the command wiring and `initSensors` share one formatting,
 * and so neither has to import the other to get it.
 */
export function describeUnresolved(unresolved: readonly UnresolvedSensor[] | undefined): string {
    if (!unresolved || unresolved.length === 0) return '';
    return [...unresolved]
        .sort((left, right) => left.sensor.localeCompare(right.sensor))
        .map(item => `${item.sensor}: ${item.state}/${item.reason}`)
        .join('; ');
}
