/**
 * Tests unitaires LoginRateLimiterService (Lot 6.4.B).
 *
 * Couvre les 2 fenêtres (IP 60s / email 15min), l'isolation entre
 * IPs distinctes et entre emails distincts, le calcul du
 * Retry-After, et le bypass via env var.
 */
import { ConfigService } from '@nestjs/config';

import { LoginRateLimiterService } from './login-rate-limiter.service';

function makeConfig(env: Record<string, string> = {}): ConfigService {
  return {
    get: (key: string): string | undefined => env[key],
  } as unknown as ConfigService;
}

function makeService(env: Record<string, string> = {}): LoginRateLimiterService {
  return new LoginRateLimiterService(makeConfig(env));
}

describe('LoginRateLimiterService', () => {
  it('autorise 5 tentatives consécutives, bloque la 6ème (limite IP)', () => {
    const svc = makeService();
    for (let i = 0; i < 5; i++) {
      const r = svc.enregistrerEtVerifier('1.2.3.4', `user${i}@miznas.local`);
      expect(r.bloque).toBe(false);
    }
    const sixieme = svc.enregistrerEtVerifier('1.2.3.4', 'user6@miznas.local');
    expect(sixieme.bloque).toBe(true);
    expect(sixieme.motif).toBe('IP');
    expect(sixieme.retryAfterSeconds).toBeGreaterThan(0);
    expect(sixieme.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('autorise 5 tentatives sur le même email, bloque la 6ème (limite EMAIL)', () => {
    const svc = makeService();
    // Varier l'IP pour ne pas être bloqué par la limite IP en premier.
    for (let i = 0; i < 5; i++) {
      const r = svc.enregistrerEtVerifier(`10.0.0.${i}`, 'cible@miznas.local');
      expect(r.bloque).toBe(false);
    }
    const sixieme = svc.enregistrerEtVerifier('10.0.0.99', 'cible@miznas.local');
    expect(sixieme.bloque).toBe(true);
    expect(sixieme.motif).toBe('EMAIL');
    expect(sixieme.retryAfterSeconds).toBeGreaterThan(60); // > 60s, fenêtre 15min
  });

  it("user A bloqué ne bloque pas user B (isolation par email)", () => {
    const svc = makeService();
    // Saturer A (5 tentatives sur même IP donc on doit varier l'IP)
    for (let i = 0; i < 5; i++) {
      svc.enregistrerEtVerifier(`10.0.0.${i}`, 'a@miznas.local');
    }
    const aBloque = svc.enregistrerEtVerifier('10.0.0.99', 'a@miznas.local');
    expect(aBloque.bloque).toBe(true);
    expect(aBloque.motif).toBe('EMAIL');
    // B non concerné, depuis IP encore libre
    const bOk = svc.enregistrerEtVerifier('11.0.0.1', 'b@miznas.local');
    expect(bOk.bloque).toBe(false);
  });

  it('IP A bloquée ne bloque pas IP B (isolation par IP)', () => {
    const svc = makeService();
    for (let i = 0; i < 5; i++) {
      svc.enregistrerEtVerifier('1.1.1.1', `u${i}@miznas.local`);
    }
    const aBloque = svc.enregistrerEtVerifier('1.1.1.1', 'autre@miznas.local');
    expect(aBloque.bloque).toBe(true);
    expect(aBloque.motif).toBe('IP');
    const bOk = svc.enregistrerEtVerifier('2.2.2.2', 'autre@miznas.local');
    expect(bOk.bloque).toBe(false);
  });

  it("ne consomme pas le compteur quand bloqué (sinon le user reste bloqué éternellement)", () => {
    const svc = makeService();
    for (let i = 0; i < 5; i++) {
      svc.enregistrerEtVerifier('1.1.1.1', `u${i}@miznas.local`);
    }
    const a = svc.enregistrerEtVerifier('1.1.1.1', 'last@miznas.local');
    expect(a.bloque).toBe(true);
    const retryAfter1 = a.retryAfterSeconds!;
    // Une 2e tentative bloquée ne doit pas allonger le retryAfter
    // (le timer démarre au plus ancien, qui n'est pas mis à jour).
    const b = svc.enregistrerEtVerifier('1.1.1.1', 'last2@miznas.local');
    expect(b.bloque).toBe(true);
    expect(b.retryAfterSeconds).toBeLessThanOrEqual(retryAfter1);
  });

  it("normalise l'email (case-insensitive) pour le tracking", () => {
    const svc = makeService();
    for (let i = 0; i < 5; i++) {
      // 5 tentatives avec casse différente, depuis IPs distinctes
      svc.enregistrerEtVerifier(`10.0.0.${i}`, 'CASE@Miznas.LOCAL');
    }
    // 6e tentative en lowercase → bloquée par EMAIL même casse changée
    const r = svc.enregistrerEtVerifier('10.0.0.99', 'case@miznas.local');
    expect(r.bloque).toBe(true);
    expect(r.motif).toBe('EMAIL');
  });

  it('LOGIN_RATE_LIMIT_DISABLED=true → bypass (jamais bloqué)', () => {
    const svc = makeService({ LOGIN_RATE_LIMIT_DISABLED: 'true' });
    // 100 tentatives, aucun blocage.
    for (let i = 0; i < 100; i++) {
      const r = svc.enregistrerEtVerifier('1.1.1.1', 'a@b.c');
      expect(r.bloque).toBe(false);
    }
  });

  it('Lot 6.5.A — autorise 3 forgot-password consécutifs, bloque le 4ème (limite IP)', () => {
    const svc = makeService();
    for (let i = 0; i < 3; i++) {
      const r = svc.enregistrerEtVerifierForgot('192.168.0.10');
      expect(r.bloque).toBe(false);
    }
    const quatrieme = svc.enregistrerEtVerifierForgot('192.168.0.10');
    expect(quatrieme.bloque).toBe(true);
    expect(quatrieme.motif).toBe('IP');
    // Fenêtre 15 min = jusqu'à 900s.
    expect(quatrieme.retryAfterSeconds).toBeGreaterThan(0);
    expect(quatrieme.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);
  });

  it('Lot 6.5.A — IP forgot A bloquée ne bloque pas IP forgot B', () => {
    const svc = makeService();
    for (let i = 0; i < 3; i++) svc.enregistrerEtVerifierForgot('1.1.1.1');
    expect(svc.enregistrerEtVerifierForgot('1.1.1.1').bloque).toBe(true);
    expect(svc.enregistrerEtVerifierForgot('2.2.2.2').bloque).toBe(false);
  });

  it("Lot 6.5.A — compteur forgot indépendant du compteur login (pas de cross-pollution)", () => {
    const svc = makeService();
    // Saturer le forgot pour 1.1.1.1
    for (let i = 0; i < 3; i++) svc.enregistrerEtVerifierForgot('1.1.1.1');
    expect(svc.enregistrerEtVerifierForgot('1.1.1.1').bloque).toBe(true);
    // Le login depuis la même IP doit toujours marcher (jusqu'à 5x).
    for (let i = 0; i < 5; i++) {
      const r = svc.enregistrerEtVerifier('1.1.1.1', `u${i}@b.c`);
      expect(r.bloque).toBe(false);
    }
  });

  it('Lot 6.5.A — LOGIN_RATE_LIMIT_DISABLED=true bypass aussi les forgot', () => {
    const svc = makeService({ LOGIN_RATE_LIMIT_DISABLED: 'true' });
    for (let i = 0; i < 100; i++) {
      expect(svc.enregistrerEtVerifierForgot('1.1.1.1').bloque).toBe(false);
    }
  });

  it('reset() vide les 2 maps', () => {
    const svc = makeService();
    for (let i = 0; i < 5; i++) {
      svc.enregistrerEtVerifier('1.1.1.1', 'a@b.c');
    }
    expect(
      svc.enregistrerEtVerifier('1.1.1.1', 'autre@b.c').bloque,
    ).toBe(true);
    svc.reset();
    // Après reset, on peut à nouveau tenter
    expect(
      svc.enregistrerEtVerifier('1.1.1.1', 'autre@b.c').bloque,
    ).toBe(false);
  });
});
