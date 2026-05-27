/**
 * RealiseTemplateService (Lot 8.5.D) — génère le template XLSX
 * téléchargeable pour aider l'utilisateur à préparer son fichier
 * d'import réalisé.
 *
 * Le template reflète à 100% le format attendu par
 * `RealiseImportService.importFichier` (cf. `HEADER_ORDONNE` et
 * `ligneSchema` dans `realise-import.service.ts`) :
 *
 *   - 6 colonnes obligatoires : code_cr, code_compte,
 *     code_ligne_metier, mois, code_devise, montant
 *   - 2 colonnes optionnelles : mode (MNT/VOL/UNIT, défaut MNT),
 *     commentaire (texte libre)
 *
 * Le workbook a 2 onglets :
 *   - "Donnees" : header stylé + 3 lignes d'exemple plausibles BSIC
 *   - "Notice"  : instructions format (mois, montant, devise, codes)
 *
 * Aucun appel base : le template est statique, pur calcul XLSX en
 * mémoire. Réutilise ExcelJS (déjà dépendance projet via Lot 7.6 /
 * BudgetImport / RealiseImport).
 */
import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';

const HEADER_DONNEES = [
  'code_cr',
  'code_compte',
  'code_ligne_metier',
  'mois',
  'code_devise',
  'montant',
  'mode',
  'commentaire',
] as const;

/**
 * 3 lignes d'exemple plausibles côté BSIC NIGER : compte 641000
 * (Salaires/CR_DARH), 702121 (Produits intérêts/CR_FINANCE), 707210
 * (Engagements garantis/CR_ENGAGEMENT). `mois` au format `YYYY-MM`,
 * `code_devise=XOF`, `mode=MNT` (par défaut), `commentaire` vide.
 * Les codes utilisés sont alignés sur les seeds Phase 5.x / Lot 8.5.A.
 */
const LIGNES_EXEMPLE: ReadonlyArray<ReadonlyArray<string>> = [
  ['CR_DARH', '641000', 'CHANGE', '2026-07', 'XOF', '210000000', 'MNT', ''],
  ['CR_FINANCE', '702121', 'CHANGE', '2026-07', 'XOF', '85000000', 'MNT', ''],
  [
    'CR_ENGAGEMENT',
    '707210',
    'CHANGE',
    '2026-07',
    'XOF',
    '42000000',
    'MNT',
    'Engagements garantis S2',
  ],
];

const NOTICE_LIGNES: ReadonlyArray<string> = [
  'Template d’import du réalisé MIZNAS — BSIC NIGER',
  '',
  'Onglet « Donnees » :',
  '  • Ligne 1 = en-tête. NE PAS la supprimer ni la renommer.',
  '  • Lignes 2+ = vos données réelles (les 3 lignes d’exemple peuvent être effacées).',
  '',
  'Colonnes obligatoires (ordre indifférent, noms exacts) :',
  '  • code_cr           — code du Centre de Responsabilité (ex. CR_DARH).',
  '  • code_compte       — code du compte PCB (ex. 641000).',
  '  • code_ligne_metier — code de la ligne métier (ex. CHANGE, RETAIL).',
  '  • mois              — format YYYY-MM (ex. 2026-07) ou YYYY-MM-DD (ex. 2026-07-01).',
  '  • code_devise       — code ISO devise (ex. XOF pour le Franc CFA).',
  '  • montant           — entier ou décimal positif, sans séparateur de milliers.',
  '                        Virgule ou point accepté comme séparateur décimal.',
  '',
  'Colonnes optionnelles :',
  '  • mode              — MNT (montant FCFA, défaut), VOL (volume), UNIT (unitaire).',
  '  • commentaire       — texte libre, visible dans l’historique de la ligne.',
  '',
  'Comportement à l’import :',
  '  • Ligne nouvelle (clé compte+CR+ligne_metier+mois+devise inédite) → création',
  '    en statut « Importé ». Un admin la validera ensuite via le bouton « Valider ».',
  '  • Ligne déjà en statut « Importé » → mise à jour (montant/mode/commentaire).',
  '  • Ligne déjà en statut « Validé » → ignorée, signalée dans le rapport.',
  '  • CR hors de votre périmètre → ignorée, signalée dans le rapport.',
  '',
  'Astuces pour récupérer les codes valides :',
  '  • Codes CR        : page « Centres de responsabilité » du module Référentiels.',
  '  • Codes compte    : page « Plan comptable » du module Référentiels.',
  '  • Codes l. métier : page « Lignes métier » du module Référentiels.',
  '  • Devise BSIC standard : XOF.',
  '',
  'Limites techniques :',
  '  • Format fichier : .xlsx ou .csv.',
  '  • Taille max : 10 Mo.',
  '  • Encoding CSV : UTF-8 recommandé.',
];

@Injectable()
export class RealiseTemplateService {
  /**
   * Génère le buffer XLSX du template d'import réalisé.
   * Pas d'I/O DB ni filesystem : 100% in-memory ExcelJS.
   */
  async genererTemplateXlsx(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'MIZNAS — BSIC NIGER';
    wb.created = new Date();
    wb.title = 'Template import réalisé';
    wb.subject =
      'Modèle de fichier pour importer le réalisé budgétaire mensuel';
    wb.company = 'BSIC NIGER S.A.';

    // ─── Onglet 1 : Donnees ────────────────────────────────────────
    const wsData = wb.addWorksheet('Donnees');
    wsData.columns = [
      { key: 'code_cr', width: 16 },
      { key: 'code_compte', width: 14 },
      { key: 'code_ligne_metier', width: 18 },
      { key: 'mois', width: 12 },
      { key: 'code_devise', width: 12 },
      { key: 'montant', width: 18 },
      { key: 'mode', width: 8 },
      { key: 'commentaire', width: 40 },
    ];
    const headerRow = wsData.addRow([...HEADER_DONNEES]);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1B2A4E' },
      };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFCBD2D9' } },
        bottom: { style: 'thin', color: { argb: 'FFCBD2D9' } },
        left: { style: 'thin', color: { argb: 'FFCBD2D9' } },
        right: { style: 'thin', color: { argb: 'FFCBD2D9' } },
      };
    });
    headerRow.height = 22;
    for (const ligne of LIGNES_EXEMPLE) {
      wsData.addRow([...ligne]);
    }
    wsData.getColumn('montant').alignment = { horizontal: 'right' };

    // ─── Onglet 2 : Notice ─────────────────────────────────────────
    const wsNotice = wb.addWorksheet('Notice');
    wsNotice.columns = [{ key: 'texte', width: 100 }];
    for (const ligne of NOTICE_LIGNES) {
      const row = wsNotice.addRow([ligne]);
      // Ligne 1 = titre : gras, taille 13.
      if (row.number === 1) {
        row.getCell(1).font = {
          bold: true,
          size: 13,
          color: { argb: 'FF1B2A4E' },
        };
      } else if (ligne.startsWith('Onglet ') || ligne.endsWith(' :')) {
        row.getCell(1).font = { bold: true, size: 11 };
      }
    }

    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(new Uint8Array(buf));
  }

  /** Exposé pour les tests + cohérence avec RealiseImportService. */
  static getHeaderColumns(): readonly string[] {
    return HEADER_DONNEES;
  }
}
