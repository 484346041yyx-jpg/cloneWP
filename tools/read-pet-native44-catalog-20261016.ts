import { loadConfig } from '../src/core/config.js';
import { writeJson } from '../src/core/files.js';
import { WordPressClient } from '../src/wordpress/client.js';
import { NATIVE44_ALL_TYPES } from '../src/native44/catalog.js';
const root='D:/cloneWP', loaded=await loadConfig(root);
const client=new WordPressClient({targetUrl:loaded.config.targetUrl,username:loaded.credentials.wp_user,applicationPassword:loaded.credentials.wp_app_password,executionStrategy:'native44-css-handoff',allowedWidgetTypes:NATIVE44_ALL_TYPES});
try { const catalog=await client.readTargetCatalog(200);const filename=root+'/reports/native44/pet-catalog-20261016.json';await writeJson(filename,catalog);console.log(JSON.stringify({filename,products:catalog.products.length})); } finally {await client.close();}
