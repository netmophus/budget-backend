/**
 * Tests unitaires R04BudgetBceaoService (Lot 7.6 — Palier 4).
 *
 * Mock léger de DataSource via jest.fn() qui dispatche selon le SQL.
 * Pas de pg-mem (le service ne fait que des raw queries, pas d'ORM).
 *
 * Couvre :
 *   - 404 NotFoundException si versionId inexistant
 *   - 409 ConflictException si statut != 'gele'
 *   - PDF : buffer non vide + magic %PDF
 *   - XLSX : buffer non vide + magic ZIP (PK\x03\x04)
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import type { DataSource } from 'typeorm';

import { ConfigurationBanqueService } from '../../configuration-banque/configuration-banque.service';
import { DEFAULT_BANK_BRANDING } from '../../configuration-banque/bank-branding';
import { ExcelBuilderService } from '../generators/excel-builder.service';
import { PdfBuilderService } from '../generators/pdf-builder.service';
import {
  R04BudgetBceaoService,
  type R04VersionMetadata,
} from './r04-budget-bceao.service';

interface MockTotaux {
  nb_lignes: string;
  nb_comptes: string;
  nb_cr: string;
  total_produits: string;
  total_charges: string;
}

interface MockResults {
  version: R04VersionMetadata | null;
  totaux?: MockTotaux;
  ventilationCr?: Array<Record<string, string>>;
  detailComptes?: Array<Record<string, string | null>>;
  compteResultat?: Array<Record<string, string>>;
  auditTrail?: Array<Record<string, string | null>>;
}

/**
 * Mock DataSource qui dispatche `query()` selon le SQL fourni. Chaque
 * test passe son objet `MockResults` et le helper le branche.
 */
function makeMockDataSource(results: MockResults): {
  dataSource: DataSource;
  querySpy: jest.Mock;
} {
  // L'ordre des conditions est CRITIQUE : du plus spécifique (clause
  // GROUP BY / JOIN distinctive) au plus générique (la query totaux
  // n'a pas de GROUP BY donc on la teste en dernier).
  const querySpy = jest.fn((sql: string) => {
    if (sql.includes('FROM dim_version')) {
      return Promise.resolve(results.version ? [results.version] : []);
    }
    if (sql.includes('FROM audit_log')) {
      return Promise.resolve(results.auditTrail ?? []);
    }
    if (sql.includes('SUBSTRING(c.code_compte')) {
      return Promise.resolve(results.compteResultat ?? []);
    }
    if (sql.includes('GROUP BY cr.id')) {
      return Promise.resolve(results.ventilationCr ?? []);
    }
    if (sql.includes('GROUP BY c.id, c.code_compte')) {
      return Promise.resolve(results.detailComptes ?? []);
    }
    if (sql.includes('COUNT(*) AS nb_lignes')) {
      // Doit rester en dernier : Query 2 (totaux) n'a pas de GROUP BY.
      return Promise.resolve([results.totaux ?? mockEmptyTotaux()]);
    }
    throw new Error(`Unmocked SQL : ${sql.substring(0, 80)}`);
  });
  const dataSource = { query: querySpy } as unknown as DataSource;
  return { dataSource, querySpy };
}

function mockEmptyTotaux(): MockTotaux {
  return {
    nb_lignes: '0',
    nb_comptes: '0',
    nb_cr: '0',
    total_produits: '0',
    total_charges: '0',
  };
}

function mockGeleVersion(
  overrides: Partial<R04VersionMetadata> = {},
): R04VersionMetadata {
  return {
    id: '42',
    code_version: 'BUDGET_2026_v1.0',
    libelle: 'Budget initial 2026',
    type_version: 'budget_initial',
    exercice_fiscal: 2026,
    statut: 'gele',
    date_soumission: '2026-05-20T15:26:00.000Z',
    utilisateur_soumission: 'finance@bsic.ne',
    commentaire_soumission: 'Soumission de BUDGET_2026_v1.0.',
    date_validation: '2026-05-20T16:55:00.000Z',
    utilisateur_validation: 'pdt.ca@bsic.ne',
    commentaire_validation: 'Validation OK.',
    date_gel: '2026-05-20T17:09:00.000Z',
    utilisateur_gel: 'dg@bsic.ne',
    commentaire_publication: 'Publication (gel) — action irréversible.',
    // Lot 7.6.bis fix #4 — noms complets résolus par LEFT JOIN "user".
    nom_soumetteur: 'Ousmane MAMANE',
    nom_validateur: 'Yacouba HAROUNA',
    nom_publicateur: 'Issoufou BARRY',
    ...overrides,
  };
}

describe('R04BudgetBceaoService', () => {
  let service: R04BudgetBceaoService;
  let querySpy: jest.Mock;

  async function bootstrap(results: MockResults): Promise<void> {
    const { dataSource, querySpy: spy } = makeMockDataSource(results);
    querySpy = spy;
    const moduleRef = await Test.createTestingModule({
      providers: [
        R04BudgetBceaoService,
        PdfBuilderService,
        ExcelBuilderService,
        { provide: getDataSourceToken(), useValue: dataSource },
        {
          provide: ConfigurationBanqueService,
          useValue: {
            getBankBranding: () => Promise.resolve(DEFAULT_BANK_BRANDING),
          },
        },
      ],
    }).compile();
    service = moduleRef.get(R04BudgetBceaoService);
  }

  it('throw 404 NotFoundException si versionId inexistant', async () => {
    await bootstrap({ version: null });
    await expect(service.extractDonnees('999')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(querySpy).toHaveBeenCalledWith(
      expect.stringContaining('FROM dim_version'),
      ['999'],
    );
  });

  it("throw 409 ConflictException si statut != 'gele'", async () => {
    await bootstrap({ version: mockGeleVersion({ statut: 'valide' }) });
    await expect(service.extractDonnees('42')).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(service.extractDonnees('42')).rejects.toThrow(
      /publiées \(gelées\)/i,
    );
  });

  it('extractDonnees() agrège les 6 queries en parallèle après validation', async () => {
    await bootstrap({
      version: mockGeleVersion(),
      totaux: {
        nb_lignes: '1080',
        nb_comptes: '30',
        nb_cr: '17',
        total_produits: '7906000000',
        total_charges: '11587000000',
      },
      ventilationCr: [
        {
          id: '100',
          code_cr: 'CR_DG',
          libelle: 'Direction Générale',
          type_cr: 'cdc',
          produits: '0',
          charges: '500000000',
          nb_comptes: '5',
          nb_lignes: '60',
        },
      ],
      compteResultat: [
        { classe: '7', sous_classe: '71', montant: '7900000000' },
        { classe: '6', sous_classe: '64', montant: '8000000000' },
      ],
      detailComptes: [
        {
          id: '500',
          code_compte: '611100',
          libelle: 'Salaires',
          classe: '6',
          sens: 'D',
          montant_total: '8000000000',
          nb_lignes: '60',
        },
      ],
      auditTrail: [
        {
          id: '117',
          date_action: '2026-05-20T17:09:00.000Z',
          utilisateur: 'dg@bsic.ne',
          type_action: 'PUBLIER_BUDGET',
          commentaire: 'Publication (gel) — action irréversible.',
        },
      ],
    });

    const d = await service.extractDonnees('42');
    expect(d.version.statut).toBe('gele');
    expect(d.totaux.nb_cr).toBe(17);
    expect(d.totaux.total_produits).toBe(7_906_000_000);
    expect(d.ventilationCr).toHaveLength(1);
    expect(d.ventilationCr[0].code_cr).toBe('CR_DG');
    expect(d.detailComptes).toHaveLength(1);
    expect(d.auditTrail).toHaveLength(1);
    expect(d.auditTrail[0].type_action).toBe('PUBLIER_BUDGET');
  });

  it('audit trail : filtre cycle courant via date_soumission', async () => {
    await bootstrap({ version: mockGeleVersion() });
    await service.extractDonnees('42');
    // La requête audit_log doit être appelée avec versionId + dateRef.
    const auditCall = querySpy.mock.calls.find((c) =>
      String(c[0]).includes('FROM audit_log'),
    );
    expect(auditCall).toBeDefined();
    expect(auditCall![1]).toEqual(['42', '2026-05-20T15:26:00.000Z']);
  });

  it('PDF : génère un buffer non vide commençant par %PDF', async () => {
    await bootstrap({ version: mockGeleVersion() });
    const buffer = await service.genererPdfBuffer('42');
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(1000);
    // Magic number PDF : %PDF
    expect(buffer.subarray(0, 4).toString('utf8')).toBe('%PDF');
  });

  it('XLSX : génère un buffer non vide ZIP (magic PK\\x03\\x04)', async () => {
    await bootstrap({
      version: mockGeleVersion(),
      ventilationCr: [
        {
          id: '100',
          code_cr: 'CR_AG',
          libelle: 'Agence',
          type_cr: 'cdr',
          produits: '1000000',
          charges: '500000',
          nb_comptes: '3',
          nb_lignes: '12',
        },
      ],
      detailComptes: [
        {
          id: '500',
          code_compte: '700100',
          libelle: 'Intérêts',
          classe: '7',
          sens: 'C',
          montant_total: '1000000',
          nb_lignes: '12',
        },
      ],
    });
    const buffer = await service.genererXlsxBuffer('42');
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(500);
    // Magic number XLSX (zip) : PK\x03\x04
    expect(buffer[0]).toBe(0x50); // P
    expect(buffer[1]).toBe(0x4b); // K
    expect(buffer[2]).toBe(0x03);
    expect(buffer[3]).toBe(0x04);
  });

  // ─── Lot 7.6.bis Palier 4 — anti-régression pagination drawTable ─

  it('PDF : pagination raisonnable (8 < pages < 20) avec 35 comptes', async () => {
    // Reproduit la condition du bug défaut B : un tableau "détail
    // comptes" assez large pour forcer drawTable à paginer plusieurs
    // fois. Avant le fix, ce dataset générait ~197 pages.
    const detailComptes = Array.from({ length: 35 }, (_, i) => ({
      id: String(500 + i),
      code_compte: `7${String(i).padStart(5, '0')}`,
      libelle: `Compte test ${i} — libellé long pour stresser le wrap`,
      classe: i < 20 ? '7' : '6',
      sens: i % 2 === 0 ? 'C' : 'D',
      montant_total: String(1_000_000 * (i + 1)),
      nb_lignes: '12',
    }));
    await bootstrap({
      version: mockGeleVersion(),
      detailComptes,
    });

    const buffer = await service.genererPdfBuffer('42');
    // Compte des pages : un PDF a un objet `/Type /Page` (singulier)
    // par page + un `/Type /Pages` (pluriel) en racine. La regex
    // `/Type\s*\/Page\s` matche uniquement les pages individuelles.
    const text = buffer.toString('latin1');
    const pageCount = (text.match(/\/Type\s*\/Page\s/g) ?? []).length;

    // Avant le fix Palier 4 : ~197. Après : ~12-14 pages selon
    // pagination réelle. Marge ample pour absorber l'évolution future.
    expect(pageCount).toBeGreaterThan(8);
    expect(pageCount).toBeLessThan(20);
  });
});
