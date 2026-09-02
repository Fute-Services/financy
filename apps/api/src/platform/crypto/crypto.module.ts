import { Global, Module } from '@nestjs/common';

import { CryptoService } from './field-encryption.service.js';

/**
 * Field-level encryption, available everywhere.
 *
 * Global for the same reason configuration is: the set of modules that will
 * ever need to encrypt a column is small but scattered, and threading an
 * import through each adds ceremony without adding a decision. There is
 * exactly one key and one algorithm, and a second instance would be a second
 * place to get either wrong.
 */
@Global()
@Module({
  providers: [CryptoService],
  exports: [CryptoService],
})
export class CryptoModule {}
