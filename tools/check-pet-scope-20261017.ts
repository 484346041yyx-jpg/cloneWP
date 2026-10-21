import {prepareLocalTask} from '../src/native44/local-task.js';
const input=await prepareLocalTask('D:/cloneWP/references/reference-v2-2026-10-17T01-38-08-872Z-www-petsupermarket-com-0cd5b3b3/program.json','D:/cloneWP');
console.log(JSON.stringify({status:'local-validated',taskId:input.program.taskId,metrics:input.inputMetrics}));
