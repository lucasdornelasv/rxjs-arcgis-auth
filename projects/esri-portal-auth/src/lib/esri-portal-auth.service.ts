import { Injectable, Inject } from "@angular/core";
import { of, Observable, asyncScheduler, defer, from } from "rxjs";
import { ILoadScriptOptions, loadModules } from "esri-loader";
import {
  esriPortalAuthOptionsToken,
  EsriPortalAuthOptions
} from "./esri-portal-auth-options";
import { EsriPortalAuthInfoLike } from "./esri-portal-auth-info.model";
import { map, subscribeOn, observeOn, flatMap, tap } from "rxjs/operators";

@Injectable({
  providedIn: "root"
})
export class EsriPortalAuthService {
  private storage: Storage;
  private storageKey = "__esri-portal-auth.info";

  private esriLoadOptions: ILoadScriptOptions;

  constructor(
    @Inject(esriPortalAuthOptionsToken)
    private options: EsriPortalAuthOptions
  ) {
    if (options.storage === "session") {
      this.storage = sessionStorage;
    } else {
      this.storage = localStorage;
    }

    this.esriLoadOptions = {
      version: "4.14",
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

  getAuthInfo(): Observable<EsriPortalAuthInfoLike> {
    return defer(() => {
      const authInfoJson = this.storage.getItem(this.storageKey);
      if (authInfoJson) {
        const authInfo: EsriPortalAuthInfoLike = JSON.parse(authInfoJson);
        return of(authInfo);
      } else {
        return of(null);
      }
    }).pipe(subscribeOn(asyncScheduler), observeOn(asyncScheduler));
  }

  getToken(): Observable<string> {
    return this.getAuthInfo().pipe(
      map(authInfo => {
        return authInfo && authInfo.token;
      })
    );
  }

  destroyCredentials() {
    return defer(() => {
      return from(
        loadModules(["esri/identity/IdentityManager"], this.esriLoadOptions)
      ).pipe(
        subscribeOn(asyncScheduler),
        tap(([IdentityManager]) => {
          IdentityManager.destroyCredentials();
          this.storage.removeItem(this.storageKey);
        }),
        observeOn(asyncScheduler)
      );
    });
  }

  requireAuthInfo() {
    return new Observable<EsriPortalAuthInfoLike>(subscriber => {
      subscriber.add(
        asyncScheduler.schedule(() => {
          loadModules(
            [
              "esri/portal/Portal",
              "esri/identity/OAuthInfo",
              "esri/identity/IdentityManager"
            ],
            this.esriLoadOptions
          )
            .then(([Portal, OAuthInfo, IdentityManager]) => {
              if (subscriber.closed) {
                return;
              }

              const info = new OAuthInfo({
                portalUrl: this.options.portalUrl,
                appId: this.options.portalAppId,
                popup: !!this.options.popup
              });

              IdentityManager.registerOAuthInfos([info]);

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
                    const authInfo: EsriPortalAuthInfoLike = {
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
              IdentityManager.checkSignInStatus(info.portalUrl + "/sharing")
                .then(portalUser => resolveFn(portalUser))
                .otherwise(() => {
                  IdentityManager.getCredential(
                    info.portalUrl + "/sharing"
                  ).then(portalUser => resolveFn(portalUser));
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
