import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { IsNull, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.entity';
import { AuthService } from './auth.service';
import { RefreshToken } from './entities/refresh-token.entity';

type Repo<T> = Pick<
  Repository<T>,
  'findOne' | 'find' | 'save' | 'create' | 'update'
>;

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: '1',
    email: 'admin@miznas.local',
    motDePasseHash: '',
    nom: 'Admin',
    prenom: 'MIZNAS',
    estActif: true,
    dateDerniereConnexion: null,
    dateCreation: new Date(),
    utilisateurCreation: 'system',
    dateModification: null,
    utilisateurModification: null,
    userRoles: [],
    ...overrides,
  } as User;
}

describe('AuthService', () => {
  let service: AuthService;
  let userRepo: jest.Mocked<Repo<User>>;
  let userRoleRepo: jest.Mocked<Repo<UserRole>>;
  let refreshRepo: jest.Mocked<Repo<RefreshToken>>;
  let jwtService: jest.Mocked<Pick<JwtService, 'signAsync'>>;
  let auditService: jest.Mocked<Pick<AuditService, 'log'>>;

  beforeEach(async () => {
    userRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn().mockImplementation((u: User) => Promise.resolve(u)),
      create: jest.fn(),
      update: jest.fn(),
    };
    userRoleRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };
    refreshRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn().mockImplementation((t: RefreshToken) => Promise.resolve(t)),
      create: jest.fn().mockImplementation((t: Partial<RefreshToken>) => t as RefreshToken),
      update: jest.fn().mockResolvedValue({ affected: 1 } as never),
    };
    jwtService = { signAsync: jest.fn().mockResolvedValue('signed.jwt.token') };
    auditService = { log: jest.fn().mockResolvedValue(undefined) };

    const config = {
      get: (key: string): string | undefined => {
        const map: Record<string, string> = {
          JWT_ACCESS_EXPIRES_IN: '15m',
          JWT_REFRESH_EXPIRES_IN: '7d',
          BCRYPT_ROUNDS: '4',
        };
        return map[key];
      },
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(UserRole), useValue: userRoleRepo },
        { provide: getRepositoryToken(RefreshToken), useValue: refreshRepo },
        { provide: JwtService, useValue: jwtService },
        { provide: AuditService, useValue: auditService },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  describe('validateUser', () => {
    it('returns the user when password matches and user is active', async () => {
      const hash = await bcrypt.hash('correct', 4);
      userRepo.findOne.mockResolvedValue(makeUser({ motDePasseHash: hash }));
      const result = await service.validateUser('admin@miznas.local', 'correct');
      expect(result).not.toBeNull();
      expect(result?.email).toBe('admin@miznas.local');
    });

    it('returns null on wrong password', async () => {
      const hash = await bcrypt.hash('correct', 4);
      userRepo.findOne.mockResolvedValue(makeUser({ motDePasseHash: hash }));
      const result = await service.validateUser('admin@miznas.local', 'WRONG');
      expect(result).toBeNull();
    });

    it('returns null when user is inactive', async () => {
      const hash = await bcrypt.hash('correct', 4);
      userRepo.findOne.mockResolvedValue(
        makeUser({ motDePasseHash: hash, estActif: false }),
      );
      const result = await service.validateUser('admin@miznas.local', 'correct');
      expect(result).toBeNull();
    });

    it('returns null when user does not exist', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const result = await service.validateUser('ghost@miznas.local', 'whatever');
      expect(result).toBeNull();
    });
  });

  describe('login', () => {
    it('issues access + refresh tokens, updates date_derniere_connexion, audits LOGIN success', async () => {
      const hash = await bcrypt.hash('correct', 4);
      userRepo.findOne.mockResolvedValue(makeUser({ motDePasseHash: hash }));

      const result = await service.login(
        'admin@miznas.local',
        'correct',
        '127.0.0.1',
        'jest-test',
      );

      expect(result.tokens.accessToken).toBe('signed.jwt.token');
      expect(typeof result.tokens.refreshToken).toBe('string');
      expect(result.tokens.expiresIn).toBe(15 * 60);
      expect(userRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: '1', dateDerniereConnexion: expect.any(Date) }),
      );
      expect(refreshRepo.save).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ typeAction: 'LOGIN', statut: 'success' }),
      );
    });

    it('audits LOGIN_FAILED and throws on bad credentials', async () => {
      const hash = await bcrypt.hash('correct', 4);
      userRepo.findOne.mockResolvedValue(makeUser({ motDePasseHash: hash }));

      await expect(
        service.login('admin@miznas.local', 'WRONG', '127.0.0.1', 'jest'),
      ).rejects.toThrow(UnauthorizedException);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ typeAction: 'LOGIN_FAILED', statut: 'failure' }),
      );
    });

    it('audits LOGIN_FAILED for unknown email (same generic outcome)', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(
        service.login('ghost@miznas.local', 'whatever1', null, null),
      ).rejects.toThrow(UnauthorizedException);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          utilisateur: 'ghost@miznas.local',
          typeAction: 'LOGIN_FAILED',
        }),
      );
    });

    // ─── Lot 6.4.A — flags mdpExpire / doitChangerMdp ───────────────

    it('retourne mdpExpire=true si dateExpirationMdp est dépassée', async () => {
      const hash = await bcrypt.hash('correct', 4);
      userRepo.findOne.mockResolvedValue(
        makeUser({
          motDePasseHash: hash,
          dateExpirationMdp: new Date(Date.now() - 86_400_000), // hier
          doitChangerMdp: false,
        }),
      );

      const result = await service.login(
        'admin@miznas.local',
        'correct',
        null,
        null,
      );
      expect(result.mdpExpire).toBe(true);
      expect(result.doitChangerMdp).toBe(false);
    });

    it('retourne doitChangerMdp=true si user.doit_changer_mdp = true', async () => {
      const hash = await bcrypt.hash('correct', 4);
      userRepo.findOne.mockResolvedValue(
        makeUser({
          motDePasseHash: hash,
          dateExpirationMdp: new Date(Date.now() + 86_400_000),
          doitChangerMdp: true,
        }),
      );

      const result = await service.login(
        'admin@miznas.local',
        'correct',
        null,
        null,
      );
      expect(result.doitChangerMdp).toBe(true);
    });

    it('flags false par défaut pour un user récent sans expiration ni reset', async () => {
      const hash = await bcrypt.hash('correct', 4);
      userRepo.findOne.mockResolvedValue(
        makeUser({
          motDePasseHash: hash,
          dateExpirationMdp: null,
          doitChangerMdp: false,
        }),
      );

      const result = await service.login(
        'admin@miznas.local',
        'correct',
        null,
        null,
      );
      expect(result.mdpExpire).toBe(false);
      expect(result.doitChangerMdp).toBe(false);
    });
  });

  describe('changerMdp', () => {
    it('hash le nouveau mdp + UPDATE doit_changer_mdp=false + nouvelle expiration', async () => {
      const hash = await bcrypt.hash('AncienConforme1!', 4);
      const user = makeUser({
        motDePasseHash: hash,
        doitChangerMdp: true,
        dateExpirationMdp: new Date(Date.now() - 86_400_000),
      });
      userRepo.findOne.mockResolvedValue(user);

      const result = await service.changerMdp(
        '1',
        'AncienConforme1!',
        'NouveauValide99@',
        null,
        null,
      );

      expect(result.mdpExpire).toBe(false);
      expect(result.doitChangerMdp).toBe(false);
      expect(userRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          doitChangerMdp: false,
          dateExpirationMdp: expect.any(Date),
        }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          typeAction: 'PASSWORD_CHANGED',
          statut: 'success',
        }),
      );
    });

    it('rejette avec UnauthorizedException si ancien mdp incorrect', async () => {
      const hash = await bcrypt.hash('AncienVrai1!', 4);
      userRepo.findOne.mockResolvedValue(makeUser({ motDePasseHash: hash }));

      await expect(
        service.changerMdp('1', 'mauvais', 'NouveauValide99@', null, null),
      ).rejects.toThrow(UnauthorizedException);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          typeAction: 'PASSWORD_CHANGED',
          statut: 'failure',
        }),
      );
    });

    it("rejette si nouveau mdp = ancien mdp", async () => {
      const hash = await bcrypt.hash('IdentiqueValide1!', 4);
      userRepo.findOne.mockResolvedValue(makeUser({ motDePasseHash: hash }));

      await expect(
        service.changerMdp(
          '1',
          'IdentiqueValide1!',
          'IdentiqueValide1!',
          null,
          null,
        ),
      ).rejects.toThrow(/différent/);
    });

    it('rejette si le nouveau mdp ne respecte pas la politique', async () => {
      const hash = await bcrypt.hash('AncienConforme1!', 4);
      userRepo.findOne.mockResolvedValue(makeUser({ motDePasseHash: hash }));

      await expect(
        service.changerMdp('1', 'AncienConforme1!', 'court', null, null),
      ).rejects.toThrow(/12 caractères|majuscule|chiffre|spécial/);
    });
  });

  describe('refresh', () => {
    function existingActiveToken(overrides: Partial<RefreshToken> = {}): RefreshToken {
      return {
        id: '10',
        fkUser: '1',
        tokenHash: 'should-be-overridden',
        dateExpiration: new Date(Date.now() + 60_000),
        dateRevocation: null,
        motifRevocation: null,
        ipEmission: null,
        userAgent: null,
        dateCreation: new Date(),
        user: makeUser(),
        ...overrides,
      } as RefreshToken;
    }

    it('rotates: revokes old (motif=rotation), issues new tokens', async () => {
      const refreshClear = '00000000-0000-4000-8000-000000000001';
      const expectedHash = service.hashRefreshToken(refreshClear);
      const old = existingActiveToken({ tokenHash: expectedHash });
      refreshRepo.findOne.mockResolvedValue(old);
      userRepo.findOne.mockResolvedValue(makeUser());

      const tokens = await service.refresh(refreshClear, null, null);

      expect(refreshRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: '10',
          motifRevocation: 'rotation',
          dateRevocation: expect.any(Date),
        }),
      );
      expect(tokens.accessToken).toBe('signed.jwt.token');
      expect(tokens.refreshToken).not.toBe(refreshClear);
    });

    it('throws UnauthorizedException when refresh is expired', async () => {
      const refreshClear = '00000000-0000-4000-8000-000000000002';
      const expectedHash = service.hashRefreshToken(refreshClear);
      refreshRepo.findOne.mockResolvedValue(
        existingActiveToken({
          tokenHash: expectedHash,
          dateExpiration: new Date(Date.now() - 60_000),
        }),
      );

      await expect(service.refresh(refreshClear, null, null)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when refresh is unknown', async () => {
      refreshRepo.findOne.mockResolvedValue(null);
      await expect(
        service.refresh('00000000-0000-4000-8000-000000000003', null, null),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('on reuse of a revoked refresh: revokes ALL active tokens (motif=forced), audits, and 401', async () => {
      const refreshClear = '00000000-0000-4000-8000-000000000004';
      const expectedHash = service.hashRefreshToken(refreshClear);
      refreshRepo.findOne.mockResolvedValue(
        existingActiveToken({
          tokenHash: expectedHash,
          dateRevocation: new Date(),
          motifRevocation: 'rotation',
        }),
      );

      await expect(service.refresh(refreshClear, null, null)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(refreshRepo.update).toHaveBeenCalledWith(
        { fkUser: '1', dateRevocation: IsNull() },
        expect.objectContaining({ motifRevocation: 'forced' }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          typeAction: 'REFRESH_FORCED_REVOCATION',
          statut: 'failure',
        }),
      );
    });

    it('throws when the user has been deactivated since', async () => {
      const refreshClear = '00000000-0000-4000-8000-000000000005';
      const expectedHash = service.hashRefreshToken(refreshClear);
      refreshRepo.findOne.mockResolvedValue(
        existingActiveToken({ tokenHash: expectedHash }),
      );
      userRepo.findOne.mockResolvedValue(makeUser({ estActif: false }));

      await expect(service.refresh(refreshClear, null, null)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('logout', () => {
    it('with refreshToken: targeted revocation (motif=logout) + LOGOUT audit', async () => {
      const clear = '00000000-0000-4000-8000-000000000010';
      await service.logout('1', 'admin@miznas.local', clear, '127.0.0.1', 'jest');
      expect(refreshRepo.update).toHaveBeenCalledWith(
        { fkUser: '1', tokenHash: service.hashRefreshToken(clear), dateRevocation: IsNull() },
        expect.objectContaining({ motifRevocation: 'logout' }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ typeAction: 'LOGOUT', statut: 'success' }),
      );
    });

    it('without refreshToken: revokes all active tokens of the user', async () => {
      await service.logout('1', 'admin@miznas.local', undefined, null, null);
      expect(refreshRepo.update).toHaveBeenCalledWith(
        { fkUser: '1', dateRevocation: IsNull() },
        expect.objectContaining({ motifRevocation: 'logout' }),
      );
    });
  });
});
