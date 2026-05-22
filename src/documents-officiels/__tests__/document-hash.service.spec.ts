/**
 * Tests unitaires DocumentHashService (Lot 8.1.B).
 *
 * Hash service = utilitaire pur, pas de dependency injection complexe.
 * Test direct via `new DocumentHashService()`.
 */
import { DocumentHashService } from '../services/document-hash.service';
import type { DocumentVisa } from '../entities/document-visa.entity';

function mockVisa(over: Partial<DocumentVisa>): DocumentVisa {
  return {
    id: 'visa-1',
    fkDocument: 'doc-1',
    fkUserViseur: '23',
    ordreVisa: 1,
    estObligatoire: true,
    libelleFonction: null,
    statut: 'VISE',
    dateDemande: new Date('2026-05-01T09:00:00.000Z'),
    dateAction: new Date('2026-05-01T10:00:00.000Z'),
    commentaire: null,
    ...over,
  } as DocumentVisa;
}

describe('DocumentHashService (Lot 8.1.B)', () => {
  const svc = new DocumentHashService();

  it('hashContenu — normalise whitespace correctement', () => {
    const messy = '<p>  Hello  \n\t  World</p>';
    const clean = '<p> Hello World</p>';
    expect(svc.hashContenu(messy)).toBe(svc.hashContenu(clean));
  });

  it('hashVisas — ordre stable (tri par ordreVisa, peu importe input order)', () => {
    const v1 = mockVisa({ ordreVisa: 1, fkUserViseur: '23' });
    const v2 = mockVisa({ ordreVisa: 2, fkUserViseur: '24' });
    const v3 = mockVisa({ ordreVisa: 3, fkUserViseur: '25' });
    const ascendant = [v1, v2, v3];
    const descendant = [v3, v2, v1];
    expect(svc.hashVisas(ascendant)).toBe(svc.hashVisas(descendant));
  });

  it('hashContenu — deterministe (2 appels mêmes input → même hash)', () => {
    const html = '<p>Lettre de cadrage budgétaire 2026</p>';
    const h1 = svc.hashContenu(html);
    const h2 = svc.hashContenu(html);
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64); // SHA-256 hex = 64 chars
  });

  it('hashVisas — exclut les visas REJETE / EN_ATTENTE / IGNORE', () => {
    const vise = mockVisa({ statut: 'VISE', fkUserViseur: '23' });
    const rejete = mockVisa({ statut: 'REJETE', fkUserViseur: '24' });
    const enAttente = mockVisa({ statut: 'EN_ATTENTE', fkUserViseur: '25' });
    const seulVise = svc.hashVisas([vise]);
    const tousMixtes = svc.hashVisas([vise, rejete, enAttente]);
    expect(seulVise).toBe(tousMixtes);
  });
});
