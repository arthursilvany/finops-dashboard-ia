export const dynamic = 'force-dynamic';
import { NextResponse } from "next/server";
import { getActiveConfig, isMockMode } from "@/lib/adx-client";
import {
  getCustomerAssessment,
  getCustomerAssessmentForRequest,
} from "@/lib/customer-assessment";
import {
  getCustomerDatasetInfo,
  getCustomerDatasetInfoForRequest,
} from "@/lib/customer-dataset-info";

export async function GET(request?: Request) {
  const config = getActiveConfig();
  const mock = isMockMode();
  // A customer Cost Export only takes effect while ADX is not configured.
  const customerDataset = mock
    ? request
      ? getCustomerDatasetInfoForRequest(request)
      : getCustomerDatasetInfo()
    : null;
  const assessment = mock
    ? request
      ? getCustomerAssessmentForRequest(request)
      : getCustomerAssessment()
    : null;

  const runtimeCustomerDataset =
    customerDataset && assessment
      ? {
          ...customerDataset,
          partialPages: [
            ...customerDataset.partialPages.filter(
              ({ page }) => page !== "/workload" && page !== "/agentic-finops",
            ),
            {
              page: "/workload",
              caveat:
                "Workload KPIs, CPU scatter and rightsizing use the collected Resource Graph, Advisor and Metrics snapshots when available. Missing optional evidence returns a real empty assessment state rather than sample data.",
            },
            {
              page: "/agentic-finops",
              caveat:
                "Agentic FinOps recommendations come from the collected Advisor cost snapshot. Live tenant execution and approval workflows remain disabled in customer assessment mode.",
            },
          ],
          sampleOnlyPages: customerDataset.sampleOnlyPages.filter(
            (page) => page !== "/workload" && page !== "/agentic-finops",
          ),
        }
      : customerDataset;

  return NextResponse.json({
    clusterUri: config.clusterUri,
    database: config.database,
    source: config.source,
    isMock: mock,
    dataSource: mock ? (runtimeCustomerDataset ? "customer" : "mock") : "adx",
    customerDataset: runtimeCustomerDataset,
  });
}
