/**
 * RealiseService (Lot 5.1) — orchestration CRUD + workflow IMPORTE
 * → VALIDE pour la table fait_realise.
 *
 * Règles métier :
 *  - Unicité par combinaison (CR × compte × ligne_metier × temps ×
 *    devise) — la 1re tentative de duplicata renvoie 409.
 *  - Workflow simple Q4 : IMPORTE (initial) → VALIDE (validateur).
 *    `valide_le` + `fk_valide_par` doivent être renseignés en
 *    statut VALIDE (CHECK SQL doublé applicatif).
 *  - Modification / suppression interdite si statut=VALIDE.
 *  - Filtrage périmètre user_perimetres en ÉCRITURE uniquement (la
 *    consultation est ouverte à tout REALISE.LIRE — cohérent avec
 *    décision Lot Administration ADMIN.D fix réel).
 *  - Pas de filtrage périmètre sur valider() — validateur transverse.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { AuditService } from '../../audit/audit.service';
import { PerimetreService } from '../../budget/services/perimetre.service';
import {
  CreerFaitRealiseDto,
  FaitRealiseResponseDto,
  ListerFaitsRealiseQueryDto,
  ModifierFaitRealiseDto,
} from '../dto/realise.dto';
import { FaitRealise } from '../entities/fait-realise.entity';

interface AuthCaller {
  userId: string;
  email: string;
}

function toResponse(f: FaitRealise): FaitRealiseResponseDto {
  return {
    id: String(f.id),
    fkCentreResponsabilite: String(f.fkCentreResponsabilite),
    fkCompte: String(f.fkCompte),
    fkLigneMetier: String(f.fkLigneMetier),
    fkTemps: String(f.fkTemps),
    fkDevise: String(f.fkDevise),
    montant: Number(f.montant),
    tauxChangeApplique: Number(f.tauxChangeApplique),
    mode: f.mode,
    statut: f.statut,
    source: f.source,
    commentaire: f.commentaire,
    valideLe: f.valideLe ? f.valideLe.toISOString() : null,
    fkValidePar: f.fkValidePar === null ? null : String(f.fkValidePar),
    dateCreation: f.dateCreation.toISOString(),
  };
}

@Injectable()
export class RealiseService {
  constructor(
    @InjectRepository(FaitRealise)
    private readonly repo: Repository<FaitRealise>,
    private readonly perimetreService: PerimetreService,
    private readonly auditService: AuditService,
  ) {}

  // ─── Helpers ───────────────────────────────────────────────────

  /**
   * Vérifie qu'un user a accès en ÉCRITURE au CR cible. Lève
   * ForbiddenException sinon. `null` (admin global) passe toujours.
   */
  async assertCrAccessibleEnEcriture(
    userId: string,
    fkCentreResponsabilite: string,
  ): Promise<void> {
    const crAutorises =
      await this.perimetreService.getCrAutorisesPourUser(userId);
    if (crAutorises === null) return;
    if (!crAutorises.includes(String(fkCentreResponsabilite))) {
      throw new ForbiddenException(
        `Vous n'avez pas accès au centre de responsabilité ${fkCentreResponsabilite} ` +
          `selon vos affectations user_perimetres / rôles actifs.`,
      );
    }
  }

  // ─── Création (saisie manuelle) ────────────────────────────────

  async creer(
    dto: CreerFaitRealiseDto,
    user: AuthCaller,
  ): Promise<FaitRealiseResponseDto> {
    await this.assertCrAccessibleEnEcriture(
      user.userId,
      dto.fkCentreResponsabilite,
    );

    // Unicité dimensions
    const existant = await this.repo.findOne({
      where: {
        fkCentreResponsabilite: dto.fkCentreResponsabilite,
        fkCompte: dto.fkCompte,
        fkLigneMetier: dto.fkLigneMetier,
        fkTemps: dto.fkTemps,
        fkDevise: dto.fkDevise,
      },
    });
    if (existant) {
      throw new ConflictException(
        `Une ligne fait_realise existe déjà pour cette combinaison de dimensions ` +
          `(id=${existant.id}). Utilisez PATCH pour mettre à jour.`,
      );
    }

    return this.repo.manager.transaction(async (tx) => {
      const r = tx.getRepository(FaitRealise);
      const entity = r.create({
        fkCentreResponsabilite: dto.fkCentreResponsabilite,
        fkCompte: dto.fkCompte,
        fkLigneMetier: dto.fkLigneMetier,
        fkTemps: dto.fkTemps,
        fkDevise: dto.fkDevise,
        montant: dto.montant,
        mode: dto.mode ?? 'MNT',
        tauxChangeApplique: dto.tauxChangeApplique ?? 1,
        statut: 'IMPORTE',
        source: 'SAISIE',
        commentaire: dto.commentaire ?? null,
        utilisateurCreation: user.email,
      });
      const saved = await r.save(entity);

      await this.auditService.log(
        {
          utilisateur: user.email,
          typeAction: 'SAISIR_REALISE',
          entiteCible: 'fait_realise',
          idCible: String(saved.id),
          statut: 'success',
          payloadApres: {
            fkCentreResponsabilite: saved.fkCentreResponsabilite,
            fkCompte: saved.fkCompte,
            fkLigneMetier: saved.fkLigneMetier,
            fkTemps: saved.fkTemps,
            fkDevise: saved.fkDevise,
            montant: Number(saved.montant),
            mode: saved.mode,
            source: 'SAISIE',
          },
          commentaire: `Saisie réalisé #${saved.id}.`,
        },
        tx,
      );
      return toResponse(saved);
    });
  }

  // ─── Modification ──────────────────────────────────────────────

  async modifier(
    id: string,
    dto: ModifierFaitRealiseDto,
    user: AuthCaller,
  ): Promise<FaitRealiseResponseDto> {
    const f = await this.repo.findOne({ where: { id } });
    if (!f) throw new NotFoundException(`fait_realise ${id} introuvable.`);
    if (f.statut === 'VALIDE') {
      throw new BadRequestException(
        `La ligne ${id} est validée — modification interdite. ` +
          `Demandez à un valideur de la dévalider d'abord.`,
      );
    }
    await this.assertCrAccessibleEnEcriture(
      user.userId,
      String(f.fkCentreResponsabilite),
    );

    const avant = {
      montant: Number(f.montant),
      mode: f.mode,
      tauxChangeApplique: Number(f.tauxChangeApplique),
      commentaire: f.commentaire,
    };

    if (dto.montant !== undefined) f.montant = dto.montant;
    if (dto.mode !== undefined) f.mode = dto.mode;
    if (dto.tauxChangeApplique !== undefined)
      f.tauxChangeApplique = dto.tauxChangeApplique;
    if (dto.commentaire !== undefined) f.commentaire = dto.commentaire ?? null;
    f.dateModification = new Date();
    f.utilisateurModification = user.email;

    return this.repo.manager.transaction(async (tx) => {
      const saved = await tx.getRepository(FaitRealise).save(f);

      await this.auditService.log(
        {
          utilisateur: user.email,
          typeAction: 'SAISIR_REALISE',
          entiteCible: 'fait_realise',
          idCible: String(saved.id),
          statut: 'success',
          payloadAvant: avant,
          payloadApres: {
            montant: Number(saved.montant),
            mode: saved.mode,
            tauxChangeApplique: Number(saved.tauxChangeApplique),
            commentaire: saved.commentaire,
          },
          commentaire: `Modification réalisé #${saved.id}.`,
        },
        tx,
      );
      return toResponse(saved);
    });
  }

  // ─── Suppression ───────────────────────────────────────────────

  async supprimer(id: string, user: AuthCaller): Promise<void> {
    const f = await this.repo.findOne({ where: { id } });
    if (!f) throw new NotFoundException(`fait_realise ${id} introuvable.`);
    if (f.statut === 'VALIDE') {
      throw new BadRequestException(
        `La ligne ${id} est validée — suppression interdite.`,
      );
    }
    await this.assertCrAccessibleEnEcriture(
      user.userId,
      String(f.fkCentreResponsabilite),
    );

    await this.repo.manager.transaction(async (tx) => {
      await tx.getRepository(FaitRealise).delete({ id });
      await this.auditService.log(
        {
          utilisateur: user.email,
          typeAction: 'SUPPRIMER_REALISE',
          entiteCible: 'fait_realise',
          idCible: String(id),
          statut: 'success',
          payloadAvant: {
            fkCentreResponsabilite: f.fkCentreResponsabilite,
            fkCompte: f.fkCompte,
            fkTemps: f.fkTemps,
            montant: Number(f.montant),
            statut: f.statut,
          },
          commentaire: `Suppression réalisé #${id}.`,
        },
        tx,
      );
    });
  }

  // ─── Validation en lot ─────────────────────────────────────────

  async valider(
    ids: string[],
    user: AuthCaller,
  ): Promise<{ nbValidees: number }> {
    const lignes = await this.repo.find({ where: { id: In(ids) } });
    if (lignes.length !== ids.length) {
      const trouves = new Set(lignes.map((l) => String(l.id)));
      const manquants = ids.filter((i) => !trouves.has(i));
      throw new NotFoundException(
        `Lignes introuvables : ${manquants.join(', ')}.`,
      );
    }
    const dejaValide = lignes.find((l) => l.statut === 'VALIDE');
    if (dejaValide) {
      throw new BadRequestException(
        `La ligne ${dejaValide.id} est déjà validée. ` +
          `Aucune ligne n'a été validée (transaction annulée).`,
      );
    }

    const maintenant = new Date();
    return this.repo.manager.transaction(async (tx) => {
      const r = tx.getRepository(FaitRealise);
      let nb = 0;
      for (const l of lignes) {
        l.statut = 'VALIDE';
        l.valideLe = maintenant;
        l.fkValidePar = user.userId;
        l.dateModification = maintenant;
        l.utilisateurModification = user.email;
        const saved = await r.save(l);
        await this.auditService.log(
          {
            utilisateur: user.email,
            typeAction: 'VALIDER_REALISE',
            entiteCible: 'fait_realise',
            idCible: String(saved.id),
            statut: 'success',
            payloadApres: {
              fkCentreResponsabilite: saved.fkCentreResponsabilite,
              fkCompte: saved.fkCompte,
              fkTemps: saved.fkTemps,
              montant: Number(saved.montant),
              statut: 'VALIDE',
            },
            commentaire: `Validation réalisé #${saved.id}.`,
          },
          tx,
        );
        nb++;
      }
      return { nbValidees: nb };
    });
  }

  // ─── Lecture ───────────────────────────────────────────────────

  async findOne(id: string): Promise<FaitRealiseResponseDto> {
    const f = await this.repo.findOne({ where: { id } });
    if (!f) throw new NotFoundException(`fait_realise ${id} introuvable.`);
    return toResponse(f);
  }

  /**
   * Listing avec filtres + pagination. Pas de filtrage périmètre
   * (lecture transverse pour tout REALISE.LIRE).
   */
  async lister(
    query: ListerFaitsRealiseQueryDto,
  ): Promise<{ items: FaitRealiseResponseDto[]; total: number }> {
    const qb = this.repo.createQueryBuilder('f');
    if (query.fkCentreResponsabilite) {
      qb.andWhere('f.fkCentreResponsabilite = :cr', {
        cr: query.fkCentreResponsabilite,
      });
    }
    if (query.fkCompte) {
      qb.andWhere('f.fkCompte = :compte', { compte: query.fkCompte });
    }
    if (query.statut) {
      qb.andWhere('f.statut = :statut', { statut: query.statut });
    }
    if (query.source) {
      qb.andWhere('f.source = :source', { source: query.source });
    }
    if (query.moisDebut) {
      qb.andWhere(
        `f.fkTemps IN (SELECT id FROM dim_temps WHERE date >= :debut::date AND jour = 1)`,
        { debut: `${query.moisDebut}-01` },
      );
    }
    if (query.moisFin) {
      qb.andWhere(
        `f.fkTemps IN (SELECT id FROM dim_temps WHERE date <= :fin::date AND jour = 1)`,
        { fin: `${query.moisFin}-01` },
      );
    }
    qb.orderBy('f.fkTemps', 'DESC').addOrderBy('f.id', 'DESC');
    qb.skip(((query.page ?? 1) - 1) * (query.limit ?? 50));
    qb.take(query.limit ?? 50);
    const [items, total] = await qb.getManyAndCount();
    return { items: items.map(toResponse), total };
  }

  /**
   * Grille de consultation par CR + plage de mois. Retourne les
   * lignes ordonnées (compte × mois). Pas de filtrage périmètre.
   */
  async getGrille(query: {
    crId: string;
    moisDebut: string;
    moisFin: string;
  }): Promise<FaitRealiseResponseDto[]> {
    const items = await this.repo
      .createQueryBuilder('f')
      .where('f.fkCentreResponsabilite = :cr', { cr: query.crId })
      .andWhere(
        `f.fkTemps IN (
          SELECT id FROM dim_temps
          WHERE date >= :debut::date
            AND date <= :fin::date
            AND jour = 1
        )`,
        {
          debut: `${query.moisDebut}-01`,
          fin: `${query.moisFin}-01`,
        },
      )
      .orderBy('f.fkCompte', 'ASC')
      .addOrderBy('f.fkTemps', 'ASC')
      .getMany();
    return items.map(toResponse);
  }
}
