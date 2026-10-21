import { readFile } from 'node:fs/promises';

const pageClosure = '$pageObservation=static function($pid)use($digest){';
const ownPageExclusions = "foreach(['_edit_lock','_edit_last','_elementor_element_cache','_elementor_css','wd_page_css_files','wd_page_css_files_mobile'] as $key)unset($meta[$key]);";
const normalizedClosure = '$pageObservation=static function($pid)use($digest,$ownerToken,$owner){';
const derivedExclusions = "if(get_post_meta($pid,'_clonewp_header_module_owner',true)===$ownerToken&&get_post_meta($pid,'_clonewp_run_id',true)===($owner['runId']??null))foreach(['_elementor_page_assets','_elementor_controls_usage'] as $key)unset($meta[$key]);";

/** Full replicas ignore two derived caches only for this module's owned page.
 * The shared legacy helper stays byte-for-byte on disk; every other guard is retained. */
export function normalizeFullReplicaHeaderHelper(source: string): string {
  if (source.split(pageClosure).length !== 2 || source.split(ownPageExclusions).length !== 2) throw Error('replica_full_native_helper_contract_changed');
  const start = source.indexOf(pageClosure), end = source.indexOf('$snapshot=static function()', start), exclusions = source.indexOf(ownPageExclusions);
  if (end < 0 || exclusions < start || exclusions > end) throw Error('replica_full_native_helper_scope_changed');
  return source.replace(pageClosure, normalizedClosure).replace(ownPageExclusions, `${ownPageExclusions}\n    ${derivedExclusions}`);
}

export async function loadFullReplicaHeaderHelper(): Promise<string> {
  return normalizeFullReplicaHeaderHelper(await readFile(new URL('../woodmart-header/generic/wordpress.php', import.meta.url), 'utf8'));
}
