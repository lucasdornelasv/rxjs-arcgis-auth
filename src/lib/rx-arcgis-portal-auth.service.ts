import {
  of,
  Observable,
  asyncScheduler,
  defer,
  from,
  Subject,
  BehaviorSubject,
} from 'rxjs';
import { ArcgisAuthOptions } from './arcgis-auth-options';
import { ArcgisAuthInfoLike } from './arcgis-auth-info.model';
import {
  map,
  subscribeOn,
  observeOn,
  flatMap,
  tap,
  share,
  finalize,
  shareReplay,
  first,
} from 'rxjs/operators';
import { ILoadScriptOptions, loadModules } from 'esri-loader';

export class RxArcgisPortalAuthService {
  private esriLoadOptions: ILoadScriptOptions;

  private oAuthInfoRegistered = false;

  private _authInfoSubject: Subject<string>;

  private _destroyCredentialsObservable?: Observable<any>;
  private _requireAuthInfoObservable?: Observable<ArcgisAuthInfoLike>;

  constructor(private options: ArcgisAuthOptions) {
    this.esriLoadOptions = {
      version: options.arcgisVersion ?? '4.16',
      css: !!(options.css ?? options.popup),
    };

    this._authInfoSubject = new BehaviorSubject(undefined as any);
  }

  isAuthorizedAsync() {
    return this.isAuthorized().toPromise();
  }

  isAuthorized() {
    return this.getAuthInfo().pipe(
      map((authInfo) => {
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
      })
    );
  }

  getAuthInfo(): Observable<ArcgisAuthInfoLike | null> {
    return this.listenAuthInfo().pipe(first(), observeOn(asyncScheduler));
  }

  getToken(): Observable<string | null> {
    return this.getAuthInfo().pipe(
      map((authInfo) => {
        return authInfo && authInfo.token ? authInfo.token : null;
      })
    );
  }

  destroyCredentials() {
    if (!this._destroyCredentialsObservable) {
      this._destroyCredentialsObservable = defer(() => {
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
                popup: !!this.options.popup,
              });
              IdentityManager.registerOAuthInfos([info]);

              this.oAuthInfoRegistered = true;
            }
            IdentityManager.destroyCredentials();
            this._authInfoSubject.next(undefined as any);
          }),
          observeOn(asyncScheduler)
        );
      }).pipe(
        subscribeOn(asyncScheduler),
        finalize(() => {
          this._destroyCredentialsObservable = undefined;
        }),
        shareReplay()
      );
    }
    return this._destroyCredentialsObservable;
  }

  requireAuthInfo() {
    if (!this._requireAuthInfoObservable) {
      this._requireAuthInfoObservable = new Observable<ArcgisAuthInfoLike>(
        (subscriber) => {
          subscriber.add(
            asyncScheduler.schedule(() => {
              loadModules<
                [
                  __esri.PortalConstructor,
                  __esri.OAuthInfoConstructor,
                  __esri.IdentityManager
                ]
              >(
                [
                  'esri/portal/Portal',
                  'esri/identity/OAuthInfo',
                  'esri/identity/IdentityManager',
                ],
                this.esriLoadOptions
              )
                .then(([Portal, OAuthInfo, IdentityManager]) => {
                  if (subscriber.closed) {
                    return;
                  }

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
                    info = IdentityManager.findOAuthInfo(
                      this.options.portalUrl
                    );
                  }

                  const resolveFn = (portalUser) => {
                    if (subscriber.closed) {
                      return;
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
                    portal
                      .load(signal)
                      .then((data) => {
                        if (subscriber.closed) {
                          return;
                        }

                        const userData = data.user.sourceJSON;
                        const authInfo: ArcgisAuthInfoLike = {
                          token: portalUser.token,
                          username: userData.username,
                          userLevel: userData.level,
                          roleId: userData.roleId,
                          expiresAt: portalUser.expires,
                        };

                        this._authInfoSubject.next(JSON.stringify(authInfo));
                        subscriber.add(
                          asyncScheduler.schedule(() => {
                            subscriber.next(authInfo);
                            subscriber.complete();
                          })
                        );
                      })
                      .catch((err) => {
                        if (subscriber.closed) {
                          return;
                        }

                        subscriber.error(err);
                      });
                  };

                  const url = info.portalUrl + '/sharing';
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
                })
                .catch((err) => {
                  if (subscriber.closed) {
                    return;
                  }

                  subscriber.error(err);
                });
            })
          );
        }
      ).pipe(
        finalize(() => {
          this._requireAuthInfoObservable = undefined;
        }),
        shareReplay()
      );
    }

    return this._requireAuthInfoObservable;
  }
}
