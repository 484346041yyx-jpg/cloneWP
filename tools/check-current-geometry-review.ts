import { readFile } from 'node:fs/promises';
import { auditFidelityProgram } from '../src/fidelity/check.js';
import { preflightNativeControls } from '../src/fidelity/native.js';

const root='D:/cloneWP';
const programPath='D:/cloneWP/references/reference-2026-10-15T01-35-56-997Z-www-petsupermarket-com-1698bebb/program.json';
const capabilitiesPath='D:/cloneWP/runs/2026-10-15T01-39-43-444Z-blocks-www-petsupermarket-com-b1a67d75/target/capabilities.json';
const {program,audit}=await auditFidelityProgram(programPath,{root,writeAudit:false});
const capabilities=JSON.parse(await readFile(capabilitiesPath,'utf8'));
const controls=preflightNativeControls(program,capabilities.legacySchemas);
process.stdout.write(JSON.stringify({auditStatus:audit.status,auditPassed:audit.passed,controlsPassed:controls.passed,nativeElements:controls.nativeElements,registeredSettings:controls.registeredSettings})+'\n');
