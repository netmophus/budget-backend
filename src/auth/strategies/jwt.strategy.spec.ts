import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtPayload, JwtStrategy } from './jwt.strategy';

function makeStrategy(secret = 'test-secret-32-bytes-test-secret'): JwtStrategy {
  const config = { get: (key: string) => (key === 'JWT_SECRET' ? secret : undefined) };
  return new JwtStrategy(config as ConfigService);
}

describe('JwtStrategy', () => {
  it('throws at construction when JWT_SECRET is missing', () => {
    const config = { get: () => undefined };
    expect(() => new JwtStrategy(config as unknown as ConfigService)).toThrow(
      /JWT_SECRET/,
    );
  });

  it('returns { userId, email, mdpExpire:false, doitChangerMdp:false } pour un payload sans flags (Lot 6.4.A)', () => {
    const strategy = makeStrategy();
    const payload: JwtPayload = {
      sub: '42',
      email: 'admin@miznas.local',
      jti: '00000000-0000-4000-8000-000000000099',
    };
    const result = strategy.validate(payload);
    expect(result).toEqual({
      userId: '42',
      email: 'admin@miznas.local',
      mdpExpire: false,
      doitChangerMdp: false,
    });
  });

  it('propage les flags mdpExpire et dcm du payload (Lot 6.4.A)', () => {
    const strategy = makeStrategy();
    const payload: JwtPayload = {
      sub: '42',
      email: 'admin@miznas.local',
      jti: '00000000-0000-4000-8000-000000000099',
      mdpExpire: true,
      dcm: true,
    };
    const result = strategy.validate(payload);
    expect(result.mdpExpire).toBe(true);
    expect(result.doitChangerMdp).toBe(true);
  });

  it('throws UnauthorizedException for malformed payload (missing sub)', () => {
    const strategy = makeStrategy();
    const payload = { email: 'a@b.c', jti: 'x' } as unknown as JwtPayload;
    expect(() => strategy.validate(payload)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException for malformed payload (missing email)', () => {
    const strategy = makeStrategy();
    const payload = { sub: '1', jti: 'x' } as unknown as JwtPayload;
    expect(() => strategy.validate(payload)).toThrow(UnauthorizedException);
  });
});
