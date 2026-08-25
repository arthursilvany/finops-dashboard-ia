/**
 * Guard for KQL that originates from untrusted input (LLM tool calls driven by
 * user-supplied chat messages). The LLM prompt is attacker-influenced, so the
 * tool layer — not the prompt — must enforce what can reach the ADX cluster.
 *
 * Strategy: deny management commands and any construct that can reach data or
 * endpoints outside the dashboard's own databases (cross-cluster, external
 * data, HTTP plugins, ingestion/export sinks).
 */

const DEFAULT_ALLOWED_DATABASES = ["Hub", "Ingestion"];

function allowedDatabases(): string[] {
  const configured = process.env.ADX_DATABASE?.trim();
  return configured
    ? [...DEFAULT_ALLOWED_DATABASES, configured]
    : DEFAULT_ALLOWED_DATABASES;
}

const BLOCKED_CONSTRUCTS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\bexternaldata\s*\(/i,
    reason: "externaldata() is not allowed",
  },
  {
    pattern: /\bcluster\s*\(/i,
    reason: "cross-cluster queries are not allowed",
  },
  {
    pattern: /\bevaluate\s+http_request(_post)?\b/i,
    reason: "the http_request plugin is not allowed",
  },
  {
    pattern: /\b(http_request|http_request_post)\s*\(/i,
    reason: "the http_request plugin is not allowed",
  },
  {
    pattern: /\bevaluate\s+(sql_request|cosmosdb_sql_request|mysql_request|postgresql_request|azure_digital_twins_query_request)\b/i,
    reason: "external request plugins are not allowed",
  },
  {
    pattern: /\binto\s+(table|externaltable)\b/i,
    reason: "write sinks are not allowed",
  },
  {
    pattern:
      /\.\s*(set|set-or-append|set-or-replace|append|ingest|export|drop|delete|purge|replace|rename|move|create|create-or-alter|alter|execute)\b/i,
    reason: "mutation and management commands are not allowed",
  },
];

export interface KqlGuardResult {
  ok: boolean;
  reason?: string;
}

/**
 * Validates that a KQL string is a read-only query scoped to this workload's
 * own databases. Returns `{ ok: false, reason }` when it must be rejected.
 */
export function validateReadOnlyKql(query: unknown): KqlGuardResult {
  if (typeof query !== "string" || query.trim().length === 0) {
    return { ok: false, reason: "Query must be a non-empty string." };
  }

  const trimmed = query.trim();

  // Management commands are routed to /v1/rest/mgmt by the ADX client.
  if (trimmed.startsWith(".")) {
    return {
      ok: false,
      reason:
        "Management commands (queries starting with '.') are not allowed. Only read-only queries.",
    };
  }

  // A management command can only be smuggled in after a statement separator.
  if (/;\s*\./.test(trimmed)) {
    return {
      ok: false,
      reason:
        "Management commands (queries starting with '.') are not allowed. Only read-only queries.",
    };
  }

  for (const { pattern, reason } of BLOCKED_CONSTRUCTS) {
    if (pattern.test(trimmed)) {
      return { ok: false, reason: `Query rejected: ${reason}.` };
    }
  }

  // database('X') is legitimate for this workload, but only for its own databases.
  const allowed = allowedDatabases().map((d) => d.toLowerCase());
  const databaseRefPattern = /\bdatabase\s*\(\s*(['"])([^'"]*)\1\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = databaseRefPattern.exec(trimmed)) !== null) {
    if (!allowed.includes(match[2].toLowerCase())) {
      return {
        ok: false,
        reason: `Query rejected: database('${match[2]}') is not allowed. Allowed databases: ${allowedDatabases().join(", ")}.`,
      };
    }
  }

  // Reject dynamic database references such as database(strcat(...)).
  if (/\bdatabase\s*\(/i.test(trimmed.replace(/\bdatabase\s*\(\s*(['"])[^'"]*\1\s*\)/gi, ""))) {
    return {
      ok: false,
      reason:
        "Query rejected: database() must reference an allowed database as a string literal.",
    };
  }

  return { ok: true };
}
