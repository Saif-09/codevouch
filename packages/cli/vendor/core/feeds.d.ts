import { type ServiceImpact } from '@vouch/services';
/**
 * Spec §8. All keyless. Rate limits are undocumented, so concurrency is
 * capped at 4 and results are cached by the caller for 7 days.
 * npm dist.unpackedSize is INSTALL size and is labelled as such; bundle
 * size is a Wave 2 field with no keyless source.
 */
export interface ImpactData {
    ecosystem: string;
    name: string;
    version: string | null;
    installSizeBytes: number | null;
    weeklyDownloads: number | null;
    lastPublished: string | null;
    license: string | null;
    transitiveCount: number | null;
    dependentCount: number | null;
    scorecardScore: number | null;
    advisories: string[];
    deprecated: boolean;
    service: ServiceImpact | null;
    errors: string[];
}
export declare function fetchImpact(ecosystem: 'npm' | 'pypi', name: string, version: string | null): Promise<ImpactData>;
