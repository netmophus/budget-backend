/**
 * CompteImportService — premier usage RÉEL de `CsvImportService`
 * (cf. `common/csv/csv-import.service.ts`, posé en Lot 2.1 et
 * jamais utilisé en condition réelle jusqu'ici).
 *
 * Comportement :
 *  1. Le CSV est passé via `CsvImportService` qui valide chaque
 *     ligne avec un schéma Zod et collecte les erreurs Zod sans
 *     interrompre le batch.
 *  2. Les lignes valides sont **triées par niveau ASC** avant
 *     traitement, pour garantir que les parents sont traités
 *     avant leurs enfants — un export du SI comptable peut sortir
 *     les comptes dans n'importe quel ordre.
 *  3. Pour chaque ligne triée, on résout `code_compte_parent` →
 *     `fk_compte_parent` (id de la version courante en base ou
 *     déjà importé dans ce batch). Si introuvable : erreur typée
 *     `PARENT_INCONNU`.
 *  4. Selon le mode :
 *     - `insert-only` : si le compte existe → SKIP ; sinon INSERT.
 *     - `upsert` : si le compte existe et un champ SCD2 diffère →
 *       `createNewVersionCompte` (nouvelle version SCD2 + relink
 *       auto-référence). Sinon SKIP (no-op, pas de bruit historique).
 *  5. **Chaque ligne est traitée indépendamment** — une erreur sur
 *     la ligne 42 n'interrompt pas l'import des 1000 autres.
 *  6. Retourne un `ImportRapportDto` structuré : totalLines /
 *     imported / updated / skipped / errors[] / dureeMs.
 */
import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

import { CsvImportService } from '../../common/csv/csv-import.service';
import { CompteService } from './compte.service';
import {
  ImportErrorCode,
  ImportErrorDto,
  ImportRapportDto,
} from './dto/import-rapport.dto';
import { ImportMode } from './dto/import-request.dto';

/**
 * `csv-parse` retourne `''` pour une cellule vide. Pour qu'une
 * cellule vide soit traitée comme « absent » (et non comme une
 * chaîne vide qui passerait Zod, polluerait le diff SCD2 upsert,
 * ou serait insérée telle quelle), on prétraite `'' → undefined`
 * sur tous les champs optionnels.
 */
const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

/**
 * `z.coerce.boolean()` utilise `Boolean(v)` JS qui considère TOUTE
 * chaîne non vide comme `true` (`Boolean('false') === true`). Inutilisable
 * pour un CSV où l'utilisateur écrit explicitement `true` / `false`.
 * On parse les valeurs textuelles courantes — vide → false (défaut).
 */
const csvBoolean = z.preprocess((v) => {
  if (typeof v === 'boolean') return v;
  if (v == null || v === '') return false;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['true', '1', 'yes', 'oui', 'vrai'].includes(s)) return true;
    if (['false', '0', 'no', 'non', 'faux'].includes(s)) return false;
  }
  return v;
}, z.boolean());

const ligneCompteSchema = z.object({
  code_compte: z
    .string()
    .min(1)
    .max(20)
    .regex(/^[0-9]+$/, 'code_compte doit être numérique'),
  libelle: z.string().min(1).max(200),
  classe: z.coerce.number().int().min(1).max(9),
  sous_classe: z.preprocess(emptyToUndefined, z.string().max(20).optional()),
  code_compte_parent: z.preprocess(
    emptyToUndefined,
    z.string().max(20).optional(),
  ),
  niveau: z.coerce.number().int().min(1).max(4),
  sens: z.preprocess(emptyToUndefined, z.enum(['D', 'C', 'M']).optional()),
  code_poste_budgetaire: z.preprocess(
    emptyToUndefined,
    z.string().max(50).optional(),
  ),
  est_compte_collectif: csvBoolean.default(false),
  est_porteur_interets: csvBoolean.default(false),
});

type LigneCompte = z.infer<typeof ligneCompteSchema>;

@Injectable()
export class CompteImportService {
  private readonly logger = new Logger(CompteImportService.name);

  constructor(
    private readonly csvImportService: CsvImportService,
    private readonly compteService: CompteService,
  ) {}

  /**
   * Point d'entrée HTTP — accepte le buffer multer, écrit en
   * fichier temporaire, délègue à `importCsv`, nettoie. Pas de
   * fuite de fichier sur le disque même en cas d'erreur.
   */
  async importBuffer(
    buffer: Buffer,
    mode: ImportMode,
    utilisateur: string,
  ): Promise<ImportRapportDto> {
    const tmpPath = join(
      tmpdir(),
      `compte-import-${Date.now()}-${Math.floor(Math.random() * 1e6)}.csv`,
    );
    await fs.writeFile(tmpPath, buffer);
    try {
      return await this.importCsv(tmpPath, mode, utilisateur);
    } finally {
      await fs.unlink(tmpPath).catch(() => {
        // best-effort cleanup
      });
    }
  }

  async importCsv(
    filePath: string,
    mode: ImportMode,
    utilisateur: string,
  ): Promise<ImportRapportDto> {
    const startMs = Date.now();
    const errors: ImportErrorDto[] = [];

    // 1. Premier passage : lecture + validation Zod via CsvImportService.
    const validRows: Array<{ data: LigneCompte; lineNo: number }> = [];
    const csvReport = await this.csvImportService.import<LigneCompte>({
      filePath,
      schema: ligneCompteSchema,
      onRow: async (row, lineNo) => {
        validRows.push({ data: row, lineNo });
      },
    });

    // Conversion des erreurs Zod du CsvImportService vers notre format typé.
    for (const e of csvReport.errors) {
      errors.push({
        ligne: e.lineNo,
        codeCompte: e.rawRow?.code_compte,
        message: e.error,
        code: 'VALIDATION_ZOD',
      });
    }

    // 2. Tri par niveau ASC (parents avant enfants), puis code pour
    //    déterminisme. Garantit que la résolution de fk_compte_parent
    //    réussit même si le CSV est désordonné.
    validRows.sort((a, b) => {
      if (a.data.niveau !== b.data.niveau) {
        return a.data.niveau - b.data.niveau;
      }
      return a.data.code_compte.localeCompare(b.data.code_compte);
    });

    // 3. Traitement ligne par ligne.
    let imported = 0;
    let updated = 0;
    let skipped = 0;

    /** Cache code → id pour les comptes importés dans ce batch. */
    const idsImportedThisBatch = new Map<string, string>();

    for (const { data, lineNo } of validRows) {
      try {
        // Résoudre le parent.
        let fkCompteParent: string | null = null;
        if (data.code_compte_parent) {
          const parentInBatch = idsImportedThisBatch.get(
            data.code_compte_parent,
          );
          if (parentInBatch) {
            fkCompteParent = parentInBatch;
          } else {
            const parentInDb = await this.compteService.findCurrent(
              data.code_compte_parent,
            );
            if (!parentInDb) {
              errors.push({
                ligne: lineNo,
                codeCompte: data.code_compte,
                message: `Parent inconnu : ${data.code_compte_parent}`,
                code: 'PARENT_INCONNU',
              });
              continue;
            }
            fkCompteParent = String(parentInDb.id);
          }
        }

        // Compte déjà existant ?
        const existing = await this.compteService.findCurrent(data.code_compte);

        if (!existing) {
          // INSERT
          const created = await this.compteService.create(
            {
              codeCompte: data.code_compte,
              libelle: data.libelle,
              classe: data.classe,
              sousClasse: data.sous_classe ?? undefined,
              fkCompteParent: fkCompteParent ?? undefined,
              niveau: data.niveau,
              sens: data.sens ?? undefined,
              codePosteBudgetaire: data.code_poste_budgetaire ?? undefined,
              estCompteCollectif: data.est_compte_collectif,
              estPorteurInterets: data.est_porteur_interets,
            },
            utilisateur,
          );
          idsImportedThisBatch.set(data.code_compte, created.id);
          imported++;
          continue;
        }

        // Compte existant.
        if (mode === 'insert-only') {
          idsImportedThisBatch.set(data.code_compte, existing.id);
          skipped++;
          continue;
        }

        // Mode upsert : détecter changement SCD2 et appliquer si oui.
        const hasScd2Diff =
          existing.libelle !== data.libelle ||
          existing.sousClasse !== (data.sous_classe ?? null) ||
          existing.fkCompteParent !== fkCompteParent ||
          existing.niveau !== data.niveau ||
          existing.sens !== (data.sens ?? null) ||
          existing.codePosteBudgetaire !==
            (data.code_poste_budgetaire ?? null) ||
          existing.estCompteCollectif !== data.est_compte_collectif ||
          existing.estPorteurInterets !== data.est_porteur_interets;

        if (!hasScd2Diff) {
          idsImportedThisBatch.set(data.code_compte, existing.id);
          skipped++;
          continue;
        }

        // Passer par CompteService.update pour bénéficier de la
        // sémantique 4-cas (intra-jour / nouvelle version + relink).
        const refreshed = await this.compteService.update(
          data.code_compte,
          {
            libelle: data.libelle,
            sousClasse: data.sous_classe ?? undefined,
            fkCompteParent: fkCompteParent ?? undefined,
            niveau: data.niveau,
            sens: data.sens ?? undefined,
            codePosteBudgetaire: data.code_poste_budgetaire ?? undefined,
            estCompteCollectif: data.est_compte_collectif,
            estPorteurInterets: data.est_porteur_interets,
          },
          utilisateur,
        );
        idsImportedThisBatch.set(data.code_compte, refreshed.id);
        updated++;
      } catch (err) {
        const code = this.mapErrorCode(err);
        const message = err instanceof Error ? err.message : String(err);
        errors.push({
          ligne: lineNo,
          codeCompte: data.code_compte,
          message,
          code,
        });
      }
    }

    return {
      totalLines: csvReport.totalLines,
      imported,
      updated,
      skipped,
      errors,
      dureeMs: Date.now() - startMs,
    };
  }

  private mapErrorCode(err: unknown): ImportErrorCode {
    const msg = err instanceof Error ? err.message : String(err);
    if (/cycle/i.test(msg)) return 'CYCLE_DETECTE';
    if (/Incohérence niveau/i.test(msg)) return 'INCOHERENCE_NIVEAU';
    if (/Incohérence classe/i.test(msg)) return 'INCOHERENCE_CLASSE';
    if (/parent .* introuvable/i.test(msg)) return 'PARENT_INCONNU';
    return 'AUTRE';
  }
}
