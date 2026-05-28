/**
 * Tests AlerteEcartCronService (Lot 8.5.E).
 *
 * Le cron est un mince wrapper autour d'AlerteEcartService :
 *  - vérifier que `alerteMensuelle()` calcule bien M-1 et délègue
 *  - vérifier que les exceptions sont catchées (pas de re-throw qui
 *    pourrait crasher le process Node)
 *  - vérifier que `onApplicationBootstrap()` ne déclenche PAS d'envoi
 *    (différence assumée vs DelegationsRappelCronService — pour éviter
 *    le spam à chaque restart en dev).
 *
 * Pas de fake timers : on n'attend pas que le cron déclenche
 * réellement à 06:00, on appelle directement les méthodes.
 */
import { AlerteEcartCronService } from './alerte-ecart-cron.service';
import { AlerteEcartService } from './alerte-ecart.service';

describe('AlerteEcartCronService', () => {
  let cron: AlerteEcartCronService;
  let alerteService: jest.Mocked<AlerteEcartService>;

  beforeEach(() => {
    alerteService = {
      notifierEcarts: jest.fn(),
    } as unknown as jest.Mocked<AlerteEcartService>;
    cron = new AlerteEcartCronService(alerteService);
  });

  it('alerteMensuelle() calcule M-1 et délègue à AlerteEcartService.notifierEcarts', async () => {
    alerteService.notifierEcarts.mockResolvedValue({
      moisAnalyse: 'fake-from-mock',
      execute: true,
      nbDestinataires: 4,
      nbAttention: 2,
      nbCritique: 1,
      nbErreursEnvoi: 0,
    });

    // On ne mock pas Date globalement (intrusif). À la place, on
    // vérifie l'invocation et on teste calculerMoisPrecedent
    // séparément ci-dessous.
    await cron.alerteMensuelle();

    expect(alerteService.notifierEcarts).toHaveBeenCalledTimes(1);
    const moisPasse = alerteService.notifierEcarts.mock.calls[0]![0];
    expect(moisPasse).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
  });

  it('alerteMensuelle() catche les erreurs sans re-throw (pas de crash process)', async () => {
    alerteService.notifierEcarts.mockRejectedValue(
      new Error('DB connection refused'),
    );

    // Ne doit PAS lever ; le cron est silencieux face à l'erreur métier.
    await expect(cron.alerteMensuelle()).resolves.toBeUndefined();
    expect(alerteService.notifierEcarts).toHaveBeenCalledTimes(1);
  });

  it('onApplicationBootstrap() ne déclenche AUCUN envoi (différence Lot 6.5.B → Lot 8.5.E)', () => {
    cron.onApplicationBootstrap();
    expect(alerteService.notifierEcarts).not.toHaveBeenCalled();
  });

  it('calculerMoisPrecedent : 2026-06-05 → "2026-05", 2026-01-15 → "2025-12"', () => {
    expect(cron.calculerMoisPrecedent(new Date(2026, 5, 5))).toBe('2026-05'); // juin
    expect(cron.calculerMoisPrecedent(new Date(2026, 0, 15))).toBe('2025-12'); // janv→déc préc.
    expect(cron.calculerMoisPrecedent(new Date(2026, 11, 5))).toBe('2026-11'); // déc→nov
  });
});
