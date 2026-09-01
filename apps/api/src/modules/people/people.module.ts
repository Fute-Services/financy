import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/index.js';
import { MembershipsController } from './memberships.controller.js';
import { MembershipsService } from './memberships.service.js';
import { PeopleService } from './people.service.js';

/**
 * `AuthModule` is imported for `SessionService`: deactivating a membership
 * must revoke the sessions behind it, and a deactivation that left them
 * working would report success while the person kept full access until their
 * token happened to expire.
 */
@Module({
  imports: [AuthModule],
  controllers: [MembershipsController],
  providers: [PeopleService, MembershipsService],
  exports: [PeopleService, MembershipsService],
})
export class PeopleModule {}
