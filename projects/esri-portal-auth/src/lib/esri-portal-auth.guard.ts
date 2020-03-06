import {
  Resolve,
  CanActivate,
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  CanLoad,
  Route,
  UrlSegment
} from "@angular/router";
import { Injectable } from "@angular/core";
import { EsriPortalAuthService } from "./esri-portal-auth.service";

@Injectable({
  providedIn: "root"
})
export class EsriPortalAuthGuard implements CanActivate, CanLoad {
  constructor(private service: EsriPortalAuthService) {}

  canLoad(route: Route, segments: UrlSegment[]): Promise<boolean> {
    return this.isAuthorized();
  }

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Promise<boolean> {
    return this.isAuthorized();
  }

  protected async isAuthorized() {
    let authorized = await this.service.isAuthorizedAsync();
    if (!authorized) {
      authorized = await this.service.requireAuthorizedAsync();
      return authorized;
    }
    return true;
  }
}
