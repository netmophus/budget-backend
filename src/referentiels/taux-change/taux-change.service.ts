/**
 * TauxChangeService — gestion des taux de change BCEAO et résolution
 * du taux applicable à une date donnée.
 *
 * **Note de design** : `ref_taux_change` n'est PAS référencé par les
 * faits via FK ; le taux applicable est COPIÉ dans
 * `fait_budget.taux_change_applique` au moment de la saisie. Cela
 * permet de modifier ou supprimer un taux historique sans casser les
 * faits déjà écrits (cf. `docs/modele-donnees.md` §4.1).
 *
 * `findTauxApplicable` est CRITIQUE pour le Lot 3.2 : c'est elle qui
 * résoudra le taux à appliquer lors du calcul automatique de
 * `montant_fcfa = montant_devise × taux_vers_pivot`.
 */
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { DimDevise } from '../devise/entities/dim-devise.entity';
import { DimTemps } from '../temps/entities/dim-temps.entity';
import { CreateTauxChangeDto } from './dto/create-taux-change.dto';
import { ListTauxChangeQueryDto } from './dto/list-taux-change-query.dto';
import { PaginatedTauxChangeDto } from './dto/paginated-taux-change.dto';
import {
  TauxApplicableDto,
  TauxChangeResponseDto,
} from './dto/taux-change-response.dto';
import { UpdateTauxChangeDto } from './dto/update-taux-change.dto';
import { RefTauxChange, TypeTaux } from './entities/ref-taux-change.entity';

function trimCodeIso(value: string): string {
  return value.trim().toUpperCase();
}

function toResponse(t: RefTauxChange): TauxChangeResponseDto {
  return {
    id: t.id,
    fkDevise: String(t.fkDevise),
    fkTemps: String(t.fkTemps),
    tauxVersPivot: String(t.tauxVersPivot),
    source: t.source,
    typeTaux: t.typeTaux,
    devise: t.devise
      ? {
          id: t.devise.id,
          codeIso: t.devise.codeIso,
          libelle: t.devise.libelle,
        }
      : undefined,
    temps: t.temps
      ? {
          id: t.temps.id,
          date: t.temps.date,
        }
      : undefined,
    dateCreation: t.dateCreation,
    utilisateurCreation: t.utilisateurCreation,
  };
}

@Injectable()
export class TauxChangeService {
  constructor(
    @InjectRepository(RefTauxChange)
    private readonly repo: Repository<RefTauxChange>,
    @InjectRepository(DimDevise)
    private readonly deviseRepo: Repository<DimDevise>,
    @InjectRepository(DimTemps)
    private readonly tempsRepo: Repository<DimTemps>,
  ) {}

  async findAll(
    query: ListTauxChangeQueryDto,
  ): Promise<PaginatedTauxChangeDto> {
    const qb = this.repo
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.devise', 'd')
      .leftJoinAndSelect('t.temps', 'tps');

    if (query.codeDevise) {
      qb.andWhere('d.codeIso = :code', {
        code: trimCodeIso(query.codeDevise),
      });
    }
    if (query.dateDebut) {
      qb.andWhere('tps.date >= :debut', { debut: query.dateDebut });
    }
    if (query.dateFin) {
      qb.andWhere('tps.date <= :fin', { fin: query.dateFin });
    }
    if (query.typeTaux) {
      qb.andWhere('t.typeTaux = :tt', { tt: query.typeTaux });
    }

    qb.orderBy('tps.date', 'DESC')
      .addOrderBy('d.codeIso', 'ASC')
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

  async findOne(id: string): Promise<TauxChangeResponseDto> {
    const row = await this.repo.findOne({
      where: { id },
      relations: { devise: true, temps: true },
    });
    if (!row) throw new NotFoundException('Taux de change introuvable');
    return toResponse(row);
  }

  /**
   * Résout le taux applicable à une date donnée pour un (codeDevise,
   * typeTaux) :
   *   1. Cherche un taux exact (`fk_temps` correspondant à la date).
   *   2. Si absent, prend le DERNIER taux disponible AVANT la date
   *      (le plus récent antérieur ou égal).
   *   3. Retourne `null` si aucun taux trouvé pour ce (devise, type).
   *
   * Le caller (typiquement le Lot 3.2 lors de la saisie budget) doit
   * gérer le `null` — typiquement : montant_fcfa = montant_devise pour
   * la devise pivot, ou erreur de validation pour les autres.
   */
  async findTauxApplicable(
    codeDevise: string,
    date: string,
    typeTaux: TypeTaux,
  ): Promise<TauxApplicableDto | null> {
    const code = trimCodeIso(codeDevise);
    const devise = await this.deviseRepo.findOne({
      where: { codeIso: code },
    });
    if (!devise) return null;

    const row = await this.repo
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.temps', 'tps')
      .where('t.fkDevise = :fkDevise', { fkDevise: devise.id })
      .andWhere('t.typeTaux = :typeTaux', { typeTaux })
      .andWhere('tps.date <= :date', { date })
      .orderBy('tps.date', 'DESC')
      .getOne();

    if (!row || !row.temps) return null;

    return {
      fkDevise: String(row.fkDevise),
      fkTemps: String(row.fkTemps),
      tauxVersPivot: String(row.tauxVersPivot),
      source: row.source,
      typeTaux: row.typeTaux,
      dateApplicable: row.temps.date,
    };
  }

  async create(
    dto: CreateTauxChangeDto,
    utilisateur: string,
  ): Promise<TauxChangeResponseDto> {
    const code = trimCodeIso(dto.codeDevise);
    const devise = await this.deviseRepo.findOne({
      where: { codeIso: code },
    });
    if (!devise) {
      throw new UnprocessableEntityException(
        `Devise ${code} introuvable. Créez-la d'abord ou vérifiez le code ISO.`,
      );
    }
    if (devise.estDevisePivot) {
      throw new UnprocessableEntityException(
        `La devise pivot (${code}) ne doit pas avoir de taux de change vers elle-même.`,
      );
    }
    const temps = await this.tempsRepo.findOne({
      where: { date: dto.date },
    });
    if (!temps) {
      throw new UnprocessableEntityException(
        `Date ${dto.date} introuvable dans dim_temps. Vérifiez le seed temps ou utilisez une date dans le calendrier.`,
      );
    }

    // Vérification d'unicité (devise, temps, type_taux) côté service —
    // double défense avec l'index partiel pour message clair.
    const existing = await this.repo.findOne({
      where: {
        fkDevise: String(devise.id),
        fkTemps: String(temps.id),
        typeTaux: dto.typeTaux,
      },
    });
    if (existing) {
      throw new ConflictException(
        `Un taux ${dto.typeTaux} existe déjà pour ${code} au ${dto.date}.`,
      );
    }

    const created = await this.repo.save(
      this.repo.create({
        fkDevise: String(devise.id),
        fkTemps: String(temps.id),
        tauxVersPivot: String(dto.tauxVersPivot),
        source: dto.source ?? 'BCEAO',
        typeTaux: dto.typeTaux,
        utilisateurCreation: utilisateur,
      }),
    );
    return this.findOne(created.id);
  }

  async update(
    id: string,
    dto: UpdateTauxChangeDto,
  ): Promise<TauxChangeResponseDto> {
    const current = await this.repo.findOne({ where: { id } });
    if (!current) throw new NotFoundException('Taux introuvable');

    if (dto.tauxVersPivot !== undefined) {
      current.tauxVersPivot = String(dto.tauxVersPivot);
    }
    if (dto.source !== undefined) current.source = dto.source;
    await this.repo.save(current);
    return this.findOne(id);
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.repo.delete({ id });
    return (result.affected ?? 0) > 0;
  }
}
