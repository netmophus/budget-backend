/**
 * Smoke test Lot 8.1.A — vérifie que les 5 entités du workflow
 * signature sont importables sans circular dependency et instanciables.
 *
 * **Périmètre limité** (pas de test fonctionnel) : la suite Jest du
 * Lot 8.1.B (service workflow) couvrira la logique métier.
 */
import { CampagneBudgetaire } from './entities/campagne-budgetaire.entity';
import { CampagneComiteMembre } from './entities/campagne-comite-membre.entity';
import { DocumentOfficiel } from './entities/document-officiel.entity';
import { DocumentSignature } from './entities/document-signature.entity';
import { DocumentVisa } from './entities/document-visa.entity';

describe('Lot 8.1.A — Entités documents officiels', () => {
  it('CampagneBudgetaire instanciable', () => {
    const c = new CampagneBudgetaire();
    expect(c).toBeDefined();
  });

  it('CampagneComiteMembre instanciable', () => {
    const m = new CampagneComiteMembre();
    expect(m).toBeDefined();
  });

  it('DocumentOfficiel instanciable', () => {
    const d = new DocumentOfficiel();
    expect(d).toBeDefined();
  });

  it('DocumentVisa instanciable', () => {
    const v = new DocumentVisa();
    expect(v).toBeDefined();
  });

  it('DocumentSignature instanciable', () => {
    const s = new DocumentSignature();
    expect(s).toBeDefined();
  });
});
