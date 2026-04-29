import 'reflect-metadata';
import {
  PERMISSIONS_KEY,
  PermissionsMetadata,
  RequirePermissions,
} from './require-permissions.decorator';

function metadataOf(method: unknown): PermissionsMetadata | undefined {
  return Reflect.getMetadata(PERMISSIONS_KEY, method as object) as
    | PermissionsMetadata
    | undefined;
}

describe('@RequirePermissions', () => {
  it('single string => mode any with one permission', () => {
    class C {
      @RequirePermissions('USER.LIRE')
      method() {
        return undefined;
      }
    }
    expect(metadataOf(C.prototype.method)).toEqual({
      permissions: ['USER.LIRE'],
      mode: 'any',
    });
  });

  it('multiple strings => mode any (OR)', () => {
    class C {
      @RequirePermissions('USER.LIRE', 'USER.GERER')
      method() {
        return undefined;
      }
    }
    expect(metadataOf(C.prototype.method)).toEqual({
      permissions: ['USER.LIRE', 'USER.GERER'],
      mode: 'any',
    });
  });

  it('{ all } => mode all (AND)', () => {
    class C {
      @RequirePermissions({ all: ['USER.LIRE', 'AUDIT.LIRE'] })
      method() {
        return undefined;
      }
    }
    expect(metadataOf(C.prototype.method)).toEqual({
      permissions: ['USER.LIRE', 'AUDIT.LIRE'],
      mode: 'all',
    });
  });

  it('{ any } => mode any (explicit)', () => {
    class C {
      @RequirePermissions({ any: ['USER.LIRE', 'USER.GERER'] })
      method() {
        return undefined;
      }
    }
    expect(metadataOf(C.prototype.method)).toEqual({
      permissions: ['USER.LIRE', 'USER.GERER'],
      mode: 'any',
    });
  });

  it('throws when called without args', () => {
    expect(() => RequirePermissions()).toThrow(/at least one/);
  });

  it('throws when mixing strings and spec object', () => {
    expect(() =>
      RequirePermissions('USER.LIRE', { all: ['ROLE.LIRE'] }),
    ).toThrow(/all must be strings/);
  });
});
