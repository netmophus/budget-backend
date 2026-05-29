/**
 * Tests AiAnalyseRateLimiterService (Lot 8.6.A). Pattern aligné sur
 * LoginRateLimiterService.spec (Lot 6.4.B). Pas de fake timers — on
 * appelle directement la méthode avec des Map remplies à la main si
 * besoin.
 */
import { ConfigService } from '@nestjs/config';

import { AiAnalyseRateLimiterService } from './ai-rate-limiter.service';

function makeConfig(disabled = false): ConfigService {
  return {
    get: (key: string): string | undefined =>
      key === 'AI_RATE_LIMIT_DISABLED'
        ? disabled
          ? 'true'
          : 'false'
        : undefined,
  } as unknown as ConfigService;
}

describe('AiAnalyseRateLimiterService', () => {
  let svc: AiAnalyseRateLimiterService;

  beforeEach(() => {
    svc = new AiAnalyseRateLimiterService(makeConfig(false));
  });

  it('autorise les 3 premières analyses dans la fenêtre burst', () => {
    expect(svc.enregistrerEtVerifier('u1').bloque).toBe(false);
    expect(svc.enregistrerEtVerifier('u1').bloque).toBe(false);
    expect(svc.enregistrerEtVerifier('u1').bloque).toBe(false);
  });

  it('bloque la 4e analyse en burst (3/60s) avec motif BURST + retryAfter', () => {
    svc.enregistrerEtVerifier('u1');
    svc.enregistrerEtVerifier('u1');
    svc.enregistrerEtVerifier('u1');
    const r = svc.enregistrerEtVerifier('u1');
    expect(r.bloque).toBe(true);
    expect(r.motif).toBe('BURST');
    expect(r.retryAfterSeconds).toBeGreaterThan(0);
    expect(r.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("isole les compteurs par utilisateur (u1 bloqué n'impacte pas u2)", () => {
    svc.enregistrerEtVerifier('u1');
    svc.enregistrerEtVerifier('u1');
    svc.enregistrerEtVerifier('u1');
    expect(svc.enregistrerEtVerifier('u1').bloque).toBe(true);
    expect(svc.enregistrerEtVerifier('u2').bloque).toBe(false);
  });

  it('AI_RATE_LIMIT_DISABLED=true → toujours autoriser même après 50 appels', () => {
    svc = new AiAnalyseRateLimiterService(makeConfig(true));
    for (let i = 0; i < 50; i++) {
      expect(svc.enregistrerEtVerifier('u1').bloque).toBe(false);
    }
  });

  it('bloque la 11e analyse en quotidien (10/24h) avec motif QUOTIDIEN', () => {
    // Espacer les 10 premiers appels pour ne pas hit la limite burst.
    // Trick : on appelle resetPourTest entre chaque pour vider le burst,
    // mais on garde le compteur quotidien que la méthode n'efface pas.
    // Approche plus simple : injecter directement dans la map quotidien.
    const svc2 = new AiAnalyseRateLimiterService(makeConfig(false));
    // Accès à la Map privée via cast (test only).
    const quotidien = (
      svc2 as unknown as { quotidienParUser: Map<string, number[]> }
    ).quotidienParUser;
    const now = Date.now();
    // 10 hits récents → la 11e doit bloquer
    quotidien.set(
      'u1',
      Array.from({ length: 10 }, (_, i) => now - i * 1000),
    );
    const r = svc2.enregistrerEtVerifier('u1');
    expect(r.bloque).toBe(true);
    expect(r.motif).toBe('QUOTIDIEN');
    expect(r.retryAfterSeconds).toBeGreaterThan(0);
  });
});
