import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/index.js';
import { InvitationAcceptanceController } from './invitation-acceptance.controller.js';
import { InvitationsController } from './invitations.controller.js';
import { InvitationsService } from './invitations.service.js';
import { MembershipsController } from './memberships.controller.js';
import { MembershipsService } from './memberships.service.js';
import { PeopleService } from './people.service.js';

/**
 * `AuthModule` is imported for `SessionService` and `PasswordService`.
 * Deactivating a membership must revoke the sessions behind it, and accepting
 * an invitation hashes a password and issues a session — so the dependency
 * runs people → auth, which is why the two public invitation routes live here
 * and route into `/auth` rather than living in the auth module and depending
 * back the other way.
 */
@Module({
  imports: [AuthModule],
  // `InvitationsController` **must** come first. Nest matches routes in
  // registration order, and `MembershipsController` has `@Get(':id')` on the
  // same prefix — registered first, it would swallow
  // `GET /v1/memberships/invitations` as a membership whose id is the literal
  // string "invitations" and answer 404. The e2e suite lists invitations, so
  // reordering this array breaks a test rather than a customer.
  controllers: [InvitationsController, MembershipsController, InvitationAcceptanceController],
  providers: [PeopleService, MembershipsService, InvitationsService],
  exports: [PeopleService, MembershipsService, InvitationsService],
})
export class PeopleModule {}
