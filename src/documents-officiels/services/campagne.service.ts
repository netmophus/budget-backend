/**
 * CampagneService (Lot 8.1.B) — gestion des campagnes budgétaires et
 * du Comité visa associé.
 *
 * Méthodes (1-3) :
 *   - creerCampagne          : INSERT en statut PARAMETRAGE
 *   - ajouterMembreComite    : INSERT ordre auto-incrémenté
 *   - lancerCampagne         : transition PARAMETRAGE -> EN_COURS
 *
 * Note RBAC : les `@RequirePermissions('CAMPAGNE.GERER')` seront posées
 * sur le controller Lot 8.1.C. Le service implémente UNIQUEMENT les
 * contrôles métier (statut, existence, contraintes). Pattern projet
 * cohérent (cf. reporting.controller.ts au Lot 7.6).
 *
 * Pas de QueryRunner ici — opérations mono-table simples. Audit en
 * autocommit (cohérent avec décision Lot 7.6 sur exports R04).
 */
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AuditService } from '../../audit/audit.service';
import { User } from '../../users/entities/user.entity';
import { AjouterComiteMembreDto } from '../dto/ajouter-comite-membre.dto';
import { CreerCampagneDto } from '../dto/creer-campagne.dto';
import { CampagneBudgetaire } from '../entities/campagne-budgetaire.entity';
import { CampagneComiteMembre } from '../entities/campagne-comite-membre.entity';

/**
 * Vue allégée d'un User sans champs sensibles (motDePasseHash,
 * dateExpirationMdp, doitChangerMdp, ...). Le projet n'utilise PAS
 * `ClassSerializerInterceptor` ni `@Exclude` — la sérialisation des
 * réponses API est explicite côté service (cf. users.service.spec.ts
 * "Critical: hash must not appear anywhere in the response").
 *
 * Hotfix Lot 8.2.A : avant ce fix, listerCampagnes/detailCampagne ne
 * chargeaient pas la relation User → pas de risque. Le fix l'introduit
 * via `relations: ['signataireDefaut']`, donc le mapping vers cette
 * vue allégée est obligatoire pour ne pas leaker motDePasseHash dans
 * la réponse JSON.
 */
export interface UserResume {
  id: string;
  email: string;
  nom: string;
  prenom: string;
}

function toUserResume(u: User | null | undefined): UserResume | undefined {
  if (!u) return undefined;
  return { id: u.id, email: u.email, nom: u.nom, prenom: u.prenom };
}

/**
 * Item retourné par GET /campagnes (liste enrichie). Les relations
 * inverses `comiteMembres` et `documents` sont retirées (jamais
 * chargées dans cette query — la liste ne les inclut pas).
 */
export type CampagneListItem = Omit<
  CampagneBudgetaire,
  'signataireDefaut' | 'comiteMembres' | 'documents'
> & {
  signataireDefaut?: UserResume;
  nombreMembres: number;
};

/**
 * Item retourné par GET /campagnes/:id (détail enrichi). `comiteMembres`
 * remplacée par la version mappée vers UserResume ; `documents` retirée
 * (livré en Lot 8.2.B).
 */
export type CampagneDetailView = Omit<
  CampagneBudgetaire,
  'signataireDefaut' | 'comiteMembres' | 'documents'
> & {
  signataireDefaut?: UserResume;
  comiteMembres: Array<
    Omit<CampagneComiteMembre, 'user'> & { user?: UserResume }
  >;
};

@Injectable()
export class CampagneService {
  constructor(
    @InjectRepository(CampagneBudgetaire)
    private readonly campagneRepo: Repository<CampagneBudgetaire>,
    @InjectRepository(CampagneComiteMembre)
    private readonly comiteRepo: Repository<CampagneComiteMembre>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Crée une campagne en statut PARAMETRAGE.
   *
   * @throws ConflictException si `exerciceFiscal` est déjà pris
   *         (contrainte UNIQUE `campagne_budgetaire.exercice_fiscal`).
   * @throws NotFoundException si `fkUserSignataireDefaut` n'existe pas.
   */
  async creerCampagne(
    dto: CreerCampagneDto,
    userEmail: string,
  ): Promise<CampagneBudgetaire> {
    // Validation existence signataire (404 explicite plutôt que crash FK).
    const signataire = await this.userRepo.findOne({
      where: { id: dto.fkUserSignataireDefaut },
    });
    if (!signataire) {
      throw new NotFoundException(
        `Signataire (user.id=${dto.fkUserSignataireDefaut}) introuvable.`,
      );
    }

    // Validation unicité exercice (409 explicite plutôt que crash UNIQUE).
    const existante = await this.campagneRepo.findOne({
      where: { exerciceFiscal: dto.exerciceFiscal },
    });
    if (existante) {
      throw new ConflictException(
        `Une campagne existe déjà pour l'exercice ${dto.exerciceFiscal} (code=${existante.code}).`,
      );
    }

    const campagne = this.campagneRepo.create({
      code: dto.code,
      exerciceFiscal: dto.exerciceFiscal,
      libelle: dto.libelle,
      statut: 'PARAMETRAGE',
      modeVisaDefaut: dto.modeVisaDefaut ?? 'PARALLELE',
      fkUserSignataireDefaut: dto.fkUserSignataireDefaut,
      utilisateurCreation: userEmail,
    });
    const saved = await this.campagneRepo.save(campagne);

    // Audit log autonome (autocommit).
    await this.auditService.log({
      utilisateur: userEmail,
      typeAction: 'CREER_DOCUMENT',
      entiteCible: 'campagne_budgetaire',
      idCible: saved.id,
      payloadApres: {
        code: saved.code,
        exerciceFiscal: saved.exerciceFiscal,
        modeVisaDefaut: saved.modeVisaDefaut,
        fkUserSignataireDefaut: saved.fkUserSignataireDefaut,
      },
      commentaire: `Création campagne ${saved.code} (exercice ${saved.exerciceFiscal}).`,
      statut: 'success',
    });

    return saved;
  }

  /**
   * Ajoute un membre au Comité d'une campagne. Ordre auto-incrémenté
   * à MAX(ordre) + 1 (1 si aucun membre).
   *
   * @throws NotFoundException si campagne introuvable.
   * @throws ConflictException si statut != PARAMETRAGE (Comité figé
   *         après lancement — un remplacement nécessitera une méthode
   *         dédiée `remplacerMembre` qui préservera les snapshots
   *         document_visa des documents déjà émis. Hors Lot 8.1.B).
   * @throws ConflictException si membre déjà présent (UNIQUE
   *         `uq_camp_user`).
   */
  async ajouterMembreComite(
    campagneId: string,
    dto: AjouterComiteMembreDto,
    userEmail: string,
  ): Promise<CampagneComiteMembre> {
    const campagne = await this.campagneRepo.findOne({
      where: { id: campagneId },
    });
    if (!campagne) {
      throw new NotFoundException(`Campagne ${campagneId} introuvable.`);
    }
    if (campagne.statut !== 'PARAMETRAGE') {
      throw new ConflictException(
        `Impossible d'ajouter un membre : campagne ${campagne.code} en statut '${campagne.statut}' (PARAMETRAGE requis).`,
      );
    }

    const dejaMembre = await this.comiteRepo.findOne({
      where: { fkCampagne: campagneId, fkUser: dto.fkUser },
    });
    if (dejaMembre) {
      throw new ConflictException(
        `User ${dto.fkUser} est déjà membre du Comité de la campagne ${campagne.code}.`,
      );
    }

    // Ordre auto = MAX + 1 (ou 1 si aucun membre).
    const maxRow = await this.comiteRepo
      .createQueryBuilder('m')
      .select('MAX(m.ordre)', 'maxOrdre')
      .where('m.fkCampagne = :campagneId', { campagneId })
      .getRawOne<{ maxOrdre: string | number | null }>();
    const ordre = maxRow?.maxOrdre ? Number(maxRow.maxOrdre) + 1 : 1;

    const membre = this.comiteRepo.create({
      fkCampagne: campagneId,
      fkUser: dto.fkUser,
      ordre,
      estObligatoire: dto.estObligatoire ?? true,
      libelleFonction: dto.libelleFonction ?? null,
      utilisateurCreation: userEmail,
    });
    return this.comiteRepo.save(membre);
  }

  /**
   * Transition PARAMETRAGE -> EN_COURS.
   *
   * @throws NotFoundException si campagne introuvable.
   * @throws ConflictException si statut != PARAMETRAGE.
   * @throws ConflictException si Comité sans membre OBLIGATOIRE
   *         (`est_obligatoire = true`). Les membres facultatifs seuls
   *         ne suffisent pas : il faut au moins 1 visa obligatoire
   *         pour que la transition VISE soit calculable cote Lot 8.1.B
   *         méthode `apporterVisa`.
   */
  async lancerCampagne(
    campagneId: string,
    userEmail: string,
  ): Promise<CampagneBudgetaire> {
    const campagne = await this.campagneRepo.findOne({
      where: { id: campagneId },
    });
    if (!campagne) {
      throw new NotFoundException(`Campagne ${campagneId} introuvable.`);
    }
    if (campagne.statut !== 'PARAMETRAGE') {
      throw new ConflictException(
        `Impossible de lancer : campagne ${campagne.code} en statut '${campagne.statut}' (PARAMETRAGE requis).`,
      );
    }

    const nbObligatoires = await this.comiteRepo.count({
      where: { fkCampagne: campagneId, estObligatoire: true },
    });
    if (nbObligatoires === 0) {
      throw new ConflictException(
        `Impossible de lancer : campagne ${campagne.code} n'a aucun membre Comité obligatoire (est_obligatoire=true).`,
      );
    }

    campagne.statut = 'EN_COURS';
    campagne.dateLancement = new Date();
    campagne.utilisateurModification = userEmail;
    return this.campagneRepo.save(campagne);
  }

  // ─── Lot 8.1.C : lectures pour les controllers ───────────────────

  /**
   * Liste les campagnes triées par exercice fiscal DESC.
   *
   * Hotfix Lot 8.2.A — chaque ligne est enrichie de :
   *  - `signataireDefaut` : vue allégée (sans motDePasseHash)
   *  - `nombreMembres`    : COUNT(comiteMembre) calculé en 1 requête
   *                         groupée (anti N+1).
   * Le frontend en a besoin pour les colonnes "Signataire" et "Membres"
   * du tableau ; avant ce fix, ces colonnes affichaient `—` et `0`
   * pour toutes les lignes.
   */
  async listerCampagnes(): Promise<CampagneListItem[]> {
    const campagnes = await this.campagneRepo.find({
      relations: ['signataireDefaut'],
      order: { exerciceFiscal: 'DESC' },
    });
    if (campagnes.length === 0) return [];

    // Compte des membres par campagne en 1 requête groupée (anti N+1).
    const ids = campagnes.map((c) => c.id);
    const counts = await this.comiteRepo
      .createQueryBuilder('m')
      .select('m.fkCampagne', 'fkCampagne')
      .addSelect('COUNT(m.id)', 'count')
      .where('m.fkCampagne IN (:...ids)', { ids })
      .groupBy('m.fkCampagne')
      .getRawMany<{ fkCampagne: string; count: string }>();
    const countMap = new Map(
      counts.map((c) => [c.fkCampagne, Number(c.count)]),
    );

    return campagnes.map((c) => {
      const { signataireDefaut, ...rest } = c;
      return {
        ...rest,
        signataireDefaut: toUserResume(signataireDefaut),
        nombreMembres: countMap.get(c.id) ?? 0,
      };
    });
  }

  /**
   * Détail d'une campagne avec ses membres comité ordonnés.
   *
   * Hotfix Lot 8.2.A — retour APLATI (et plus `{ campagne, membres }`)
   * pour matcher le contrat `CampagneDetail` attendu par le frontend.
   * Relations `signataireDefaut` et `comiteMembres.user` chargées et
   * mappées vers `UserResume` (sécurité : pas de motDePasseHash dans
   * la réponse JSON).
   *
   * @throws NotFoundException si campagne introuvable.
   */
  async detailCampagne(campagneId: string): Promise<CampagneDetailView> {
    const campagne = await this.campagneRepo.findOne({
      where: { id: campagneId },
      relations: ['signataireDefaut'],
    });
    if (!campagne) {
      throw new NotFoundException(`Campagne ${campagneId} introuvable.`);
    }
    const membres = await this.comiteRepo.find({
      where: { fkCampagne: campagneId },
      relations: ['user'],
      order: { ordre: 'ASC' },
    });

    const { signataireDefaut, ...rest } = campagne;
    return {
      ...rest,
      signataireDefaut: toUserResume(signataireDefaut),
      comiteMembres: membres.map((m) => {
        const { user, ...mRest } = m;
        return { ...mRest, user: toUserResume(user) };
      }),
    };
  }
}
