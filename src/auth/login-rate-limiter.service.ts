/**
 * LoginRateLimiterService (Lot 6.4.B) — rate limiting custom à
 * 2 niveaux pour POST /auth/login :
 *
 *   - IP    : 5 tentatives par 60 secondes
 *   - email : 5 tentatives par 15 minutes
 *
 * Storage IN-MEMORY (Map). Acceptable pour V1 mono-instance API.
 * DETTE TRACÉE : non distributif — multi-instance API casserait le
 * rate limit. Migration vers Redis storage en V2 (BullMQ Redis du
 * Lot 6.3 déjà disponible) ou Lot 7+.
 *
 * Désactivable via env var `LOGIN_RATE_LIMIT_DISABLED=true` (utilisé
 * en test e2e pour ne pas bloquer les autres specs qui font plusieurs
 * logins successifs sur la même IP).
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const FENETRE_IP_MS = 60_000; // 60 s
const FENETRE_EMAIL_MS = 15 * 60_000; // 15 min
const LIMITE = 5;

// Lot 6.5.A — fenêtre + limite dédiées pour POST /auth/forgot-password.
// Plus tolérant qu'un simple "3 par minute" : 3 par 15 min car un user
// qui clique le lien 2 fois en quelques minutes est plausible.
const FENETRE_FORGOT_MS = 15 * 60_000;
const LIMITE_FORGOT = 3;

export interface RateLimitResult {
  bloque: boolean;
  motif?: 'IP' | 'EMAIL';
  retryAfterSeconds?: number;
}

@Injectable()
export class LoginRateLimiterService {
  private readonly parIp: Map<string, number[]> = new Map();
  private readonly parEmail: Map<string, number[]> = new Map();
  // Lot 6.5.A — compteur dédié forgot-password (clé = IP).
  private readonly parIpForgot: Map<string, number[]> = new Map();

  constructor(private readonly config: ConfigService) {}

  private estDesactive(): boolean {
    return this.config.get<string>('LOGIN_RATE_LIMIT_DISABLED') === 'true';
  }

  /**
   * Vérifie le seuil pour (ip, email) ; si OK, enregistre la tentative
   * et retourne `{ bloque: false }`. Si seuil dépassé, retourne le
   * motif (IP ou EMAIL) et le delay avant la prochaine tentative
   * autorisée. Aucune tentative n'est enregistrée en cas de blocage
   * (sinon le compteur ne décroît jamais).
   */
  enregistrerEtVerifier(ip: string, email: string): RateLimitResult {
    if (this.estDesactive()) return { bloque: false };

    const now = Date.now();
    const cleEmail = email.toLowerCase().trim();

    // 1. Vérifier IP (fenêtre 60 s).
    const ipTimes = (this.parIp.get(ip) ?? []).filter(
      (t) => now - t < FENETRE_IP_MS,
    );
    if (ipTimes.length >= LIMITE) {
      const oldest = ipTimes[0];
      const retryAfter = Math.ceil((FENETRE_IP_MS - (now - oldest)) / 1000);
      return { bloque: true, motif: 'IP', retryAfterSeconds: retryAfter };
    }

    // 2. Vérifier email (fenêtre 15 min).
    const emailTimes = (this.parEmail.get(cleEmail) ?? []).filter(
      (t) => now - t < FENETRE_EMAIL_MS,
    );
    if (emailTimes.length >= LIMITE) {
      const oldest = emailTimes[0];
      const retryAfter = Math.ceil((FENETRE_EMAIL_MS - (now - oldest)) / 1000);
      return { bloque: true, motif: 'EMAIL', retryAfterSeconds: retryAfter };
    }

    // 3. Aucun blocage : enregistrer la tentative pour les 2 clés.
    ipTimes.push(now);
    emailTimes.push(now);
    this.parIp.set(ip, ipTimes);
    this.parEmail.set(cleEmail, emailTimes);

    return { bloque: false };
  }

  /**
   * Lot 6.5.A — Vérification du seuil pour POST /auth/forgot-password.
   * Une seule clé (IP) car on ne révèle pas l'absence d'email côté
   * réponse (anti-énumération) — limiter par email permettrait à un
   * attaquant de découvrir les emails valides en observant le statut
   * 429. La fenêtre est de 15 minutes pour 3 tentatives.
   * Désactivable par la même env var `LOGIN_RATE_LIMIT_DISABLED=true`
   * (cohérent dev local + tests e2e).
   */
  enregistrerEtVerifierForgot(ip: string): RateLimitResult {
    if (this.estDesactive()) return { bloque: false };

    const now = Date.now();
    const ipTimes = (this.parIpForgot.get(ip) ?? []).filter(
      (t) => now - t < FENETRE_FORGOT_MS,
    );
    if (ipTimes.length >= LIMITE_FORGOT) {
      const oldest = ipTimes[0];
      const retryAfter = Math.ceil((FENETRE_FORGOT_MS - (now - oldest)) / 1000);
      return { bloque: true, motif: 'IP', retryAfterSeconds: retryAfter };
    }
    ipTimes.push(now);
    this.parIpForgot.set(ip, ipTimes);
    return { bloque: false };
  }

  /** Réinitialise les 3 maps. Utilisé par les tests (afterEach). */
  reset(): void {
    this.parIp.clear();
    this.parEmail.clear();
    this.parIpForgot.clear();
  }
}
