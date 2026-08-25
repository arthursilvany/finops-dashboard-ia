# EA Price Sheet vs Azure Pricing Calculator

## Direct Answer

If you sign in to Azure Pricing Calculator with an EA contract and query a SKU that is not eligible in that EA,
the calculator may silently fall back to retail pricing.

That is why financial governance, audits, and executive decisions should use the EA Price Sheet as the source
of truth.

## What Each Tool Is For

### Azure Pricing Calculator (EA signed-in)

- Good for what-if simulation and architecture planning.
- Can compare PAYG, RI, and Savings Plan quickly.
- May show prices for scenarios that are not contract-valid.

### EA Price Sheet

- Contractual price source used for billing and finance controls.
- Contains only valid contracted meters and prices.
- Best source for chargeback, showback, and audit evidence.

## Practical Rule

- Use the calculator for simulation and early design.
- Use EA Price Sheet for real cost, automation, and governance.

If a SKU is not present in the EA Price Sheet, treat it as not contract-priced, even if the calculator can show a
value.

## Decision Matrix

| Scenario | Recommended Source |
| --- | --- |
| Early architecture and what-if analysis | Azure Pricing Calculator |
| Initial business case | Azure Pricing Calculator |
| Approved budget and forecast | EA Price Sheet |
| Chargeback and showback | EA Price Sheet |
| Audit and compliance evidence | EA Price Sheet |

## Recommended FinOps Workflow

1. Use Azure Pricing Calculator for quick scenario exploration.
2. Validate with EA Price Sheet plus actual usage data.
3. Operationalize in ADX/FinOps Hub for repeatable reporting and automation.

## References

- [View and download Azure EA pricing](https://learn.microsoft.com/azure/cost-management-billing/manage/ea-pricing)
- [Pricing overview for Enterprise Agreement](https://learn.microsoft.com/azure/cost-management-billing/manage/ea-pricing-overview)
- [EA price sheet schema and limitations](https://learn.microsoft.com/azure/cost-management-billing/manage/ea-understand-pricesheet)
