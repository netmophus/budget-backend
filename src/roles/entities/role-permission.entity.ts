import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Permission } from './permission.entity';
import { Role } from './role.entity';

@Entity({ name: 'bridge_role_permission' })
@Unique('uq_bridge_role_permission', ['fkRole', 'fkPermission'])
@Index('ix_bridge_role_permission_role', ['fkRole'])
@Index('ix_bridge_role_permission_permission', ['fkPermission'])
export class RolePermission {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id!: string;

  @Column({ name: 'fk_role', type: 'bigint' })
  fkRole!: string;

  @Column({ name: 'fk_permission', type: 'bigint' })
  fkPermission!: string;

  @Column({
    name: 'date_creation',
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  dateCreation!: Date;

  @ManyToOne(() => Role, (role) => role.rolePermissions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'fk_role' })
  role!: Role;

  @ManyToOne(() => Permission, (permission) => permission.rolePermissions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'fk_permission' })
  permission!: Permission;
}
