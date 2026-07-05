/**
 * AnthropicService (Lot 8.6.A) — appel synchrone à l'API Claude
 * d'Anthropic pour produire une analyse markdown du dashboard
 * Budget vs Réalisé.
 *
 * Pipeline :
 *  1. Le caller (TableauBordController) fournit une `EcartsResponseDto`
 *     déjà calculée par AnalyseEcartsService (lecture seule, pas de
 *     duplication SQL).
 *  2. On compresse les données : KPI agrégés + top 20 lignes
 *     CRITIQUE+ATTENTION triées par ecartAbs DESC + agrégation
 *     mensuelle (budget/réalisé/écart par mois). Total ~2-3K tokens.
 *  3. Appel `messages.create()` du SDK avec un prompt système qui
 *     cadre le ton (banque UEMOA, recommandations actionables, FR).
 *  4. Retour : `{ analyse, model, tokensInput, tokensOutput, dureeMs }`.
 *
 * Mode dry-run : `AI_DRY_RUN=true` → réponse mockée déterministe sans
 * appel SDK (cohérent avec EMAIL_DRY_RUN du module Notifications).
 * Permet démos, tests CI sans clé API + sans facturation accidentelle.
 *
 * Gestion d'erreur : on NE PROPAGE JAMAIS le message SDK brut au
 * caller (peut contenir des infos sensibles — endpoint URL, headers).
 * On wrappe en message générique côté caller + log technique côté
 * service (logger Pino, pas exposé au client).
 *
 * Couplage : aucune dépendance à un autre service métier (ni audit
 * ni rate-limiter ici — ils sont câblés en amont par le caller).
 * Service stateless, testable en isolation.
 */
import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  DEFAULT_BANK_BRANDING,
  type BankPromptContext,
} from '../configuration-banque/bank-branding';
import type {
  EcartsResponseDto,
  LigneEcartDto,
} from '../tableau-de-bord/dto/tableau-bord.dto';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
// Lot PDF-V2 — l'analyse IA devient le cœur du rapport (structure riche :
// diagnostic + analyse par écart + signaux faibles + reco + questions Comité).
// On double le budget de sortie pour laisser la place à ce développement.
const DEFAULT_MAX_TOKENS = 4096;
const TOP_LIGNES = 20;

export interface AiAnalyseResult {
  analyse: string;
  model: string;
  tokensInput: number;
  tokensOutput: number;
  dureeMs: number;
  dryRun: boolean;
}

/** Une entrée code+libellé (CR ou ligne métier) pour la structure org. */
export interface CodeLibelle {
  code: string;
  libelle: string;
}

/**
 * Contexte injecté dans le prompt IA (Chantier A) : identité/marché de la
 * banque (config) + structure organisationnelle (CR périmètre + LM globales).
 */
export interface AiPromptContext {
  bank: BankPromptContext;
  centresResponsabilite: CodeLibelle[];
  lignesMetier: CodeLibelle[];
}

/** Repli si le caller ne fournit pas de contexte (BSIC, sans structure). */
const FALLBACK_PROMPT_CONTEXT: AiPromptContext = {
  bank: {
    nom: DEFAULT_BANK_BRANDING.nom,
    sigle: DEFAULT_BANK_BRANDING.sigle,
    nomComplet: DEFAULT_BANK_BRANDING.nomComplet,
    positionnement: null,
    contexteMarche: null,
    concurrents: null,
    groupe: null,
    villeSiege: DEFAULT_BANK_BRANDING.villeSiege,
    pays: DEFAULT_BANK_BRANDING.pays,
    refReglementaireBceao: null,
  },
  centresResponsabilite: [],
  lignesMetier: [],
};

interface ResumeMensuel {
  mois: string;
  libelleMois: string;
  totalBudget: number;
  totalRealise: number;
  totalEcart: number;
}

@Injectable()
export class AnthropicService {
  private readonly logger = new Logger(AnthropicService.name);
  private client?: Anthropic;

  constructor(private readonly config: ConfigService) {}

  private get dryRun(): boolean {
    return this.config.get<string>('AI_DRY_RUN', 'true') !== 'false';
  }

  private get model(): string {
    return this.config.get<string>('ANTHROPIC_MODEL', DEFAULT_MODEL);
  }

  private getClient(): Anthropic {
    if (this.client) return this.client;
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY manquant. Définir la variable dans .env ou activer AI_DRY_RUN=true.',
      );
    }
    this.client = new Anthropic({ apiKey });
    return this.client;
  }

  /**
   * Point d'entrée principal. Reçoit la réponse `EcartsResponseDto`
   * déjà calculée par AnalyseEcartsService et retourne une analyse
   * markdown produite par Claude.
   *
   * Utilise `userEmail` uniquement pour le log technique (pas envoyé
   * au modèle — pas de PII inutile dans le prompt).
   */
  async analyserEcarts(
    ecarts: EcartsResponseDto,
    userEmail: string,
    ctx: AiPromptContext = FALLBACK_PROMPT_CONTEXT,
  ): Promise<AiAnalyseResult> {
    const start = Date.now();
    const prompt = this.construirePrompt(ecarts);
    const systemPrompt = this.construireSystemPrompt(ctx);

    if (this.dryRun) {
      this.logger.log(
        `[AI dry-run] Analyse demandée par ${userEmail} (${String(ecarts.lignes.length)} lignes) — réponse mockée.`,
      );
      return this.reponseMockee(ecarts, start);
    }

    // Check de la clé HORS du try : une absence de clé est un défaut
    // de configuration (responsable déploiement) — pas une erreur SDK.
    // On laisse remonter le message clair pour debug, distinct du
    // wrap 'AI_PROVIDER_ERROR' réservé aux erreurs SDK runtime.
    const client = this.getClient();

    try {
      const response = await client.messages.create({
        model: this.model,
        max_tokens: DEFAULT_MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }],
      });
      const analyseText = response.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { type: 'text'; text: string }).text)
        .join('\n');
      const result: AiAnalyseResult = {
        analyse: analyseText,
        model: response.model,
        tokensInput: response.usage.input_tokens,
        tokensOutput: response.usage.output_tokens,
        dureeMs: Date.now() - start,
        dryRun: false,
      };
      this.logger.log(
        `[AI] Analyse OK pour ${userEmail} — ${String(result.tokensInput)} in + ${String(result.tokensOutput)} out, ${String(result.dureeMs)} ms.`,
      );
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[AI] Échec appel Anthropic pour ${userEmail} : ${msg}`,
      );
      // ⚠️ On ne propage PAS le message SDK brut au caller (sensible).
      // Le caller construira un message générique côté HTTP.
      throw new Error('AI_PROVIDER_ERROR');
    }
  }

  /**
   * Construit le system prompt enrichi (Chantier A). Rôle senior + cadre
   * BCEAO + structure attendue + règles de format sont INVARIANTS ; les
   * sections institutionnelles/marché/positionnement/concurrents/structure
   * org sont injectées dynamiquement et OMISES si vides (arbitrage : pas
   * de « non renseigné »). Public pour permettre les tests.
   */
  construireSystemPrompt(ctx: AiPromptContext): string {
    const b = ctx.bank;
    const parts: string[] = [
      `Tu es MIZNAS AI, controleur de gestion senior avec 15 ans d'experience`,
      `dans le secteur bancaire de l'Union Economique et Monetaire Ouest-`,
      `Africaine (UMOA). Tu conseilles la Direction Generale de ${b.nom}.`,
    ];

    const inst: string[] = [];
    if (b.nomComplet) inst.push(`- Denomination : ${b.nomComplet}`);
    if (b.groupe) inst.push(`- Groupe : ${b.groupe}`);
    inst.push(`- Siege : ${b.villeSiege}, ${b.pays}`);
    if (b.refReglementaireBceao) {
      inst.push(`- Reference reglementaire : ${b.refReglementaireBceao}`);
    }
    parts.push('', 'CONTEXTE INSTITUTIONNEL', ...inst);

    if (b.contexteMarche) {
      parts.push('', 'CONTEXTE DE MARCHE', b.contexteMarche);
    }
    if (b.positionnement) {
      parts.push('', 'POSITIONNEMENT', b.positionnement);
    }
    if (b.concurrents) {
      parts.push('', 'PRINCIPAUX CONCURRENTS', b.concurrents);
    }

    if (ctx.centresResponsabilite.length || ctx.lignesMetier.length) {
      parts.push('', 'STRUCTURE ORGANISATIONNELLE');
      if (ctx.centresResponsabilite.length) {
        parts.push('Centres de responsabilite :');
        parts.push(
          ...ctx.centresResponsabilite.map((c) => `- ${c.code} : ${c.libelle}`),
        );
      }
      if (ctx.lignesMetier.length) {
        parts.push('Lignes metier :');
        parts.push(
          ...ctx.lignesMetier.map((l) => `- ${l.code} : ${l.libelle}`),
        );
      }
    }

    parts.push(
      '',
      BCEAO_BLOCK,
      '',
      ROLE_BLOCK,
      '',
      STRUCTURE_BLOCK,
      '',
      FORMAT_BLOCK,
    );
    return parts.join('\n');
  }

  /**
   * Mock déterministe utilisé en AI_DRY_RUN=true. Reflète la structure
   * de la vraie réponse pour que le frontend / les tests puissent être
   * validés sans clé API.
   */
  private reponseMockee(
    ecarts: EcartsResponseDto,
    start: number,
  ): AiAnalyseResult {
    const nbAtt = ecarts.kpi.nbEcartsAttention;
    const nbCrit = ecarts.kpi.nbEcartsCritique;
    const totalAbs = Math.round(ecarts.kpi.ecartTotalAbs);
    const analyse =
      `## Analyse MIZNAS AI — synthèse (mode dry-run)\n\n` +
      `**Périmètre analysé** : ${String(ecarts.lignes.length)} lignes ` +
      `sur ${ecarts.filtres.moisDebut} → ${ecarts.filtres.moisFin}.\n\n` +
      `### Alertes\n\n` +
      `- 🔴 **${String(nbCrit)} écart(s) CRITIQUE** (≥ 10 %).\n` +
      `- 🟠 **${String(nbAtt)} écart(s) ATTENTION** (≥ 5 %).\n` +
      `- Écart total absolu : **${formatFcfa(totalAbs)} FCFA**.\n\n` +
      `### Recommandations (mock)\n\n` +
      `1. Vérifier les comptes en niveau CRITIQUE en priorité.\n` +
      `2. Croiser avec le détail mensuel pour identifier la saisonnalité.\n` +
      `3. Demander confirmation aux responsables CR concernés.\n\n` +
      `_Cette analyse est mockée (AI_DRY_RUN=true). Pour un appel réel, ` +
      `définir ANTHROPIC_API_KEY et passer AI_DRY_RUN=false._`;
    return {
      analyse,
      model: `${this.model}-mocked`,
      tokensInput: 0,
      tokensOutput: 0,
      dureeMs: Date.now() - start,
      dryRun: true,
    };
  }

  /**
   * Construit le prompt utilisateur envoyé à Claude. Compression
   * des données pour rester dans ~3K tokens même avec 500+ lignes
   * en entrée.
   *
   * Exposé pour les tests (vérifier que les chiffres clés sont
   * bien dans le prompt sans monter le SDK).
   */
  construirePrompt(ecarts: EcartsResponseDto): string {
    const topLignes = this.selectionnerTopLignes(ecarts.lignes);
    const resumeMensuel = this.agregerParMois(ecarts.lignes);
    const lignesJson = topLignes.map((l) => ({
      cr: l.codeCr,
      compte: `${l.codeCompte} ${l.libelleCompte}`,
      mois: l.libelleMois,
      budget: Math.round(l.montantBudget ?? 0),
      realise: l.montantRealise === null ? null : Math.round(l.montantRealise),
      ecartPct: l.ecartPct,
      niveau: l.niveauAlerte,
      sens: l.sensEcart,
    }));
    return [
      `# Données à analyser`,
      ``,
      `## Périmètre`,
      `- Mois début : ${ecarts.filtres.moisDebut}`,
      `- Mois fin : ${ecarts.filtres.moisFin}`,
      `- Version : ${String(ecarts.filtres.versionId)}, scénario : ${String(ecarts.filtres.scenarioId)}`,
      `- Seuils : ATTENTION ≥ ${String(ecarts.filtres.seuilEcartPctAttention ?? 5)} %, CRITIQUE ≥ ${String(ecarts.filtres.seuilEcartPctCritique ?? 10)} %`,
      ``,
      `## KPI globaux`,
      `- Lignes avec écart : ${String(ecarts.kpi.nbEcartsTotal)}`,
      `- Niveau CRITIQUE : ${String(ecarts.kpi.nbEcartsCritique)}`,
      `- Niveau ATTENTION : ${String(ecarts.kpi.nbEcartsAttention)}`,
      `- Lignes manquantes (sans réalisé) : ${String(ecarts.kpi.nbLignesManquantes)}`,
      `- Écart total absolu : ${formatFcfa(Math.round(ecarts.kpi.ecartTotalAbs))} FCFA`,
      `- Dont défavorable : ${formatFcfa(Math.round(ecarts.kpi.ecartTotalDefavorable))} FCFA`,
      `- Dont favorable : ${formatFcfa(Math.round(ecarts.kpi.ecartTotalFavorable))} FCFA`,
      ``,
      `## Top ${String(topLignes.length)} écarts (CRITIQUE + ATTENTION, triés par |écart| DESC)`,
      '```json',
      JSON.stringify(lignesJson, null, 2),
      '```',
      ``,
      `## Évolution mensuelle (budget vs réalisé, agrégés)`,
      '```json',
      JSON.stringify(resumeMensuel, null, 2),
      '```',
      ``,
      `# Consigne`,
      ``,
      `Analyse les donnees ci-dessus et produis ton rapport en respectant`,
      `EXACTEMENT la structure en 6 sections et les regles de format definies`,
      `dans ton prompt systeme (DIAGNOSTIC -> ANALYSE DES ECARTS -> INDICATEURS`,
      `BCEAO -> SIGNAUX FAIBLES -> RECOMMANDATIONS -> QUESTIONS COMITE).`,
      ``,
      `Format ASCII / Latin-1 uniquement, pas d'emojis : utilise [CRITIQUE],`,
      `[ATTENTION], [OK]. Reste factuel : ne specule pas au-dela des chiffres`,
      `fournis, cite les montants (FCFA), pourcentages et codes (compte, CR,`,
      `ligne metier).`,
    ].join('\n');
  }

  private selectionnerTopLignes(lignes: LigneEcartDto[]): LigneEcartDto[] {
    return lignes
      .filter(
        (l) => l.niveauAlerte === 'CRITIQUE' || l.niveauAlerte === 'ATTENTION',
      )
      .filter(
        (l): l is LigneEcartDto & { ecartAbs: number } => l.ecartAbs !== null,
      )
      .sort((a, b) => b.ecartAbs - a.ecartAbs)
      .slice(0, TOP_LIGNES);
  }

  private agregerParMois(lignes: LigneEcartDto[]): ResumeMensuel[] {
    const acc = new Map<string, ResumeMensuel>();
    for (const l of lignes) {
      const existing = acc.get(l.mois);
      const realise = l.montantRealise ?? 0;
      const budget = l.montantBudget ?? 0;
      if (existing) {
        existing.totalBudget += budget;
        existing.totalRealise += realise;
        existing.totalEcart += realise - budget;
      } else {
        acc.set(l.mois, {
          mois: l.mois,
          libelleMois: l.libelleMois,
          totalBudget: Math.round(budget),
          totalRealise: Math.round(realise),
          totalEcart: Math.round(realise - budget),
        });
      }
    }
    return [...acc.values()]
      .map((m) => ({
        ...m,
        totalBudget: Math.round(m.totalBudget),
        totalRealise: Math.round(m.totalRealise),
        totalEcart: Math.round(m.totalEcart),
      }))
      .sort((a, b) => a.mois.localeCompare(b.mois));
  }
}

// ─── Blocs invariants du system prompt (Chantier A) ──────────────────

const BCEAO_BLOCK = [
  'CADRE REGLEMENTAIRE BCEAO (invariant UMOA)',
  'Tu raisonnes dans le cadre prudentiel de la BCEAO / Commission Bancaire',
  'de l UMOA :',
  '- Dispositif de Bale II/III transpose dans l UMOA (fonds propres, ratio de',
  '  solvabilite, ratio de levier, coussins de fonds propres).',
  '- Plan Comptable Bancaire de l UMOA (PCB-UMOA) : classe 6 (charges) et',
  '  classe 7 (produits) pour le compte de resultat.',
  '- Ratios prudentiels clefs : coefficient d exploitation (cible <= 65 %),',
  '  ratio de liquidite, couverture des emplois moyens et longs, division des',
  '  risques.',
  'Tu relies les ecarts budgetaires a leurs implications prudentielles quand',
  'c est pertinent.',
].join('\n');

const ROLE_BLOCK = [
  'TON ROLE',
  'Tu depasses le constat factuel : tu contextualises chaque ecart dans l',
  'activite et le marche de la banque, tu proposes des actions correctrices',
  'precises (proprietaire + echeance), tu anticipes les questions du Comite',
  'Budgetaire et tu detectes les signaux faibles avant qu ils ne deviennent',
  'critiques.',
].join('\n');

const STRUCTURE_BLOCK = [
  'STRUCTURE ATTENDUE DE TA REPONSE',
  '1. DIAGNOSTIC SYNTHETIQUE (10 lignes max) : etat global, tendance, risque.',
  '2. ANALYSE DES ECARTS SIGNIFICATIFS : pour chacun des 3 a 5 plus importants,',
  '   constat chiffre, causes racines probables, action correctrice',
  '   (proprietaire + echeance), risque en cas d inaction.',
  '3. INDICATEURS REGLEMENTAIRES BCEAO : lecture des ratios impactes.',
  '4. SIGNAUX FAIBLES ET TENDANCES : comptes a surveiller, saisonnalite.',
  '5. RECOMMANDATIONS PRIORITAIRES : top 5 ordonnees par impact decroissant.',
  '6. QUESTIONS A TRAITER AU PROCHAIN COMITE : 3 a 5 questions de decision.',
].join('\n');

const FORMAT_BLOCK = [
  'REGLES DE FORMAT (strictes)',
  '- Uniquement caracteres ASCII et Latin-1 standard.',
  '- INTERDIT : emojis, symboles Unicode etendus (fleches, puces, box-drawing).',
  '- Utilise ">=" / "<=" et "->" au lieu des symboles ; "-" ou "*" pour les listes.',
  '- Utilise [CRITIQUE] / [ATTENTION] / [OK] au lieu d emojis de niveau.',
  '- Markdown : "## Titre", "### Sous-titre", "**gras**", tableaux "| col | col |".',
  '- Cite systematiquement les chiffres exacts fournis (FCFA, %, codes compte/CR).',
  '- Francais professionnel, dense, oriente decision.',
].join('\n');

function formatFcfa(montant: number): string {
  return new Intl.NumberFormat('fr-FR', {
    maximumFractionDigits: 0,
  }).format(montant);
}
