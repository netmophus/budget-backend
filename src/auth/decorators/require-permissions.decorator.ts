import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'requiredPermissions';

export type PermissionsMode = 'any' | 'all';

export interface PermissionsMetadata {
  permissions: string[];
  mode: PermissionsMode;
}

export type RequirePermissionsArg =
  | string
  | { any: string[] }
  | { all: string[] };

function isPermissionSpec(
  arg: RequirePermissionsArg,
): arg is { any: string[] } | { all: string[] } {
  return typeof arg === 'object' && arg !== null;
}

export function RequirePermissions(
  ...args: RequirePermissionsArg[]
): MethodDecorator & ClassDecorator {
  if (args.length === 0) {
    throw new Error('@RequirePermissions requires at least one permission code');
  }

  let metadata: PermissionsMetadata;

  if (args.length === 1 && isPermissionSpec(args[0])) {
    const spec = args[0];
    if ('all' in spec) {
      metadata = { permissions: spec.all, mode: 'all' };
    } else {
      metadata = { permissions: spec.any, mode: 'any' };
    }
  } else {
    const permissions = args.filter(
      (a): a is string => typeof a === 'string',
    );
    if (permissions.length !== args.length) {
      throw new Error(
        '@RequirePermissions: when passing multiple arguments, all must be strings. Use { any } or { all } for explicit mode.',
      );
    }
    metadata = { permissions, mode: 'any' };
  }

  if (metadata.permissions.length === 0) {
    throw new Error('@RequirePermissions: empty permissions list');
  }

  return SetMetadata(PERMISSIONS_KEY, metadata);
}
