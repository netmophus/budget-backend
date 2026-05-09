import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';

import { Public } from '../auth/decorators/public.decorator';
import { EmailQueueProducer } from '../notifications/email-queue.producer';

interface ComponentStatus {
  status: 'up' | 'down';
  message?: string;
}

interface HealthResponse {
  status: 'ok' | 'degraded' | 'down';
  app: ComponentStatus;
  database: ComponentStatus;
  redis: ComponentStatus;
}

/**
 * Healthcheck MIZNAS (Lot 6.3.C — refactor pour Redis 'degraded').
 *
 * Sémantique :
 *  - DB down  → status global 'down' (HTTP 503 via terminus throw).
 *    L'app n'est PAS utilisable sans la base.
 *  - Redis down → status global 'degraded' (HTTP 200). L'app reste
 *    utilisable côté lecture/écriture, seuls les emails sont en
 *    panne — décision produit "MIZNAS reste utilisable même sans
 *    emails" actée au Lot 6.3.
 *  - Tout up → status global 'ok'.
 *
 * Le payload inclut systématiquement les 3 composants pour que les
 * monitorings externes (Datadog, Grafana, etc.) puissent alerter
 * spécifiquement sur Redis down via la clé `redis.status`.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly emailQueue: EmailQueueProducer,
  ) {}

  @Public()
  @Get()
  @ApiOperation({
    summary:
      "Vérifie la disponibilité de l'application, de la base et de Redis. " +
      "Statut 'degraded' si Redis est down (les emails sont en panne mais " +
      "l'app reste utilisable).",
  })
  async check(): Promise<HealthResponse> {
    // DB : on délègue à terminus. Si la DB est down, terminus throw,
    // l'endpoint répond 503. C'est le comportement souhaité (DB
    // indispensable). Si on arrive après ce point, elle est up.
    await this.health.check([() => this.db.pingCheck('database')]);

    const redisOk = await this.emailQueue.pingRedis();
    const redis: ComponentStatus = redisOk
      ? { status: 'up' }
      : { status: 'down', message: 'Redis injoignable — emails en panne' };

    const status: HealthResponse['status'] =
      redis.status === 'down' ? 'degraded' : 'ok';

    return {
      status,
      app: { status: 'up' },
      database: { status: 'up' },
      redis,
    };
  }
}
