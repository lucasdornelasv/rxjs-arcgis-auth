import { NgModule, ModuleWithProviders } from '@angular/core';
import { EsriPortalAuthService } from './esri-portal-auth.service';
import { EsriPortalAuthGuard } from './esri-portal-auth.guard';
import { CommonModule } from '@angular/common';
import {
	esriPortalAuthOptionsToken,
	EsriPortalAuthOptions
} from './esri-portal-auth-options';

@NgModule({
	imports: [CommonModule],
	providers: [EsriPortalAuthService, EsriPortalAuthGuard]
})
export class EsriPortalAuthModule {
	static forRoot(
		options: EsriPortalAuthOptions
	): ModuleWithProviders<EsriPortalAuthModule> {
		return {
			ngModule: EsriPortalAuthModule,
			providers: [
				{
					provide: esriPortalAuthOptionsToken,
					useValue: options
				}
			]
		};
	}
}
