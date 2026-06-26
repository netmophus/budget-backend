/**
 * ExportExcelService (Lot 5.2.B + PR3) — génère un .xlsx à 4 onglets :
 * Synthèse (KPI + bloc compte de résultat PNB/CE/Solde), Détail des
 * écarts (avec colonne % d'exécution + mise en forme conditionnelle
 * « Niveau »), Filtres, et Top performances (sur / sous-performances).
 *
 * Réutilise exceljs (déjà dans le projet depuis Lot 3.7).
 */
import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';

import { EcartsResponseDto, type NiveauAlerte } from '../dto/tableau-bord.dto';

const COULEURS_NIVEAU: Record<NiveauAlerte, string> = {
  NORMAL: 'C6EFCE', // vert clair
  ATTENTION: 'FFEB9C', // orange clair
  CRITIQUE: 'FFC7CE', // rouge clair
  MANQUANT: 'D9D9D9', // gris clair
  SANS_BUDGET: 'FCD5B4', // orange (réalisé sans budget)
};

const NIVEAU_LIBELLE: Record<NiveauAlerte, string> = {
  NORMAL: 'Normal',
  ATTENTION: 'Attention',
  CRITIQUE: 'Critique',
  MANQUANT: 'Manquant',
  SANS_BUDGET: 'Sans budget',
};

@Injectable()
export class ExportExcelService {
  async genererXlsx(
    ecarts: EcartsResponseDto,
    metaCodeVersion: string,
  ): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'MIZNAS';
    wb.created = new Date();

    // ─── Onglet 1 — Synthèse (KPI) ───────────────────────────
    const wsSynth = wb.addWorksheet('Synthèse');
    wsSynth.columns = [
      { header: 'Indicateur', key: 'k', width: 35 },
      { header: 'Valeur', key: 'v', width: 22 },
    ];
    wsSynth.getRow(1).font = { bold: true };
    wsSynth.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'D9D9D9' },
    };

    const k = ecarts.kpi;
    const t = ecarts.totaux;
    const lignesSynth: Array<{ k: string; v: number | string }> = [
      { k: 'Version', v: metaCodeVersion },
      {
        k: 'Période',
        v: `${ecarts.filtres.moisDebut} → ${ecarts.filtres.moisFin}`,
      },
      {
        k: 'Seuil ATTENTION (%)',
        v: ecarts.filtres.seuilEcartPctAttention ?? 5,
      },
      {
        k: 'Seuil CRITIQUE (%)',
        v: ecarts.filtres.seuilEcartPctCritique ?? 10,
      },
      { k: '', v: '' },
      // Compte de résultat (PR3).
      { k: 'PNB Budget (FCFA)', v: t.pnb.budget },
      { k: 'PNB Réalisé (FCFA)', v: t.pnb.realise },
      {
        k: 'Coef. exploitation Budget (%)',
        v: t.coefExploitationBudget ?? '—',
      },
      {
        k: 'Coef. exploitation Réalisé (%)',
        v: t.coefExploitationRealise ?? '—',
      },
      { k: 'Solde Budget (FCFA)', v: t.solde.budget },
      { k: 'Solde Réalisé (FCFA)', v: t.solde.realise },
      { k: '', v: '' },
      { k: 'Nb total écarts', v: k.nbEcartsTotal },
      { k: 'Nb écarts CRITIQUES', v: k.nbEcartsCritique },
      { k: 'Nb écarts ATTENTION', v: k.nbEcartsAttention },
      { k: 'Nb lignes MANQUANTES', v: k.nbLignesManquantes },
      { k: 'Nb lignes SANS BUDGET', v: k.nbSansBudget },
      { k: '', v: '' },
      { k: 'Écart total absolu (FCFA)', v: k.ecartTotalAbs },
      { k: '  dont défavorable (FCFA)', v: k.ecartTotalDefavorable },
      { k: '  dont favorable (FCFA)', v: k.ecartTotalFavorable },
      { k: '', v: '' },
      { k: 'Date de génération', v: new Date().toISOString() },
    ];
    for (const r of lignesSynth) wsSynth.addRow(r);
    // Format milliers sur toutes les lignes monétaires (piloté par le
    // libellé, robuste à l'ordre des lignes).
    lignesSynth.forEach((r, idx) => {
      if (typeof r.v === 'number' && /FCFA/i.test(r.k)) {
        wsSynth.getCell(`B${idx + 2}`).numFmt = '#,##0';
      }
    });

    // ─── Onglet 2 — Détail des écarts ─────────────────────────
    const wsDetail = wb.addWorksheet('Détail des écarts');
    wsDetail.columns = [
      { header: 'CR', key: 'codeCr', width: 16 },
      { header: 'Libellé CR', key: 'libelleCr', width: 28 },
      { header: 'Compte', key: 'codeCompte', width: 12 },
      { header: 'Libellé compte', key: 'libelleCompte', width: 32 },
      { header: 'Classe', key: 'classeCompte', width: 8 },
      { header: 'Nature', key: 'natureCompte', width: 10 },
      { header: 'Ligne métier', key: 'codeLigneMetier', width: 22 },
      { header: 'Mois', key: 'libelleMois', width: 16 },
      { header: 'Budget', key: 'montantBudget', width: 16 },
      { header: 'Réalisé', key: 'montantRealise', width: 16 },
      { header: 'Écart', key: 'ecart', width: 16 },
      { header: 'Écart %', key: 'ecartPct', width: 12 },
      { header: '% exéc.', key: 'tauxExecution', width: 10 },
      { header: 'Niveau', key: 'niveauLibelle', width: 12 },
      { header: 'Sens', key: 'sensEcart', width: 14 },
    ];
    const headerRow = wsDetail.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'D9D9D9' },
    };
    wsDetail.views = [{ state: 'frozen', ySplit: 1 }];

    for (const l of ecarts.lignes) {
      const row = wsDetail.addRow({
        codeCr: l.codeCr,
        libelleCr: l.libelleCr,
        codeCompte: l.codeCompte,
        libelleCompte: l.libelleCompte,
        classeCompte: l.classeCompte,
        natureCompte: l.natureCompte,
        codeLigneMetier: l.codeLigneMetier,
        libelleMois: l.libelleMois,
        montantBudget: l.montantBudget,
        montantRealise: l.montantRealise,
        ecart: l.ecart,
        ecartPct: l.ecartPct === null ? null : l.ecartPct / 100,
        tauxExecution: l.tauxExecution === null ? null : l.tauxExecution / 100,
        niveauLibelle: NIVEAU_LIBELLE[l.niveauAlerte],
        sensEcart: l.sensEcart ?? '—',
      });
      // Formats numériques
      row.getCell('montantBudget').numFmt = '#,##0';
      row.getCell('montantRealise').numFmt = '#,##0';
      row.getCell('ecart').numFmt = '#,##0';
      row.getCell('ecartPct').numFmt = '0.0%';
      row.getCell('tauxExecution').numFmt = '0.0%';
      // Couleur de fond conditionnelle sur la colonne Niveau
      row.getCell('niveauLibelle').fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: COULEURS_NIVEAU[l.niveauAlerte] },
      };
      row.getCell('niveauLibelle').font = { bold: true };
    }

    // ─── Onglet 3 — Filtres ───────────────────────────────────
    const wsFiltres = wb.addWorksheet('Filtres');
    wsFiltres.columns = [
      { header: 'Filtre', key: 'k', width: 30 },
      { header: 'Valeur', key: 'v', width: 50 },
    ];
    wsFiltres.getRow(1).font = { bold: true };
    wsFiltres.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'D9D9D9' },
    };
    const f = ecarts.filtres;
    wsFiltres.addRow({ k: 'Version', v: f.versionId });
    wsFiltres.addRow({ k: 'Scénario', v: f.scenarioId });
    wsFiltres.addRow({
      k: 'CR',
      v: f.crIds && f.crIds.length > 0 ? f.crIds.join(', ') : '(tous)',
    });
    wsFiltres.addRow({
      k: 'Lignes métier',
      v:
        f.ligneMetierIds && f.ligneMetierIds.length > 0
          ? f.ligneMetierIds.join(', ')
          : '(toutes)',
    });
    wsFiltres.addRow({ k: 'Mois début', v: f.moisDebut });
    wsFiltres.addRow({ k: 'Mois fin', v: f.moisFin });
    wsFiltres.addRow({
      k: 'Seuil ATTENTION (%)',
      v: f.seuilEcartPctAttention ?? 5,
    });
    wsFiltres.addRow({
      k: 'Seuil CRITIQUE (%)',
      v: f.seuilEcartPctCritique ?? 10,
    });

    // ─── Onglet 4 — Top performances (sur / sous) (PR3) ───────
    const wsTop = wb.addWorksheet('Top performances');
    wsTop.columns = [
      { header: 'Catégorie', key: 'cat', width: 18 },
      { header: 'CR', key: 'cr', width: 16 },
      { header: 'Compte', key: 'compte', width: 36 },
      { header: 'Mois', key: 'mois', width: 14 },
      { header: 'Écart abs. (FCFA)', key: 'ecartAbs', width: 18 },
      { header: 'Sens', key: 'sens', width: 14 },
    ];
    const topHeader = wsTop.getRow(1);
    topHeader.font = { bold: true };
    topHeader.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'D9D9D9' },
    };
    wsTop.views = [{ state: 'frozen', ySplit: 1 }];

    const topParSens = (sens: 'FAVORABLE' | 'DEFAVORABLE') =>
      ecarts.lignes
        .filter((l) => l.sensEcart === sens && l.ecartAbs !== null)
        .sort((a, b) => (b.ecartAbs ?? 0) - (a.ecartAbs ?? 0))
        .slice(0, 10);

    for (const [cat, sens] of [
      ['Sur-performance', 'FAVORABLE'],
      ['Sous-performance', 'DEFAVORABLE'],
    ] as const) {
      for (const l of topParSens(sens)) {
        const row = wsTop.addRow({
          cat,
          cr: l.codeCr,
          compte: `${l.codeCompte} ${l.libelleCompte}`,
          mois: l.libelleMois,
          ecartAbs: l.ecartAbs,
          sens,
        });
        row.getCell('ecartAbs').numFmt = '#,##0';
      }
    }

    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
  }
}
