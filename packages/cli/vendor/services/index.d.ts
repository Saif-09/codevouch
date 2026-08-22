/**
 * Curated service-impact table. No registry exists for "you added Clerk and
 * it costs this at 10k users", so this is hand-seeded for the providers that
 * actually appear in AI-built apps (Vouch tech spec §8, RESEARCH §6.4).
 *
 * Shared surface: Vouch consumes it for Dossiers, launch-readiness for cost
 * findings. One table, two products. Keep entries factual and dated; pricing
 * moves, so `asOf` is mandatory and consumers should show it.
 */
export interface ServiceImpact {
    service: string;
    category: 'auth' | 'payments' | 'database' | 'cache' | 'email' | 'analytics' | 'errors' | 'storage' | 'ai' | 'search' | 'sms';
    /** Rough monthly cost with ~10k monthly active users, honest range. */
    pricingAt10k: string;
    /** What the app does when this service is down. */
    failureMode: string;
    /** What data leaves the user's machine or server to this provider. */
    dataEgress: string;
    readsSecrets: boolean;
    asOf: string;
}
export declare function lookupService(packageName: string): ServiceImpact | null;
export declare function allServices(): ServiceImpact[];
