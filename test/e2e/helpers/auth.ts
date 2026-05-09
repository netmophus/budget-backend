/**
 * Helpers d'authentification pour les tests e2e.
 *
 * `login()` exécute un POST /api/v1/auth/login via SuperTest et renvoie
 * le couple access/refresh + le user id, prêt à être utilisé en header
 * Authorization Bearer.
 *
 * Les comptes de PERSONAS reposent sur :
 *  - `auth-seed.ts` (admin + lecteur)
 *  - migration `1779200000090-AjouterPersonasBSIC` (6 personas BSIC,
 *    mot de passe commun `MiznasTest!2026`)
 *  - migration `1779200000110-CreerRolesMetierEtBasculePersonasBSIC`
 *    qui leur affecte un rôle métier (SAISISSEUR / VALIDATEUR /
 *    PUBLICATEUR / AUDITEUR).
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  userId: string;
  email: string;
}

export async function login(
  app: INestApplication,
  email: string,
  motDePasse: string,
): Promise<AuthSession> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, motDePasse })
    .expect(200);
  return {
    accessToken: res.body.accessToken as string,
    refreshToken: res.body.refreshToken as string,
    userId: res.body.user.id as string,
    email: res.body.user.email as string,
  };
}

export function bearer(session: AuthSession): { Authorization: string } {
  return { Authorization: `Bearer ${session.accessToken}` };
}

export const PERSONAS = {
  ADMIN: { email: 'admin@miznas.local', motDePasse: 'ChangeMe!2026' },
  LECTEUR: { email: 'lecteur@miznas.local', motDePasse: 'Lecteur!2026' },
  ADJ_RETAIL: { email: 'adj.retail@miznas.local', motDePasse: 'MiznasTest!2026' },
  DIR_RETAIL: { email: 'dir.retail@miznas.local', motDePasse: 'MiznasTest!2026' },
  DIR_CORPORATE: { email: 'dir.corporate@miznas.local', motDePasse: 'MiznasTest!2026' },
  CONTROLEUR_GESTION: {
    email: 'controleur.gestion@miznas.local',
    motDePasse: 'MiznasTest!2026',
  },
  AUDITEUR: { email: 'auditeur@miznas.local', motDePasse: 'MiznasTest!2026' },
  DGA_EXPLOITATION: {
    email: 'dga.exploitation@miznas.local',
    motDePasse: 'MiznasTest!2026',
  },
} as const;
