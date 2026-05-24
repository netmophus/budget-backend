/**
 * DocumentWorkflowService (Lot 8.1.B Palier 3) — orchestration des
 * transitions du workflow signature.
 *
 *   BROUILLON ─creer/editer→ BROUILLON
 *   BROUILLON ─soumettre→ SOUMIS_VISA (snapshot Comité)
 *   SOUMIS_VISA ─viser+all_obligatoires_OK→ VISE
 *   SOUMIS_VISA ─rejeter→ BROUILLON (reset visas)
 *   VISE ─signer→ SIGNE (hash crypto + audit irreversible)
 *
 * **Transactions** : 3 méthodes utilisent `dataSource.transaction()`
 * pour atomicité multi-tables :
 *   - soumettreVisa : UPDATE doc + INSERT N visas + audit
 *   - apporterVisa REJETER : UPDATE visa + UPDATE doc + DELETE autres
 *     visas + audit
 *   - signerDocument : INSERT audit (RETURNING id) + INSERT signature
 *     avec fk_audit_log + UPDATE doc. Ordre crucial : audit AVANT
 *     signature pour que fk_audit_log ne soit jamais NULL.
 *
 * **RBAC** : les `@RequirePermissions` sont sur le controller Lot 8.1.C.
 * Le service implémente uniquement les checks MÉTIER (user est emetteur,
 * dans comité, signataire, ordre séquentiel, mot de passe).
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { DataSource, type EntityManager } from 'typeorm';

import { AuditLog } from '../../audit/entities/audit-log.entity';
import { User } from '../../users/entities/user.entity';
import { type UserResume, toUserResume } from '../../users/utils/user-resume';
import { ApporterVisaDto } from '../dto/apporter-visa.dto';
import { CreerDocumentDto } from '../dto/creer-document.dto';
import { EditerDocumentDto } from '../dto/editer-document.dto';
import { ListerDocumentsQueryDto } from '../dto/lister-documents-query.dto';
import { SignerDocumentDto } from '../dto/signer-document.dto';
import { SoumettreVisaDto } from '../dto/soumettre-visa.dto';
import { VerifierIntegriteDto } from '../dto/verifier-integrite.dto';
import { CampagneBudgetaire } from '../entities/campagne-budgetaire.entity';
import { CampagneComiteMembre } from '../entities/campagne-comite-membre.entity';
import { DocumentOfficiel } from '../entities/document-officiel.entity';
import { DocumentSignature } from '../entities/document-signature.entity';
import { DocumentVisa } from '../entities/document-visa.entity';
import { LettreCadrageDetail } from '../entities/lettre-cadrage-detail.entity';
import { LettreMobilisationDetail } from '../entities/lettre-mobilisation-detail.entity';
import { NoteOrientationDetail } from '../entities/note-orientation-detail.entity';
import { DocumentHashService } from './document-hash.service';

/**
 * Lot 8.1.E Palier 2 — types de vue API pour `listerDocuments` et
 * `detailDocument`. Les relations TypeORM (`emetteur`, `signataire`,
 * `visas`, `campagne`, `versionBudget`) sont retirées de l'entité
 * via `Omit` puis remplacées par des shapes adaptés au frontend :
 *  - `emetteur`/`signataire` mappés en `UserResume` (4 champs)
 *  - `visas[].user` mappé en `UserResume` (clé renommée depuis
 *    l'entité `visa.viseur` pour matcher le contrat frontend
 *    `DocumentVisaResume.user`)
 *  - `signature` conservée telle quelle (entité avec snapshot
 *    `emailSignataire`/`nomSignataire`, pas de relation supplémentaire)
 *
 * Symétrie avec `CampagneListItem`/`CampagneDetailView` introduits
 * en hotfix Lot 8.2.A.
 */
export type DocumentOfficielListItem = Omit<
  DocumentOfficiel,
  | 'emetteur'
  | 'signataire'
  | 'visas'
  | 'campagne'
  | 'versionBudget'
  | 'signature'
> & {
  emetteur?: UserResume;
  signataire?: UserResume;
};

export type DocumentVisaWithUser = Omit<DocumentVisa, 'viseur' | 'document'> & {
  user?: UserResume;
};

export type DocumentOfficielDetailView = Omit<
  DocumentOfficiel,
  | 'emetteur'
  | 'signataire'
  | 'visas'
  | 'campagne'
  | 'versionBudget'
  | 'signature'
> & {
  emetteur?: UserResume;
  signataire?: UserResume;
  visas: DocumentVisaWithUser[];
  signature: DocumentSignature | null;
  /**
   * Lot 8.2.C — détail métier structuré, présent UNIQUEMENT pour les
   * documents de type `D2_LETTRE_CADRAGE`. `null` si type ≠ D2 ou si
   * le DG n'a pas encore renseigné le détail (BROUILLON fraîchement
   * créé).
   */
  lettreCadrageDetail: LettreCadrageDetail | null;
  /**
   * Lot 8.3.A — détail métier structuré, présent UNIQUEMENT pour les
   * documents de type `D3_NOTE_ORIENTATION` (Note interne avec analyse
   * macro + axes stratégiques). `null` si type ≠ D3 ou si le DG n'a
   * pas encore renseigné le détail.
   */
  noteOrientationDetail: NoteOrientationDetail | null;
  /**
   * Lot 8.3.B — détail métier structuré, présent UNIQUEMENT pour les
   * documents de type `D5_LETTRE_MOBILISATION` (Lettre motivationnelle
   * DG → Directeurs après cadrage + orientation). `null` si type ≠ D5
   * ou si le DG n'a pas encore renseigné le détail.
   *
   * **Exclusion mutuelle** : au plus UN des 3 détails métier
   * (lettreCadrageDetail / noteOrientationDetail /
   * lettreMobilisationDetail) est non-null pour un document donné,
   * car déterminé par `typeDocument`.
   */
  lettreMobilisationDetail: LettreMobilisationDetail | null;
};

/**
 * Contexte utilisateur passé par le controller Lot 8.1.C. Évite N
 * lookups user par email côté service.
 */
export interface ActorContext {
  userId: string;
  userEmail: string;
  isAdmin?: boolean;
  ipAddress?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class DocumentWorkflowService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly hashService: DocumentHashService,
  ) {}

  // ─── 4. creerDocument ────────────────────────────────────────────

  async creerDocument(
    dto: CreerDocumentDto,
    actor: ActorContext,
  ): Promise<DocumentOfficiel> {
    const campagneRepo = this.dataSource.getRepository(CampagneBudgetaire);
    const docRepo = this.dataSource.getRepository(DocumentOfficiel);
    const userRepo = this.dataSource.getRepository(User);

    const campagne = await campagneRepo.findOne({
      where: { id: dto.fkCampagne },
    });
    if (!campagne) {
      throw new NotFoundException(`Campagne ${dto.fkCampagne} introuvable.`);
    }
    if (campagne.statut !== 'EN_COURS') {
      throw new ConflictException(
        `Impossible de créer un document : campagne ${campagne.code} en statut '${campagne.statut}' (EN_COURS requis).`,
      );
    }

    const dejaCode = await docRepo.findOne({
      where: { codeDocument: dto.codeDocument },
    });
    if (dejaCode) {
      throw new ConflictException(
        `Document avec code_document='${dto.codeDocument}' existe déjà.`,
      );
    }

    const signataire = await userRepo.findOne({
      where: { id: dto.fkUserSignataire },
    });
    if (!signataire) {
      throw new NotFoundException(
        `Signataire (user.id=${dto.fkUserSignataire}) introuvable.`,
      );
    }

    const doc = docRepo.create({
      codeDocument: dto.codeDocument,
      typeDocument: dto.typeDocument,
      fkCampagne: dto.fkCampagne,
      titre: dto.titre,
      contenuHtml: dto.contenuHtml,
      referenceExterne: dto.referenceExterne ?? null,
      statut: 'BROUILLON',
      fkUserEmetteur: actor.userId,
      fkUserSignataire: dto.fkUserSignataire,
      fkVersionBudget: dto.fkVersionBudget ?? null,
      utilisateurCreation: actor.userEmail,
    });
    const saved = await docRepo.save(doc);

    await this.insertAudit(this.dataSource.manager, {
      utilisateur: actor.userEmail,
      typeAction: 'CREER_DOCUMENT',
      entiteCible: 'document_officiel',
      idCible: saved.id,
      payloadApres: {
        codeDocument: saved.codeDocument,
        typeDocument: saved.typeDocument,
        fkCampagne: saved.fkCampagne,
        fkUserSignataire: saved.fkUserSignataire,
      },
      commentaire: `Création document ${saved.codeDocument} (${saved.typeDocument}).`,
    });

    return saved;
  }

  // ─── 5. editerDocument ───────────────────────────────────────────

  async editerDocument(
    documentId: string,
    dto: EditerDocumentDto,
    actor: ActorContext,
  ): Promise<DocumentOfficiel> {
    const docRepo = this.dataSource.getRepository(DocumentOfficiel);
    const doc = await docRepo.findOne({ where: { id: documentId } });
    if (!doc) {
      throw new NotFoundException(`Document ${documentId} introuvable.`);
    }
    if (doc.statut !== 'BROUILLON') {
      throw new ConflictException(
        `Édition impossible : statut '${doc.statut}' (BROUILLON requis).`,
      );
    }
    if (doc.fkUserEmetteur !== actor.userId && !actor.isAdmin) {
      throw new ForbiddenException(
        `Édition réservée à l'émetteur (user.id=${doc.fkUserEmetteur}) ou ADMIN.`,
      );
    }

    const avant = {
      titre: doc.titre,
      contenuHtml: doc.contenuHtml,
      referenceExterne: doc.referenceExterne,
    };

    if (dto.titre !== undefined) doc.titre = dto.titre;
    if (dto.contenuHtml !== undefined) doc.contenuHtml = dto.contenuHtml;
    if (dto.contenuJson !== undefined) doc.contenuJson = dto.contenuJson;
    if (dto.referenceExterne !== undefined) {
      doc.referenceExterne = dto.referenceExterne;
    }
    if (dto.fichierJointPath !== undefined) {
      doc.fichierJointPath = dto.fichierJointPath;
    }
    if (dto.fichierJointNom !== undefined) {
      doc.fichierJointNom = dto.fichierJointNom;
    }
    doc.dateModification = new Date();
    doc.utilisateurModification = actor.userEmail;

    const saved = await docRepo.save(doc);

    await this.insertAudit(this.dataSource.manager, {
      utilisateur: actor.userEmail,
      typeAction: 'EDITER_DOCUMENT',
      entiteCible: 'document_officiel',
      idCible: saved.id,
      payloadAvant: avant,
      payloadApres: {
        titre: saved.titre,
        contenuHtml: saved.contenuHtml,
        referenceExterne: saved.referenceExterne,
      },
      commentaire: `Édition document ${saved.codeDocument}.`,
    });

    return saved;
  }

  // ─── 6. soumettreVisa (TRANSACTION) ──────────────────────────────

  async soumettreVisa(
    documentId: string,
    _dto: SoumettreVisaDto,
    actor: ActorContext,
  ): Promise<DocumentOfficiel> {
    const doc = await this.dataSource
      .getRepository(DocumentOfficiel)
      .findOne({ where: { id: documentId } });
    if (!doc) {
      throw new NotFoundException(`Document ${documentId} introuvable.`);
    }
    if (doc.statut !== 'BROUILLON') {
      throw new ConflictException(
        `Soumission impossible : statut '${doc.statut}' (BROUILLON requis).`,
      );
    }
    if (doc.fkUserEmetteur !== actor.userId) {
      throw new ForbiddenException(
        `Soumission réservée à l'émetteur (user.id=${doc.fkUserEmetteur}).`,
      );
    }
    if (!doc.fkCampagne) {
      throw new ConflictException(
        'Soumission impossible : document non rattaché à une campagne.',
      );
    }

    const campagne = await this.dataSource
      .getRepository(CampagneBudgetaire)
      .findOne({ where: { id: doc.fkCampagne } });
    if (!campagne || campagne.statut !== 'EN_COURS') {
      throw new ConflictException(
        `Soumission impossible : campagne ${campagne?.code ?? '?'} en statut '${campagne?.statut ?? 'inconnu'}' (EN_COURS requis).`,
      );
    }

    const membres = await this.dataSource
      .getRepository(CampagneComiteMembre)
      .find({ where: { fkCampagne: doc.fkCampagne } });
    if (membres.length === 0) {
      throw new ConflictException(
        `Soumission impossible : Comité de la campagne ${campagne.code} est vide.`,
      );
    }

    return this.dataSource.transaction(async (mgr) => {
      const docRepoTx = mgr.getRepository(DocumentOfficiel);
      const visaRepoTx = mgr.getRepository(DocumentVisa);

      doc.statut = 'SOUMIS_VISA';
      doc.dateSoumissionVisa = new Date();
      doc.utilisateurModification = actor.userEmail;
      const saved = await docRepoTx.save(doc);

      // SNAPSHOT du Comité — N lignes document_visa figées
      // au moment de la soumission. Préservées même si le Comité
      // évolue après (pratique bancaire).
      for (const m of membres) {
        await visaRepoTx.insert({
          fkDocument: saved.id,
          fkUserViseur: m.fkUser,
          ordreVisa: m.ordre,
          estObligatoire: m.estObligatoire,
          libelleFonction: m.libelleFonction,
          statut: 'EN_ATTENTE',
        });
      }

      await this.insertAudit(mgr, {
        utilisateur: actor.userEmail,
        typeAction: 'SOUMETTRE_DOCUMENT_VISA',
        entiteCible: 'document_officiel',
        idCible: saved.id,
        payloadApres: {
          codeDocument: saved.codeDocument,
          nbVisasAttendus: membres.length,
          modeVisa: campagne.modeVisaDefaut,
        },
        commentaire: `Soumission ${saved.codeDocument} au visa (${membres.length} visa(s) attendu(s)).`,
      });

      return saved;
    });
  }

  // ─── 7. apporterVisa (TRANSACTION pour REJETER) ──────────────────

  async apporterVisa(
    documentId: string,
    dto: ApporterVisaDto,
    actor: ActorContext,
  ): Promise<DocumentOfficiel> {
    if (dto.action === 'REJETER' && !dto.commentaire?.trim()) {
      throw new BadRequestException('Commentaire obligatoire en cas de rejet.');
    }

    const doc = await this.dataSource
      .getRepository(DocumentOfficiel)
      .findOne({ where: { id: documentId } });
    if (!doc) {
      throw new NotFoundException(`Document ${documentId} introuvable.`);
    }
    if (doc.statut !== 'SOUMIS_VISA') {
      throw new ConflictException(
        `Visa impossible : statut '${doc.statut}' (SOUMIS_VISA requis).`,
      );
    }

    const visas = await this.dataSource
      .getRepository(DocumentVisa)
      .find({ where: { fkDocument: documentId } });
    const monVisa = visas.find(
      (v) => v.fkUserViseur === actor.userId && v.statut === 'EN_ATTENTE',
    );
    if (!monVisa) {
      throw new ForbiddenException(
        "Vous n'êtes pas dans le Comité de ce document, ou votre visa a déjà été apposé.",
      );
    }

    // Mode séquentiel : vérifier que tous les visas d'ordre inférieur
    // sont déjà VISE. Charge la campagne pour connaître le mode.
    const campagne = doc.fkCampagne
      ? await this.dataSource
          .getRepository(CampagneBudgetaire)
          .findOne({ where: { id: doc.fkCampagne } })
      : null;
    if (campagne?.modeVisaDefaut === 'SEQUENTIEL') {
      const precedentsNonVises = visas.some(
        (v) => v.ordreVisa < monVisa.ordreVisa && v.statut !== 'VISE',
      );
      if (precedentsNonVises) {
        throw new ForbiddenException(
          `Mode séquentiel : vous devez attendre que les visas d'ordre < ${monVisa.ordreVisa} soient apposés avant le vôtre.`,
        );
      }
    }

    if (dto.action === 'REJETER') {
      return this.dataSource.transaction(async (mgr) => {
        const visaRepoTx = mgr.getRepository(DocumentVisa);
        const docRepoTx = mgr.getRepository(DocumentOfficiel);

        monVisa.statut = 'REJETE';
        monVisa.dateAction = new Date();
        monVisa.commentaire = dto.commentaire ?? null;
        await visaRepoTx.save(monVisa);

        // Retour BROUILLON + DELETE autres visas (reset propre, on
        // re-snapshot au prochain submit).
        doc.statut = 'BROUILLON';
        doc.dateSoumissionVisa = null;
        doc.utilisateurModification = actor.userEmail;
        const saved = await docRepoTx.save(doc);

        await visaRepoTx.delete({
          fkDocument: documentId,
          statut: 'EN_ATTENTE',
        });

        await this.insertAudit(mgr, {
          utilisateur: actor.userEmail,
          typeAction: 'REJETER_DOCUMENT',
          entiteCible: 'document_officiel',
          idCible: saved.id,
          commentaire: `Rejet visa ${saved.codeDocument} — motif : ${dto.commentaire}`,
        });

        return saved;
      });
    }

    // action === 'VISER'
    return this.dataSource.transaction(async (mgr) => {
      const visaRepoTx = mgr.getRepository(DocumentVisa);
      const docRepoTx = mgr.getRepository(DocumentOfficiel);

      monVisa.statut = 'VISE';
      monVisa.dateAction = new Date();
      monVisa.commentaire = dto.commentaire ?? null;
      await visaRepoTx.save(monVisa);

      // Re-lecture des visas pour calculer la complétion (incluant le
      // visa qu'on vient d'apposer).
      const tousLesVisas = await visaRepoTx.find({
        where: { fkDocument: documentId },
      });
      const tousObligatoiresVises = tousLesVisas
        .filter((v) => v.estObligatoire)
        .every((v) => v.statut === 'VISE');

      if (tousObligatoiresVises) {
        doc.statut = 'VISE';
        doc.dateVisaComplet = new Date();
      }
      doc.utilisateurModification = actor.userEmail;
      const saved = await docRepoTx.save(doc);

      await this.insertAudit(mgr, {
        utilisateur: actor.userEmail,
        typeAction: 'VISER_DOCUMENT',
        entiteCible: 'document_officiel',
        idCible: saved.id,
        commentaire: tousObligatoiresVises
          ? `Visa apposé ${saved.codeDocument} — tous les visas obligatoires apposés, document VISE.`
          : `Visa apposé ${saved.codeDocument}.`,
      });

      return saved;
    });
  }

  // ─── 8. signerDocument (TRANSACTION + ORDRE PRECIS) ──────────────

  async signerDocument(
    documentId: string,
    dto: SignerDocumentDto,
    actor: ActorContext,
  ): Promise<DocumentOfficiel> {
    const userRepo = this.dataSource.getRepository(User);
    const docRepo = this.dataSource.getRepository(DocumentOfficiel);

    const user = await userRepo.findOne({ where: { id: actor.userId } });
    if (!user) {
      throw new UnauthorizedException('Utilisateur introuvable.');
    }
    const mdpOk = await bcrypt.compare(dto.motDePasse, user.motDePasseHash);
    if (!mdpOk) {
      throw new UnauthorizedException('Mot de passe invalide.');
    }

    const doc = await docRepo.findOne({ where: { id: documentId } });
    if (!doc) {
      throw new NotFoundException(`Document ${documentId} introuvable.`);
    }
    if (doc.statut !== 'VISE') {
      throw new ConflictException(
        `Signature impossible : statut '${doc.statut}' (VISE requis).`,
      );
    }
    if (doc.fkUserSignataire !== actor.userId) {
      throw new ForbiddenException(
        `Signature réservée au signataire désigné (user.id=${doc.fkUserSignataire}).`,
      );
    }

    const visas = await this.dataSource
      .getRepository(DocumentVisa)
      .find({ where: { fkDocument: documentId } });
    const hashContenu = this.hashService.hashContenu(doc.contenuHtml);
    const hashVisas = this.hashService.hashVisas(visas);

    return this.dataSource.transaction(async (mgr) => {
      // **ORDRE PRECIS** : audit AVANT signature, pour que
      // document_signature.fk_audit_log ne soit jamais NULL. La
      // ligne audit est créée DANS la transaction → rollback solidaire.
      const auditResult = await mgr.getRepository(AuditLog).insert({
        utilisateur: actor.userEmail,
        ipSource: actor.ipAddress ?? null,
        userAgent: actor.userAgent?.substring(0, 500) ?? null,
        typeAction: 'SIGNER_DOCUMENT',
        entiteCible: 'document_officiel',
        idCible: documentId,
        payloadApres: {
          codeDocument: doc.codeDocument,
          hashContenu,
          hashVisas,
          methodeAuthentification: 'PASSWORD',
        },
        commentaire: `Signature ${doc.codeDocument} par ${user.prenom} ${user.nom} (${user.email}).`,
        statut: 'success',
      });
      const auditId = String(auditResult.identifiers[0].id);

      await mgr.getRepository(DocumentSignature).insert({
        fkDocument: documentId,
        fkUserSignataire: actor.userId,
        emailSignataire: user.email,
        nomSignataire: `${user.prenom} ${user.nom}`,
        hashContenu,
        hashVisas,
        ipSignature: actor.ipAddress ?? null,
        userAgentSignature: actor.userAgent ?? null,
        methodeAuthentification: 'PASSWORD',
        fkAuditLog: auditId,
      });

      doc.statut = 'SIGNE';
      doc.dateSignature = new Date();
      doc.hashContenuSigne = hashContenu;
      doc.utilisateurModification = actor.userEmail;
      return mgr.getRepository(DocumentOfficiel).save(doc);
    });
  }

  // ─── 9. verifierIntegrite ────────────────────────────────────────

  async verifierIntegrite(documentId: string): Promise<VerifierIntegriteDto> {
    const docRepo = this.dataSource.getRepository(DocumentOfficiel);
    const sigRepo = this.dataSource.getRepository(DocumentSignature);
    const visaRepo = this.dataSource.getRepository(DocumentVisa);

    const doc = await docRepo.findOne({ where: { id: documentId } });
    if (!doc) {
      throw new NotFoundException(`Document ${documentId} introuvable.`);
    }

    const signature = await sigRepo.findOne({
      where: { fkDocument: documentId },
    });
    const hashContenuActuel = this.hashService.hashContenu(doc.contenuHtml);
    const visas = await visaRepo.find({ where: { fkDocument: documentId } });
    const hashVisasActuel = this.hashService.hashVisas(visas);

    if (!signature) {
      return {
        documentId,
        signaturePresente: false,
        contenuIntact: false,
        visasIntacts: false,
        dateSignature: null,
        signataireSnapshot: null,
        details: {
          hashContenuActuel,
          hashContenuSigne: '',
          hashVisasActuel,
          hashVisasSigne: '',
        },
      };
    }

    return {
      documentId,
      signaturePresente: true,
      contenuIntact: hashContenuActuel === signature.hashContenu,
      visasIntacts: hashVisasActuel === signature.hashVisas,
      dateSignature: signature.dateSignature,
      signataireSnapshot: {
        email: signature.emailSignataire,
        nom: signature.nomSignataire,
      },
      details: {
        hashContenuActuel,
        hashContenuSigne: signature.hashContenu,
        hashVisasActuel,
        hashVisasSigne: signature.hashVisas,
      },
    };
  }

  // ─── 10. listerDocuments ─────────────────────────────────────────

  /**
   * Lot 8.1.E Palier 2 — enrichissement émetteur + signataire pour
   * que le tableau frontend (DocumentsPage) affiche les noms réels
   * au lieu de "user.id=10" / "—". Mapping `UserResume` (4 champs
   * id/email/nom/prenom seulement, défense en profondeur après le
   * `@Exclude motDePasseHash` global du Palier 1).
   */
  async listerDocuments(
    query: ListerDocumentsQueryDto,
    actor: ActorContext,
  ): Promise<DocumentOfficielListItem[]> {
    const qb = this.dataSource
      .getRepository(DocumentOfficiel)
      .createQueryBuilder('d')
      .leftJoinAndSelect('d.emetteur', 'emetteur')
      .leftJoinAndSelect('d.signataire', 'signataire');

    if (query.statut)
      qb.andWhere('d.statut = :statut', { statut: query.statut });
    if (query.typeDocument) {
      qb.andWhere('d.typeDocument = :type', { type: query.typeDocument });
    }
    if (query.fkCampagne) {
      qb.andWhere('d.fkCampagne = :camp', { camp: query.fkCampagne });
    }

    // RBAC dynamique : ADMIN voit tout. Sinon, emetteur OU viseur OU signataire.
    if (!actor.isAdmin) {
      qb.andWhere(
        `(d.fkUserEmetteur = :uid
          OR d.fkUserSignataire = :uid
          OR EXISTS (
            SELECT 1 FROM document_visa v
             WHERE v.fk_document = d.id AND v.fk_user_viseur = :uid
          ))`,
        { uid: actor.userId },
      );
    }

    // Filtres "monRole" (perspective utilisateur).
    if (query.monRole === 'emetteur') {
      qb.andWhere('d.fkUserEmetteur = :uid', { uid: actor.userId });
    } else if (query.monRole === 'signataire') {
      qb.andWhere('d.fkUserSignataire = :uid', { uid: actor.userId });
    } else if (query.monRole === 'viseur_en_attente') {
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM document_visa v
           WHERE v.fk_document = d.id
             AND v.fk_user_viseur = :uid
             AND v.statut = 'EN_ATTENTE'
        )`,
        { uid: actor.userId },
      );
    }

    qb.orderBy('d.dateModification', 'DESC', 'NULLS LAST').addOrderBy(
      'd.dateCreation',
      'DESC',
    );

    const docs = await qb.getMany();
    return docs.map((d) => {
      const { emetteur, signataire, ...rest } = d;
      return {
        ...rest,
        emetteur: toUserResume(emetteur),
        signataire: toUserResume(signataire),
      };
    });
  }

  // ─── 11. detailDocument (Lot 8.1.C) ──────────────────────────────

  /**
   * Détail d'un document avec ses visas et sa signature éventuelle.
   * Check d'accès métier : actor doit être émetteur OU dans
   * `document_visa` OU signataire OU ADMIN.
   *
   * @throws NotFoundException si document introuvable.
   * @throws ForbiddenException si actor n'a aucun rôle sur le document.
   */
  /**
   * Lot 8.1.E Palier 2 — refonte du retour pour matcher le contrat
   * frontend `DocumentOfficiel` (Lot 8.2.B) :
   *
   * Avant : `{ document, visas, signature }` (nested, sans enrichissements)
   * → frontend forcé d'aplatir au boundary (lib/api/documents.ts) +
   * cartouche détail affiche "user.id=10" car relation non chargée.
   *
   * Après : `{ ...document, emetteur, signataire, visas, signature }`
   * (aplati) avec :
   *  - `emetteur` / `signataire` chargés via relations TypeORM puis
   *    mappés en `UserResume` (id/email/nom/prenom — minimise la surface
   *    API + défense en profondeur après @Exclude motDePasseHash global).
   *  - `visas[].user` (clé renommée depuis l'entité `visa.viseur` pour
   *    aligner sur le contrat frontend `DocumentVisaResume.user`).
   *  - `signature` conservée telle quelle — l'entité contient déjà
   *    `emailSignataire` / `nomSignataire` capturés au snapshot
   *    signature, pas besoin de relation supplémentaire.
   *
   * Symétrie avec le hotfix `campagne.service.detailCampagne`
   * (Lot 8.2.A) qui avait corrigé le même pattern.
   */
  async detailDocument(
    documentId: string,
    actor: ActorContext,
  ): Promise<DocumentOfficielDetailView> {
    const doc = await this.dataSource.getRepository(DocumentOfficiel).findOne({
      where: { id: documentId },
      relations: ['emetteur', 'signataire'],
    });
    if (!doc) {
      throw new NotFoundException(`Document ${documentId} introuvable.`);
    }

    const visas = await this.dataSource.getRepository(DocumentVisa).find({
      where: { fkDocument: documentId },
      relations: ['viseur'],
      order: { ordreVisa: 'ASC' },
    });

    // Check d'accès métier (RBAC technique reste sur le controller).
    if (!actor.isAdmin) {
      const estEmetteur = doc.fkUserEmetteur === actor.userId;
      const estSignataire = doc.fkUserSignataire === actor.userId;
      const estViseur = visas.some((v) => v.fkUserViseur === actor.userId);
      if (!estEmetteur && !estSignataire && !estViseur) {
        throw new ForbiddenException(
          "Accès refusé : vous n'êtes ni émetteur, ni viseur, ni signataire de ce document.",
        );
      }
    }

    const signature = await this.dataSource
      .getRepository(DocumentSignature)
      .findOne({ where: { fkDocument: documentId } });

    // Lot 8.2.C — chargement conditionnel du détail métier D2.
    // Lot 8.3.A — chargement conditionnel du détail métier D3.
    // Lot 8.3.B — chargement conditionnel du détail métier D5.
    // Exclusion mutuelle par typeDocument : au plus un des 3 SELECT
    // est exécuté pour un document donné. Pour les 4 autres types
    // (D1, D11, D12, R3, R5), aucun round-trip supplémentaire.
    const lettreCadrageDetail =
      doc.typeDocument === 'D2_LETTRE_CADRAGE'
        ? await this.dataSource
            .getRepository(LettreCadrageDetail)
            .findOne({ where: { fkDocument: documentId } })
        : null;
    const noteOrientationDetail =
      doc.typeDocument === 'D3_NOTE_ORIENTATION'
        ? await this.dataSource
            .getRepository(NoteOrientationDetail)
            .findOne({ where: { fkDocument: documentId } })
        : null;
    const lettreMobilisationDetail =
      doc.typeDocument === 'D5_LETTRE_MOBILISATION'
        ? await this.dataSource
            .getRepository(LettreMobilisationDetail)
            .findOne({ where: { fkDocument: documentId } })
        : null;

    const { emetteur, signataire, ...rest } = doc;
    return {
      ...rest,
      emetteur: toUserResume(emetteur),
      signataire: toUserResume(signataire),
      visas: visas.map((v) => {
        const { viseur, ...vRest } = v;
        return { ...vRest, user: toUserResume(viseur) };
      }),
      signature,
      lettreCadrageDetail,
      noteOrientationDetail,
      lettreMobilisationDetail,
    };
  }

  // ─── 12. historiqueDocument (Lot 8.1.C) ──────────────────────────

  /**
   * Timeline chronologique d'un document depuis `audit_log`.
   * Pas de check actor — le RBAC `DOCUMENT.LIRE` est appliqué au
   * controller. Les événements sont mappés en libellés lisibles.
   *
   * @throws NotFoundException si aucun événement (= document inexistant).
   */
  async historiqueDocument(documentId: string): Promise<{
    documentId: string;
    evenements: Array<{
      etape: string;
      date: Date;
      acteur: string;
      libelle: string;
      commentaire: string | null;
      payload: object | null;
    }>;
  }> {
    const rows = await this.dataSource
      .getRepository(AuditLog)
      .createQueryBuilder('a')
      .where('a.entiteCible = :entite', { entite: 'document_officiel' })
      .andWhere('a.idCible = :id', { id: documentId })
      .orderBy('a.dateAction', 'ASC')
      .getMany();

    if (rows.length === 0) {
      throw new NotFoundException(
        `Aucun historique pour le document ${documentId} (probablement inexistant).`,
      );
    }

    const LIBELLES_ETAPE: Record<string, string> = {
      CREER_DOCUMENT: 'Création du document',
      EDITER_DOCUMENT: 'Édition du document',
      SOUMETTRE_DOCUMENT_VISA: 'Soumission au visa',
      VISER_DOCUMENT: 'Visa apposé',
      REJETER_DOCUMENT: 'Rejet du visa',
      SIGNER_DOCUMENT: 'Signature finale',
    };

    return {
      documentId,
      evenements: rows.map((r) => ({
        etape: r.typeAction,
        date: r.dateAction,
        acteur: r.utilisateur,
        libelle: LIBELLES_ETAPE[r.typeAction] ?? r.typeAction,
        commentaire: r.commentaire,
        payload: r.payloadApres,
      })),
    };
  }

  // ─── Helper privé : insertion audit_log via manager ───────────────

  /**
   * Insère une ligne audit_log via le manager fourni. Permet de
   * solidariser l'audit avec la transaction métier en cours (rollback
   * solidaire si l'INSERT métier échoue).
   *
   * **Pourquoi pas AuditService.log() directement ?** L'API existante
   * accepte un manager optionnel et fait `repo.insert()` sans retourner
   * d'identifier. La méthode `signerDocument` a besoin de récupérer
   * l'id généré pour le mettre dans document_signature.fk_audit_log
   * → on duplique légèrement la logique d'insertion ici pour
   * récupérer le RETURNING via `InsertResult.identifiers`.
   */
  private async insertAudit(
    manager: EntityManager,
    entry: {
      utilisateur: string;
      typeAction: AuditLog['typeAction'];
      entiteCible: string;
      idCible?: string | null;
      payloadAvant?: object | null;
      payloadApres?: object | null;
      commentaire?: string | null;
      ipSource?: string | null;
      userAgent?: string | null;
    },
  ): Promise<void> {
    await manager.getRepository(AuditLog).insert({
      utilisateur: entry.utilisateur,
      ipSource: entry.ipSource ?? null,
      userAgent: entry.userAgent?.substring(0, 500) ?? null,
      typeAction: entry.typeAction,
      entiteCible: entry.entiteCible,
      idCible: entry.idCible ?? null,
      payloadAvant: entry.payloadAvant ?? null,
      payloadApres: entry.payloadApres ?? null,
      commentaire: entry.commentaire ?? null,
      statut: 'success',
    });
  }
}
