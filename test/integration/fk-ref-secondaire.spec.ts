/**
 * Smoke test des 13 migrations Lot 2.5-bis-B (FK ref_*).
 *
 * Vérifie :
 *  - Les 13 fichiers existent et exportent bien une classe avec
 *    le bon `name`.
 *  - Les méthodes `up` et `down` sont définies.
 *  - L'ordre des timestamps est croissant (>= 1779100000010).
 *
 * Le refus FK réel (INSERT valeur inexistante / DELETE valeur
 * référencée) est :
 *  - Garanti par PostgreSQL en prod via les contraintes ADD FOREIGN
 *    KEY ... ON DELETE RESTRICT (cf. migrations).
 *  - Garanti applicativement par `BaseRefSecondaireService.softDelete`
 *    + `isReferenced(code)` testé en Lot 2.5-bis-A
 *    (referentiels-secondaires.e2e.spec.ts — DELETE 409 sur valeur
 *    référencée).
 *  - Non testable en pg-mem car l'option A (entité varchar simple,
 *    sans @ManyToOne) n'expose pas la FK à TypeORM `synchronize`.
 *    Le test psql en recette est le complément.
 */
import { AddFkAuditLogTypeAction1779100000130 } from './1779100000130-AddFkAuditLogTypeAction';
import { AddFkDimCompteClasse1779100000050 } from './1779100000050-AddFkDimCompteClasse';
import { AddFkDimCompteSens1779100000040 } from './1779100000040-AddFkDimCompteSens';
import { AddFkDimCrTypeCr1779100000030 } from './1779100000030-AddFkDimCrTypeCr';
import { AddFkDimProduitTypeProduit1779100000060 } from './1779100000060-AddFkDimProduitTypeProduit';
import { AddFkDimScenarioStatut1779100000110 } from './1779100000110-AddFkDimScenarioStatut';
import { AddFkDimScenarioTypeScenario1779100000100 } from './1779100000100-AddFkDimScenarioTypeScenario';
import { AddFkDimSegmentCategorie1779100000070 } from './1779100000070-AddFkDimSegmentCategorie';
import { AddFkDimStructureCodePays1779100000020 } from './1779100000020-AddFkDimStructureCodePays';
import { AddFkDimStructureTypeStructure1779100000010 } from './1779100000010-AddFkDimStructureTypeStructure';
import { AddFkDimVersionStatut1779100000090 } from './1779100000090-AddFkDimVersionStatut';
import { AddFkDimVersionTypeVersion1779100000080 } from './1779100000080-AddFkDimVersionTypeVersion';
import { AddFkRefTauxChangeTypeTaux1779100000120 } from './1779100000120-AddFkRefTauxChangeTypeTaux';

describe('Migrations FK ref_* (Lot 2.5-bis-B)', () => {
  const MIGRATIONS = [
    {
      cls: AddFkDimStructureTypeStructure1779100000010,
      name: 'AddFkDimStructureTypeStructure1779100000010',
    },
    {
      cls: AddFkDimStructureCodePays1779100000020,
      name: 'AddFkDimStructureCodePays1779100000020',
    },
    {
      cls: AddFkDimCrTypeCr1779100000030,
      name: 'AddFkDimCrTypeCr1779100000030',
    },
    {
      cls: AddFkDimCompteSens1779100000040,
      name: 'AddFkDimCompteSens1779100000040',
    },
    {
      cls: AddFkDimCompteClasse1779100000050,
      name: 'AddFkDimCompteClasse1779100000050',
    },
    {
      cls: AddFkDimProduitTypeProduit1779100000060,
      name: 'AddFkDimProduitTypeProduit1779100000060',
    },
    {
      cls: AddFkDimSegmentCategorie1779100000070,
      name: 'AddFkDimSegmentCategorie1779100000070',
    },
    {
      cls: AddFkDimVersionTypeVersion1779100000080,
      name: 'AddFkDimVersionTypeVersion1779100000080',
    },
    {
      cls: AddFkDimVersionStatut1779100000090,
      name: 'AddFkDimVersionStatut1779100000090',
    },
    {
      cls: AddFkDimScenarioTypeScenario1779100000100,
      name: 'AddFkDimScenarioTypeScenario1779100000100',
    },
    {
      cls: AddFkDimScenarioStatut1779100000110,
      name: 'AddFkDimScenarioStatut1779100000110',
    },
    {
      cls: AddFkRefTauxChangeTypeTaux1779100000120,
      name: 'AddFkRefTauxChangeTypeTaux1779100000120',
    },
    {
      cls: AddFkAuditLogTypeAction1779100000130,
      name: 'AddFkAuditLogTypeAction1779100000130',
    },
  ];

  it('expose 13 migrations dans l\'ordre croissant des timestamps', () => {
    expect(MIGRATIONS).toHaveLength(13);
    const timestamps = MIGRATIONS.map((m) => {
      const match = m.name.match(/(\d{13})$/);
      return match ? Number(match[1]) : 0;
    });
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThan(timestamps[i - 1]!);
    }
    expect(timestamps[0]).toBeGreaterThanOrEqual(1779100000010);
  });

  it.each(MIGRATIONS)(
    'migration $name expose name + up + down',
    ({ cls, name }) => {
      const instance = new cls();
      expect(instance.name).toBe(name);
      expect(typeof instance.up).toBe('function');
      expect(typeof instance.down).toBe('function');
    },
  );
});
