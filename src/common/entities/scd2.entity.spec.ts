/**
 * `Scd2Entity` est une classe abstraite de **mixin** : elle ne porte
 * pas de PK ni de business key et n'est jamais instanciée directement.
 * Sa responsabilité est la déclaration des 8 colonnes SCD2 + audit
 * via les decorators TypeORM.
 *
 * Tester son comportement runtime (instancier, appeler des méthodes)
 * serait artificiel — on inspecte donc uniquement les metadata
 * TypeORM pour vérifier que les colonnes sont déclarées avec les
 * bons noms, types, défauts et contraintes de nullité.
 *
 * Les comportements liés aux colonnes (transitions de version,
 * historisation) sont testés sur `Scd2Service` (cf.
 * `services/scd2.service.spec.ts`).
 */
import { getMetadataArgsStorage } from 'typeorm';

import { Scd2Entity } from './scd2.entity';

describe('Scd2Entity', () => {
  const columns = getMetadataArgsStorage().columns.filter(
    (c) => c.target === Scd2Entity,
  );

  it('declares the 8 SCD2 + audit columns', () => {
    const names = columns.map((c) => c.options.name).sort();
    expect(names).toEqual([
      'date_creation',
      'date_debut_validite',
      'date_fin_validite',
      'date_modification',
      'est_actif',
      'utilisateur_creation',
      'utilisateur_modification',
      'version_courante',
    ]);
  });

  it('uses booleans defaulting to true for version_courante and est_actif', () => {
    const versionCourante = columns.find(
      (c) => c.options.name === 'version_courante',
    );
    const estActif = columns.find((c) => c.options.name === 'est_actif');
    expect(versionCourante?.options.type).toBe('boolean');
    expect(versionCourante?.options.default).toBe(true);
    expect(estActif?.options.type).toBe('boolean');
    expect(estActif?.options.default).toBe(true);
  });

  it('uses date type for validity boundaries (debut not nullable, fin nullable)', () => {
    const debut = columns.find((c) => c.options.name === 'date_debut_validite');
    const fin = columns.find((c) => c.options.name === 'date_fin_validite');
    expect(debut?.options.type).toBe('date');
    expect(debut?.options.nullable).toBeFalsy();
    expect(fin?.options.type).toBe('date');
    expect(fin?.options.nullable).toBe(true);
  });

  it('defaults date_creation to CURRENT_TIMESTAMP', () => {
    const dc = columns.find((c) => c.options.name === 'date_creation');
    expect(dc?.options.type).toBe('timestamp');
    const def = dc?.options.default;
    const evaluated = typeof def === 'function' ? def() : def;
    expect(evaluated).toBe('CURRENT_TIMESTAMP');
  });

  it('defaults utilisateur_creation to "system" with length 255', () => {
    const uc = columns.find((c) => c.options.name === 'utilisateur_creation');
    expect(uc?.options.type).toBe('varchar');
    expect(uc?.options.length).toBe(255);
    expect(uc?.options.default).toBe('system');
  });

  it('marks date_modification and utilisateur_modification as nullable', () => {
    const dm = columns.find((c) => c.options.name === 'date_modification');
    const um = columns.find(
      (c) => c.options.name === 'utilisateur_modification',
    );
    expect(dm?.options.nullable).toBe(true);
    expect(um?.options.nullable).toBe(true);
  });
});
