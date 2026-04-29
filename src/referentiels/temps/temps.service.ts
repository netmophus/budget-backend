import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';

import { ListTempsQueryDto } from './dto/list-temps-query.dto';
import { PaginatedTempsDto } from './dto/paginated-temps.dto';
import { TempsResponseDto } from './dto/temps-response.dto';
import { DimTemps } from './entities/dim-temps.entity';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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
  };
}

@Injectable()
export class TempsService {
  constructor(
    @InjectRepository(DimTemps)
    private readonly repo: Repository<DimTemps>,
  ) {}

  async findAll(query: ListTempsQueryDto): Promise<PaginatedTempsDto> {
    const where: Record<string, unknown> = {};
    if (query.annee !== undefined) where.annee = query.annee;
    if (query.mois !== undefined) where.mois = query.mois;
    if (query.exerciceFiscal !== undefined) {
      where.exerciceFiscal = query.exerciceFiscal;
    }
    if (query.dateDebut && query.dateFin) {
      where.date = Between(query.dateDebut, query.dateFin);
    } else if (query.dateDebut) {
      where.date = Between(query.dateDebut, '9999-12-31');
    } else if (query.dateFin) {
      where.date = Between('0001-01-01', query.dateFin);
    }

    const [items, total] = await this.repo.findAndCount({
      where,
      order: { date: 'ASC' },
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
      throw new NotFoundException(
        `Aucun jour calendaire pour la date ${date}`,
      );
    }
    return toResponse(row);
  }

  async findRange(
    dateDebut: string,
    dateFin: string,
  ): Promise<TempsResponseDto[]> {
    const items = await this.repo.find({
      where: { date: Between(dateDebut, dateFin) },
      order: { date: 'ASC' },
    });
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
}
