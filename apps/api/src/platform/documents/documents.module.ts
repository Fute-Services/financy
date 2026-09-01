import { Global, Module } from '@nestjs/common';

import { ConfigService } from '../config/index.js';
import { DOCUMENT_PROVIDER, type DocumentProvider } from './document-provider.js';
import { LocalDocumentProvider } from './local-document-provider.js';

/**
 * Private document storage.
 *
 * Global, because receipts are not the only thing that will need it — an
 * export, a statement, a signed agreement all end up here — and threading an
 * import through each module adds a line and prevents nothing.
 *
 * **Only the local adapter exists, and selecting S3 fails loudly.** The
 * config schema already requires a bucket and a region when
 * `DOCUMENT_PROVIDER=s3`; a factory that quietly returned the filesystem
 * adapter when S3 was configured would write receipts onto a container's
 * ephemeral disk and lose them on the next deploy — with every log line saying
 * the upload succeeded.
 */
@Global()
@Module({
  providers: [
    {
      provide: DOCUMENT_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): DocumentProvider => {
        if (config.get('DOCUMENT_PROVIDER') === 's3') {
          throw new Error(
            'DOCUMENT_PROVIDER=s3, but S3DocumentProvider is not implemented yet. ' +
              'Use the local provider, or implement the adapter — falling back silently would ' +
              'store receipts on ephemeral disk and lose them on the next deploy.',
          );
        }

        return new LocalDocumentProvider(
          config.get('STORAGE_LOCAL_PATH'),
          config.get('SIGNED_URL_SECRET'),
          config.get('API_BASE_URL'),
        );
      },
    },
  ],
  exports: [DOCUMENT_PROVIDER],
})
export class DocumentsModule {}
