export interface ArcgisAuthInfoLike {
  token: string;
  username: string;
  userLevel: string;
  roleId?: string;
  expiresAt: number;
}
