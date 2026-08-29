declare const process: { cwd(): string; argv: string[]; exitCode?: number };
declare module 'node:path' { const path: any; export default path; }
declare module 'node:fs' { export const realpathSync: any; export const promises: any; export const existsSync: any; export const readFileSync: any; }
declare module 'node:crypto' { const crypto: { randomUUID(): string }; export default crypto; }
declare module 'node:child_process' {
  export function spawn(command: string, args: string[], options: any): any;
}
declare module 'node:http' {
  export type Server = any;
  export function createServer(handler: (req: any, res: any) => void): any;
}
declare module 'node:os' { export function tmpdir(): string; }
declare module 'node:fs/promises' { export const mkdtemp: any; export const writeFile: any; export const readFile: any; export const rm: any; }
declare module 'node:process' { export const stdin: any; export const stdout: any; }
declare module 'node:readline/promises' { export function createInterface(options: any): any; }
