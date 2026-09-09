# Commerce decision artifacts

Use this reference for a solopreneur's MVP-to-GTM decision or a shopping/merchant economics
artifact. For prioritization or implementation decisions, load only the relevant existing
[pipeline PRD/TAD/ADR](../../../guides/PRD-TAD-ADR.md),
[feature inventory](../../../guides/FEATURES.md) or
[composition ownership](../../../guides/TECH-STACK.md). Preserve their criterion and RAO identifiers;
link buyer evidence and the actual implementation/check owner for each proposed increment.
A calculation from supplied figures needs no additional repository guide unless an owner
contract affects the calculation or the claim being made.

Apply Constraints -> Argumentation -> Outranking to the observed alternatives:

1. Apply hard limits first: user's budget, available owner interfaces, security, license,
   deployment constraints and source-bound evidence. Unknown eligibility stays unresolved.
2. Record the strongest case and counterevidence for each viable option: real buyer pain,
   willingness to pay, existing usable functionality, remaining effort and delivery risk.
3. Prefer the smallest existing capability that addresses demonstrated pain and can reach a
   complete paid loop. Use the existing `feature:rank` contract when its inputs are available;
   without trusted demand evidence it may correctly select nothing. Do not substitute invented
   weighted scores, market claims or WTP for missing evidence.

For a proposed loop, show discovery -> offer -> explicit buyer confirmation -> owner checkout
-> fulfillment -> receipt/readback -> replay. Bind each step to its actual owner and observed
status. Merchant mutation and shopping checkout keep the product's authorization contract.
Offline drafts or a checkout preview do not establish settlement.

Calculate only from declared units and inputs. For example, contribution per completed order
is collected revenue less that order's attributable payment, inference, fulfillment and refund
costs. Separate fixed operating cost, development effort, margin and cash flow. Mark assumptions
and sensitivity ranges; do not turn a free-tier assumption into a measured $0 operating bill.

The [Anthropic commerce reference](https://github.com/anthropics/commerce-agents) is design
inspiration for separating roles, shared contracts and host runtimes. Its README describes a
checkout handoff and staged merchant changes, not real ordering or charging. Recheck the source
before relying on it; do not copy its code, prompts, skills, tests or schemas or add its packages.

An artifact may explain an incomplete loop. It may claim production readiness or first revenue
only when the actual deployed owner versions, authenticated readback, provider transaction and
replay evidence support that claim. Missing evidence names the affected step, not a fabricated pass.
