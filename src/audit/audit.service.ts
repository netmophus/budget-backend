/**
 * AuditService — piste d'audit métier RÉGLEMENTAIRE.
 *
 * À ne pas confondre avec le logger Pino (logs techniques HTTP / erreurs / debug).
 *
 * - audit_log : insertions persistées en DB, **inviolables**, conservation 10 ans
 *   (cf. §10.3 des spécifications + docs/audit.md).
 * - Pino     : volatile, stdout / fichier, destiné à l'observabilité ops.
 *
 * Toute action métier sensible doit produire une ligne audit_log. Si l'INSERT
 * échoue, l'action métier doit échouer également (cohérence réglementaire).
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { AuditLogResponseDto } from './dto/audit-log-response.dto';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto';
import { PaginatedAuditLogsDto } from './dto/paginated-audit-logs.dto';
import { AuditLog, AuditStatut, TypeAction } from './entities/audit-log.entity';

export interface AuditLogEntry {
  utilisateur: string;
  ipSource?: string | null;
  userAgent?: string | null;
  typeAction: TypeAction;
  entiteCible: string;
  idCible?: string | null;
  payloadAvant?: unknown;
  payloadApres?: unknown;
  commentaire?: string | null;
  statut: AuditStatut;
  dureeMs?: number | null;
}

export interface FindAllMeta {
  caller?: string;
  ipSource?: string | null;
  userAgent?: string | null;
}

function toResponse(row: AuditLog): AuditLogResponseDto {
  return {
    id: row.id,
    dateAction: row.dateAction,
    utilisateur: row.utilisateur,
    ipSource: row.ipSource,
    userAgent: row.userAgent,
    typeAction: row.typeAction,
    entiteCible: row.entiteCible,
    idCible: row.idCible,
    payloadAvant: row.payloadAvant,
    payloadApres: row.payloadApres,
    commentaire: row.commentaire,
    statut: row.statut,
    dureeMs: row.dureeMs,
  };
}

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly repo: Repository<AuditLog>,
  ) {}

  /**
   * Lot 4.1-fix2.B — accepte un EntityManager optionnel pour
   * insérer l'audit dans la même transaction que l'opération
   * appelante (rollback solidaire si l'audit échoue, et inversement).
   * Sans manager fourni, comportement inchangé : INSERT autonome.
   */
  async log(
    entry: AuditLogEntry,
    manager?: import('typeorm').EntityManager,
  ): Promise<void> {
    const repo = manager ? manager.getRepository(AuditLog) : this.repo;
    await repo.insert({
      utilisateur: entry.utilisateur,
      ipSource: entry.ipSource ?? null,
      userAgent: entry.userAgent ? entry.userAgent.substring(0, 500) : null,
      typeAction: entry.typeAction,
      entiteCible: entry.entiteCible,
      idCible: entry.idCible ?? null,
      payloadAvant: entry.payloadAvant ?? null,
      payloadApres: entry.payloadApres ?? null,
      commentaire: entry.commentaire ?? null,
      statut: entry.statut,
      dureeMs: entry.dureeMs ?? null,
    });
  }

  async findAll(
    query: ListAuditLogsQueryDto,
    meta: FindAllMeta = {},
  ): Promise<PaginatedAuditLogsDto> {
    // Méta-audit : la consultation par un utilisateur réel est elle-même tracée.
    // Pas de récursion possible : log() ne rappelle pas findAll().
    if (meta.caller && meta.caller !== 'system') {
      await this.log({
        utilisateur: meta.caller,
        ipSource: meta.ipSource,
        userAgent: meta.userAgent,
        typeAction: 'LIRE_AUDIT',
        entiteCible: 'audit_log',
        statut: 'success',
        commentaire: `filtres=${JSON.stringify(query)}`,
      });
    }

    const where: Record<string, unknown> = {};
    if (query.utilisateur) where.utilisateur = query.utilisateur;
    if (query.typeAction) where.typeAction = query.typeAction;
    if (query.entiteCible) where.entiteCible = query.entiteCible;
    if (query.idCible) where.idCible = query.idCible;
    if (query.statut) where.statut = query.statut;

    if (query.dateDebut && query.dateFin) {
      where.dateAction = Between(
        new Date(query.dateDebut),
        new Date(query.dateFin),
      );
    } else if (query.dateDebut) {
      where.dateAction = MoreThanOrEqual(new Date(query.dateDebut));
    } else if (query.dateFin) {
      where.dateAction = LessThanOrEqual(new Date(query.dateFin));
    }

    const [items, total] = await this.repo.findAndCount({
      where,
      order: { dateAction: 'DESC', id: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    return {
      items: items.map(toResponse),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async findOne(id: string): Promise<AuditLogResponseDto> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException('Ligne d’audit introuvable');
    }
    return toResponse(row);
  }
}
