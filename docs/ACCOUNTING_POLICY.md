# Recorded financial accounting policy — v0.9 candidate

**Proposed product policy; founder/accountant approval pending.** These are explicit
reporting choices, not a representation of compliance with an accounting standard.

Amounts are USD integer microdollars (1 USD = 1,000,000 micros); Stripe USD cents
multiply exactly by 10,000. No floating point or inferred FX. Individual stored
amounts fit PostgreSQL signed BIGINT; aggregates use exact numeric/BigInt. Token
price estimates round each event's positive exact rational cost to the nearest
microdollar with half-up ties; sums retain those recorded event amounts. UI dollar
formatting is display rounding only. Reconciliation tolerances are explicit input,
never hidden corrections to the ledger.

| Reported amount | Contract |
| --- | --- |
| Gross recorded revenue | Sum of original successful payment records in [start,end); unpaid invoices create no receipt |
| Refunds / credits / payment reversals | Separate positive reductions linked to original payment and immutable provider/account/object evidence |
| Net recorded revenue | gross − refunds − credits − reversals for their effective period |
| Provider-reported inference cost | Explicit reported USD micros received with usage; source remains reported |
| Estimated inference cost | Token quantities and trusted effective-dated price/version reference; historical records never silently repriced |
| Unknown inference cost | Missing model/rate/tier data; never converted to zero or included as verified cost |
| Known contribution | net recorded revenue − known tracked inference cost; partial when evidence missing |
| Complete contribution | Same equation only if all tracked usage is priced and financial backlog/evidence resolved |
| Contribution percentage | Rounded basis points only when complete and net revenue > 0; otherwise null |

A refund belongs to its actual effective reduction period, even if the original
payment is older. Reports retain that original link and input hashes. A later
period can have negative net revenue; no percentage is asserted on zero/negative
net revenue. An empty tracked-usage set is not proof no provider usage was missed;
provider reconciliation and operational completeness must corroborate it.

This is **recorded payment/credit attribution**, not accrual recognition, MRR, cash
on bank statement or company-wide net profit. A customer-balance credit reduces
attributed recorded revenue under this proposed policy even though it does not
return cash. Processor fees, taxes, hosting, payroll and other operating costs
are not modeled or subtracted. An invoice payment may include taxes: do not call
this tax-exclusive recognized revenue without an approved upstream allocation.
`invoice.paid` can represent supported provider payment mechanisms; authentic
sandbox/API evidence must confirm the deployment's collection policy. Out-of-band
payments and credits require explicit review; never invent bank settlement.

Original payments are immutable. Reductions require exact original/customer/USD
linkage and cumulative reductions <= payment under a payment-row lock. Stable
provider/account/source-object identity prevents retries and changed event IDs
from double counting. Refund-backed credit notes rely on succeeded refunds; pure
post-payment balance credits require explicit balance-transaction evidence. Mixed,
pre-payment, out-of-band, credit void/reinstatement and complete dispute lifecycles
are unsupported; retain unresolved evidence and fail visibly. Positive
reinstatements need a separately reviewed future policy, not mutation of history.

Stripe account/source links must come from trusted API evidence, not arbitrary
customer metadata. Legacy direct payments without that evidence are not guessed
into account mappings. Unknown currencies/FX, unmatched billing lines, unsupported
provider cache-creation tiers and missing usage keep reconciliation incomplete.
Credits/discounts in provider billing need signed lines and explicit reviewed
allocations; tolerance acceptance does not certify the provider invoice.

Every report retains its normalized inputs, source references, allocations,
tolerances and canonical digest. The ledger/export/reconciliation equations are
synthetically tested. Authentic Stripe/provider billing and independent accounting
approval remain required; no real billing totals or approval are manufactured.

A prepaid provider balance top-up is **not token usage expense**. In particular, a
$5 OpenAI credit purchase does not mean $5 of inference was consumed. Compare the
actual dated usage charges, separately retaining unused credit balance, credits
and other adjustments. For the supplied 25-input/13-output OpenAI sample, event
rounding yields 9 micros, conditional on the reviewed rates; organization-level
9-micro billing corroborates the amount without proving project/key allocation.
See [evidence and outstanding v0.5 gates](OPENAI_INTEGRATION.md#private-openai-billing-validation-v05).
Founder/accountant approval of rounding, cost allocation, coverage and this policy
must be dated and recorded separately; synthetic tests cannot supply that approval.
