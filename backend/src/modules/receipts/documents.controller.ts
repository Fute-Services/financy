import { RECEIPT_MAX_BYTES } from '@financy/contracts';
import { ForbiddenError, NotFoundError, ValidationError } from '@financy/core';
import { Controller, Get, Param, Put, Query, Req, Res, type RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';

import { Public } from '../../platform/authorization/index.js';
import { ConfigService } from '../../platform/config/index.js';
import {
  DOCUMENT_PROVIDER,
  LocalDocumentProvider,
  type DocumentProvider,
} from '../../platform/documents/index.js';
import { Inject } from '@nestjs/common';

/**
 * The storage endpoint the local adapter's signed URLs point at (ADR-0008).
 *
 * ## Why this route is `@Public()` and still not open
 *
 * It carries no session. It cannot: a signed URL is followed by an `<img>`
 * tag, a PDF viewer, a `fetch` from a worker — contexts where the cookie may
 * not travel and where a redirect to a login page produces a broken image
 * rather than an error anybody sees. **The signature is the authorisation**,
 * and it is scoped to one key, one operation, and one expiry.
 *
 * That is exactly how S3 presigned URLs work, and emulating it — rather than
 * serving files behind the ordinary session guard — is the point: the failure
 * modes a developer meets locally are the failure modes production has.
 *
 * ## What the signature covers, and why each part is there
 *
 * - **The key**, so a link to one receipt is not a link to another.
 * - **The operation**, so the link that lets somebody read a file is not the
 *   same string that lets them overwrite it. The read link is the one that
 *   gets pasted into a chat message.
 * - **The expiry**, checked before the signature is compared, so a valid
 *   signature on a stale link is refused.
 *
 * ## What it deliberately does not do
 *
 * It does not check permissions. It cannot — there is no caller to check. The
 * permission check happened when the URL was minted, moments earlier, against
 * the receipt's own row; the short TTL is what keeps those two facts close
 * enough together to mean the same thing.
 */
@Controller('documents')
export class DocumentsController {
  constructor(
    @Inject(DOCUMENT_PROVIDER) private readonly documents: DocumentProvider,
    private readonly config: ConfigService,
  ) {}

  /**
   * Receive an upload.
   *
   * Size is enforced here as well as by the schema, because this is the only
   * place the actual bytes are counted — the browser's `File.size` is a claim
   * like any other.
   */
  @Put(':key')
  @Public()
  async upload(
    @Param('key') key: string,
    @Query('token') token: string,
    @Query('expires') expires: string,
    @Req() request: RawBodyRequest<Request>,
    @Res() response: Response,
  ): Promise<void> {
    this.assertSigned('PUT', key, expires, token);

    const body = await readBody(request, Math.min(this.maxBytes(), RECEIPT_MAX_BYTES));

    await this.documents.replaceObject(decodeURIComponent(key), body);

    // 200 with nothing: the caller's next step is `POST /receipts/{id}/complete`,
    // and anything this returned about the file would be a claim made by the
    // side of the exchange that must not be trusted.
    response.status(200).json({ ok: true });
  }

  @Get(':key')
  @Public()
  async download(
    @Param('key') key: string,
    @Query('token') token: string,
    @Query('expires') expires: string,
    @Query('name') name: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    this.assertSigned('GET', key, expires, token);

    const data = await this.documents.read(decodeURIComponent(key));

    if (data === null) throw new NotFoundError('Document');

    /**
     * `attachment`, always, and a generic content type.
     *
     * A stored file rendered inline runs in this application's origin, which
     * turns an uploaded SVG or HTML file into stored XSS. The type check at
     * completion makes that unlikely; this makes it unable to matter.
     */
    response.setHeader('Content-Type', 'application/octet-stream');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${sanitiseFileName(name ?? 'download')}"`,
    );
    response.setHeader('Cache-Control', 'private, no-store');

    response.status(200).send(Buffer.from(data));
  }

  private maxBytes(): number {
    return this.config.get('STORAGE_MAX_UPLOAD_BYTES');
  }

  private assertSigned(
    operation: 'GET' | 'PUT',
    key: string,
    expires: string,
    token: string,
  ): void {
    const provider = this.documents;

    /* c8 ignore next 3 -- unreachable while the local adapter is the only one. */
    if (!(provider instanceof LocalDocumentProvider)) {
      throw new NotFoundError('Document');
    }

    if (typeof token !== 'string' || typeof expires !== 'string') {
      throw new ForbiddenError('This link is not valid.');
    }

    const decoded = decodeURIComponent(key);

    if (!provider.verify(operation, decoded, Number(expires), token)) {
      // One message for an expired link, a tampered key, and a wrong
      // signature. Distinguishing them tells whoever is probing which of their
      // attempts got closer.
      throw new ForbiddenError('This link has expired or is not valid.');
    }
  }
}

/**
 * The body, with a hard ceiling.
 *
 * Read as a stream and abandoned the moment it exceeds the limit, rather than
 * buffered and measured afterwards — the point of a limit is to not hold the
 * bytes.
 */
async function readBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let total = 0;

  return new Promise((resolve, reject) => {
    request.on('data', (chunk: Buffer) => {
      total += chunk.length;

      if (total > maxBytes) {
        request.destroy();
        reject(
          new ValidationError({
            file: [`That file is larger than the ${String(maxBytes / 1024 / 1024)} MB limit.`],
          }),
        );

        return;
      }

      chunks.push(chunk);
    });

    request.on('end', () => {
      resolve(Uint8Array.from(Buffer.concat(chunks)));
    });
    request.on('error', reject);
  });
}

/**
 * A file name safe to put in a header.
 *
 * Quotes, control characters, and newlines are removed rather than escaped:
 * a newline in this header is a response-splitting attack, and the name is
 * cosmetic enough that stripping is the right trade.
 */
function sanitiseFileName(name: string): string {
  return name.replace(/[^\w.\- ]/g, '_').slice(0, 100) || 'download';
}
