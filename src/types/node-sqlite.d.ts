// Minimal ambient types for `node:sqlite` (Node 22.5+ experimental).
// @types/node 20.x doesn't include these yet — once we bump to 22 we can
// delete this file.

declare module 'node:sqlite' {
  export interface StatementSync {
    run(...params: unknown[]): { changes?: number; lastInsertRowid?: number };
    all(...params: any[]): unknown[];
    get(...params: any[]): unknown | undefined;
    sourceSQL: string;
  }

  export interface DatabaseSync {
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }

  export class DatabaseSync {
    constructor(filename: string);
  }
}