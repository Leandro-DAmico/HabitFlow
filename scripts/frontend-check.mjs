// Run project-installed tools with this Node runtime, including on Windows.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../frontend');
const commands = {
  lint: ['eslint/bin/eslint.js', '.'],
  format: ['prettier/bin/prettier.cjs', '--check', '.'],
};
const command = commands[process.argv[2]];
if (!command) throw new Error('Choose lint or format');
const result = spawnSync(process.execPath, [path.join(frontend, 'node_modules', command[0]), ...command.slice(1)], {
  cwd: frontend,
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
