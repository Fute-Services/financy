import { Module } from '@nestjs/common';

import { CARD_PROVIDER } from './card-provider.js';
import { CardsController } from './cards.controller.js';
import { CardsService } from './cards.service.js';
import { MockCardProvider } from './mock-card-provider.js';

/**
 * Cards, and the issuer behind them.
 *
 * The provider is bound to a token rather than to a class, so swapping the mock
 * for a real issuer is one line here and no change anywhere else. That is the
 * whole return on defining the port: the service never names an adapter.
 */
@Module({
  controllers: [CardsController],
  providers: [CardsService, { provide: CARD_PROVIDER, useClass: MockCardProvider }],
  exports: [CardsService],
})
export class CardsModule {}
