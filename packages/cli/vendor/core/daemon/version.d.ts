/**
 * Single source of truth for the daemon build version.
 * Bump this whenever routes, behaviour, or the database schema change: the
 * CLI replaces any daemon whose version differs from its own, so a stale
 * background process never keeps serving old logic after an upgrade.
 */
export declare const DAEMON_VERSION = "5";
