/**
 * VersionsResumeService (Lot 7.3) — agrégation d'une version budget
 * pour la page « Versions à valider ».
 *
 * Calcule en une seule requête : SUM(montant_fcfa), COUNT(DISTINCT
 * fk_compte), COUNT(*). Filtré par la liste de CR autorisés du user
 * connecté (null = admin global, [] = aucun CR → 0/0/0 sans aller en
 * base).
 *
 * Lot 7.4 — Si la version est verrouillée (soumis/valide/gele), le
 * filtre périmètre est bypassé : un validateur doit voir le budget
 * complet pour pouvoir décider.
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { FaitBudget } from '../../faits/budget/entities/fait-budget.entity';
import { ResumeVersionDto } from '../dto/resume-version.dto';

@Injectable()
export class VersionsResumeService {
  /**
   * Statuts pour lesquels le résumé est consultable globalement
   * (lecture par les validateurs/publicateur sans filtre périmètre).
   */
  private static readonly STATUTS_LECTURE_GLOBALE: readonly string[] = [
    'soumis',
    'valide',
    'gele',
  ];

  constructor(
    @InjectRepository(FaitBudget)
    private readonly repo: Repository<FaitBudget>,
  ) {}

  /**
   * Calcule le résumé d'une version pour un user.
   *
   * @param versionId identifiant bigint stringifié de la version
   * @param crAutorises résultat de `PerimetreService.getCrAutorisesPourUser` :
   *                    `null` = admin (pas de filtre CR),
   *                    `[]`   = aucun CR autorisé (court-circuit zéro),
   *                    `string[]` = filtre IN sur fk_centre.
   *
   * Lot 7.4 — Si la version est dans un statut "lecture globale",
   * `crAutorises` est forcé à `null` (lecture du budget complet).
   */
  async getResumeVersion(
    versionId: string,
    crAutorises: string[] | null,
  ): Promise<ResumeVersionDto> {
    const statutRows: Array<{ statut: string }> = await this.repo.manager.query(
      `SELECT statut FROM dim_version WHERE id = $1`,
      [versionId],
    );
    const statut: string | undefined = statutRows[0]?.statut;
    if (
      statut &&
      VersionsResumeService.STATUTS_LECTURE_GLOBALE.includes(statut)
    ) {
      crAutorises = null;
    }

    if (crAutorises !== null && crAutorises.length === 0) {
      return {
        versionId,
        montantTotalFcfa: 0,
        nombreComptes: 0,
        nombreLignes: 0,
      };
    }

    const qb = this.repo
      .createQueryBuilder('fb')
      .select('COALESCE(SUM(fb.montant_fcfa), 0)', 'totalFcfa')
      .addSelect('COUNT(DISTINCT fb.fk_compte)', 'nbComptes')
      .addSelect('COUNT(*)', 'nbLignes')
      .where('fb.fk_version = :vid', { vid: versionId });

    if (crAutorises !== null) {
      qb.andWhere('fb.fk_centre IN (:...crs)', { crs: crAutorises });
    }

    const row = await qb.getRawOne<{
      totalFcfa: string | number | null;
      nbComptes: string | number | null;
      nbLignes: string | number | null;
    }>();

    return {
      versionId,
      montantTotalFcfa: Number(row?.totalFcfa ?? 0),
      nombreComptes: Number(row?.nbComptes ?? 0),
      nombreLignes: Number(row?.nbLignes ?? 0),
    };
  }
}
