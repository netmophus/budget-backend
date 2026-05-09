import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthUser } from '../decorators/current-user.decorator';

export interface JwtPayload {
  sub: string;
  email: string;
  jti: string;
  // Lot 6.4.A — flags d'état mot de passe (optionnels pour compat
  // descendante avec les JWT émis avant le Lot 6.4).
  mdpExpire?: boolean;
  dcm?: boolean; // doitChangerMdp (abrégé pour limiter la taille du JWT)
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    const secret = config.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET is not defined');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: secret,
      ignoreExpiration: false,
    });
  }

  validate(payload: JwtPayload): AuthUser {
    if (!payload.sub || !payload.email) {
      throw new UnauthorizedException('Jeton invalide');
    }
    return {
      userId: payload.sub,
      email: payload.email,
      mdpExpire: payload.mdpExpire ?? false,
      doitChangerMdp: payload.dcm ?? false,
    };
  }
}
