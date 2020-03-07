export interface ArcgisAuthOptions {
  portalUrl: string;
  portalAppId: string;
  storage?: "local" | "session";
  popup?: boolean;
}
