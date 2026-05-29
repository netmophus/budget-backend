/**
 * AiAnalyseRateLimiterService (Lot 8.6.A) — rate limiting custom à
 * 2 niveaux pour POST /tableau-de-bord/analyse-ai :
 *
 *   - burst    : 3 analyses / 60 secondes par utilisateur
 *   - quotidien : 10 analyses / 24 heures par utilisateur
 *
 * Pattern copié de LoginRateLimiterService (Lot 6.4.B) :
 *  - Storage IN-MEMORY (Map<userId, number[]>). Acceptable V1
 *    mono-instance API. Dette tracée vers Redis pour V2
 *    (BullMQ Redis du Lot 6.3 déjà disponible).
 *  - Désactivable via env var `AI_RATE_LIMIT_DISABLED=true`
 *    (utilisé en test e2e + bench coût).
 *
 * Pourquoi 2 fenêtres et pas une seule :
 *  - 3/min protège du clic compulsif (anti-burst, UX)
 *  - 10/jour protège le budget Anthropic (anti-abus prolongé)
 *
 * Coût visé : 10 × 0.024 $ = 0.24 $ / utilisateur / jour max.
 * Pour 50 utilisateurs actifs = 12 $/jour = ~360 $/mois plafond.
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const FENETRE_BURST_MS = 60_000; // 60 s
const LIMITE_BURST = 3;

const FENETRE_QUOTIDIEN_MS = 24 * 60 * 60_000; // 24 h
const LIMITE_QUOTIDIEN = 10;

export interface AiRateLimitResult {
  bloque: boolean;
  motif?: 'BURST' | 'QUOTIDIEN';
  retryAfterSeconds?: number;
}

@Injectable()
export class AiAnalyseRateLimiterService {
  private readonly burstParUser: Map<string, number[]> = new Map();
  private readonly quotidienParUser: Map<string, number[]> = new Map();

  constructor(private readonly config: ConfigService) {}

  private estDesactive(): boolean {
    return this.config.get<string>('AI_RATE_LIMIT_DISABLED') === 'true';
  }

  /**
   * Vérifie les 2 seuils pour `userId`. Si OK, enregistre la
   * tentative et retourne `{ bloque: false }`. Si seuil dépassé,
   * retourne le motif (BURST ou QUOTIDIEN) et le délai avant la
   * prochaine analyse autorisée. Aucune tentative n'est enregistrée
   * en cas de blocage (sinon le compteur ne décroît jamais).
   */
  enregistrerEtVerifier(userId: string): AiRateLimitResult {
    if (this.estDesactive()) return { bloque: false };

    const now = Date.now();

    // 1. Burst (3 / 60s)
    const burstHits = (this.burstParUser.get(userId) ?? []).filter(
      (ts) => now - ts < FENETRE_BURST_MS,
    );
    if (burstHits.length >= LIMITE_BURST) {
      const plusAncien = burstHits[0];
      const retryAfterMs = FENETRE_BURST_MS - (now - plusAncien);
      return {
        bloque: true,
        motif: 'BURST',
        retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
      };
    }

    // 2. Quotidien (10 / 24h)
    const quotidienHits = (this.quotidienParUser.get(userId) ?? []).filter(
      (ts) => now - ts < FENETRE_QUOTIDIEN_MS,
    );
    if (quotidienHits.length >= LIMITE_QUOTIDIEN) {
      const plusAncien = quotidienHits[0];
      const retryAfterMs = FENETRE_QUOTIDIEN_MS - (now - plusAncien);
      return {
        bloque: true,
        motif: 'QUOTIDIEN',
        retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
      };
    }

    // OK : enregistrer + nettoyer les anciennes traces.
    burstHits.push(now);
    this.burstParUser.set(userId, burstHits);
    quotidienHits.push(now);
    this.quotidienParUser.set(userId, quotidienHits);
    return { bloque: false };
  }

  /** Utilitaire test : reset complet (pas appelé en prod). */
  resetPourTest(): void {
    this.burstParUser.clear();
    this.quotidienParUser.clear();
  }
}
