/**
 * DocumentHashService (Lot 8.1.B) — calculs cryptographiques pour
 * l'intégrité des documents officiels signés.
 *
 * Utilise `crypto` natif Node.js (SHA-256, pas de dépendance externe).
 * Les hash sont :
 *   - `hashContenu` : SHA-256 du `contenu_html` normalisé (whitespace
 *     consécutif → 1 espace + trim). Permet la comparaison stable
 *     même si l'editeur frontend insère des espaces/tabs/newlines
 *     parasites.
 *   - `hashVisas` : SHA-256 de la concaténation canonique des visas
 *     VISE triés par `ordre_visa`. Format chaque visa :
 *     `<fk_user_viseur>|<date_action ISO>|<commentaire>`, séparateur
 *     `||` entre visas.
 *
 * Les hash sont stockes (`document_signature.hash_contenu` et
 * `hash_visas`) au moment de la signature. La methode `verifierIntegrite`
 * du DocumentWorkflowService recalcule a la volee et compare.
 */
import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';

import type { DocumentVisa } from '../entities/document-visa.entity';

@Injectable()
export class DocumentHashService {
  /**
   * Normalise puis hash en SHA-256 hex.
   * Normalisation : `\s+` → 1 espace ASCII + trim.
   */
  hashContenu(contenuHtml: string): string {
    const normalise = contenuHtml.replace(/\s+/g, ' ').trim();
    return createHash('sha256').update(normalise, 'utf8').digest('hex');
  }

  /**
   * Hash SHA-256 hex des visas VISE, triés par `ordre_visa`.
   * Les visas REJETE / EN_ATTENTE / IGNORE sont exclus — seuls les
   * visas effectivement apposés contribuent au hash.
   */
  hashVisas(visas: ReadonlyArray<DocumentVisa>): string {
    const serialise = visas
      .filter((v) => v.statut === 'VISE')
      .slice()
      .sort((a, b) => a.ordreVisa - b.ordreVisa)
      .map((v) => {
        const date = v.dateAction ? v.dateAction.toISOString() : '';
        const com = v.commentaire ?? '';
        return `${v.fkUserViseur}|${date}|${com}`;
      })
      .join('||');
    return createHash('sha256').update(serialise, 'utf8').digest('hex');
  }
}
