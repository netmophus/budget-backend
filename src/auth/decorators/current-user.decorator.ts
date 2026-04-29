import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { Request } from 'express';

export interface AuthUser {
  userId: string;
  email: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    if (!request.user) {
      throw new Error('CurrentUser used on a non-authenticated request');
    }
    return request.user;
  },
);
