# Atlas Bookkeeping Platform — Backend Architecture
**For CTO Review · v1.0 · Source: maven-backend**

---

## Executive Summary

The Atlas bookkeeping platform is a multi-tenant Django/DRF backend that ingests raw bank statements and produces fully categorised, ledger-ready transactions. The core pipeline is an orchestrated **Workflow engine** where named Nodes run either as Celery background tasks or synchronous human-gate steps, sharing a mutable context dict serialised to Postgres after every step. Categorisation follows a three-layer funnel — deterministic static rules, regex-based dynamic rules, then LLM embedding clustering — each layer consuming only what the previous left unmatched. A parallel routing system assigns non-categorisation **Strategies** (transfer, income split, check) to transactions by evaluating **Recipe** conditions at persist time, stamping `Transaction.routing_intent` and `Transaction.applied_strategy_config` on each row.

---

## 1. Core Concepts

### 1.1 Intent

The **why / what / whom** of a transaction.

**Current (merged):** A single field on `Transaction`:
```
Transaction.routing_intent  CharField(50)  nullable
                            choices = RoutingModule.CHOICES
                            NULL → default categorisation path
                            "transfer" | "income_split" | "check" | ...
```

**Planned (branch `fix/separate-persist-from-llm-categorize`):** A richer `TransactionIntent` model:
```
TransactionIntent
├── transaction               FK → Transaction  (nullable — set after LLM categorise)
├── workflow_execution_id     BigIntegerField   (join key before transaction exists)
├── source_row_index          IntegerField
├── purpose                   CharField         (LLM-inferred: e.g. "payroll", "rent")
├── medium                    CharField         (e.g. "ach", "wire", "card")
├── entity_type               CharField         (e.g. "vendor", "employee", "processor")
├── confidence                FloatField
└── source                    CharField         (IntentSource.LLM | RULE | MANUAL)
```

Intent inference runs at the **start** of the pipeline via `IntentInferenceService` (OpenAI via Vault) and `IntentDedupService` (caches by description to avoid redundant LLM calls).

### 1.2 Strategy

A **handler** for a class of transactions that require specialised reconciliation logic beyond simple COA assignment.

| RoutingModule | DB value | Config model | Handler |
|---|---|---|---|
| `CATEGORISATION` | `"categorisation"` | (none) | Static → Dynamic → LLM pipeline |
| `INCOME_SPLIT` | `"income_split"` | `ProcessorConfig` + `IncomeConfig` | Gross-up net payout to charges / refunds / fees |
| `TRANSFER` | `"transfer"` | `TransferConfig` | Match debit/credit pairs via `TransferMatchingService` |
| `CHECK` | `"check"` | `CheckMatchConfig` | Await `CheckItem` from scanned PDFs |
| `EXPENSE_SPLIT` | `"expense_split"` | *(reserved, not implemented)* | Itemised receipt matching |
| `ASK_MY_ACCOUNTANT` | *(planned)* | — | Human escalation |

`StrategyConfig` is a **bridge model** — no `strategy_type` column; `strategy_type` is a derived property that inspects which FK is populated:

```
StrategyConfig
├── processor_config  → ProcessorConfig   (income_split)
│                         charges_coa, refunds_coa, fees_coa, max_date_gap
├── transfer_config   → TransferConfig    (transfer)
│                         max_date_gap, amount_tolerance
├── check_config      → CheckMatchConfig  (check)
└── receipt_config    → ReceiptMatchConfig
```

### 1.3 Recipe

The **account-level routing configuration** for a specific `CapitalAccount`. A Recipe is the composition of `RoutingRule` + `StrategyConfig` rows scoped to that account. There is no single `Recipe` model — the concept is emergent.

```
CapitalAccount
      │
      ├──[1:N]── RoutingRule ──────────────────────── conditions (JSONField)
      │              │    priority ASC, first match wins    description_pattern (regex)
      │              │                                      counterparty_pattern (regex)
      │              │                                      direction: inflow | outflow
      │              │                                      amount_min / amount_max
      │              │
      │              └──[0:1]── StrategyConfig ─── strategy_type (derived)
      │                               │
      │                               └── ProcessorConfig | TransferConfig |
      │                                   CheckMatchConfig | ReceiptMatchConfig
      │
      └── static_rules_cache / dynamic_rules_cache  (Postgres JSONField — fallback)
```

**Recipe lifecycle:**

```
PHASE 1 — Onboarding (one-time)
  seed_routing_rules(account_id, team_id)
  update_transfer_config(account_id, ...)
  seed_income_split_config(account_id, team_id, source_counterparty, ...)

PHASE 2 — Apply (every bank statement upload)
  for each bank row, rules evaluated in priority ASC order:
    conditions match? → routing_intent = strategy_type, strategy_config_id stamped
    no match?         → routing_intent = CATEGORISATION

PHASE 3 — Refine (ongoing)
  Admin adds / edits RoutingRule rows as new patterns emerge
  StrategyConfig parameters updated when processors / accounts change
```

---

## 2. Data Pipeline

```
PDF / CSV bank statement
        │
        ▼
┌─────────────────────────────────────────────────────────────────┐
│ ParsePdfNode  (background)                                       │
│  - Parse rows → csv_bank_statement_data (Date / Desc / Amount)  │
│  - Write BankStatementLineDocument to MongoDB (audit trail)     │
│  - Detect duplicates against prior batches                      │
└────────────────────────────┬────────────────────────────────────┘
                             │
             ┌───────────────▼───────────────────┐
             │  [PLANNED — branch not merged]     │
             │  InferIntentNode  (background)      │
             │   IntentDedupService (cache hit?)   │
             │   IntentInferenceService (OpenAI)   │
             │   RoutingRulesEngine.match()        │
             │   → TransactionIntent created       │
             │     non-cat rows → persisted now    │
             │     cat rows → stay in pipeline     │
             └───────────────────────────────────┘
                             │ (current: all rows continue)
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ ApplyStaticRulesNode  (background, self-loop)                   │
│  - Load static RulesSnapshot from MongoDB                       │
│  - Exact case-insensitive match on description                  │
│  - Matched → "Rule Match Status" = "Single Match" (locked)      │
│  - Writes csv_categorized_data, sets proceed flag on completion │
└────────────────────────────┬────────────────────────────────────┘
                             │ unmatched rows pass through
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ ApplyDynamicRulesNode  (background, self-loop)                  │
│  - Load dynamic RulesSnapshot from MongoDB                      │
│  - Rules sorted by Similarity Threshold DESC (most specific 1st)│
│  - re.search(regex, description, IGNORECASE) per row            │
│  - Static-matched rows: SKIPPED (never overwritten)             │
│  - Matched   → rule_match_status = "Single Match"               │
│  - Unmatched → rule_match_status = "No Match"                   │
└────────────────────────────┬────────────────────────────────────┘
                             │ rows where NEITHER status = "Single Match"
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ LLMCategorizeNodeV2  (background)                               │
│  - clean_description() strips dates / transaction IDs           │
│  - Inflow / outflow clustered separately per round              │
│  Round 1: threshold 0.85 → LLM assigns COA to each cluster     │
│  Round 2: 0.90  (rejects from R1)                               │
│  Round 3: 0.95  (rejects from R2)                               │
│  Round 4: 0.98  (force-accept all remaining)                    │
│  - Counterparty override from Django Counterparty model         │
│  - _link_intent_records() closes placeholder TransactionIntents │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ PersistTransactionsNode  (foreground)                           │
│  - bulk_create Transaction rows                                 │
│  - routing_intent stamped (currently always CATEGORISATION)     │
│  - applied_strategy_config FK stamped                           │
│  - _enrich_persisted_transactions():                            │
│      receipt matching, transfer detection, dup detection        │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
            Postgres: bank_feeds_transaction
                             │
            ┌────────────────▼─────────────────┐
            │  Strategy handlers (post-persist)  │
            │                                    │
            │  routing_intent = "transfer"   →   │
            │    TransferMatchingService         │
            │                                    │
            │  routing_intent = "income_split" → │
            │    ProcessorPayout reconciliation  │
            │                                    │
            │  routing_intent = "check"       →  │
            │    CheckItem matching              │
            └────────────────────────────────────┘

━━━━━━━━━━━━━━ RULE GENERATION (feedback loop) ━━━━━━━━━━━━━━

  Historical GL (Google Sheets / CSV)
         │
         ▼
  TeamOnboardingWorkflow / CreateRulesFromGLWorkflow
         │
         ├─ GenerateSingleCapitalGLNode → GlSnapshotDocument   (MongoDB)
         ├─ IdentifyStaticRulesNode    → RulesSnapshot "static" (MongoDB)
         │    groups by description, stores rm_transactions_covered
         └─ DynamicRulesPipelineNodeV2 → RulesSnapshot "dynamic" (MongoDB)
              LLM clustering (pos/neg split), stores pm_transactions_covered
                                ↑
                       Read by ApplyStaticRulesNode
                       and ApplyDynamicRulesNode
                       on every bank statement run
```

**Key pipeline invariants:**
- Static rules use exact string equality. Dynamic rules use regex. Static fires first and its output is **never overwritten** by any downstream node.
- Dynamic rules sort by `Similarity Threshold` descending — most specific rule wins on multi-match.
- `LLMCategorizeNodeV2` receives zero already-categorised rows — it only processes what fell through both rule layers.
- MongoDB fallback: if no `RulesSnapshot` exists, `MongoRulesDataSource` falls back to `CapitalAccount.static_rules_cache` / `dynamic_rules_cache` (Postgres JSONField) and self-heals by writing back to MongoDB.

---

## 3. Workflow Engine

### 3.1 Node Graph Model

```
Workflow subclass
├── nodes:       Dict[str, WorkflowNode]       keyed by workflow_node_name
├── transitions: Dict[str, List[Transition]]   keyed by source node name
└── context:     Dict[str, Any]                shared blackboard, serialised to DB

Transition
├── from_node:  str
├── to_node:    str
└── condition:  Optional[Callable[[Dict], bool]]   # None = unconditional
```

After a node executes, `_determine_next_node()` iterates the transition list for the current node and returns the first `to_node` whose condition evaluates `True` against the context. `None` condition = always fires. Self-loops handle pagination: a node re-executes until it writes a `_proceed_to_next = True` flag to context.

### 3.2 Node Execution Model

```
execute_current_node() resolution:
  1. CELERY_TASK_ALWAYS_EAGER set?          → synchronous (test mode)
  2. node.execute_in_background = False?    → synchronous (foreground / human gate)
  3. explicit override from caller?         → use that value
  4. else                                   → background (Celery)

Background path:
  create WorkflowNodeExecution (PENDING)
  → dispatch execute_workflow_node Celery task
  [Celery worker]
  → reconstruct Workflow from execution.workflow_class_path
  → call execute_current_node(execute_in_background=False)

Foreground path:
  node.run(input_data)          Pydantic validation → node.execute() → writes to context
  _determine_next_node()
  transaction.atomic():
    save_state()                serialise context → WorkflowExecution.context (JSONField)
    update current_node_reference
    upsert WorkflowNodeExecution → SUCCESS
  maybe_dispatch_next_background_node()   if auto_chain_background_nodes=True
```

### 3.3 Versioning

```
WorkflowRegistry (singleton)
  scans generic_workflows/ and tenant_workflows/ for */workflow/main.py
  _path_to_class[path]  → versioned lookup
  _workflows[name]      → latest version (last write wins on same name)

At execution creation:
  AllowedWorkflow rows for team ordered by -id (newest first)
  → first whose workflow_name matches request = selected class
  → WorkflowExecution.workflow_class_path stamped (immutable)

In Celery task:
  registry.get_workflow_by_path(execution.workflow_class_path)  ← preferred
  or registry.get_workflow(execution.workflow_name)             ← fallback for old rows
```

---

## 4. Data Architecture

### 4.1 Postgres — Transactional Source of Truth

| Table | Model | Purpose |
|---|---|---|
| `bank_feeds_transaction` | `Transaction` | One row per categorised entry. Carries `routing_intent`, `applied_strategy_config`, `categorization_source`, COA FK, review_status. |
| `bank_feeds_capitalaccount` | `CapitalAccount` | Per-account config. `static_rules_cache` / `dynamic_rules_cache` as Postgres fallback. |
| `bank_feeds_routingrule` | `RoutingRule` | Account-level routing rules with `conditions` JSONField and `strategy_config` FK. |
| `reconciliation_strategyconfig` | `StrategyConfig` | Bridge to concrete strategy configs. |
| `workflows_workflowexecution` | `WorkflowExecution` | Run state: `context` (JSONField), `current_node_reference`, `workflow_class_path`. |
| `workflows_workflownodeexecution` | `WorkflowNodeExecution` | Per-node execution record: status, timing, task_id. |
| `workflows_allowedworkflow` | `AllowedWorkflow` | Per-team feature flag: which workflow paths are enabled. |

### 4.2 MongoDB — Append-Only Snapshots

All writes are inserts (never in-place updates). "Current state" = `find_one(..., sort=[("created_at", -1)])`.

| Collection | Contents | Natural key |
|---|---|---|
| `accounting_bookkeeping_gl_snapshots` | Filtered GL rows per capital account | `{team_id}:{account_name}:{gsheet_url}` |
| `accounting_bookkeeping_rules_snapshots` | Static or dynamic rule list; `groups_flagged_for_review`; `gl_entries_count` | `{team_id}:{account_name}:{rule_type}` |
| `accounting_bookkeeping_coa_snapshots` | COA account list | `{team_id}:{gsheet_url}` |
| `accounting_bookkeeping_counterparty_snapshots` | Counterparty names + account mapping | `{team_id}:{gsheet_url}` |
| `accounting_bookkeeping_bank_statement_lines` | Raw date/description/amount rows (audit + dedup) | `{team_id}:{workflow_execution_id}:{idx}` |

**Entity ID stability:** A `natural_key → UUID` indirection (`entity_id_map` collection) ensures the same logical entity (e.g. "Chase CC 5770 static rules") always references the same document ID, even when regenerated from a different sheet URL.

**All snapshot writes are non-fatal** (`try_snapshot_*` helpers): a MongoDB outage never blocks the categorisation workflow.

### 4.3 Why Split

| Concern | Postgres | MongoDB |
|---|---|---|
| ACID guarantees | Required — transactions, audit trail | Not required — snapshots are independent |
| Schema stability | Fixed FK constraints, migrations | Rules structure evolves; append-only is natural |
| Data size | One row per transaction (manageable) | GL snapshots: thousands of rows per account |
| Failure tolerance | Must be consistent | Can be stale — Postgres cache is fallback |

---

## 5. Multi-Tenancy and Operations

### 5.1 Schema-Per-Tenant

```
public schema
├── business_business       tenant registry
├── business_domain         domain → tenant mapping
└── accounts_*              shared user accounts

<tenant> schema (e.g. "atlas", "beta")
├── bank_feeds_*            bookkeeping models
├── reconciliation_*        strategy configs, payouts
├── workflows_*             execution records, AllowedWorkflow
└── teams_*                 team membership
```

`HeaderTenantMiddleware` reads `X-Tenant-Schema` and activates the schema via `connection.set_schema()`. All ORM queries in that request thread automatically hit the correct search path — no application-level `tenant_id` filter needed.

### 5.2 Celery Routing

Queue name: `{app}-{env}-{schema_name}-{queue_suffix}` e.g. `maven-backend-production-atlas-workflow-default-queue`

`TenantAndTeamAwareTask.apply_async()` injects `schema_name` + `team_id` into every task payload. The worker reconstructs both contexts before calling the task body. Broker: **Google Cloud Pub/Sub**; tenant subscriptions registered at worker startup.

---

## 6. Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Rule matching order | Static → Dynamic → LLM | Cheapest / most deterministic first; LLM only processes residual |
| Static match lock | `"Rule Match Status" = "Single Match"` written by static node; all downstream nodes check before overwriting | Prevents weaker dynamic/LLM signal degrading a deterministic match |
| MongoDB append-only | Snapshots are inserts, never updates | Full version history retained; stale reads are safe; no migration drift |
| Postgres JSONField fallback | `CapitalAccount.static_rules_cache` / `dynamic_rules_cache` | MongoDB outage must not break categorisation |
| Workflow context as blackboard | Single mutable dict, serialised after each node | Full state in one JSON blob enables crash-resume without re-running prior nodes |
| `workflow_class_path` stamped at creation | Immutable on `WorkflowExecution` | Mid-flight executions never affected by a new deployment's registry ordering |
| StrategyConfig bridge model | `strategy_type` derived from which FK is set, not a DB column | Adding a new strategy = new concrete config model + new FK; no enum migration |
| LLM clustering: 4 rounds | 0.85 → 0.90 → 0.95 → 0.98, force-accept on R4 | Coarse clusters handle obvious groups cheaply; force-accept guarantees 100% coverage |
| Schema-per-tenant | PostgreSQL schema isolation via `django-tenants` | True data isolation without application-level `tenant_id` on every query |

---

## 7. Architecture Gaps and Roadmap

| Area | Current State | Target |
|---|---|---|
| **Intent Inference** | `routing_intent` is always `CATEGORISATION` (InferIntentNode not merged) | `InferIntentNode` as first pipeline step; LLM infers `purpose / medium / entity_type` per description; non-cat transactions persisted immediately |
| **Recipe as first-class entity** | Implicit — `RoutingRule` + `StrategyConfig` rows scoped to account | Dedicated `Recipe` model with version history, diff view, and clone-for-new-client |
| **RoutingRule scoping** | No `CapitalAccount` FK on current `RoutingRule` — team-level rules | Planned `IntentRoutingRule` model carries `bookkeeping_account` FK (account-scoped) |
| **expense_split strategy** | Constant defined, no handler or config model | `ExpenseSplitConfig` + itemised receipt matching handler |
| **Sub-workflow invocation** | Nodes copied explicitly across workflows | `SubWorkflowNode` pattern — parent invokes named child, merges context on completion |
| **GL context size** | Full rows stored in workflow context JSON | Stream from GCS for GL > 10K rows; store URL + metadata only |
| **Coverage analytics** | Per-run stats in execution context | Time-series: trend of rule coverage % across runs |
| **Celery tenant subscription** | Registered once at worker startup | Dynamic subscription on tenant provisioning (no worker restart required) |

---

*Atlas · Confidential · Backend Architecture for CTO Review*
