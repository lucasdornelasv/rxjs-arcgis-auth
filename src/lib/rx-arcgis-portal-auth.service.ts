import {
  of,
  Observable,
  asyncScheduler,
  defer,
  from,
  Subject,
  BehaviorSubject,
} from "rxjs";
import { ArcgisAuthOptions } from "./arcgis-auth-options";
import { ArcgisAuthInfoLike } from "./arcgis-auth-info.model";
import {
  map,
  subscribeOn,
  observeOn,
  mergeMap,
  tap,
  share,
  finalize,
  shareReplay,
  first,
} from "rxjs/operators";

import OAuthInfo from "@arcgis/core/identity/OAuthInfo";
import IdentityManager from "@arcgis/core/identity/IdentityManager";
import Portal from "@arcgis/core/portal/Portal";

export class RxArcgisPortalAuthService {
  private oAuthInfoRegistered = false;

  private _authInfoSubject: Subject<string>;

  private _requireAuthInfoObservable?: Observable<ArcgisAuthInfoLike>;

  constructor(private options: ArcgisAuthOptions) {
    this._authInfoSubject = new BehaviorSubject(undefined as any);
  }

  isAuthorizedAsync() {
    return this.isAuthorized().toPromise();
  }

  isAuthorized() {
    return this.getAuthInfo().pipe(
      map((authInfo) => {
        if (Date.now() < (authInfo?.expiresAt ?? 0)) {
          return true;
        }
        return false;
      })
    );
  }

  requireAuthorizedAsync() {
    return this.requireAuthInfo()
      .pipe(mergeMap(() => this.isAuthorized()))
      .toPromise();
  }

  listenAuthInfo(): Observable<ArcgisAuthInfoLike | null> {
    return this._authInfoSubject.pipe(
      map((authInfoStr) => {
        let authInfo: ArcgisAuthInfoLike | null;
        if (authInfoStr) {
          authInfo = JSON.parse(authInfoStr);
        } else {
          authInfo = null;
        }

        return authInfo;
      }),
      observeOn(asyncScheduler)
    );
  }

  getAuthInfo(): Observable<ArcgisAuthInfoLike | null> {
    return this.listenAuthInfo().pipe(first());
  }

  getToken(): Observable<string | null> {
    return this.getAuthInfo().pipe(
      map((authInfo) => {
        return authInfo?.token ?? null;
      })
    );
  }

  destroyCredentials() {
    if (!this.oAuthInfoRegistered) {
      const info = new OAuthInfo({
        portalUrl: this.options.portalUrl,
        appId: this.options.portalAppId,
        popup: !!this.options.popup,
      });
      IdentityManager.registerOAuthInfos([info]);

      this.oAuthInfoRegistered = true;
    }

    IdentityManager.destroyCredentials();
    this._authInfoSubject.next(undefined as any);
  }

  requireAuthInfo() {
    if (!this._requireAuthInfoObservable) {
      this._requireAuthInfoObservable = new Observable<ArcgisAuthInfoLike>(
        (subscriber) => {
          let info: __esri.OAuthInfo;
          if (!this.oAuthInfoRegistered) {
            info = new OAuthInfo({
              portalUrl: this.options.portalUrl,
              appId: this.options.portalAppId,
              popup: !!this.options.popup,
            });
            IdentityManager.registerOAuthInfos([info]);

            this.oAuthInfoRegistered = true;
          } else {
            info = IdentityManager.findOAuthInfo(this.options.portalUrl);
          }

          const resolveFn = (portalUser) => {
            if (subscriber.closed) {
              return Promise.resolve();
            }

            const portal = new Portal({
              url: this.options.portalUrl,
              user: portalUser,
            });

            const controller = new AbortController();
            const signal = controller.signal;

            subscriber.add(() => {
              controller.abort();
            });

            return portal.load(signal).then(() => {
              if (subscriber.closed) {
                return;
              }

              const userData = portal.user.sourceJSON;
              const authInfo: ArcgisAuthInfoLike = {
                token: portalUser.token,
                userId: userData.id,
                username: userData.username,
                email: userData.email,
                firstName: userData.firstName,
                lastName: userData.lastName,
                fullName: userData.fullName,
                userLevel: userData.level,
                roleId: userData.roleId,
                expiresAt: portalUser.expires,
              };

              this._authInfoSubject.next(JSON.stringify(authInfo));

              subscriber.next(authInfo);
              subscriber.complete();
            });
          };

          const url = info.portalUrl + "/sharing";
          IdentityManager.checkSignInStatus(url)
            .then((portalUser) => resolveFn(portalUser))
            .catch(() => {
              if (subscriber.closed) {
                return;
              }
              IdentityManager.getCredential(url)
                .then((portalUser) => resolveFn(portalUser))
                .catch((err) => {
                  if (subscriber.closed) {
                    return;
                  }

                  subscriber.error(err);
                });
            });
        }
      ).pipe(observeOn(asyncScheduler), share());
    }

    return this._requireAuthInfoObservable;
  }
}
