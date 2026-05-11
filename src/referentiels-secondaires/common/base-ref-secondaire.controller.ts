/**
 * Factory générique de controllers pour les référentiels secondaires.
 *
 * NestJS ne supporte pas élégamment l'héritage de routes décorées
 * quand on veut paramétrer le `entiteCible` du décorateur @Auditable
 * (qui doit être posé à la décoration, donc connu statiquement).
 * On utilise une factory : chaque module concret appelle
 * `createRefSecondaireControllerClass({...})` et obtient une classe
 * de controller pré-décorée.
 *
 * Usage type :
 * ```typescript
 * const RefTypeStructureController = createRefSecondaireControllerClass(
 *   { routePath: 'type-structure', entiteCible: 'ref_type_structure' },
 *   RefTypeStructureService,
 * );
 * ```
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  type Type,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { Auditable } from '../../audit/decorators/auditable.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import {
  type BaseRefSecondaireService,
  type ToggleActifResult,
} from './base-ref-secondaire.service';
import { CreateRefSecondaireDto } from './dto/create-ref-secondaire.dto';
import {
  ListRefSecondaireDto,
  PaginatedRefSecondaireDto,
} from './dto/list-ref-secondaire.dto';
import { UpdateRefSecondaireDto } from './dto/update-ref-secondaire.dto';
import {
  type BaseRefSecondaire,
  type RefSecondaireWithId,
} from './entities/base-ref-secondaire.entity';

interface FactoryOptions {
  /** Chemin segment de l'URL : `/api/v1/configuration/<routePath>`. */
  routePath: string;
  /** Nom de la table (utilisé pour audit_log.entite_cible). */
  entiteCible: string;
  /** Tag Swagger lisible (par défaut basé sur entiteCible). */
  swaggerTag?: string;
}

export function createRefSecondaireControllerClass<
  T extends RefSecondaireWithId,
  S extends BaseRefSecondaireService<T>,
>(options: FactoryOptions, ServiceCtor: Type<S>): Type<unknown> {
  const tag = options.swaggerTag ?? `configuration-${options.entiteCible}`;
  const path = `configuration/${options.routePath}`;

  @ApiTags(tag)
  @ApiBearerAuth()
  @Controller(path)
  class RefSecondaireController {
    constructor(@Inject(ServiceCtor) public readonly service: S) {}

    @Get()
    @RequirePermissions('CONFIGURATION.LIRE')
    @ApiOperation({
      summary: `Liste paginée ${options.entiteCible} (filtres estActif/estSysteme/search).`,
    })
    @ApiOkResponse()
    findAll(
      @Query() query: ListRefSecondaireDto,
    ): Promise<PaginatedRefSecondaireDto<T>> {
      return this.service.findAll(query);
    }

    @Get('par-code/:code')
    @RequirePermissions('CONFIGURATION.LIRE')
    @ApiOperation({
      summary: `Récupère ${options.entiteCible} par code business.`,
    })
    @ApiOkResponse()
    @ApiNotFoundResponse()
    findByCode(@Param('code') code: string): Promise<T> {
      return this.service.findByCode(code);
    }

    @Get(':id')
    @RequirePermissions('CONFIGURATION.LIRE')
    @ApiOperation({ summary: `Récupère ${options.entiteCible} par id.` })
    @ApiOkResponse()
    @ApiNotFoundResponse()
    findById(@Param('id') id: string): Promise<T> {
      return this.service.findById(id);
    }

    @Post()
    @RequirePermissions('CONFIGURATION.GERER')
    @Auditable({ typeAction: 'CREATE', entiteCible: options.entiteCible })
    @ApiOperation({
      summary: `Crée une nouvelle valeur ${options.entiteCible}.`,
    })
    @ApiCreatedResponse()
    @ApiConflictResponse({ description: 'Code déjà existant.' })
    create(
      @Body() dto: CreateRefSecondaireDto,
      @CurrentUser() user: AuthUser,
    ): Promise<T> {
      return this.service.create(dto, user.email);
    }

    @Patch(':id')
    @RequirePermissions('CONFIGURATION.GERER')
    @Auditable({
      typeAction: 'UPDATE',
      entiteCible: options.entiteCible,
      extractIdCible: (req) => (req.params as { id?: string }).id ?? null,
    })
    @ApiOperation({
      summary: `Modifie une valeur ${options.entiteCible} (refus si renommage code et estSysteme=true).`,
    })
    @ApiOkResponse()
    @ApiNotFoundResponse()
    @ApiConflictResponse({ description: 'Code déjà pris (renommage).' })
    update(
      @Param('id') id: string,
      @Body() dto: UpdateRefSecondaireDto,
      @CurrentUser() user: AuthUser,
    ): Promise<T> {
      return this.service.update(id, dto, user.email);
    }

    @Post(':id/toggle-actif')
    @RequirePermissions('CONFIGURATION.GERER')
    @Auditable({
      typeAction: 'UPDATE',
      entiteCible: options.entiteCible,
      extractIdCible: (req) => (req.params as { id?: string }).id ?? null,
    })
    @ApiOperation({
      summary: `Bascule est_actif. Warning si désactivation d'une valeur référencée.`,
    })
    @ApiOkResponse()
    @ApiNotFoundResponse()
    toggleActif(
      @Param('id') id: string,
      @CurrentUser() user: AuthUser,
    ): Promise<ToggleActifResult<T>> {
      return this.service.toggleActif(id, user.email);
    }

    @Delete(':id')
    @HttpCode(HttpStatus.NO_CONTENT)
    @RequirePermissions('CONFIGURATION.GERER')
    @Auditable({
      typeAction: 'DELETE',
      entiteCible: options.entiteCible,
      extractIdCible: (req) => (req.params as { id?: string }).id ?? null,
    })
    @ApiOperation({
      summary: `Supprime une valeur ${options.entiteCible} (refus si estSysteme=true ou référencée).`,
    })
    @ApiNoContentResponse()
    @ApiNotFoundResponse()
    @ApiConflictResponse({
      description: 'Valeur système ou référencée par une dimension.',
    })
    async delete(
      @Param('id') id: string,
      @CurrentUser() user: AuthUser,
    ): Promise<void> {
      await this.service.softDelete(id, user.email);
    }
  }

  // Définir un nom lisible pour les logs Nest et les tests.
  Object.defineProperty(RefSecondaireController, 'name', {
    value: `${options.entiteCible
      .split('_')
      .map((s) => s[0]?.toUpperCase() + s.slice(1))
      .join('')}Controller`,
  });
  return RefSecondaireController;
}

/* Re-export utilitaire pour les sous-modules. */
export type { BaseRefSecondaire };
