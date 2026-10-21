import { loadConfig, redactor } from '../src/core/config.js';
import { NovamiraTransport } from '../src/wordpress/mcp.js';
import { nativeCheckpointPHP } from '../src/wordpress/checkpoint.js';
const loaded = await loadConfig('D:/cloneWP'), origin = new URL(loaded.config.targetUrl).origin;
const token = 'Basic ' + Buffer.from(loaded.credentials.wp_user + ':' + loaded.credentials.wp_app_password).toString('base64');
const fetcher: typeof fetch = async (input, init = {}) => {
  const url = new URL(input instanceof Request ? input.url : input.toString()); if (url.origin !== origin) throw Error('Different origin rejected');
  const headers = new Headers(init.headers); headers.set('Authorization', token);
  return fetch(input, { ...init, headers, redirect: 'error', signal: AbortSignal.timeout(45000) });
};
const transport = new NovamiraTransport(new URL('/wp-json/mcp/novamira', origin), fetcher);
try {
  const code = `$id=15621;$run='2026-10-17T02-00-02-486Z-n44-1f0d432c';$diagnostic=['postType'=>get_post_type($id),'status'=>get_post_status($id),'ownerMatches'=>get_post_meta($id,'_clonewp_run_id',true)===$run,'canEdit'=>current_user_can('edit_post',$id)];try{$doc=\\Elementor\\Plugin::$instance->documents->get($id);$diagnostic['documentExists']=(bool)$doc;$diagnostic['built']=$doc?$doc->is_built_with_elementor():false;${nativeCheckpointPHP("['container','heading','text-editor','button','wd_list','wd_image_or_svg','image-box','divider','nested-carousel','wd_products']")}$diagnostic['nativeCheckpointPassed']=true;}catch(\\Throwable $e){$diagnostic['nativeCheckpointPassed']=false;$diagnostic['error']=substr(preg_replace('/[^a-zA-Z0-9_ .:()-]/','',$e->getMessage()),0,180);}return $diagnostic;`;
  const result = await transport.execute('novamira/execute-php', { code });
  console.log(redactor(loaded.credentials)(JSON.stringify(result)));
} finally { await transport.close(); }
