import { runCommand } from './command-runner.js';

export async function launchBrowser(url: string, options: {
  platform?: string;
  run?: (executable: string, args: string[]) => Promise<{ exitCode: number }>;
} = {}): Promise<{ opened: boolean; message: string }> {
  const platform = options.platform ?? process.platform;
  const run = options.run ?? ((executable, args) => runCommand({ executable, args, timeoutMs: 10_000 }));
  const command = platform === 'darwin'
    ? ['open', [url]] as const
    : platform === 'win32'
      ? ['cmd.exe', ['/c', 'start', '', url]] as const
      : ['xdg-open', [url]] as const;
  try {
    const result = await run(command[0], [...command[1]]);
    if (result.exitCode === 0) return { opened: true, message: `Opened ${url}` };
  } catch {}
  return { opened: false, message: `Open this URL manually: ${url}` };
}
