import { Module } from '@nestjs/common';

import { LeadsController } from './leads.controller.js';
import { LeadsService } from './leads.service.js';

/**
 * Demo requests from the public site.
 *
 * Its own module rather than a route bolted onto an existing one, because it
 * is the only part of the API that serves someone outside every organisation.
 * Folding it into `organization` or `auth` would put a tenant-free write
 * beside tenant-scoped ones and make "which routes here are public" a question
 * you have to read the file to answer.
 */
@Module({
  controllers: [LeadsController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
