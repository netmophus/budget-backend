/**
 * Tests rendu Handlebars (Lot 4.3) — vérifie que chaque template
 * produit un HTML cohérent avec les variables typiques + ne
 * contient ni placeholder cassé ({{undefined}}) ni reste de syntaxe
 * Handlebars ({{).
 *
 * On instancie NotificationsService avec des dépendances factices
 * juste pour appeler `rendreTemplate()` (méthode publique pure).
 */
import { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';

import type { PermissionsService } from '../auth/permissions.service';
import type { User } from '../users/entities/user.entity';
import type { EmailLog } from './entities/email-log.entity';
import { NotificationsService } from './notifications.service';

const VARS_BASE = {
  destinataire: { prenom: 'Aïcha', nom: 'Diallo', email: 'a@miznas.local' },
  app_base_url: 'http://localhost:5173',
  annee: 2026,
};

function makeService(): NotificationsService {
  const cfg = {
    get: (_k: string, def?: string) => def ?? '',
  } as unknown as ConfigService;
  return new NotificationsService(
    {} as Repository<EmailLog>,
    {} as Repository<User>,
    cfg,
    {} as PermissionsService,
  );
}

function expectValide(html: string): void {
  expect(html).toContain('<!DOCTYPE html>');
  expect(html).toContain('MIZNAS');
  expect(html).not.toMatch(/\{\{[^}]+\}\}/);
  expect(html).not.toContain('undefined');
}

describe('Templates Handlebars (Lot 4.3)', () => {
  const service = makeService();

  it('budget-soumis : affiche codeVersion + auteur + lien', () => {
    const html = service.rendreTemplate('budget-soumis', {
      ...VARS_BASE,
      codeVersion: 'BI_2027',
      auteurEmail: 'preparateur@miznas.local',
      commentaire: 'Prêt pour validation.',
      lien_action: '/budget/versions',
    });
    expectValide(html);
    expect(html).toContain('BI_2027');
    expect(html).toContain('preparateur@miznas.local');
    expect(html).toContain('Prêt pour validation');
    expect(html).toContain('/budget/versions');
  });

  it('budget-valide : confirmation de validation + lien', () => {
    const html = service.rendreTemplate('budget-valide', {
      ...VARS_BASE,
      codeVersion: 'BI_2027',
      auteurEmail: 'controleur@miznas.local',
      commentaire: 'Cohérent.',
      lien_action: '/budget/versions',
    });
    expectValide(html);
    expect(html).toContain('validée');
    expect(html).toContain('controleur@miznas.local');
  });

  it('budget-rejete : affiche le motif de rejet en évidence', () => {
    const html = service.rendreTemplate('budget-rejete', {
      ...VARS_BASE,
      codeVersion: 'BI_2027',
      auteurEmail: 'controleur@miznas.local',
      commentaire: 'Frais d\'exploitation surévalués sur Q3.',
      lien_action: '/budget/versions',
    });
    expectValide(html);
    expect(html).toContain('rejetée');
    expect(html).toContain('Frais d&#x27;exploitation surévalués sur Q3');
  });

  it('budget-publie : mention immuabilité BCEAO 10 ans', () => {
    const html = service.rendreTemplate('budget-publie', {
      ...VARS_BASE,
      codeVersion: 'BI_2027',
      auteurEmail: 'directeur@miznas.local',
      commentaire: 'Officiel.',
      lien_action: '/budget/versions',
    });
    expectValide(html);
    expect(html).toContain('publiée');
    expect(html).toContain('immuable');
    expect(html).toContain('10 ans');
  });

  it('delegation-recue : permissions, période, motif, anti-chaînage', () => {
    const html = service.rendreTemplate('delegation-recue', {
      ...VARS_BASE,
      delegationId: '42',
      permissions: ['SAISIE', 'VALIDATION'],
      dateDebut: '2027-01-01',
      dateFin: '2027-01-31',
      motif: 'Mission BCEAO Niamey',
      lien_action: '/mes-delegations',
    });
    expectValide(html);
    expect(html).toContain('SAISIE');
    expect(html).toContain('VALIDATION');
    expect(html).toContain('2027-01-01');
    expect(html).toContain('Mission BCEAO Niamey');
    expect(html).toContain('Anti-chaînage');
  });

  it('delegation-expiree : libellé "expiré automatiquement"', () => {
    const html = service.rendreTemplate('delegation-expiree', {
      ...VARS_BASE,
      delegationId: '42',
      permissions: ['VALIDATION'],
      dateDebut: '2027-01-01',
      dateFin: '2027-01-31',
      lien_action: '/mes-delegations',
    });
    expectValide(html);
    expect(html).toContain('expiré');
    expect(html).toContain('automatiquement');
  });

  it('delegation-revoquee : motif de révocation visible', () => {
    const html = service.rendreTemplate('delegation-revoquee', {
      ...VARS_BASE,
      delegationId: '42',
      permissions: ['VALIDATION'],
      dateDebut: '2027-01-01',
      dateFin: '2027-01-31',
      motif: 'Mission BCEAO',
      motifRevocation: 'Retour anticipé.',
      lien_action: '/mes-delegations',
    });
    expectValide(html);
    expect(html).toContain('révoquée');
    expect(html).toContain('Retour anticipé');
  });

  it('affectation-creee : type cible + date + motif', () => {
    const html = service.rendreTemplate('affectation-creee', {
      ...VARS_BASE,
      affectationId: '99',
      cibleType: 'CR',
      cibleId: '12',
      cibleCrIds: null,
      dateDebut: '2027-01-15',
      motif: 'Renfort pôle BSIC Mali',
      lien_action: '/profile',
    });
    expectValide(html);
    expect(html).toContain('CR');
    expect(html).toContain('Renfort pôle BSIC Mali');
    expect(html).toContain('2027-01-15');
  });

  it('layout : pied de page institutionnel + désinscription mentionnée', () => {
    const html = service.rendreTemplate('budget-soumis', {
      ...VARS_BASE,
      codeVersion: 'X',
      auteurEmail: 'y@m.io',
      lien_action: '/budget/versions',
    });
    expect(html).toContain('automatiquement par MIZNAS');
    expect(html).toContain('préférences');
    expect(html).toContain('© 2026');
  });
});
