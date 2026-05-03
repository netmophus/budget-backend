import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { Auditable } from '../../audit/decorators/auditable.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { PerimetreService } from '../../budget/services/perimetre.service';
import { CreateFaitBudgetFromBusinessKeysDto } from './dto/create-fait-budget-from-business-keys.dto';
import { CreateFaitBudgetDto } from './dto/create-fait-budget.dto';
import { FaitBudgetFromBusinessKeysResponseDto } from './dto/fait-budget-from-business-keys-response.dto';
import { FaitBudgetResponseDto } from './dto/fait-budget-response.dto';
import { ListFaitBudgetQueryDto } from './dto/list-fait-budget-query.dto';
import { PaginatedFaitBudgetDto } from './dto/paginated-fait-budget.dto';
import { ParGrainQueryDto } from './dto/par-grain-query.dto';
import { UpdateFaitBudgetDto } from './dto/update-fait-budget.dto';
import { FaitBudgetService } from './fait-budget.service';

@ApiTags('faits-budget')
@ApiBearerAuth()
@Controller('faits/budget')
export class FaitBudgetController {
  constructor(
    private readonly service: FaitBudgetService,
    private readonly perimetreService: PerimetreService,
  ) {}

  /**
   * Helper privé : 403 si fkCentre n'est pas dans le périmètre du user
   * (sauf admin global, où crAutorises === null).
   */
  private async assertCrAutorise(
    fkCentre: string,
    userId: string,
  ): Promise<void> {
    const crs = await this.perimetreService.getCrAutorisesPourUser(userId);
    if (crs === null) return;
    if (!crs.includes(String(fkCentre))) {
      throw new ForbiddenException(
        `Vous n'avez pas accès au centre de responsabilité ${fkCentre} ` +
          `(filtrage périmètre Q5).`,
      );
    }
  }

  @Get()
  @RequirePermissions('BUDGET.LIRE')
  @ApiOperation({
    summary:
      'Liste paginée des faits budget (filtres : fkVersion / fkScenario / fkTemps / fkCentre / fkCompte / codeVersion / codeScenario / annee / mois). Filtré par périmètre RBAC du user (Q5).',
  })
  @ApiOkResponse({ type: PaginatedFaitBudgetDto })
  async findAll(
    @Query() query: ListFaitBudgetQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<PaginatedFaitBudgetDto> {
    const crAutorises = await this.perimetreService.getCrAutorisesPourUser(
      user.userId,
    );
    return this.service.findAll(query, crAutorises);
  }

  @Get('par-grain')
  @RequirePermissions('BUDGET.LIRE')
  @ApiOperation({
    summary:
      'Récupère un fait budget par son grain unique (10 FK). 404 si absent.',
  })
  @ApiOkResponse({ type: FaitBudgetResponseDto })
  @ApiNotFoundResponse()
  async findByGrain(
    @Query() query: ParGrainQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<FaitBudgetResponseDto> {
    const r = await this.service.findByGrain(query);
    if (!r) {
      throw new NotFoundException(
        'Aucun fait budget trouvé pour ce grain (10-uplet de FK).',
      );
    }
    await this.assertCrAutorise(r.fkCentre, user.userId);
    return r;
  }

  @Get(':id')
  @RequirePermissions('BUDGET.LIRE')
  @ApiOperation({ summary: 'Récupère un fait budget par son id (filtré par périmètre).' })
  @ApiOkResponse({ type: FaitBudgetResponseDto })
  @ApiNotFoundResponse()
  async findById(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<FaitBudgetResponseDto> {
    const r = await this.service.findById(id);
    await this.assertCrAutorise(r.fkCentre, user.userId);
    return r;
  }

  @Post()
  @RequirePermissions('BUDGET.SAISIR')
  @Auditable({ typeAction: 'CREATE', entiteCible: 'fait_budget' })
  @ApiOperation({
    summary:
      "Crée un fait budget à partir des 10 FK techniques (réservé imports/scripts). Pour la saisie utilisateur, préférer POST /from-business-keys.",
  })
  @ApiCreatedResponse({ type: FaitBudgetResponseDto })
  @ApiConflictResponse({
    description:
      'Grain unique violé (un fait existe déjà pour ce 10-uplet) ou version cible figée.',
  })
  @ApiNotFoundResponse({ description: 'Une des FK pointe vers une dimension inexistante.' })
  @ApiBadRequestResponse({ description: 'Validation DTO invalide.' })
  async create(
    @Body() dto: CreateFaitBudgetDto,
    @CurrentUser() user: AuthUser,
  ): Promise<FaitBudgetResponseDto> {
    await this.assertCrAutorise(dto.fkCentre, user.userId);
    return this.service.create(dto, user.email);
  }

  @Post('from-business-keys')
  @RequirePermissions('BUDGET.SAISIR')
  @Auditable({ typeAction: 'CREATE', entiteCible: 'fait_budget' })
  @ApiOperation({
    summary:
      'Saisie budget — endpoint principal pour saisie utilisateur',
    description: `Crée un fait budget à partir des codes business des 9 dimensions + une date métier.

**Algorithme (Option B, cf. modele-donnees.md §6.3)** :

1. Résolution \`dateMetier\` (YYYY-MM-01) → \`fk_temps\` via \`TempsService.findByDate\`.
2. Résolution des 6 dimensions SCD2 (structure / centre / compte / ligne_metier / produit / segment) vers la version VALIDE À LA DATE MÉTIER — pas la version courante. Garantit que les reportings historiques restent stables même si une dimension est révisée plus tard.
3. Résolution des 3 dimensions non-SCD2 (devise par codeIso, version par codeVersion, scénario par codeScenario).
4. Validation business : version doit être en statut \`'ouvert'\`, scénario en \`'actif'\`. Cohérence devise pivot XOF / taux=1.0.
5. Résolution du taux de change :
   - Si \`tauxChangeApplique\` fourni → utilisé tel quel (override manuel).
   - Sinon si devise = pivot XOF → 1.0.
   - Sinon → \`TauxChangeService.findTauxApplicable\` avec \`typeTaux\` (par défaut : \`'fixe_budgetaire'\` pour budget_initial / atterrissage, \`'cloture'\` pour reforecast).
6. Calcul automatique \`montantFcfa = montantDevise × tauxChangeApplique\` (4 décimales). Si fourni, cohérence vérifiée à 0.01 près.
7. INSERT via la même méthode que POST / (validation grain unique \`uq_fait_budget_grain\`).

**Codes erreur** :
- 201 : succès, retour avec \`resolutionDetails\`.
- 400 : DTO invalide (date pas un 1er du mois, code ISO mal formaté, etc.).
- 401 / 403 : non authentifié / pas la permission BUDGET.SAISIR.
- 404 : date métier introuvable dans \`dim_temps\`, ou \`codeDevise\` / \`codeVersion\` / \`codeScenario\` inexistant.
- 409 : version cible non \`'ouvert'\`, scénario archivé, ou grain dupliqué (uq_fait_budget_grain).
- 422 : aucune version SCD2 valide à la date métier pour une des 6 dimensions, devise XOF avec taux ≠ 1, montantFcfa fourni incohérent avec montantDevise × taux, ou aucun taux applicable trouvé.

**Champs de \`resolutionDetails\`** (audit + debug + UI Lot 3.5) :
- \`tauxChangeSource\` : \`'fourni-utilisateur'\` | \`'auto-pivot-xof'\` | \`'auto-fixe-budgetaire'\` | \`'auto-cloture'\` | \`'auto-moyen-mensuel'\`.
- \`dateApplicableTaux\` : date du taux retenu côté \`ref_taux_change\` (null si XOF ou taux fourni manuellement).
- \`montantFcfaSource\` : \`'fourni-utilisateur'\` | \`'calcule-automatique'\`.
- \`dimensionsResolues\` : tableau des 6 résolutions SCD2 avec les bornes de validité de chaque version retenue.

L'audit_log capture la requête + la réponse (y compris \`resolutionDetails\`), donc tout le contexte de résolution est tracé.`,
  })
  @ApiCreatedResponse({ type: FaitBudgetFromBusinessKeysResponseDto })
  @ApiBadRequestResponse({ description: 'Validation DTO invalide.' })
  @ApiNotFoundResponse({
    description:
      'Date métier introuvable ou codeDevise/codeVersion/codeScenario inconnu.',
  })
  @ApiConflictResponse({
    description: 'Version non ouverte, scénario archivé, ou grain dupliqué.',
  })
  @ApiUnprocessableEntityResponse({
    description:
      "Aucune version SCD2 valide à la date métier pour une dimension, ou cohérence devise/taux/montant violée.",
  })
  async createFromBusinessKeys(
    @Body() dto: CreateFaitBudgetFromBusinessKeysDto,
    @CurrentUser() user: AuthUser,
  ): Promise<FaitBudgetFromBusinessKeysResponseDto> {
    // Pour la résolution depuis codes business, le check périmètre se
    // fait APRÈS résolution (on a besoin du fkCentre résolu). Le
    // service le fait déjà via création — mais on ré-arme ici une
    // garde minimale : si le user n'a aucun CR autorisé (= []),
    // refuser tout d'office.
    const crs = await this.perimetreService.getCrAutorisesPourUser(
      user.userId,
    );
    if (crs !== null && crs.length === 0) {
      throw new ForbiddenException(
        "Aucun centre de responsabilité dans votre périmètre. Saisie refusée.",
      );
    }
    const result = await this.service.createFromBusinessKeys(dto, user.email);
    // Vérifier ex post que le CR résolu est bien dans le périmètre.
    await this.assertCrAutorise(result.fkCentre, user.userId);
    return result;
  }

  @Patch(':id')
  @RequirePermissions('BUDGET.SAISIR')
  @Auditable({
    typeAction: 'UPDATE',
    entiteCible: 'fait_budget',
    extractIdCible: (req) => (req.params as { id?: string }).id ?? null,
  })
  @ApiOperation({
    summary:
      'Modifie les mesures d\'un fait (montantDevise / montantFcfa / tauxChangeApplique). Aucune FK modifiable (un fait modifié = supprimé + recréé).',
  })
  @ApiOkResponse({ type: FaitBudgetResponseDto })
  @ApiNotFoundResponse()
  @ApiUnprocessableEntityResponse({
    description: 'Une FK est présente dans le payload (interdit).',
  })
  @ApiConflictResponse({
    description:
      "La version cible est figée (statut != 'ouvert').",
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateFaitBudgetDto,
    @CurrentUser() user: AuthUser,
  ): Promise<FaitBudgetResponseDto> {
    // Vérifier le périmètre AVANT update (lecture du fait existant).
    const existing = await this.service.findById(id);
    await this.assertCrAutorise(existing.fkCentre, user.userId);
    return this.service.update(
      id,
      dto as UpdateFaitBudgetDto & Record<string, unknown>,
      user.email,
    );
  }

  @Delete(':id')
  @RequirePermissions('BUDGET.SUPPRIMER')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auditable({
    typeAction: 'DELETE',
    entiteCible: 'fait_budget',
    extractIdCible: (req) => (req.params as { id?: string }).id ?? null,
  })
  @ApiOperation({
    summary: "Supprime un fait. Refusé si version cible != 'ouvert'.",
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse({
    description: "Version cible figée — suppression refusée.",
  })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    const existing = await this.service.findById(id); // 404 si absent
    await this.assertCrAutorise(existing.fkCentre, user.userId);
    const ok = await this.service.remove(id);
    if (!ok) throw new NotFoundException();
  }
}
