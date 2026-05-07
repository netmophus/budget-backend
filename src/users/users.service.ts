import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { PermissionsService } from '../auth/permissions.service';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { PaginatedUsersDto } from './dto/paginated-users.dto';
import {
  UserDetailResponseDto,
  UserRoleSummaryDto,
} from './dto/user-detail-response.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UserRole } from './entities/user-role.entity';
import { User } from './entities/user.entity';

function toUserResponse(user: User): UserResponseDto {
  return {
    id: user.id,
    email: user.email,
    nom: user.nom,
    prenom: user.prenom,
    estActif: user.estActif,
    dateDerniereConnexion: user.dateDerniereConnexion,
    dateCreation: user.dateCreation,
  };
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserRole)
    private readonly userRoleRepo: Repository<UserRole>,
    private readonly permissionsService: PermissionsService,
  ) {}

  async findAll(query: ListUsersQueryDto): Promise<PaginatedUsersDto> {
    const where: Record<string, unknown> = {};
    if (query.email) {
      where.email = ILike(`%${query.email}%`);
    }
    if (typeof query.estActif === 'boolean') {
      where.estActif = query.estActif;
    }

    const [items, total] = await this.userRepo.findAndCount({
      where,
      order: { id: 'ASC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    let responses = items.map(toUserResponse);

    // Lot 4.1-fix.A — enrichissement optionnel avec le compteur de
    // périmètres actifs (utilisé par /admin/affectations pour afficher
    // tous les users dont ceux à 0 périmètre, et éviter le N+1).
    if (query.withPerimetresCount && items.length > 0) {
      const today = new Date().toISOString().slice(0, 10);
      const ids = items.map((u) => u.id);
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
      const counts = (await this.userRepo.manager.query<
        Array<{ fk_user: string; n: string }>
      >(
        `SELECT fk_user, COUNT(*)::text AS n
           FROM user_perimetres
          WHERE fk_user IN (${placeholders})
            AND actif = true
            AND date_debut <= $${ids.length + 1}
            AND (date_fin IS NULL OR date_fin >= $${ids.length + 1})
          GROUP BY fk_user`,
        [...ids, today],
      )) ?? [];
      const byUser = new Map(
        counts.map((c) => [String(c.fk_user), Number(c.n)]),
      );
      responses = responses.map((r) => ({
        ...r,
        nombrePerimetresActifs: byUser.get(r.id) ?? 0,
      }));
    }

    return {
      items: responses,
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  /**
   * Recherche serveur (Lot Administration ADMIN.C) — ILIKE sur
   * email/nom/prenom OR, est_actif=true, limite 10, tri alpha email.
   * Utilisée par le composant <UserAutocomplete /> pour les
   * sélecteurs de users (CreerDelegationDialog, etc.).
   */
  async recherche(q: string, limit = 10): Promise<UserResponseDto[]> {
    const safeLimit = Math.min(Math.max(1, limit), 50);
    if (!q || q.trim().length === 0) return [];
    const pattern = `%${q.trim()}%`;
    const items = await this.userRepo
      .createQueryBuilder('u')
      .where('u.estActif = :true', { true: true })
      .andWhere(
        '(u.email ILIKE :p OR u.nom ILIKE :p OR u.prenom ILIKE :p)',
        { p: pattern },
      )
      .orderBy('u.email', 'ASC')
      .limit(safeLimit)
      .getMany();
    return items.map(toUserResponse);
  }

  async findOne(id: string): Promise<UserDetailResponseDto> {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('Utilisateur introuvable');
    }

    const userRoles = await this.userRoleRepo.find({
      where: { fkUser: id, estActif: true },
      relations: { role: true },
    });

    const roles: UserRoleSummaryDto[] = userRoles.map((ur) => ({
      code: ur.role.codeRole,
      libelle: ur.role.libelle,
      perimetreType: ur.perimetreType,
      perimetreId: ur.perimetreId,
    }));

    const permissions = await this.permissionsService.getEffectivePermissions(id);

    return { ...toUserResponse(user), roles, permissions };
  }
}
