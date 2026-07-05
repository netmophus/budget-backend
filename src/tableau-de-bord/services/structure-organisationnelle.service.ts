/**
 * StructureOrganisationnelleService (Chantier A) — fournit la structure
 * organisationnelle (Centres de Responsabilité + Lignes Métier actives) au
 * prompt IA enrichi.
 *
 *  - CR : filtrés par le périmètre de l'utilisateur (PerimetreService).
 *  - LM : globales (pas de filtrage périmètre).
 *
 * Ne renvoie que la version SCD2 courante et active (`versionCourante` +
 * `estActif`), triée par code pour un rendu déterministe.
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { AuthUser } from '../../auth/decorators/current-user.decorator';
import { PerimetreService } from '../../budget/services/perimetre.service';
import { DimCentreResponsabilite } from '../../referentiels/centre-responsabilite/entities/dim-centre-responsabilite.entity';
import { DimLigneMetier } from '../../referentiels/ligne-metier/entities/dim-ligne-metier.entity';

export interface CodeLibelle {
  code: string;
  libelle: string;
}

@Injectable()
export class StructureOrganisationnelleService {
  constructor(
    @InjectRepository(DimCentreResponsabilite)
    private readonly crRepo: Repository<DimCentreResponsabilite>,
    @InjectRepository(DimLigneMetier)
    private readonly lmRepo: Repository<DimLigneMetier>,
    private readonly perimetreService: PerimetreService,
  ) {}

  /** CR actifs courants, filtrés par le périmètre de l'utilisateur. */
  async getCentresResponsabilite(user: AuthUser): Promise<CodeLibelle[]> {
    // null = accès global (admin / périmètre GLOBAL) → aucun filtre.
    const autorises = await this.perimetreService.getCrAutorisesPourUser(
      user.userId,
    );
    const crs = await this.crRepo.find({
      where: { versionCourante: true, estActif: true },
      order: { codeCr: 'ASC' },
    });
    const filtres =
      autorises === null
        ? crs
        : crs.filter((c) => autorises.includes(c.codeCr));
    return filtres.map((c) => ({ code: c.codeCr, libelle: c.libelle }));
  }

  /** Lignes métier actives courantes (globales, sans filtrage périmètre). */
  async getLignesMetier(): Promise<CodeLibelle[]> {
    const lms = await this.lmRepo.find({
      where: { versionCourante: true, estActif: true },
      order: { codeLigneMetier: 'ASC' },
    });
    return lms.map((l) => ({ code: l.codeLigneMetier, libelle: l.libelle }));
  }
}
