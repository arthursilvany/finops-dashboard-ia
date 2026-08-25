#!/usr/bin/env python3
"""Batch test all finops-dashboard API endpoints."""
import json
import urllib.request
import sys

BASE = "http://localhost:3000/api"

ENDPOINTS = [
    "cost-summary/kpi",
    "cost-summary/by-service",
    "cost-summary/by-subscription",
    "cost-summary/daily",
    "cost-summary/over-time",
    "anomalies/summary",
    "anomalies/timeline",
    "anomalies/top-resources",
    "budgets/vs-actual",
    "budgets/by-subscription",
    "budgets/forecast",
    "budgets/burn-rate",
    "chargeback/kpi",
    "chargeback/by-bu",
    "chargeback/trend",
    "governance/kpi",
    "governance/tag-compliance",
    "governance/budget-vs-actual",
    "reservations/detail",
    "reservations/options",
    "reservations/trend",
    "rate-optimization/savings",
    "rate-optimization/idle",
    "rate-optimization/commitment-gap",
    "rate-optimization/actions",
    "workload/kpi",
    "workload/rightsizing",
    "workload/cpu-scatter",
    "ai-insights",
    "filters/options",
]

results = {"ok": [], "fail": [], "mock": []}

for ep in ENDPOINTS:
    url = f"{BASE}/{ep}"
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=90) as resp:
            body = json.loads(resp.read())
            is_mock = body.get("metadata", {}).get("isMock")
            status = resp.status
            if is_mock:
                results["mock"].append(ep)
                tag = "MOCK"
            else:
                results["ok"].append(ep)
                tag = "REAL"
            print(f"  ✅ {ep:40s} {status} {tag}")
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:200]
        results["fail"].append((ep, e.code, body))
        print(f"  ❌ {ep:40s} {e.code} {body[:80]}")
    except Exception as e:
        results["fail"].append((ep, 0, str(e)[:100]))
        print(f"  ❌ {ep:40s} ERR  {str(e)[:80]}")

print(f"\n{'='*60}")
print(f"REAL: {len(results['ok'])} | MOCK: {len(results['mock'])} | FAIL: {len(results['fail'])}")
if results["fail"]:
    print("\nFailed endpoints:")
    for ep, code, msg in results["fail"]:
        print(f"  {ep}: HTTP {code} — {msg[:120]}")
if results["mock"]:
    print("\nMock endpoints:")
    for ep in results["mock"]:
        print(f"  {ep}")
