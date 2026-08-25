export const EXECUTION_LOG_KQL = `
FinOpsExecutionLog
| project executionId, resourceId, resourceName, action, beforeCost, afterCost,
         status, executedBy, timestamp, recommendationId, rollbackStatus
| order by timestamp desc
| take 50
`;

export const EXECUTION_SAVINGS_KQL = `
let execLog = FinOpsExecutionLog
  | where status == "success"
  | project resourceId, resourceName, action, beforeCost, estimatedAfterCost, actualAfterCost, timestamp;
execLog
| extend estimatedSavings = beforeCost - estimatedAfterCost,
         actualSavings = beforeCost - actualAfterCost,
         accuracy = iff(beforeCost - estimatedAfterCost == 0, 100.0,
           round((beforeCost - actualAfterCost) / (beforeCost - estimatedAfterCost) * 100, 1))
| order by timestamp desc
`;
