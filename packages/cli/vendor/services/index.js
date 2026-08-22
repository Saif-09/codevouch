/**
 * Curated service-impact table. No registry exists for "you added Clerk and
 * it costs this at 10k users", so this is hand-seeded for the providers that
 * actually appear in AI-built apps (Vouch tech spec §8, RESEARCH §6.4).
 *
 * Shared surface: Vouch consumes it for Dossiers, launch-readiness for cost
 * findings. One table, two products. Keep entries factual and dated; pricing
 * moves, so `asOf` is mandatory and consumers should show it.
 */
const TABLE = {
    clerk: {
        service: 'Clerk', category: 'auth',
        pricingAt10k: 'free to ~$100/mo (10k MAU is the free-tier edge; pro from $25/mo + $0.02/MAU past 10k)',
        failureMode: 'nobody can sign in or out; existing JWT sessions keep working until expiry',
        dataEgress: 'user identities: emails, names, OAuth profiles, session metadata',
        readsSecrets: true, asOf: '2026-08-21',
    },
    stripe: {
        service: 'Stripe', category: 'payments',
        pricingAt10k: 'no platform fee; 2.9% + 30¢ per charge (varies by country and method)',
        failureMode: 'checkout dies; webhooks queue and replay, so fulfilment lags rather than losing orders',
        dataEgress: 'payment details, customer emails, order amounts; card data goes to Stripe directly, never your server',
        readsSecrets: true, asOf: '2026-08-21',
    },
    supabase: {
        service: 'Supabase', category: 'database',
        pricingAt10k: 'free tier pauses after inactivity; realistic floor $25/mo pro',
        failureMode: 'the whole app, if it is your primary database; check for client-side fallbacks',
        dataEgress: 'your entire database contents, auth users, storage objects',
        readsSecrets: true, asOf: '2026-08-21',
    },
    neon: {
        service: 'Neon Postgres', category: 'database',
        pricingAt10k: 'free tier ~0.5GB; launch plan from $19/mo, scales with compute-hours',
        failureMode: 'the whole app, if primary DB; cold starts add latency after idle on free tier',
        dataEgress: 'your entire database contents',
        readsSecrets: true, asOf: '2026-08-21',
    },
    upstash: {
        service: 'Upstash Redis', category: 'cache',
        pricingAt10k: 'pay-per-request, often <$10/mo at this scale; watch per-command pricing in hot loops',
        failureMode: 'depends what you cached: sessions in Redis means everyone is logged out; cache-only means slow, not down',
        dataEgress: 'whatever you cache: often sessions, rate-limit counters, queues',
        readsSecrets: true, asOf: '2026-08-21',
    },
    resend: {
        service: 'Resend', category: 'email',
        pricingAt10k: 'free 3k emails/mo, then $20/mo for 50k',
        failureMode: 'transactional email stops: signups without verification mails, silent password-reset failure',
        dataEgress: 'recipient addresses and full email bodies',
        readsSecrets: true, asOf: '2026-08-21',
    },
    posthog: {
        service: 'PostHog', category: 'analytics',
        pricingAt10k: 'free tier covers ~1M events/mo; typical 10k-user app stays free or <$50/mo',
        failureMode: 'you lose analytics; the app is unaffected if the SDK is loaded async (verify it is)',
        dataEgress: 'user behaviour events, device info, IPs unless anonymized, session recordings if enabled',
        readsSecrets: false, asOf: '2026-08-21',
    },
    sentry: {
        service: 'Sentry', category: 'errors',
        pricingAt10k: 'free 5k errors/mo, team from $26/mo; error storms can blow quota fast',
        failureMode: 'you stop seeing errors; the app is unaffected',
        dataEgress: 'stack traces, request context, and whatever locals you attach; scrub PII in beforeSend',
        readsSecrets: false, asOf: '2026-08-21',
    },
    openai: {
        service: 'OpenAI API', category: 'ai',
        pricingAt10k: 'pure usage; 10k users doing one GPT-class call/day is roughly $100 to $1500/mo depending on model and tokens',
        failureMode: 'every AI feature dies at once unless you route through a gateway with fallbacks',
        dataEgress: 'every prompt and completion, which often includes user content',
        readsSecrets: true, asOf: '2026-08-21',
    },
    anthropic: {
        service: 'Anthropic API', category: 'ai',
        pricingAt10k: 'pure usage; same order of magnitude as OpenAI, model-dependent',
        failureMode: 'every AI feature dies at once unless you route through a gateway with fallbacks',
        dataEgress: 'every prompt and completion, which often includes user content',
        readsSecrets: true, asOf: '2026-08-21',
    },
    'vercel-blob': {
        service: 'Vercel Blob', category: 'storage',
        pricingAt10k: 'storage ~$0.023/GB + operations; uploads at 10k users usually <$20/mo',
        failureMode: 'uploads and file serving fail; the rest of the app survives',
        dataEgress: 'every stored file',
        readsSecrets: true, asOf: '2026-08-21',
    },
    algolia: {
        service: 'Algolia', category: 'search',
        pricingAt10k: 'free 10k search req/mo is tight at 10k users; grow plan ~$0.50/1k requests',
        failureMode: 'search dies; make sure the app degrades to a DB query, not a blank page',
        dataEgress: 'your indexed records, which is often your whole catalogue',
        readsSecrets: true, asOf: '2026-08-21',
    },
    twilio: {
        service: 'Twilio', category: 'sms',
        pricingAt10k: 'per-message; OTP-heavy apps at 10k users can hit hundreds/mo. SMS pumping fraud is the real bill risk',
        failureMode: 'OTP login locks everyone out if SMS is the only factor',
        dataEgress: 'phone numbers and message bodies',
        readsSecrets: true, asOf: '2026-08-21',
    },
    firebase: {
        service: 'Firebase', category: 'database',
        pricingAt10k: 'Spark free tier is generous; Blaze pay-as-you-go, runaway reads are the classic bill shock',
        failureMode: 'the whole app, typically, since it is usually auth + DB + storage at once',
        dataEgress: 'auth identities, database contents, analytics events',
        readsSecrets: true, asOf: '2026-08-21',
    },
};
/** npm package name → service key. */
const PACKAGE_MAP = {
    '@clerk/nextjs': 'clerk', '@clerk/clerk-react': 'clerk', '@clerk/clerk-sdk-node': 'clerk',
    '@clerk/backend': 'clerk', '@clerk/express': 'clerk',
    stripe: 'stripe', '@stripe/stripe-js': 'stripe', '@stripe/react-stripe-js': 'stripe',
    '@supabase/supabase-js': 'supabase', '@supabase/ssr': 'supabase',
    '@neondatabase/serverless': 'neon',
    '@upstash/redis': 'upstash', '@upstash/ratelimit': 'upstash', '@upstash/qstash': 'upstash',
    resend: 'resend',
    'posthog-js': 'posthog', 'posthog-node': 'posthog',
    '@sentry/nextjs': 'sentry', '@sentry/node': 'sentry', '@sentry/react': 'sentry',
    openai: 'openai', '@ai-sdk/openai': 'openai',
    '@anthropic-ai/sdk': 'anthropic', '@ai-sdk/anthropic': 'anthropic',
    '@vercel/blob': 'vercel-blob',
    algoliasearch: 'algolia', 'react-instantsearch': 'algolia',
    twilio: 'twilio',
    firebase: 'firebase', 'firebase-admin': 'firebase',
};
export function lookupService(packageName) {
    const key = PACKAGE_MAP[packageName];
    return key ? TABLE[key] : null;
}
export function allServices() {
    return Object.values(TABLE);
}
