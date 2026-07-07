import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';

import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { PermissionsService } from '../auth/permissions.service';
import {
  AnalyseIaDetailDto,
  AnalyseIaListItemDto,
  CreerAnalyseIaData,
  ListerAnalysesIaQueryDto,
  PaginatedAnalysesIaDto,
} from './dto/analyse-ia.dto';
import { AnalyseIa } from './entities/analyse-ia.entity';

/** Rétention : 24 mois (2 exercices). */
const RETENTION_MOIS = 24;

@Injectable()
export class AnalyseIaService {
  constructor(
    @InjectRepository(AnalyseIa)
    private readonly repo: Repository<AnalyseIa>,
    private readonly permissionsService: PermissionsService,
    private readonly auditService: AuditService,
  ) {}

  /** Persiste une analyse réussie. Appelé en best-effort par le controller. */
  async creer(data: CreerAnalyseIaData): Promise<AnalyseIa> {
    const entity = this.repo.create({
      fkUser: data.fkUser,
      dateGeneration: data.dateGeneration,
      versionId: data.versionId,
      scenarioId: data.scenarioId,
      moisDebut: data.moisDebut,
      moisFin: data.moisFin,
      crsSelectionnes: data.crsSelectionnes,
      modele: data.modele,
      promptVersion: data.promptVersion,
      reponseMarkdown: data.reponseMarkdown,
      kpiSnapshot: data.kpiSnapshot,
      tokensIn: data.tokensIn,
      tokensOut: data.tokensOut,
      dureeMs: data.dureeMs,
      coutEstime: data.coutEstime.toFixed(5),
      dryRun: data.dryRun,
      statut: 'success',
      utilisateurCreation: data.demandeurEmail,
    });
    return this.repo.save(entity);
  }

  /** Mes analyses (auto-filtrées sur fkUser). */
  async listerPourUser(
    userId: string,
    query: ListerAnalysesIaQueryDto,
  ): Promise<PaginatedAnalysesIaDto> {
    return this.paginer({ ...this.filtres(query), fkUser: userId }, query);
  }

  /** Toutes les analyses (réservé aux porteurs d'AI.HISTORIQUE). */
  async listerTout(
    query: ListerAnalysesIaQueryDto,
  ): Promise<PaginatedAnalysesIaDto> {
    return this.paginer(this.filtres(query), query);
  }

  /**
   * Détail complet + contrôle d'accès : propriétaire OU porteur d'
   * AI.HISTORIQUE. Trace une consultation (audit ANALYSE_IA_CONSULTEE).
   */
  async getDetail(id: string, user: AuthUser): Promise<AnalyseIaDetailDto> {
    const a = await this.repo.findOne({ where: { id } });
    if (!a) throw new NotFoundException(`Analyse IA ${id} introuvable.`);

    // Comparaison en string : bigint peut remonter en number selon le driver.
    if (String(a.fkUser) !== String(user.userId)) {
      const peutToutVoir = await this.permissionsService.hasPermission(
        user.userId,
        ['AI.HISTORIQUE'],
      );
      if (!peutToutVoir) {
        throw new ForbiddenException(
          'Accès refusé : cette analyse appartient à un autre utilisateur.',
        );
      }
    }

    await this.auditService.log({
      utilisateur: user.email,
      typeAction: 'ANALYSE_IA_CONSULTEE',
      entiteCible: 'analyse_ia',
      idCible: a.id,
      statut: 'success',
      commentaire: `Consultation de l'analyse IA ${a.id}.`,
    });

    return toDetail(a);
  }

  /** Suppression (gate AI.HISTORIQUE côté controller). Hard delete + audit. */
  async supprimer(id: string, user: AuthUser): Promise<void> {
    const a = await this.repo.findOne({ where: { id } });
    if (!a) throw new NotFoundException(`Analyse IA ${id} introuvable.`);
    await this.repo.delete({ id });
    await this.auditService.log({
      utilisateur: user.email,
      typeAction: 'ANALYSE_IA_SUPPRIMEE',
      entiteCible: 'analyse_ia',
      idCible: id,
      statut: 'success',
      commentaire: `Suppression de l'analyse IA ${id} (demandeur ${a.utilisateurCreation}).`,
    });
  }

  /** Purge des analyses de plus de 24 mois (cron). Retourne le nb supprimé. */
  async purgerAnciennes(): Promise<number> {
    const seuil = new Date();
    seuil.setMonth(seuil.getMonth() - RETENTION_MOIS);
    const res = await this.repo.delete({ dateGeneration: LessThan(seuil) });
    return res.affected ?? 0;
  }

  // ─── Helpers privés ───────────────────────────────────────────

  private filtres(query: ListerAnalysesIaQueryDto): Record<string, unknown> {
    const w: Record<string, unknown> = {};
    if (query.versionId) w.versionId = query.versionId;
    if (query.scenarioId) w.scenarioId = query.scenarioId;
    if (query.moisDebut) w.moisDebut = query.moisDebut;
    if (query.moisFin) w.moisFin = query.moisFin;
    return w;
  }

  private async paginer(
    where: Record<string, unknown>,
    query: ListerAnalysesIaQueryDto,
  ): Promise<PaginatedAnalysesIaDto> {
    const [items, total] = await this.repo.findAndCount({
      where,
      order: { dateGeneration: 'DESC', id: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    return {
      items: items.map(toListItem),
      total,
      page: query.page,
      limit: query.limit,
    };
  }
}

// ─── Mappers ───────────────────────────────────────────────────────

function resumeDe(markdown: string): string {
  const plat = markdown
    .replace(/[#*>`|_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plat.length > 180 ? `${plat.slice(0, 179)}…` : plat;
}

function toListItem(a: AnalyseIa): AnalyseIaListItemDto {
  return {
    id: a.id,
    dateGeneration: a.dateGeneration.toISOString(),
    demandeurEmail: a.utilisateurCreation,
    versionId: a.versionId,
    scenarioId: a.scenarioId,
    moisDebut: a.moisDebut,
    moisFin: a.moisFin,
    modele: a.modele,
    tokensIn: a.tokensIn,
    tokensOut: a.tokensOut,
    dureeMs: a.dureeMs,
    coutEstime: Number(a.coutEstime),
    dryRun: a.dryRun,
    resume: resumeDe(a.reponseMarkdown),
  };
}

function toDetail(a: AnalyseIa): AnalyseIaDetailDto {
  return {
    ...toListItem(a),
    crsSelectionnes: a.crsSelectionnes,
    promptVersion: a.promptVersion,
    reponseMarkdown: a.reponseMarkdown,
    kpiSnapshot: a.kpiSnapshot,
  };
}
