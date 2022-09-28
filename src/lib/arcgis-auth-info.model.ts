export interface ArcgisAuthInfoLike {
  token: string;
  userId: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  userLevel: string;
  roleId?: string;
  expiresAt: number;
}
