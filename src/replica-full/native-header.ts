import { WordPressHeaderModuleDriver } from '../woodmart-header/generic/wordpress.js';
import type { WoodMartHeaderTransport } from '../woodmart-header/transport.js';
import { normalizeFullReplicaHeaderHelper } from './native-helper.js';
import type { HeaderMenuContentClient } from '../woodmart-header/generic/menu-content.js';

type NativeTransport = Pick<WoodMartHeaderTransport, 'origin' | 'readPHP' | 'executePHP'>;

/** Reuse native contracts, ownership and CAS; normalize only the new flow's helper. */
export class FullReplicaHeaderModuleDriver extends WordPressHeaderModuleDriver {
  constructor(transport: NativeTransport, contentClient?: HeaderMenuContentClient) {
    super({
      origin: transport.origin,
      readPHP: operation => transport.readPHP({ ...operation, code: normalizeFullReplicaHeaderHelper(operation.code) }),
      executePHP: operation => transport.executePHP({ ...operation, code: normalizeFullReplicaHeaderHelper(operation.code) }),
    }, contentClient);
  }
}
