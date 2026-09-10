import type { Env } from "@/lib/env";
import { FakeInstagramApiClient, GraphInstagramApiClient, type InstagramApiClient } from "./api";

export function createInstagramApiClient(env: Env): InstagramApiClient {
  if (process.env.USE_FAKE_INSTAGRAM === "1") {
    return new FakeInstagramApiClient();
  }
  return new GraphInstagramApiClient({
    pageAccessToken: env.INSTAGRAM_PAGE_ACCESS_TOKEN,
    businessAccountId: env.INSTAGRAM_BUSINESS_ACCOUNT_ID,
  });
}

export * from "./api";
export * from "./webhook";
