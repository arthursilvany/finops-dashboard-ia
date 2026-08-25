import { z } from "zod";

const csvArray = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(",").filter(Boolean) : []));

const tagSchema = z
  .string()
  .optional()
  .transform((v) => {
    if (!v) return [];
    try {
      const parsed = JSON.parse(v);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (t: unknown) =>
          typeof t === "object" &&
          t !== null &&
          "key" in t &&
          "values" in t &&
          typeof (t as Record<string, unknown>).key === "string" &&
          Array.isArray((t as Record<string, unknown>).values),
      );
    } catch {
      return [];
    }
  });

export const filterSchema = z.object({
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  /**
   * Cloud providers ("Azure", "AWS", ...). Empty means every provider, which
   * keeps every existing single-cloud URL working unchanged.
   */
  providers: csvArray,
  subscriptions: csvArray,
  regions: csvArray,
  services: csvArray,
  resourceGroups: csvArray,
  tags: tagSchema,
  currency: z.enum(["billing", "usd"]).optional().default("billing"),
});

export type ParsedFilters = z.infer<typeof filterSchema>;
