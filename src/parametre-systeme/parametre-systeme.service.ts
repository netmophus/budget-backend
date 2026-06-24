import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { ParametreSysteme } from './entities/parametre-systeme.entity';
import {
  CLE_MODE_SAISIE_REALISE,
  MODES_SAISIE_REALISE,
  MODE_SAISIE_REALISE_DEFAUT,
  type ModeSaisieRealise,
} from './parametre-systeme.constants';

/**
 * ParametreSystemeService — lecture/écriture du paramétrage global
 * (table `parametre_systeme`). Toute écriture est tracée par un audit
 * `MODIFIER_PARAMETRE_SYSTEME` dans la même transaction (cohérence
 * réglementaire : si l'audit échoue, l'update est rollback).
 */
@Injectable()
export class ParametreSystemeService {
  constructor(
    @InjectRepository(ParametreSysteme)
    private readonly repo: Repository<ParametreSysteme>,
    private readonly auditService: AuditService,
  ) {}

  /** Valeur brute d'un paramètre, ou `defaut` si absent. */
  async getValeur(cle: string, defaut: string): Promise<string> {
    const row = await this.repo.findOne({ where: { cle } });
    return row?.valeur ?? defaut;
  }

  /**
   * Mode de saisie du réalisé courant. Tolérant : toute valeur inconnue
   * (corruption, paramètre absent) retombe sur le défaut CENTRALISE.
   */
  async getModeSaisieRealise(): Promise<ModeSaisieRealise> {
    const valeur = await this.getValeur(
      CLE_MODE_SAISIE_REALISE,
      MODE_SAISIE_REALISE_DEFAUT,
    );
    return MODES_SAISIE_REALISE.includes(valeur as ModeSaisieRealise)
      ? (valeur as ModeSaisieRealise)
      : MODE_SAISIE_REALISE_DEFAUT;
  }

  /** Modifie le mode de saisie du réalisé (audit + transaction). */
  async setModeSaisieRealise(
    mode: ModeSaisieRealise,
    user: AuthUser,
  ): Promise<ModeSaisieRealise> {
    await this.setValeur(CLE_MODE_SAISIE_REALISE, mode, user);
    return mode;
  }

  /**
   * Écrit la valeur d'un paramètre existant + audit transactionnel.
   * Le paramètre doit avoir été créé (par migration/seed) — on ne crée
   * pas de clé arbitraire à la volée.
   */
  async setValeur(
    cle: string,
    valeur: string,
    user: AuthUser,
  ): Promise<ParametreSysteme> {
    const existant = await this.repo.findOne({ where: { cle } });
    if (!existant) {
      throw new NotFoundException(`Paramètre système '${cle}' introuvable.`);
    }
    const valeurAvant = existant.valeur;

    return this.repo.manager.transaction(async (tx) => {
      const repo = tx.getRepository(ParametreSysteme);
      existant.valeur = valeur;
      existant.dateModification = new Date();
      existant.utilisateurModification = user.email;
      const saved = await repo.save(existant);

      await this.auditService.log(
        {
          utilisateur: user.email,
          typeAction: 'MODIFIER_PARAMETRE_SYSTEME',
          entiteCible: 'parametre_systeme',
          idCible: String(saved.id),
          payloadAvant: { cle, valeur: valeurAvant },
          payloadApres: { cle, valeur },
          statut: 'success',
          commentaire: `Paramètre '${cle}' : '${valeurAvant}' → '${valeur}'.`,
        },
        tx,
      );
      return saved;
    });
  }
}
