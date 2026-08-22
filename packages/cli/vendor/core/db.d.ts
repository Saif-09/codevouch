/**
 * Storage runs on Node's built-in SQLite rather than a native addon.
 *
 * better-sqlite3 compiles on install, which means every user needs a C++
 * toolchain before they can run `vouch`. `node:sqlite` ships with Node 24,
 * so installing Vouch is just downloading JavaScript.
 *
 * This adapter keeps the surface the rest of the codebase already uses
 * (prepare/run/get/all, exec, close), and normalises rows: node:sqlite
 * returns null-prototype objects, which behave oddly with deep-equality
 * checks and with anything that expects a plain object.
 */
export interface Statement {
    run(...params: unknown[]): {
        changes: number | bigint;
        lastInsertRowid: number | bigint;
    };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
}
export interface Db {
    prepare(sql: string): Statement;
    exec(sql: string): void;
    close(): void;
}
export declare function openDb(path: string): Db;
