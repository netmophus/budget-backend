import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AiAnalyseRateLimiterService } from './ai-rate-limiter.service';
import { AnthropicService } from './anthropic.service';

/**
 * AiModule (Lot 8.6.A) — expose les services nécessaires à
 * l'endpoint MIZNAS AI du dashboard Budget vs Réalisé.
 *
 * Les 2 services sont stateless (côté DI) :
 *  - `AnthropicService` lit la clé API via ConfigService et appelle
 *    le SDK Anthropic (ou retourne un mock si AI_DRY_RUN=true).
 *  - `AiAnalyseRateLimiterService` maintient 2 Maps in-memory
 *    (burst + quotidien) — pattern Lot 6.4.B, dette Redis tracée.
 *
 * Le module est consommé par TableauBordModule pour câbler l'endpoint
 * POST /tableau-de-bord/analyse-ai.
 */
@Module({
  imports: [ConfigModule],
  providers: [AnthropicService, AiAnalyseRateLimiterService],
  exports: [AnthropicService, AiAnalyseRateLimiterService],
})
export class AiModule {}
