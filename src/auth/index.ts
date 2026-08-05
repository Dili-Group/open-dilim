// index.ts — điểm vào tầng auth. Bootstrap dựng SqlIdentityResolver, worker gọi resolve().

export { SqlIdentityResolver } from "./resolver.ts";
export { SqlGroupCustomerLookup } from "./group-customer.ts";
export type {
  IdentityResolver,
  ResolveInput,
  GroupCustomerLookup,
  GroupLookupInput,
} from "./types.ts";
