/**
 * BankBranding (Lot B2) — vue « rendu » de la configuration banque,
 * consommée par les générateurs PDF/Excel pour débrancher le hardcoding
 * « BSIC NIGER ». Type volontairement placé dans le module feuille
 * `configuration-banque` pour que `reporting`/`tableau-de-bord` en
 * dépendent (et non l'inverse).
 */
export interface BankBranding {
  nom: string;
  sigle: string;
  nomComplet: string;
  adresse: string;
  villeSiege: string;
  pays: string;
  couleurPrimaire: string;
  couleurPrimaireDark: string;
  couleurSecondaire: string;
  logoRef: string | null;
  refReglementaireBceao: string | null;
}

/**
 * Contexte « plat » injecté dans les templates emails Handlebars (Lot B3),
 * exposé sous la clé `bank`. Débranche le hardcoding « BSIC » du layout et
 * met à disposition les infos institutionnelles pour de futurs templates.
 */
export interface BankEmailContext {
  sigle: string;
  nom: string;
  nomComplet: string;
  /** Adresse concaténée : siège, ville, pays (parties vides ignorées). */
  adresseComplete: string;
  groupe: string | null;
  telephone: string | null;
  /** `bank.logoRef` tel quel (chemin/URL), sans traitement. */
  logoRef: string | null;
}

/** Un membre du Comité tel que rendu sur la page Approbations des PDF. */
export interface MembreComitePdf {
  nomPrenom: string;
  titre: string | null;
  fonction: 'PRESIDENT' | 'MEMBRE' | 'SECRETAIRE' | 'DG';
  ordreAffichage: number;
}

/**
 * Valeurs de repli (BSIC NIGER) — utilisées si la configuration n'est pas
 * disponible (seed absent, base indisponible). Garantit la
 * rétrocompatibilité du rendu pendant la transition (Lots B2 → B4).
 */
export const DEFAULT_BANK_BRANDING: BankBranding = {
  nom: 'BSIC NIGER',
  sigle: 'BSIC',
  nomComplet: "Banque Sahélo-Saharienne pour l'Investissement et le Commerce",
  adresse: 'Boulevard de la Liberté, BP 12 080',
  villeSiege: 'Niamey',
  pays: 'Niger',
  couleurPrimaire: '#1B2A4E',
  couleurPrimaireDark: '#0F1B33',
  couleurSecondaire: '#C49B3F',
  logoRef: null,
  refReglementaireBceao: null,
};

/** Membres du Comité de repli (BSIC NIGER). */
export const DEFAULT_MEMBRES_COMITE: MembreComitePdf[] = [
  {
    nomPrenom: 'Souleymane DIORI',
    titre: 'M.',
    fonction: 'PRESIDENT',
    ordreAffichage: 1,
  },
  {
    nomPrenom: 'Halima OUSMANE',
    titre: 'Mme',
    fonction: 'MEMBRE',
    ordreAffichage: 2,
  },
  {
    nomPrenom: 'Ibrahima MAHAMADOU',
    titre: 'M.',
    fonction: 'MEMBRE',
    ordreAffichage: 3,
  },
  {
    nomPrenom: 'Ousmane MAMANE',
    titre: 'M.',
    fonction: 'SECRETAIRE',
    ordreAffichage: 4,
  },
  {
    nomPrenom: 'Issoufou BARRY',
    titre: 'M.',
    fonction: 'DG',
    ordreAffichage: 5,
  },
];
