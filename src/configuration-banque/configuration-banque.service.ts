import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { ConfigurationBanqueMembreComite } from './entities/configuration-banque-membre-comite.entity';
import { ConfigurationBanque } from './entities/configuration-banque.entity';
import type {
  ConfigurationBanquePubliqueDto,
  ConfigurationBanqueResponseDto,
  CreateMembreComiteDto,
  MembreComiteResponseDto,
  UpdateConfigurationBanqueDto,
  UpdateMembreComiteDto,
} from './dto/configuration-banque.dto';

/** id figé de la ligne unique (table mono-ligne verrouillée par CHECK). */
const CONFIG_ID = '1';

/**
 * ConfigurationBanqueService (Lot B1) — lecture/écriture de la config
 * institutionnelle de la banque cliente + membres du Comité. Toute
 * écriture est tracée par un audit `CONFIGURATION_BANQUE_MODIFIEE`
 * transactionnel (rollback si l'audit échoue), pattern
 * ParametreSystemeService.
 */
@Injectable()
export class ConfigurationBanqueService {
  constructor(
    @InjectRepository(ConfigurationBanque)
    private readonly configRepo: Repository<ConfigurationBanque>,
    @InjectRepository(ConfigurationBanqueMembreComite)
    private readonly membreRepo: Repository<ConfigurationBanqueMembreComite>,
    private readonly auditService: AuditService,
  ) {}

  /** Ligne de configuration unique (throw si le seed n'a pas tourné). */
  private async getEntite(): Promise<ConfigurationBanque> {
    const config = await this.configRepo.findOne({
      where: { id: CONFIG_ID },
    });
    if (!config) {
      throw new NotFoundException(
        'Configuration banque introuvable (migration/seed 590 non appliqué ?).',
      );
    }
    return config;
  }

  private async getMembres(
    actifsSeulement: boolean,
  ): Promise<ConfigurationBanqueMembreComite[]> {
    return this.membreRepo.find({
      where: {
        fkConfigurationBanque: CONFIG_ID,
        ...(actifsSeulement ? { estActif: true } : {}),
      },
      order: { ordreAffichage: 'ASC', id: 'ASC' },
    });
  }

  /** Configuration complète + membres (tous, ordonnés). */
  async getConfiguration(): Promise<ConfigurationBanqueResponseDto> {
    const config = await this.getEntite();
    const membres = await this.getMembres(false);
    return { ...toResponse(config), membres: membres.map(toMembreResponse) };
  }

  /**
   * Version PUBLIQUE (whitelist stricte) — exposée sans auth pour le
   * branding front. Aucun champ sensible (membres, contexte marché).
   */
  async getConfigurationPublique(): Promise<ConfigurationBanquePubliqueDto> {
    const c = await this.getEntite();
    return {
      nom: c.nom,
      sigle: c.sigle,
      nomCommercialComplet: c.nomCommercialComplet,
      villeSiege: c.villeSiege,
      pays: c.pays,
      couleurPrimaire: c.couleurPrimaire,
      couleurPrimaireDark: c.couleurPrimaireDark,
      couleurSecondaire: c.couleurSecondaire,
      logoRef: c.logoRef,
    };
  }

  /** Mise à jour partielle de la configuration + audit transactionnel. */
  async updateConfiguration(
    dto: UpdateConfigurationBanqueDto,
    user: AuthUser,
  ): Promise<ConfigurationBanqueResponseDto> {
    const config = await this.getEntite();
    const avant = toResponse(config);

    await this.configRepo.manager.transaction(async (tx) => {
      const repo = tx.getRepository(ConfigurationBanque);
      Object.assign(config, dto);
      config.dateModification = new Date();
      config.utilisateurModification = user.email;
      await repo.save(config);

      await this.auditService.log(
        {
          utilisateur: user.email,
          typeAction: 'CONFIGURATION_BANQUE_MODIFIEE',
          entiteCible: 'configuration_banque',
          idCible: CONFIG_ID,
          statut: 'success',
          payloadAvant: avant,
          payloadApres: { ...avant, ...dto },
          commentaire: `Configuration banque mise à jour (${String(
            Object.keys(dto).length,
          )} champ(s)).`,
        },
        tx,
      );
    });

    return this.getConfiguration();
  }

  // ─── Membres du Comité ─────────────────────────────────────────

  async ajouterMembre(
    dto: CreateMembreComiteDto,
    user: AuthUser,
  ): Promise<MembreComiteResponseDto> {
    return this.membreRepo.manager.transaction(async (tx) => {
      const repo = tx.getRepository(ConfigurationBanqueMembreComite);
      const membre = repo.create({
        fkConfigurationBanque: CONFIG_ID,
        nomPrenom: dto.nomPrenom,
        titre: dto.titre ?? null,
        fonction: dto.fonction,
        ordreAffichage: dto.ordreAffichage ?? 0,
        estActif: true,
        utilisateurCreation: user.email,
      });
      const saved = await repo.save(membre);

      await this.auditService.log(
        {
          utilisateur: user.email,
          typeAction: 'CONFIGURATION_BANQUE_MODIFIEE',
          entiteCible: 'configuration_banque_membre_comite',
          idCible: String(saved.id),
          statut: 'success',
          payloadApres: {
            nomPrenom: saved.nomPrenom,
            fonction: saved.fonction,
          },
          commentaire: `Membre Comité ajouté : ${saved.nomPrenom} (${saved.fonction}).`,
        },
        tx,
      );
      return toMembreResponse(saved);
    });
  }

  async modifierMembre(
    id: string,
    dto: UpdateMembreComiteDto,
    user: AuthUser,
  ): Promise<MembreComiteResponseDto> {
    const membre = await this.membreRepo.findOne({ where: { id } });
    if (!membre) {
      throw new NotFoundException(`Membre Comité ${id} introuvable.`);
    }
    return this.membreRepo.manager.transaction(async (tx) => {
      const repo = tx.getRepository(ConfigurationBanqueMembreComite);
      if (dto.nomPrenom !== undefined) membre.nomPrenom = dto.nomPrenom;
      if (dto.titre !== undefined) membre.titre = dto.titre;
      if (dto.fonction !== undefined) membre.fonction = dto.fonction;
      if (dto.ordreAffichage !== undefined)
        membre.ordreAffichage = dto.ordreAffichage;
      if (dto.estActif !== undefined) membre.estActif = dto.estActif;
      const saved = await repo.save(membre);

      await this.auditService.log(
        {
          utilisateur: user.email,
          typeAction: 'CONFIGURATION_BANQUE_MODIFIEE',
          entiteCible: 'configuration_banque_membre_comite',
          idCible: String(saved.id),
          statut: 'success',
          payloadApres: {
            nomPrenom: saved.nomPrenom,
            fonction: saved.fonction,
          },
          commentaire: `Membre Comité modifié : ${saved.nomPrenom}.`,
        },
        tx,
      );
      return toMembreResponse(saved);
    });
  }

  /** Désactivation logique (est_actif=false), pas de suppression physique. */
  async desactiverMembre(
    id: string,
    user: AuthUser,
  ): Promise<MembreComiteResponseDto> {
    const membre = await this.membreRepo.findOne({ where: { id } });
    if (!membre) {
      throw new NotFoundException(`Membre Comité ${id} introuvable.`);
    }
    return this.membreRepo.manager.transaction(async (tx) => {
      const repo = tx.getRepository(ConfigurationBanqueMembreComite);
      membre.estActif = false;
      const saved = await repo.save(membre);

      await this.auditService.log(
        {
          utilisateur: user.email,
          typeAction: 'CONFIGURATION_BANQUE_MODIFIEE',
          entiteCible: 'configuration_banque_membre_comite',
          idCible: String(saved.id),
          statut: 'success',
          payloadApres: { estActif: false },
          commentaire: `Membre Comité désactivé : ${saved.nomPrenom}.`,
        },
        tx,
      );
      return toMembreResponse(saved);
    });
  }
}

// ─── Mappers ───────────────────────────────────────────────────────

function toResponse(
  c: ConfigurationBanque,
): Omit<ConfigurationBanqueResponseDto, 'membres'> {
  return {
    nom: c.nom,
    sigle: c.sigle,
    nomCommercialComplet: c.nomCommercialComplet,
    formeJuridique: c.formeJuridique,
    groupe: c.groupe,
    siegeSocial: c.siegeSocial,
    villeSiege: c.villeSiege,
    pays: c.pays,
    telephone: c.telephone,
    emailContact: c.emailContact,
    refReglementaireBceao: c.refReglementaireBceao,
    exerciceFiscalLibelle: c.exerciceFiscalLibelle,
    couleurPrimaire: c.couleurPrimaire,
    couleurPrimaireDark: c.couleurPrimaireDark,
    couleurSecondaire: c.couleurSecondaire,
    logoRef: c.logoRef,
    contexteMarche: c.contexteMarche,
    concurrents: c.concurrents,
    positionnement: c.positionnement,
  };
}

function toMembreResponse(
  m: ConfigurationBanqueMembreComite,
): MembreComiteResponseDto {
  return {
    id: String(m.id),
    nomPrenom: m.nomPrenom,
    titre: m.titre,
    fonction: m.fonction,
    ordreAffichage: m.ordreAffichage,
    estActif: m.estActif,
  };
}
