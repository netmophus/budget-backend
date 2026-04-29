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

    return {
      items: items.map(toUserResponse),
      total,
      page: query.page,
      limit: query.limit,
    };
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
