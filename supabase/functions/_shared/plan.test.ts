import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { planForStatus } from "./plan.ts";

Deno.test("active and trialing map to pro", () => {
  assertEquals(planForStatus("active"), "pro");
  assertEquals(planForStatus("trialing"), "pro");
});

Deno.test("everything else maps to free", () => {
  assertEquals(planForStatus("canceled"), "free");
  assertEquals(planForStatus("past_due"), "free");
  assertEquals(planForStatus("unpaid"), "free");
  assertEquals(planForStatus("incomplete"), "free");
  assertEquals(planForStatus(""), "free");
});
