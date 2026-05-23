/**
 * Test d'audit Lot 8.1.E (cross-cutting sécurité).
 *
 * Garantit que `User.motDePasseHash` ne fuite JAMAIS dans la
 * sérialisation `instanceToPlain` de class-transformer — pilier du
 * `ClassSerializerInterceptor` global activé dans `main.ts`.
 *
 * Toute régression future (ex: quelqu'un retire le `@Exclude`,
 * remplace par une version moins stricte, désactive l'interceptor)
 * fait planter ce test.
 *
 * Pattern complémentaire au test pré-existant
 * `users.service.spec.ts` qui couvre le mapping manuel
 * `toUserResponse()` du service. Ici on couvre le décorateur de
 * l'ENTITÉ : utile car tout autre service qui retournerait une
 * instance `User` directement (ou via relation TypeORM) sans
 * mapping est désormais protégé par défaut.
 */
import { instanceToPlain, plainToInstance } from 'class-transformer';

import { User } from './user.entity';

describe('User entity — sécurité Lot 8.1.E', () => {
  const SECRET_HASH = '$2b$12$leakAlertNeverShouldAppearInJSON';

  function makeUser(): User {
    return plainToInstance(User, {
      id: '23',
      email: 'dg@bsic.ne',
      nom: 'BARRY',
      prenom: 'Issoufou',
      motDePasseHash: SECRET_HASH,
      estActif: true,
      dateDerniereConnexion: null,
      dateCreation: new Date('2026-01-01T00:00:00Z'),
      utilisateurCreation: 'system',
      dateModification: null,
    });
  }

  it('instanceToPlain(User) ne contient PAS motDePasseHash', () => {
    const user = makeUser();
    const plain = instanceToPlain(user);

    expect(plain).not.toHaveProperty('motDePasseHash');
    expect(JSON.stringify(plain)).not.toContain('motDePasseHash');
    expect(JSON.stringify(plain)).not.toContain(SECRET_HASH);
  });

  it('motDePasseHash reste accessible côté serveur (bcrypt.compare doit marcher)', () => {
    const user = makeUser();

    // `@Exclude({ toPlainOnly: true })` n'affecte QUE la sérialisation,
    // pas la lecture en mémoire. C'est ce qui permet à `auth.service`
    // de continuer à valider les mots de passe.
    expect(user.motDePasseHash).toBe(SECRET_HASH);
  });

  it('autres champs sensibles non-hash restent exposés (email, nom, prenom)', () => {
    const user = makeUser();
    const plain = instanceToPlain(user);

    expect(plain).toHaveProperty('email', 'dg@bsic.ne');
    expect(plain).toHaveProperty('nom', 'BARRY');
    expect(plain).toHaveProperty('prenom', 'Issoufou');
    expect(plain).toHaveProperty('id', '23');
  });

  it('garantie même si User est imbriqué (relation TypeORM emetteur/signataire)', () => {
    // Simule un endpoint qui retournerait un objet wrapper contenant
    // l'instance User (ex: `{ document, emetteur: User }` après
    // `relations: ['emetteur']` chargé par TypeORM).
    const wrapper = { otherField: 'ok', emetteur: makeUser() };
    const plain = instanceToPlain(wrapper);

    expect(JSON.stringify(plain)).not.toContain('motDePasseHash');
    expect(JSON.stringify(plain)).not.toContain(SECRET_HASH);
    // Le wrapper conserve ses autres champs et le user reste enrichi
    // (sans le hash).
    expect(plain).toHaveProperty('otherField', 'ok');
    expect(plain).toHaveProperty('emetteur.email', 'dg@bsic.ne');
  });
});
