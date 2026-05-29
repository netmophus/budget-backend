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

import type {
  EcartsResponseDto,
  LigneEcartDto,
} from '../tableau-de-bord/dto/tableau-bord.dto';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 2048;
const TOP_LIGNES = 20;

export interface AiAnalyseResult {
  analyse: string;
  model: string;
  tokensInput: number;
  tokensOutput: number;
  dureeMs: number;
  dryRun: boolean;
}

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
  ): Promise<AiAnalyseResult> {
    const start = Date.now();
    const prompt = this.construirePrompt(ecarts);

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
        system: SYSTEM_PROMPT,
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
      budget: Math.round(l.montantBudget),
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
      `Produis une analyse markdown structurée :`,
      `1. **Synthèse** en 2-3 phrases (état global, tendance).`,
      `2. **Écarts critiques** : commenter les 3-5 plus importants.`,
      `3. **Tendance mensuelle** : identifier saisonnalité ou rupture.`,
      `4. **Recommandations actionables** : 3 points max, concrètes.`,
      ``,
      `Reste factuel, en français professionnel. Pas de spéculation au-delà des chiffres.`,
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
      if (existing) {
        existing.totalBudget += l.montantBudget;
        existing.totalRealise += realise;
        existing.totalEcart += realise - l.montantBudget;
      } else {
        acc.set(l.mois, {
          mois: l.mois,
          libelleMois: l.libelleMois,
          totalBudget: Math.round(l.montantBudget),
          totalRealise: Math.round(realise),
          totalEcart: Math.round(realise - l.montantBudget),
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

const SYSTEM_PROMPT =
  `Tu es MIZNAS AI, un assistant d'analyse budgétaire pour une banque commerciale ` +
  `de l'Union Économique et Monétaire Ouest-Africaine (UEMOA). Tu réponds toujours ` +
  `en français professionnel, factuel et concis. Tu cites les chiffres exacts ` +
  `fournis (montants en FCFA, %, codes compte/CR). Tu ne spécules pas au-delà ` +
  `des données. Tu structures ta réponse en markdown avec sections claires.`;

function formatFcfa(montant: number): string {
  return new Intl.NumberFormat('fr-FR', {
    maximumFractionDigits: 0,
  }).format(montant);
}
