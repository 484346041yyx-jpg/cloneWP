import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const tests=(await readdir(new URL('../tests/',import.meta.url))).filter(name=>name.endsWith('.test.ts')).sort().map(name=>fileURLToPath(new URL('../tests/'+name,import.meta.url)));
const child=spawn(process.execPath,[fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs',import.meta.url)),'--test','--test-concurrency=2','--test-timeout=120000',...tests],{
  cwd:root,stdio:'inherit',env:{...process.env,GOMAXPROCS:process.env.GOMAXPROCS||'2'},
});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',(code,signal)=>{process.exitCode=code??(signal?1:0);});
