// index.ts — điểm vào tầng auth. Bootstrap dựng SqlIdentityResolver, worker gọi resolve().

export { SqlIdentityResolver } from "./resolver.ts";
export { CachedIdentityResolver, authCacheKey } from "./cached-resolver.ts";
export { SqlIdentityRepo } from "./identity-repo.ts";
export { SqlGroupCustomerLookup, SqlCustomerRoomLookup } from "./group-customer.ts";
export type {
  IdentityResolver,
  ResolveInput,
  GroupCustomerLookup,
  GroupLookupInput,
  CustomerRoom,
  CustomerRoomLookup,
} from "./types.ts";
