import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
// The native TypeScript compiler otherwise follows the host's very large CPU
// count and can exhaust memory while browser verification is running.
const child=spawn(process.execPath,[fileURLToPath(new URL('../node_modules/typescript/bin/tsc',import.meta.url)),'-p','tsconfig.json'],{
  cwd:root,stdio:'inherit',env:{...process.env,GOMAXPROCS:process.env.GOMAXPROCS||'2'},
});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',(code,signal)=>{process.exitCode=code??(signal?1:0);});
