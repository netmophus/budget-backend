/**
 * NotificationService (Lot 4.3) — pivot du module notifications.
 *
 * Responsabilités :
 *  - Résoudre les destinataires d'un événement métier (logique RBAC
 *    + délégations actives + filtrage préférences user).
 *  - Choisir le template + le sujet selon l'événement.
 *  - Rendre le template Handlebars en HTML.
 *  - Tenter l'envoi via nodemailer avec retry simple (3 tentatives,
 *    backoff 1s/3s/10s) — ou simuler en dry-run.
 *  - Tracer chaque envoi (réel, supprimé par préférence, dry-run,
 *    échec définitif) dans `email_log`.
 *
 * Mode dry-run : si `EMAIL_DRY_RUN=true`, aucun appel SMTP réel ;
 * la ligne est créée avec statut='SUPPRIME' et raison documentée
 * dans payload.
 *
 * Couplage faible : le service NE connaît PAS les services métier.
 * Il est appelé via les listeners @OnEvent enregistrés dans
 * NotificationsListenersService.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { compile, type TemplateDelegate } from 'handlebars';
import { type Transporter, createTransport } from 'nodemailer';
import { Repository } from 'typeorm';

import { PermissionsService } from '../auth/permissions.service';
import { User } from '../users/entities/user.entity';
import {
  EmailLog,
  type StatutEmail,
  type TypeEvenement,
} from './entities/email-log.entity';
import {
  EmailLogResponseDto,
  ListerEmailLogQueryDto,
  StatistiquesEmailDto,
} from './dto/notifications.dto';

interface EnvoyerOptions {
  /** id si la ligne email_log était déjà créée (cas du retry). */
  emailLogId?: string;
}

interface EnvoyerResult {
  emailLog: EmailLog;
  envoye: boolean;
}

interface ResolutionContexte {
  budgetVersionId?: string;
  delegationId?: string;
  affectationId?: string;
  /** auteur de l'action métier (exclu des destinataires automatiques) */
  auteurEmail?: string;
  /** id user de l'auteur (pour soumetteur/validateur lookup) */
  auteurId?: string;
  /**
   * Pour les évenements délégations/affectations : ids explicites des
   * destinataires fournis par le listener (qui connaît déjà
   * fkDelegataire / fkUser). Évite une résolution RBAC inutile.
   */
  destinataireUserIds?: string[];
}

const SUJETS: Record<TypeEvenement, string> = {
  BUDGET_SOUMIS: '[MIZNAS] Version budgétaire soumise pour validation',
  BUDGET_VALIDE: '[MIZNAS] Version budgétaire validée',
  BUDGET_REJETE: '[MIZNAS] Version budgétaire rejetée',
  BUDGET_PUBLIE: '[MIZNAS] Version budgétaire publiée (gel BCEAO)',
  DELEGATION_CREEE: '[MIZNAS] Vous avez reçu une délégation',
  DELEGATION_EXPIREE: '[MIZNAS] Délégation expirée',
  DELEGATION_REVOQUEE: '[MIZNAS] Délégation révoquée',
  AFFECTATION_CREEE: '[MIZNAS] Nouvelle affectation de périmètre',
};

const TEMPLATES: Record<TypeEvenement, string> = {
  BUDGET_SOUMIS: 'budget-soumis',
  BUDGET_VALIDE: 'budget-valide',
  BUDGET_REJETE: 'budget-rejete',
  BUDGET_PUBLIE: 'budget-publie',
  DELEGATION_CREEE: 'delegation-recue',
  DELEGATION_EXPIREE: 'delegation-expiree',
  DELEGATION_REVOQUEE: 'delegation-revoquee',
  AFFECTATION_CREEE: 'affectation-creee',
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly compiledTemplates = new Map<string, TemplateDelegate>();
  private layoutCache?: TemplateDelegate;
  private transporter?: Transporter;

  constructor(
    @InjectRepository(EmailLog)
    private readonly emailLogRepo: Repository<EmailLog>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly config: ConfigService,
    private readonly permissionsService: PermissionsService,
  ) {}

  // ─── Configuration ──────────────────────────────────────────────

  private get dryRun(): boolean {
    return this.config.get<string>('EMAIL_DRY_RUN', 'true') !== 'false';
  }

  private getAppBaseUrl(): string {
    return this.config.get<string>('APP_BASE_URL', 'http://localhost:5173');
  }

  private getTransporter(): Transporter {
    if (this.transporter) return this.transporter;
    this.transporter = createTransport({
      host: this.config.get<string>('SMTP_HOST', 'localhost'),
      port: Number(this.config.get<string>('SMTP_PORT', '1025')),
      secure: false,
      auth: this.config.get<string>('SMTP_USER')
        ? {
            user: this.config.get<string>('SMTP_USER')!,
            pass: this.config.get<string>('SMTP_PASS')!,
          }
        : undefined,
    });
    return this.transporter;
  }

  // ─── Templates ──────────────────────────────────────────────────

  private chargerTemplate(nom: string): TemplateDelegate {
    const cache = this.compiledTemplates.get(nom);
    if (cache) return cache;
    const path = join(__dirname, 'templates', `${nom}.hbs`);
    const source = readFileSync(path, 'utf-8');
    const compiled = compile(source);
    this.compiledTemplates.set(nom, compiled);
    return compiled;
  }

  private chargerLayout(): TemplateDelegate {
    if (this.layoutCache) return this.layoutCache;
    const path = join(__dirname, 'templates', '_layout.hbs');
    const source = readFileSync(path, 'utf-8');
    this.layoutCache = compile(source);
    return this.layoutCache;
  }

  /**
   * Rend le HTML final : applique d'abord le template d'événement,
   * puis l'injecte dans le layout commun via `{{{contenu}}}`.
   * Public pour permettre la prévisualisation côté admin.
   */
  rendreTemplate(nom: string, variables: Record<string, unknown>): string {
    const evenement = this.chargerTemplate(nom);
    const layout = this.chargerLayout();
    const contenu = evenement(variables);
    return layout({ ...variables, contenu });
  }

  // ─── Résolution destinataires ──────────────────────────────────

  /**
   * Détermine la liste des users à notifier pour un événement donné.
   * NB : le filtrage final par préférences utilisateur (toggle global +
   * liste blanche) est appliqué dans `envoyer()` afin que les users
   * filtrés produisent quand même une trace SUPPRIME.
   */
  async resoudreDestinataires(
    evenement: TypeEvenement,
    contexte: ResolutionContexte,
  ): Promise<User[]> {
    switch (evenement) {
      case 'BUDGET_SOUMIS':
        return this.usersAvecPermission('BUDGET.VALIDER', contexte.auteurId);
      case 'BUDGET_VALIDE': {
        const acteurs: User[] = [];
        const soumetteur = await this.findUserParAuditAction(
          'SOUMETTRE_BUDGET',
          contexte.budgetVersionId!,
        );
        if (soumetteur) acteurs.push(soumetteur);
        const publieurs = await this.usersAvecPermission(
          'BUDGET.PUBLIER',
          contexte.auteurId,
        );
        for (const p of publieurs) {
          if (!acteurs.some((u) => u.id === p.id)) acteurs.push(p);
        }
        return acteurs;
      }
      case 'BUDGET_REJETE': {
        const soumetteur = await this.findUserParAuditAction(
          'SOUMETTRE_BUDGET',
          contexte.budgetVersionId!,
        );
        return soumetteur ? [soumetteur] : [];
      }
      case 'BUDGET_PUBLIE': {
        const acteurs: User[] = [];
        const [soumetteur, validateur] = await Promise.all([
          this.findUserParAuditAction(
            'SOUMETTRE_BUDGET',
            contexte.budgetVersionId!,
          ),
          this.findUserParAuditAction(
            'VALIDER_BUDGET',
            contexte.budgetVersionId!,
          ),
        ]);
        if (soumetteur) acteurs.push(soumetteur);
        if (validateur && !acteurs.some((u) => u.id === validateur.id)) {
          acteurs.push(validateur);
        }
        const saisisseurs = await this.usersAvecPermission(
          'BUDGET.SAISIR',
          contexte.auteurId,
        );
        for (const s of saisisseurs) {
          if (!acteurs.some((u) => u.id === s.id)) acteurs.push(s);
        }
        return acteurs;
      }
      case 'DELEGATION_CREEE':
      case 'DELEGATION_REVOQUEE':
      case 'DELEGATION_EXPIREE':
      case 'AFFECTATION_CREEE': {
        // Le listener fournit les ids dans destinataireUserIds.
        const ids = contexte.destinataireUserIds ?? [];
        if (ids.length === 0) return [];
        const users: User[] = [];
        for (const id of ids) {
          const u = await this.userRepo.findOne({ where: { id } });
          if (u) users.push(u);
        }
        return users;
      }
      default:
        return [];
    }
  }

  /** Récupère les users qui possèdent une permission donnée (natif ou délégation active). */
  private async usersAvecPermission(
    codePermission: string,
    excludeUserId?: string,
  ): Promise<User[]> {
    const allUsers = await this.userRepo.find({ where: { estActif: true } });
    const matching: User[] = [];
    for (const u of allUsers) {
      if (excludeUserId && u.id === excludeUserId) continue;
      const has = await this.permissionsService.hasPermission(u.id, [
        codePermission,
      ]);
      if (has) matching.push(u);
    }
    return matching;
  }

  /**
   * Trouve l'auteur le plus récent d'une action audit_log sur une
   * entité (versionId). Utilisé pour récupérer soumetteur/validateur.
   */
  private async findUserParAuditAction(
    typeAction: string,
    idCible: string,
  ): Promise<User | null> {
    const rows = (await this.userRepo.manager.query<
      Array<{ utilisateur: string }>
    >(
      `SELECT utilisateur FROM audit_log
        WHERE type_action = $1 AND id_cible = $2 AND statut = 'success'
        ORDER BY id DESC LIMIT 1`,
      [typeAction, String(idCible)],
    )) ?? [];
    if (rows.length === 0) return null;
    return this.userRepo.findOne({ where: { email: rows[0]!.utilisateur } });
  }

  // ─── Envoi ──────────────────────────────────────────────────────

  /**
   * Envoie l'email à un destinataire (ou trace SUPPRIME).
   * Logique de filtrage préférences appliquée ici afin que la
   * trace existe systématiquement dans email_log.
   */
  async envoyer(
    evenement: TypeEvenement,
    destinataire: User,
    payload: Record<string, unknown>,
    options: EnvoyerOptions = {},
  ): Promise<EnvoyerResult> {
    // 1. Filtre préférences utilisateur
    const motifSuppression = this.motifSuppression(evenement, destinataire);
    if (motifSuppression) {
      const log = await this.logSupprime(
        evenement,
        destinataire,
        payload,
        motifSuppression,
      );
      return { emailLog: log, envoye: false };
    }

    // 2. Mode dry-run global
    if (this.dryRun) {
      const log = await this.logSupprime(
        evenement,
        destinataire,
        payload,
        'EMAIL_DRY_RUN=true',
      );
      return { emailLog: log, envoye: false };
    }

    // 3. Préparation du contenu
    const sujet = SUJETS[evenement];
    const template = TEMPLATES[evenement];
    const variables = {
      ...payload,
      destinataire: {
        prenom: destinataire.prenom,
        nom: destinataire.nom,
        email: destinataire.email,
      },
      app_base_url: this.getAppBaseUrl(),
      annee: new Date().getFullYear(),
    };

    // 4. Création (ou récupération) de la ligne email_log
    let log = options.emailLogId
      ? await this.emailLogRepo.findOne({ where: { id: options.emailLogId } })
      : null;
    if (!log) {
      log = this.emailLogRepo.create({
        evenement,
        fkDestinataire: destinataire.id,
        destinataireEmail: destinataire.email,
        sujet,
        template,
        payload,
        statut: 'EN_ATTENTE',
        tentatives: 0,
      });
      log = await this.emailLogRepo.save(log);
    }

    // 5. Tentatives avec backoff
    const html = this.rendreTemplate(template, variables);
    const backoffsMs = [1000, 3000, 10000];
    let derniereErreur: string | null = null;
    for (let i = 0; i < backoffsMs.length; i++) {
      log.tentatives++;
      try {
        await this.getTransporter().sendMail({
          from: this.config.get<string>('SMTP_FROM', 'miznas@bsic.local'),
          to: destinataire.email,
          subject: sujet,
          html,
        });
        log.statut = 'ENVOYE';
        log.envoyeLe = new Date();
        log.dernierMessageErreur = null;
        log = await this.emailLogRepo.save(log);
        return { emailLog: log, envoye: true };
      } catch (err) {
        derniereErreur = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Tentative ${log.tentatives}/${backoffsMs.length} ` +
            `échouée pour ${destinataire.email} (${evenement}) : ${derniereErreur}`,
        );
        if (i < backoffsMs.length - 1) {
          await new Promise((r) => setTimeout(r, backoffsMs[i]));
        }
      }
    }

    // 6. Échec définitif
    log.statut = 'ECHEC';
    log.dernierMessageErreur = derniereErreur;
    log = await this.emailLogRepo.save(log);
    return { emailLog: log, envoye: false };
  }

  /**
   * Détermine si un user a coupé ce type d'event. Retourne un motif
   * (string) si oui, null sinon.
   */
  private motifSuppression(
    evenement: TypeEvenement,
    user: User,
  ): string | null {
    if (!user.notificationsEmailActives) {
      return 'PREF_TOGGLE_GLOBAL_OFF';
    }
    if (
      user.notificationsEmailTypes !== null &&
      !user.notificationsEmailTypes.includes(evenement)
    ) {
      return 'PREF_TYPE_NON_SOUSCRIT';
    }
    return null;
  }

  private async logSupprime(
    evenement: TypeEvenement,
    user: User,
    payload: Record<string, unknown>,
    motif: string,
  ): Promise<EmailLog> {
    const log = this.emailLogRepo.create({
      evenement,
      fkDestinataire: user.id,
      destinataireEmail: user.email,
      sujet: SUJETS[evenement],
      template: TEMPLATES[evenement],
      payload: { ...payload, _motifSuppression: motif },
      statut: 'SUPPRIME' as StatutEmail,
      tentatives: 0,
    });
    return this.emailLogRepo.save(log);
  }

  // ─── Rejouer (admin) ────────────────────────────────────────────

  async rejouer(emailLogId: string): Promise<EnvoyerResult> {
    const log = await this.emailLogRepo.findOne({
      where: { id: emailLogId },
    });
    if (!log) {
      throw new NotFoundException(`email_log ${emailLogId} introuvable.`);
    }
    if (log.statut === 'ENVOYE') {
      return { emailLog: log, envoye: true };
    }
    if (log.fkDestinataire === null) {
      throw new NotFoundException(
        `email_log ${emailLogId} n'a plus de destinataire (user supprimé).`,
      );
    }
    const user = await this.userRepo.findOne({
      where: { id: log.fkDestinataire },
    });
    if (!user) {
      throw new NotFoundException(
        `Destinataire user ${log.fkDestinataire} introuvable.`,
      );
    }
    return this.envoyer(log.evenement, user, log.payload, {
      emailLogId: log.id,
    });
  }

  // ─── Listing + stats ────────────────────────────────────────────

  async listerLogs(
    filtres: ListerEmailLogQueryDto,
  ): Promise<{ items: EmailLogResponseDto[]; total: number }> {
    const qb = this.emailLogRepo.createQueryBuilder('e');
    if (filtres.statuts && filtres.statuts.length > 0) {
      qb.andWhere('e.statut IN (:...statuts)', { statuts: filtres.statuts });
    }
    if (filtres.evenements && filtres.evenements.length > 0) {
      qb.andWhere('e.evenement IN (:...evs)', { evs: filtres.evenements });
    }
    if (filtres.dateDebut) {
      qb.andWhere('e.dateCreation >= :d', { d: filtres.dateDebut });
    }
    if (filtres.dateFin) {
      qb.andWhere('e.dateCreation <= :f', { f: filtres.dateFin });
    }
    if (filtres.rechercheEmail) {
      qb.andWhere('e.destinataireEmail ILIKE :recherche', {
        recherche: `%${filtres.rechercheEmail}%`,
      });
    }
    qb.orderBy('e.dateCreation', 'DESC');
    qb.skip(((filtres.page ?? 1) - 1) * (filtres.limit ?? 50));
    qb.take(filtres.limit ?? 50);
    const [items, total] = await qb.getManyAndCount();
    return {
      items: items.map((i) => this.toResponse(i)),
      total,
    };
  }

  async statistiques(): Promise<StatistiquesEmailDto> {
    const j7 = new Date(Date.now() - 7 * 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 19);
    const j30 = new Date(Date.now() - 30 * 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 19);
    const total7 = await this.emailLogRepo
      .createQueryBuilder('e')
      .where('e.dateCreation >= :j7', { j7 })
      .getCount();
    const total30 = await this.emailLogRepo
      .createQueryBuilder('e')
      .where('e.dateCreation >= :j30', { j30 })
      .getCount();
    const parStatutRows = (await this.emailLogRepo.manager.query<
      Array<{ statut: StatutEmail; n: string }>
    >(
      `SELECT statut, COUNT(*)::text AS n FROM email_log
        WHERE date_creation >= $1
        GROUP BY statut`,
      [j30],
    )) ?? [];
    const parEvRows = (await this.emailLogRepo.manager.query<
      Array<{ evenement: string; n: string }>
    >(
      `SELECT evenement, COUNT(*)::text AS n FROM email_log
        WHERE date_creation >= $1
        GROUP BY evenement`,
      [j30],
    )) ?? [];
    const parStatut: Record<StatutEmail, number> = {
      EN_ATTENTE: 0,
      ENVOYE: 0,
      ECHEC: 0,
      SUPPRIME: 0,
    };
    for (const r of parStatutRows) {
      parStatut[r.statut] = Number(r.n);
    }
    const parEvenement: Record<string, number> = {};
    for (const r of parEvRows) {
      parEvenement[r.evenement] = Number(r.n);
    }
    return {
      total7Jours: total7,
      total30Jours: total30,
      parStatut,
      parEvenement,
    };
  }

  private toResponse(e: EmailLog): EmailLogResponseDto {
    return {
      id: String(e.id),
      evenement: e.evenement,
      fkDestinataire: e.fkDestinataire === null ? null : String(e.fkDestinataire),
      destinataireEmail: e.destinataireEmail,
      sujet: e.sujet,
      template: e.template,
      payload: e.payload,
      statut: e.statut,
      tentatives: e.tentatives,
      dernierMessageErreur: e.dernierMessageErreur,
      envoyeLe: e.envoyeLe ? e.envoyeLe.toISOString() : null,
      dateCreation: e.dateCreation.toISOString(),
    };
  }
}
