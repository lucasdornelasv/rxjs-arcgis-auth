export interface ArcgisAuthOptions {
  portalUrl: string;
  portalAppId: string;
  arcgisVersion?: string;
  storage?: "local" | "session";
  popup?: boolean;
  css?: boolean;
}
