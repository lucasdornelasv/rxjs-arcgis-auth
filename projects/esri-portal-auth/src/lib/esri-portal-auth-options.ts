import { InjectionToken } from '@angular/core';

export const esriPortalAuthOptionsToken = new InjectionToken(
	'esriPortalAuthOptionsToken'
);

export interface EsriPortalAuthOptions {
	portalUrl: string;
	portalAppId: string;
	storage?: 'local' | 'session';
	popup?: boolean;
}
