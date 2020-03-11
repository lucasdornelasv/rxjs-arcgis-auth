import { of, Observable, asyncScheduler, defer, from } from 'rxjs';
import { ArcgisAuthOptions } from './arcgis-auth-options';
import { ArcgisAuthInfoLike } from './arcgis-auth-info.model';
import { map, subscribeOn, observeOn, flatMap, tap } from 'rxjs/operators';
import { ILoadScriptOptions, loadModules } from 'esri-loader';

export class RxArcgisPortalAuthService {
  private storage: Storage;
  private storageKey = 'arcgis-portal-auth.info';

  private esriLoadOptions: ILoadScriptOptions;

  private oAuthInfoRegistered = false;

  constructor(private options: ArcgisAuthOptions) {
    if (options.storage === 'session') {
      this.storage = sessionStorage;
    } else {
      this.storage = localStorage;
    }

    this.esriLoadOptions = {
      version: '4.14',
      css: !!this.options.popup
    };
  }

  isAuthorizedAsync() {
    return this.isAuthorized().toPromise();
  }

  isAuthorized() {
    return this.getAuthInfo().pipe(
      map(authInfo => {
        if (
          authInfo &&
          authInfo.token &&
          authInfo.expiresAt &&
          Date.now() < authInfo.expiresAt
        ) {
          return true;
        }
        return false;
      })
    );
  }

  requireAuthorizedAsync() {
    return this.requireAuthInfo()
      .pipe(flatMap(() => this.isAuthorized()))
      .toPromise();
  }

  getAuthInfo(): Observable<ArcgisAuthInfoLike | null> {
    return defer(() => {
      const authInfoJson = this.storage.getItem(this.storageKey);
      if (authInfoJson) {
        const authInfo: ArcgisAuthInfoLike = JSON.parse(authInfoJson);
        return of(authInfo);
      } else {
        return of(null);
      }
    }).pipe(subscribeOn(asyncScheduler), observeOn(asyncScheduler));
  }

  getToken(): Observable<string | null> {
    return this.getAuthInfo().pipe(
      map(authInfo => {
        return authInfo && authInfo.token ? authInfo.token : null;
      })
    );
  }

  destroyCredentials() {
    return defer(() => {
      return from(
        loadModules(
          ['esri/identity/OAuthInfo', 'esri/identity/IdentityManager'],
          this.esriLoadOptions
        )
      ).pipe(
        tap(([OAuthInfo, IdentityManager]) => {
          if (!this.oAuthInfoRegistered) {
            const info = new OAuthInfo({
              portalUrl: this.options.portalUrl,
              appId: this.options.portalAppId,
              popup: !!this.options.popup
            });
            IdentityManager.registerOAuthInfos([info]);

            this.oAuthInfoRegistered = true;
          }
          IdentityManager.destroyCredentials();
          this.storage.removeItem(this.storageKey);
        }),
        observeOn(asyncScheduler)
      );
    }).pipe(subscribeOn(asyncScheduler));
  }

  requireAuthInfo() {
    return new Observable<ArcgisAuthInfoLike>(subscriber => {
      subscriber.add(
        asyncScheduler.schedule(() => {
          loadModules(
            [
              'esri/portal/Portal',
              'esri/identity/OAuthInfo',
              'esri/identity/IdentityManager'
            ],
            this.esriLoadOptions
          )
            .then(([Portal, OAuthInfo, IdentityManager]) => {
              if (subscriber.closed) {
                return;
              }

              let info;
              if (!this.oAuthInfoRegistered) {
                info = new OAuthInfo({
                  portalUrl: this.options.portalUrl,
                  appId: this.options.portalAppId,
                  popup: !!this.options.popup
                });
                IdentityManager.registerOAuthInfos([info]);
    
                this.oAuthInfoRegistered = true;
              } else {
                info = IdentityManager.findOAuthInfo(this.options.portalUrl);
              }

              const resolveFn = portalUser => {
                if (subscriber.closed) {
                  return;
                }

                const portal = new Portal({
                  url: this.options.portalUrl,
                  user: portalUser
                });
                portal
                  .load()
                  .then(data => {
                    if (subscriber.closed) {
                      return;
                    }

                    const userData = data.user.sourceJSON;
                    const authInfo: ArcgisAuthInfoLike = {
                      token: portalUser.token,
                      username: userData.username,
                      userLevel: userData.level,
                      expiresAt: portalUser.expires
                    };
                    this.storage.setItem(
                      this.storageKey,
                      JSON.stringify(authInfo)
                    );
                    subscriber.add(
                      asyncScheduler.schedule(() => {
                        subscriber.next(authInfo);
                        subscriber.complete();
                      })
                    );
                  })
                  .catch(err => {
                    if (subscriber.closed) {
                      return;
                    }

                    subscriber.error(err);
                  });
              };

              const url = info.portalUrl + '/sharing';
              IdentityManager.checkSignInStatus(url)
                .then(portalUser => resolveFn(portalUser))
                .otherwise(() => {
                  IdentityManager.getCredential(url)
                    .then(portalUser => resolveFn(portalUser))
                    .catch(err => {
                      if (subscriber.closed) {
                        return;
                      }

                      subscriber.error(err);
                    });
                });
            })
            .catch(err => {
              if (subscriber.closed) {
                return;
              }

              subscriber.error(err);
            });
        })
      );
    });
  }
}
