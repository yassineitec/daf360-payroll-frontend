import { inject } from '@angular/core';
import { CanActivateFn } from '@angular/router';
import { UserStore } from './user.store';
import { environment } from '../../environments/environment';

/**
 * Garde d'authentification — **volontairement identique** à celles de rh, facturation et
 * pointage. Ne pas la faire diverger : si elle échoue ici et pas là-bas, la différence
 * n'est pas dans ce fichier.
 *
 * Historique utile. Cette garde a levé `NG0203: The _UserStore token injection failed`,
 * puis, réécrite en classe, `NG0200: Circular dependency detected for _AuthGuard`, puis,
 * réduite à `inject(Injector)`, un `NG0203` sur `_Injector` **depuis l'intérieur de
 * `R3Injector.hydrate`** — c'est-à-dire depuis une fabrique DI, le contexte d'injection le
 * plus canonique qui soit. C'est ce dernier point qui a tranché : `hydrate` pose
 * l'injecteur courant juste avant d'appeler la fabrique, donc si `inject()` ne le voit
 * pas, les deux fonctions ne viennent pas du même module `@angular/core`.
 *
 * La cause était une dérive de version : payroll avait `@angular/core@21.2.19` installé
 * là où le shell et les autres remotes avaient `21.2.18`. Native Federation déduplique un
 * singleton par nom **et version** ; ne pouvant satisfaire `21.2.19` avec la copie déjà
 * publiée dans l'importmap, il en a servi une seconde à payroll. Le routeur du shell
 * posait alors le contexte dans la copie A et ce `inject()` le lisait dans la copie B.
 *
 * Les cinq `package.json` épinglent désormais `@angular/*` sur une version exacte, le
 * caret `^21.2.0` laissant chaque `npm i` résoudre vers le dernier patch du jour. Même
 * règle que la lib et ngrx (playbook §11).
 */
export const authGuard: CanActivateFn = async () => {
  const userStore = inject(UserStore);

  // Chemin rapide : le store NgRx partagé est déjà peuplé — soit par le bootstrap de cette
  // app, soit par le shell (ou un autre remote fédéré) qui a appelé /api/me en premier.
  // `UserStore.currentUser` lit ce même store, donc ce test couvre les deux cas, `rhToken`
  // compris puisqu'il vit sur la même `MeResponse` canonique.
  if (userStore.isAuthenticated()) return true;

  // Pas encore peuplé : on va le chercher nous-mêmes.
  try {
    await userStore.loadCurrentUser();
    if (userStore.isAuthenticated()) return true;
  } catch {
    // erreur réseau — on tombe dans la redirection
  }

  window.location.href = environment.shellUrl || '/';
  return false;
};
