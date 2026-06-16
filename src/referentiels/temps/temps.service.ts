import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AuditService } from '../../audit/audit.service';
import { AuthUser } from '../../auth/decorators/current-user.decorator';
import { generateTempsRows } from '../../seeds/temps-seed';
import { ExtendCalendrierDto } from './dto/extend-calendrier.dto';
import { ListTempsQueryDto } from './dto/list-temps-query.dto';
import { PaginatedTempsDto } from './dto/paginated-temps.dto';
import { TempsResponseDto } from './dto/temps-response.dto';
import { UpdateJourDto } from './dto/update-jour.dto';
import { DimTemps } from './entities/dim-temps.entity';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Champs « métier modifiables » d'un jour — snapshot audit (avant/après). */
function editableSnapshot(row: DimTemps): Record<string, unknown> {
  return {
    jourOuvre: row.jourOuvre,
    estFinDeMois: row.estFinDeMois,
    estFinDeTrimestre: row.estFinDeTrimestre,
    estFinDAnnee: row.estFinDAnnee,
    libelleJour: row.libelleJour,
  };
}

function toResponse(row: DimTemps): TempsResponseDto {
  return {
    id: row.id,
    date: row.date,
    annee: row.annee,
    trimestre: row.trimestre,
    mois: row.mois,
    jour: row.jour,
    semaineIso: row.semaineIso,
    jourOuvre: row.jourOuvre,
    estFinDeMois: row.estFinDeMois,
    estFinDeTrimestre: row.estFinDeTrimestre,
    estFinDAnnee: row.estFinDAnnee,
    exerciceFiscal: row.exerciceFiscal,
    libelleMois: row.libelleMois,
    libelleJour: row.libelleJour,
  };
}

@Injectable()
export class TempsService {
  constructor(
    @InjectRepository(DimTemps)
    private readonly repo: Repository<DimTemps>,
    private readonly auditService: AuditService,
  ) {}

  async findAll(query: ListTempsQueryDto): Promise<PaginatedTempsDto> {
    const qb = this.repo.createQueryBuilder('t');
    if (query.annee !== undefined) {
      qb.andWhere('t.annee = :annee', { annee: query.annee });
    }
    if (query.mois !== undefined) {
      qb.andWhere('t.mois = :mois', { mois: query.mois });
    }
    if (query.exerciceFiscal !== undefined) {
      qb.andWhere('t.exerciceFiscal = :exo', { exo: query.exerciceFiscal });
    }
    if (query.dateDebut) {
      qb.andWhere('t.date >= :debut', { debut: query.dateDebut });
    }
    if (query.dateFin) {
      qb.andWhere('t.date <= :fin', { fin: query.dateFin });
    }

    qb.orderBy('t.date', 'ASC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    const [items, total] = await qb.getManyAndCount();

    return {
      items: items.map(toResponse),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async findOne(id: string): Promise<TempsResponseDto> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException('Jour calendaire introuvable');
    }
    return toResponse(row);
  }

  async findByDate(date: string): Promise<TempsResponseDto> {
    if (!ISO_DATE.test(date)) {
      throw new BadRequestException(
        'Format de date invalide : attendu YYYY-MM-DD',
      );
    }
    const row = await this.repo.findOne({ where: { date } });
    if (!row) {
      throw new NotFoundException(`Aucun jour calendaire pour la date ${date}`);
    }
    return toResponse(row);
  }

  async findRange(
    dateDebut: string,
    dateFin: string,
  ): Promise<TempsResponseDto[]> {
    const items = await this.repo
      .createQueryBuilder('t')
      .where('t.date >= :debut', { debut: dateDebut })
      .andWhere('t.date <= :fin', { fin: dateFin })
      .orderBy('t.date', 'ASC')
      .getMany();
    return items.map(toResponse);
  }

  async findByMois(annee: number, mois: number): Promise<TempsResponseDto[]> {
    const items = await this.repo.find({
      where: { annee, mois },
      order: { date: 'ASC' },
    });
    return items.map(toResponse);
  }

  async findExercice(exerciceFiscal: number): Promise<TempsResponseDto[]> {
    const items = await this.repo.find({
      where: { exerciceFiscal },
      order: { date: 'ASC' },
    });
    return items.map(toResponse);
  }

  /**
   * Lot 8.7.A — édition d'un jour du calendrier (ADMIN).
   *
   * Met à jour uniquement les champs « métier » whitelistés par UpdateJourDto
   * (jour_ouvre, fins de période, libelle_jour). Les colonnes calculées
   * (date, annee, trimestre, mois, jour, semaine_iso, libelle_mois) et
   * exercice_fiscal restent intactes. Une ligne audit MODIFIER_JOUR_CALENDRIER
   * est posée (payloadAvant/Apres). Si l'audit échoue, l'opération échoue
   * (cohérence réglementaire — cf. AuditService).
   */
  async updateJour(
    id: string,
    dto: UpdateJourDto,
    user: AuthUser,
  ): Promise<TempsResponseDto> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException('Jour calendaire introuvable');
    }

    const avant = editableSnapshot(row);

    if (dto.jourOuvre !== undefined) row.jourOuvre = dto.jourOuvre;
    if (dto.estFinDeMois !== undefined) row.estFinDeMois = dto.estFinDeMois;
    if (dto.estFinDeTrimestre !== undefined) {
      row.estFinDeTrimestre = dto.estFinDeTrimestre;
    }
    if (dto.estFinDAnnee !== undefined) row.estFinDAnnee = dto.estFinDAnnee;
    if (dto.libelleJour !== undefined) {
      row.libelleJour = dto.libelleJour === '' ? null : dto.libelleJour;
    }

    const saved = await this.repo.save(row);

    await this.auditService.log({
      utilisateur: user.email,
      typeAction: 'MODIFIER_JOUR_CALENDRIER',
      entiteCible: 'dim_temps',
      idCible: saved.id,
      payloadAvant: avant,
      payloadApres: editableSnapshot(saved),
      commentaire: `Edition du jour ${saved.date}`,
      statut: 'success',
    });

    return toResponse(saved);
  }

  /**
   * Lot 8.7.A — extension du calendrier sur une plage d'années (ADMIN).
   *
   * Réutilise la fonction pure `generateTempsRows` du seed, insère en
   * ON CONFLICT DO NOTHING (`.orIgnore()`) → ré-étendre une plage déjà
   * couverte n'ajoute aucun jour. Le nombre réellement inséré est mesuré
   * par différence de COUNT. Audit ETENDRE_CALENDRIER posé en fin.
   */
  async etendreCalendrier(
    dto: ExtendCalendrierDto,
    user: AuthUser,
  ): Promise<{ nbJoursAjoutes: number; message: string }> {
    if (dto.anneeFin < dto.anneeDebut) {
      throw new BadRequestException(
        'anneeFin doit être supérieure ou égale à anneeDebut',
      );
    }

    const debutMs = Date.now();
    const rows = generateTempsRows(dto.anneeDebut, dto.anneeFin).map((r) => ({
      ...r,
      // Override optionnel : forcer un exercice fiscal unique sur la plage.
      exerciceFiscal: dto.exerciceFiscal ?? r.exerciceFiscal,
      libelleJour: null as string | null,
    }));

    const countAvant = await this.repo.count();

    // Insertion par lots pour borner la taille des requêtes (cf. seed).
    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      await this.repo
        .createQueryBuilder()
        .insert()
        .into(DimTemps)
        .values(rows.slice(i, i + BATCH))
        .orIgnore()
        .execute();
    }

    const countApres = await this.repo.count();
    const nbJoursAjoutes = countApres - countAvant;
    const dureeMs = Date.now() - debutMs;

    await this.auditService.log({
      utilisateur: user.email,
      typeAction: 'ETENDRE_CALENDRIER',
      entiteCible: 'dim_temps',
      idCible: null,
      payloadApres: {
        anneeDebut: dto.anneeDebut,
        anneeFin: dto.anneeFin,
        exerciceFiscal: dto.exerciceFiscal ?? null,
        nbJoursAjoutes,
        dureeMs,
      },
      commentaire: `Extension calendrier ${dto.anneeDebut}-${dto.anneeFin}`,
      statut: 'success',
    });

    return {
      nbJoursAjoutes,
      message:
        nbJoursAjoutes > 0
          ? `${nbJoursAjoutes} jours ajoutés au calendrier`
          : 'Aucun jour ajouté (plage déjà couverte)',
    };
  }
}
