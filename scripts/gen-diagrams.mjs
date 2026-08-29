/**
 * One-off generator for the standalone Mermaid sources indexed by docs/diagrams/README.md.
 * Run with: node scripts/gen-diagrams.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'diagrams');
mkdirSync(OUT, { recursive: true });

/** @type {Record<string,string>} */
const diagrams = {
  '01-product-ecosystem': `%% Financy — product ecosystem
%% Source of truth: docs/01-PRODUCT-REQUIREMENTS.md
graph TB
  subgraph People["People who use Financy"]
    EMP["Employee<br/>requests and spends"]
    MGR["Manager<br/>approves within budget"]
    FIN["Finance Admin<br/>reviews, codes, closes"]
    ADM["Org Admin<br/>configures access and policy"]
    AUD["Auditor<br/>reads everything, changes nothing"]
  end

  subgraph Financy["Financy — the control and orchestration layer"]
    CTRL["Control<br/>policies · approvals · limits"]
    EVID["Evidence<br/>receipts · memos · context"]
    REC["Record<br/>transactions · expenses · bills"]
    INS["Insight<br/>budgets · reports · dashboard"]
    HIST["History<br/>immutable audit trail"]
  end

  subgraph External["Systems Financy connects to"]
    ISS["Card issuer<br/>(Phase 7)"]
    RAIL["Payment rail<br/>(Phase 7)"]
    ACC["Accounting system<br/>the book of record"]
    BANK["Bank statements<br/>reconciliation"]
    IDP["Identity provider<br/>SSO (Phase 7)"]
  end

  EMP --> CTRL
  MGR --> CTRL
  ADM --> CTRL
  FIN --> REC
  FIN --> INS
  AUD --> HIST

  CTRL --> EVID --> REC --> INS
  CTRL --> HIST
  REC --> HIST
  INS --> HIST

  CTRL <--> ISS
  REC <--> RAIL
  REC --> ACC
  BANK --> REC
  IDP --> Financy

  classDef core fill:#EEF3FF,stroke:#2A4CD1,color:#161B23
  classDef ext fill:#F5F7FA,stroke:#98A3B4,stroke-dasharray:4,color:#3A4250
  class CTRL,EVID,REC,INS,HIST core
  class ISS,RAIL,ACC,BANK,IDP ext
`,

  '02-system-architecture': `%% Financy — high-level system architecture
%% Source of truth: docs/08-ARCHITECTURE.md §2
graph TB
  subgraph Client
    BR["Browser<br/>untrusted"]
  end

  subgraph Application
    WEB["apps/web — Next.js 15<br/>App Router · RSC + client islands<br/>adds NO authority"]
    API["apps/api — NestJS 11<br/>modular monolith<br/>ALL authorisation decisions"]
    WRK["Workers — same artefact,<br/>worker entrypoint"]
  end

  subgraph Data
    PG[("PostgreSQL 16+<br/>tenant-scoped, RLS from Phase 6")]
    RD[("Redis<br/>queue · rate limit")]
    OBJ[("Object storage<br/>private, signed URLs only")]
  end

  subgraph Ports["External systems — behind ports"]
    CP["CardProvider"]
    PP["PaymentProvider"]
    AP["AccountingProvider"]
    NP["NotificationProvider"]
    OP["OCRProvider"]
    IP["IdentityProvider"]
  end

  OTEL["OpenTelemetry collector"]

  BR -->|"TLS · httpOnly cookie"| WEB
  BR -->|"TLS · httpOnly cookie"| API
  WEB -->|"forwards the user session"| API
  API --> PG
  API --> RD
  API --> OBJ
  API -. "enqueue after commit" .-> RD
  RD -. "consume" .-> WRK
  WRK --> PG
  WRK --> OBJ
  API --> CP & PP & AP & NP & OP & IP
  WRK --> CP & PP & AP & NP & OP & IP
  API --> OTEL
  WRK --> OTEL

  classDef trust fill:#EEF3FF,stroke:#2A4CD1
  classDef untrust fill:#FDECEC,stroke:#A3161C
  class API,WRK trust
  class BR untrust
`,

  '03-request-flow': `%% Financy — request pipeline, browser to database and back
%% Source of truth: docs/08-ARCHITECTURE.md §4.4
sequenceDiagram
  autonumber
  participant C as Browser
  participant MW as Middleware
  participant G as Guards
  participant I as Interceptors
  participant P as Validation pipe
  participant CT as Controller
  participant S as Application service
  participant D as Domain (pure)
  participant R as Repository
  participant DB as PostgreSQL

  C->>MW: HTTP request + session cookie
  MW->>MW: correlation id · security headers · body limit · rate limit
  MW->>G: pass
  G->>G: 1 AuthGuard — resolve session, load membership
  G->>G: 2 TenantGuard — bind organizationId from the membership;<br/>reject any client-supplied mismatch
  G->>G: 3 PermissionGuard — required permission present?
  G->>G: 4 ScopeGuard — attach the row-scope predicate
  G->>G: 5 StepUpGuard — recent re-auth for high-risk actions
  G->>I: pass
  I->>I: IdempotencyInterceptor — replay or reserve the key
  I->>P: pass
  P->>P: Zod parse from packages/contracts, strip unknown keys
  P->>CT: typed, validated DTO
  CT->>S: one use-case call
  S->>DB: BEGIN
  S->>R: read (tenant predicate is mandatory)
  R->>DB: SELECT ... WHERE organization_id = $ctx
  S->>D: apply invariants and the state machine
  D-->>S: result or domain error
  S->>R: write
  S->>R: write the audit event — SAME transaction
  S->>DB: COMMIT
  S-->>CT: result
  CT-->>I: representation
  I->>I: serialise · store the idempotent response · emit metrics
  I-->>C: response + correlation id

  Note over G: Tenant binding happens BEFORE permission checking,<br/>so a query that could reveal another tenant's data<br/>cannot even be constructed.
`,

  '04-module-architecture': `%% Financy — domain module architecture
%% Source of truth: docs/08-ARCHITECTURE.md §4.2
graph TB
  subgraph Platform["Platform — cross-cutting, no business logic"]
    CFG[config]:::p
    DBM[database]:::p
    CTX[request-context]:::p
    AUTHZ[authorization]:::p
    AUDIT[audit]:::p
    QUEUE[queue]:::p
    STORE[storage]:::p
    TEL[telemetry]:::p
    ERR[errors]:::p
  end

  subgraph P1["Phase 1 — Foundation"]
    AUTH[auth]
    ORG[organization]
    USERS[users]
    PERM[permissions]
  end

  subgraph P2["Phase 2 — Spend control"]
    POL[policies]
    APRV[approvals]
    SPEND[spend]
    CARDS[cards]
  end

  subgraph P3["Phase 3 — Record"]
    TXN[transactions]
    RCPT[receipts]
    EXPS[expenses]
    REIM[reimbursements]
  end

  subgraph P4["Phase 4 — Insight"]
    BUD[budgets]
    RPT[reports]
  end

  subgraph P56["Phase 5-6 — Payables"]
    VEND[vendors]
    BILL[bills]
    PROC[procurement]
    ACCT[accounting]
  end

  INTG[integrations]:::p

  AUTH --> ORG --> USERS --> PERM
  SPEND --> POL
  SPEND --> APRV
  APRV --> POL
  CARDS --> POL
  TXN --> CARDS
  EXPS --> RCPT
  EXPS --> APRV
  REIM --> EXPS
  BUD --> TXN
  BUD --> SPEND
  RPT --> TXN
  RPT --> BUD
  RPT --> EXPS
  BILL --> APRV
  BILL --> VEND
  PROC --> APRV
  PROC --> VEND
  PROC --> BUD
  ACCT --> TXN
  ACCT --> EXPS
  ACCT --> BILL
  CARDS --> INTG
  TXN --> INTG
  ACCT --> INTG

  classDef p fill:#F5F7FA,stroke:#6B7788,color:#3A4250
`,

  '05-erd-core': `%% Financy — ERD: identity, tenancy, access
%% Source of truth: docs/09-DATABASE-DESIGN.md §2
erDiagram
  ORGANIZATIONS ||--o{ ENTITIES : has
  ORGANIZATIONS ||--o{ DEPARTMENTS : has
  ORGANIZATIONS ||--o{ MEMBERSHIPS : has
  ORGANIZATIONS ||--o{ PROJECTS : has
  ORGANIZATIONS ||--o{ CATEGORIES : has
  ORGANIZATIONS ||--o{ INVITATIONS : issues
  ORGANIZATIONS ||--o{ AUDIT_EVENTS : records
  ORGANIZATIONS ||--o{ SECURITY_EVENTS : records
  USERS ||--o{ MEMBERSHIPS : holds
  USERS ||--o{ SESSIONS : opens
  USERS ||--o{ MFA_FACTORS : enrols
  ROLES ||--o{ ROLE_PERMISSIONS : grants
  PERMISSIONS ||--o{ ROLE_PERMISSIONS : "granted by"
  ROLES ||--o{ MEMBERSHIPS : "assigned to"
  DEPARTMENTS ||--o{ DEPARTMENTS : "parent of"
  DEPARTMENTS ||--o{ MEMBERSHIPS : contains
  MEMBERSHIPS ||--o{ MEMBERSHIPS : manages
  MEMBERSHIPS ||--o{ AUDIT_EVENTS : "actor of"

  ORGANIZATIONS {
    uuid id PK
    citext slug UK
    text name
    char3 base_currency
    text timezone
    int fiscal_year_start_month
    jsonb settings
  }
  USERS {
    uuid id PK
    citext email UK
    text password_hash
    text full_name
    int failed_login_count
    timestamptz locked_until
  }
  MEMBERSHIPS {
    uuid id PK
    uuid organization_id FK
    uuid user_id FK
    uuid role_id FK
    uuid department_id FK
    uuid manager_membership_id FK
    text scope
    text status
  }
  ROLES {
    uuid id PK
    uuid organization_id FK
    text key
    bool is_system
  }
  PERMISSIONS {
    uuid id PK
    text key UK
    text resource
    text action
  }
  ROLE_PERMISSIONS {
    uuid role_id FK
    uuid permission_id FK
  }
  ENTITIES {
    uuid id PK
    uuid organization_id FK
    text name
    char3 functional_currency
    timestamptz archived_at
  }
  DEPARTMENTS {
    uuid id PK
    uuid organization_id FK
    uuid parent_id FK
    text path
    uuid head_membership_id FK
  }
  SESSIONS {
    uuid id PK
    uuid user_id FK
    uuid active_membership_id FK
    bytea token_hash UK
    timestamptz idle_expires_at
    timestamptz absolute_expires_at
    timestamptz revoked_at
  }
  AUDIT_EVENTS {
    uuid id PK
    uuid organization_id FK
    uuid actor_membership_id FK
    text actor_type
    text action
    text resource_type
    uuid resource_id
    jsonb before
    jsonb after
    uuid correlation_id
    timestamptz created_at
  }
`,

  '06-erd-spend': `%% Financy — ERD: policies, approvals, spend requests, cards
%% Source of truth: docs/09-DATABASE-DESIGN.md §3
erDiagram
  POLICIES ||--o{ POLICY_VERSIONS : "versioned as"
  POLICY_VERSIONS ||--o{ POLICY_RULES : contains
  SPEND_REQUESTS ||--o{ SPEND_REQUEST_ITEMS : "itemised by"
  SPEND_REQUESTS ||--|| APPROVAL_INSTANCES : "authorised by"
  APPROVAL_WORKFLOWS ||--o{ APPROVAL_STEP_TEMPLATES : defines
  APPROVAL_INSTANCES ||--o{ APPROVAL_STEPS : has
  APPROVAL_STEPS ||--o{ APPROVAL_STEP_APPROVERS : eligible
  APPROVAL_STEPS ||--o{ APPROVAL_ACTIONS : records
  MEMBERSHIPS ||--o{ APPROVAL_ACTIONS : acted
  MEMBERSHIPS ||--o{ APPROVAL_DELEGATIONS : delegates
  CARDS ||--o{ SPEND_LIMITS : "limit history"
  POLICIES ||--o{ CARDS : governs

  POLICIES {
    uuid id PK
    uuid organization_id FK
    text name
    text spend_types
    int priority
    text status
    uuid current_version_id FK
    timestamptz effective_from
    timestamptz effective_to
  }
  POLICY_VERSIONS {
    uuid id PK
    uuid policy_id FK
    int version
    jsonb snapshot
    timestamptz created_at
  }
  POLICY_RULES {
    uuid id PK
    uuid policy_version_id FK
    int sequence
    jsonb conditions
    jsonb outcomes
    bool is_terminal
  }
  SPEND_REQUESTS {
    uuid id PK
    uuid organization_id FK
    text reference UK
    uuid requester_membership_id FK
    numeric amount
    char3 currency
    text status
    jsonb policy_decision
    uuid approval_instance_id FK
    date valid_until
    int version
  }
  APPROVAL_INSTANCES {
    uuid id PK
    uuid organization_id FK
    text subject_type
    uuid subject_id
    text status
    jsonb policy_decision_snapshot
  }
  APPROVAL_STEPS {
    uuid id PK
    uuid approval_instance_id FK
    int sequence
    text step_type
    int quorum
    text status
    timestamptz due_at
    text escalation_action
  }
  APPROVAL_ACTIONS {
    uuid id PK
    uuid approval_step_id FK
    uuid acted_by_membership_id FK
    uuid on_behalf_of_membership_id FK
    text action
    text comment
    timestamptz created_at
  }
  APPROVAL_DELEGATIONS {
    uuid id PK
    uuid from_membership_id FK
    uuid to_membership_id FK
    timestamptz starts_at
    timestamptz ends_at
  }
  CARDS {
    uuid id PK
    uuid organization_id FK
    uuid holder_membership_id FK
    numeric limit_amount
    char3 limit_currency
    text status
    text provider
    text provider_card_id
    char4 last_four
  }
  SPEND_LIMITS {
    uuid id PK
    uuid card_id FK
    numeric amount
    char3 currency
    text period
    timestamptz effective_from
  }
`,

  '07-erd-financial': `%% Financy — ERD: transactions, receipts, expenses, reimbursements, budgets
%% Source of truth: docs/09-DATABASE-DESIGN.md §4
erDiagram
  TRANSACTIONS ||--o{ RECEIPT_ATTACHMENTS : "evidenced by"
  TRANSACTIONS ||--o{ TRANSACTION_ADJUSTMENTS : "corrected by"
  TRANSACTIONS }o--o| SPEND_REQUESTS : fulfils
  RECEIPTS ||--o{ RECEIPT_ATTACHMENTS : "attached via"
  EXPENSES ||--o{ EXPENSE_ITEMS : itemised
  EXPENSES ||--o{ RECEIPT_ATTACHMENTS : "evidenced by"
  REIMBURSEMENTS ||--o{ REIMBURSEMENT_LINES : pays
  EXPENSES ||--o| REIMBURSEMENT_LINES : "reimbursed at most once"
  BUDGETS ||--o{ BUDGET_LINES : periodised
  BUDGET_LINES ||--o{ BUDGET_MOVEMENTS : "append-only ledger"
  BUDGET_LINES ||--o{ BUDGET_ALERTS : triggers

  TRANSACTIONS {
    uuid id PK
    uuid organization_id FK
    uuid card_id FK
    uuid member_membership_id FK
    uuid spend_request_id FK
    text merchant_name
    numeric amount
    char3 currency
    numeric fx_rate
    text fx_rate_source
    date fx_rate_as_of
    text status
    text receipt_status
    text review_status
    text accounting_status
    text provider
    text provider_transaction_id
    timestamptz occurred_at
    timestamptz posted_at
  }
  TRANSACTION_ADJUSTMENTS {
    uuid id PK
    uuid adjusts_transaction_id FK
    numeric amount
    char3 currency
    text reason
    uuid actor_membership_id FK
  }
  RECEIPTS {
    uuid id PK
    uuid organization_id FK
    uuid uploaded_by_membership_id FK
    text storage_key
    text mime_type
    bigint size_bytes
    bytea checksum_sha256
    text scan_status
    jsonb ocr_result
  }
  RECEIPT_ATTACHMENTS {
    uuid id PK
    uuid receipt_id FK
    text subject_type
    uuid subject_id
    timestamptz attached_at
    timestamptz detached_at
  }
  EXPENSES {
    uuid id PK
    uuid organization_id FK
    text reference UK
    uuid member_membership_id FK
    numeric amount
    char3 currency
    date expense_date
    text funding_type
    text status
    jsonb policy_decision
    uuid approval_instance_id FK
  }
  REIMBURSEMENTS {
    uuid id PK
    uuid organization_id FK
    text reference UK
    uuid payee_membership_id FK
    numeric total_amount
    char3 currency
    text status
    text payment_reference
    timestamptz paid_at
  }
  REIMBURSEMENT_LINES {
    uuid id PK
    uuid reimbursement_id FK
    uuid expense_id FK "UNIQUE"
    numeric amount
    char3 currency
  }
  BUDGETS {
    uuid id PK
    uuid organization_id FK
    text scope_type
    uuid scope_id
    char3 currency
    date period_start
    date period_end
    text overspend_behavior
    jsonb alert_thresholds
  }
  BUDGET_LINES {
    uuid id PK
    uuid budget_id FK
    date period_start
    numeric allocated_amount
    numeric committed_amount
    numeric actual_amount
    int version
  }
  BUDGET_MOVEMENTS {
    uuid id PK
    uuid budget_line_id FK
    text movement_type
    text direction
    numeric amount
    text source_type
    uuid source_id
    timestamptz created_at
  }
`,

  '08-erd-payables': `%% Financy — ERD: vendors, bills, procurement, accounting
%% Source of truth: docs/09-DATABASE-DESIGN.md §5
erDiagram
  VENDORS ||--o{ VENDOR_CONTACTS : has
  VENDORS ||--o{ BILLS : invoices
  VENDORS ||--o{ PURCHASE_ORDERS : supplies
  BILLS ||--o{ BILL_LINES : itemised
  PURCHASE_ORDERS ||--o{ PURCHASE_ORDER_LINES : itemised
  PURCHASE_ORDER_LINES ||--o{ PO_RECEIPTS : received
  BILL_LINES }o--o| PURCHASE_ORDER_LINES : "three-way match"
  ACCOUNTING_CODES ||--o{ ACCOUNTING_MAPPINGS : "targeted by"
  EXPORT_BATCHES ||--o{ EXPORT_BATCH_ITEMS : contains

  VENDORS {
    uuid id PK
    uuid organization_id FK
    text name
    text normalized_name
    text tax_id
    text status
    uuid merged_into_id FK
    bytea bank_details_encrypted
  }
  BILLS {
    uuid id PK
    uuid organization_id FK
    uuid vendor_id FK
    text bill_number
    date issue_date
    date due_date
    numeric total_amount
    char3 currency
    text status
    uuid approval_instance_id FK
    timestamptz paid_at
  }
  BILL_LINES {
    uuid id PK
    uuid bill_id FK
    int sequence
    numeric quantity
    numeric unit_amount
    numeric line_amount
    uuid accounting_code_id FK
    uuid purchase_order_line_id FK
  }
  PURCHASE_ORDERS {
    uuid id PK
    uuid organization_id FK
    text po_number
    uuid vendor_id FK
    numeric total_amount
    char3 currency
    text status
    uuid approval_instance_id FK
  }
  PURCHASE_ORDER_LINES {
    uuid id PK
    uuid purchase_order_id FK
    numeric quantity
    numeric unit_amount
    numeric received_quantity
  }
  PO_RECEIPTS {
    uuid id PK
    uuid purchase_order_line_id FK
    numeric quantity
    timestamptz received_at
  }
  ACCOUNTING_CODES {
    uuid id PK
    uuid organization_id FK
    text code_type
    text code
    text name
    bool is_active
  }
  ACCOUNTING_MAPPINGS {
    uuid id PK
    uuid organization_id FK
    int priority
    jsonb conditions
    uuid gl_account_id FK
    uuid cost_center_id FK
    uuid tax_code_id FK
  }
  EXPORT_BATCHES {
    uuid id PK
    uuid organization_id FK
    date period_start
    date period_end
    int row_count
    bytea checksum_sha256
    text storage_key
  }
`,

  '09-org-hierarchy': `%% Financy — organisation and user hierarchy
%% Source of truth: docs/03-USER-ROLES-PERMISSIONS.md §1
graph TB
  ORG["Organisation — Acme Ltd<br/>base currency USD"]

  ORG --> E1["Entity: Acme Ltd (US)<br/>functional currency USD"]
  ORG --> E2["Entity: Acme Europe BV<br/>functional currency EUR"]

  ORG --> D0["Department root: Acme"]
  D0 --> D1["Engineering<br/>path /engineering"]
  D0 --> D2["Sales<br/>path /sales"]
  D0 --> D3["Operations<br/>path /operations"]
  D1 --> D11["Platform<br/>path /engineering/platform"]
  D1 --> D12["Product<br/>path /engineering/product"]

  D1 -.head.-> M2
  D2 -.head.-> M5

  subgraph Memberships["Memberships — user + organisation + role + scope"]
    M1["Daniel · ORG_ADMIN<br/>scope ORGANISATION"]
    M2["Marcus · MANAGER<br/>scope DEPARTMENT /engineering"]
    M3["Aisha · EMPLOYEE<br/>scope SELF"]
    M4["Priya · FINANCE_ADMIN<br/>scope ORGANISATION"]
    M5["Sofia · MANAGER<br/>scope DEPARTMENT /sales"]
    M6["Robert · AUDITOR<br/>scope ORGANISATION, read-only"]
  end

  D11 --> M3
  D1 --> M2
  D2 --> M5
  D3 --> M1
  D3 --> M4
  D3 --> M6

  M3 -.manager.-> M2
  M2 -.manager.-> M1

  subgraph Users["Users — global identities"]
    U1["aisha@acme.com"]
  end
  U1 --> M3
  U1 -.may also hold.-> MX["Membership at another organisation"]

  classDef note fill:#F5F7FA,stroke:#98A3B4,stroke-dasharray:4
  class MX note
`,

  '10-spend-request-lifecycle': `%% Financy — spend request state machine
%% Source of truth: docs/05-USER-FLOWS.md §D · FR-SPD-005
stateDiagram-v2
  [*] --> DRAFT: create
  DRAFT --> DRAFT: edit / autosave
  DRAFT --> SUBMITTED: submit — authoritative policy evaluation
  DRAFT --> CANCELLED: cancel

  SUBMITTED --> PENDING_APPROVAL: chain resolved, at least one step
  SUBMITTED --> APPROVED: verdict AUTO_APPROVE
  SUBMITTED --> BLOCKED: verdict BLOCK

  PENDING_APPROVAL --> APPROVED: all steps approved
  PENDING_APPROVAL --> REJECTED: any step rejected
  PENDING_APPROVAL --> CHANGES_REQUESTED: approver returns it
  PENDING_APPROVAL --> ESCALATED: step timeout
  PENDING_APPROVAL --> CANCELLED: requester cancels

  ESCALATED --> PENDING_APPROVAL: reassigned
  ESCALATED --> APPROVED: escalation approver approves
  ESCALATED --> REJECTED: escalation approver rejects

  CHANGES_REQUESTED --> DRAFT: requester edits — re-evaluated from scratch
  CHANGES_REQUESTED --> CANCELLED: abandoned

  APPROVED --> FULFILLED: linked transaction settles
  APPROVED --> EXPIRED: unused past valid_until — commitment released

  BLOCKED --> DRAFT: requester revises
  BLOCKED --> [*]
  REJECTED --> [*]
  CANCELLED --> [*]
  FULFILLED --> [*]
  EXPIRED --> [*]

  note right of BLOCKED
    BLOCKED is the policy refusing.
    REJECTED is a human refusing.
    Kept distinct so policy
    effectiveness is measurable.
  end note
`,

  '11-approval-engine': `%% Financy — approval resolution and action handling
%% Source of truth: docs/11-APPROVAL-POLICY-ENGINE.md §6-7
flowchart TD
  D["PolicyDecision.requirements.approvalSteps"] --> L{"For each step spec"}
  L --> R{"ApproverSpec kind"}
  R -- MEMBERSHIP --> M1["Use it directly"]
  R -- ROLE --> M2["All active memberships<br/>with that role, in scope"]
  R -- DEPARTMENT_HEAD --> M3["Walk the department tree<br/>levelsUp times, take the head"]
  R -- MANAGER_CHAIN --> M4["managerChain at position n"]
  R -- ENTITY_FINANCE_OWNER --> M5["The entity's finance owner"]
  R -- WORKFLOW --> M6["Expand the named workflow"]

  M1 --> F1
  M2 --> F1
  M3 --> F1
  M4 --> F1
  M5 --> F1
  M6 --> F1

  F1["Filter: active memberships only"] --> F2["Filter: remove the requester<br/>INV-02, applied BEFORE delegation"]
  F2 --> F3["Apply active delegations<br/>substitute delegate for delegator"]
  F3 --> F4["Filter AGAIN: remove the requester<br/>a delegation must not reintroduce them"]
  F4 --> E{"Any eligible approver left?"}
  E -- yes --> OK["Persist the step and its approver set"]
  E -- no --> FB["Fallback ladder:<br/>1 next level up the manager chain<br/>2 the department head's manager<br/>3 the entity finance owner<br/>4 any ORG_ADMIN<br/>5 raise UNRESOLVABLE_APPROVER"]
  FB --> OK

  OK --> ACT["Approver acts"]
  ACT --> LK["SELECT ... FOR UPDATE on the step"]
  LK --> RC{"Re-check status INSIDE the lock"}
  RC -- "not ACTIVE" --> C409["409 STEP_NOT_ACTIONABLE"]
  RC -- ACTIVE --> WR["INSERT approval_action (immutable)<br/>UPDATE step<br/>activate next step or complete instance<br/>INSERT audit_event<br/>— all in one transaction"]

  classDef danger fill:#FDECEC,stroke:#A3161C
  class FB,C409 danger
`,

  '12-policy-evaluation': `%% Financy — policy evaluation algorithm
%% Source of truth: docs/11-APPROVAL-POLICY-ENGINE.md §5
flowchart TD
  A["evaluate(context) — PURE, no I/O"] --> B["Load active policy versions:<br/>org matches · spendType matches ·<br/>effective_from <= now < effective_to · status ACTIVE"]
  B --> C["Sort by priority DESC, then policy id ASC<br/>deterministic, never insertion order"]
  C --> D{"More policies?"}
  D -- no --> E{"Any outcome collected?"}
  E -- no --> F["Apply the organisation default outcome"]
  E -- yes --> M
  D -- yes --> G["Next policy — evaluate rules in sequence"]
  G --> H{"Rule conditions match?"}
  H -- no --> I{"More rules in this policy?"}
  I -- yes --> G
  I -- no --> D
  H -- yes --> J["Collect outcomes;<br/>record matched rule id and policy version id"]
  J --> K{"Rule terminal, or outcome BLOCK?"}
  K -- yes --> M
  K -- no --> I
  F --> M["merge(outcomes) — nine precedence rules:<br/>1 BLOCK dominates<br/>2 approvers unioned and de-duplicated<br/>3 same sequence becomes one step, strictest type<br/>4 strictest evidence requirement wins<br/>5 AUTO_APPROVE only if no approver required<br/>6 finance review is sticky<br/>7 shortest timeout wins<br/>8 shortest validity wins<br/>9 exceptions accumulate"]
  M --> N["PolicyDecision:<br/>verdict · requirements · blocks · exceptions ·<br/>matchedRuleIds · policyVersionIds · engineVersion"]
  N --> P["Persist verbatim on the record — IMMUTABLE.<br/>Never recomputed for display."]

  classDef pure fill:#E7F6EC,stroke:#0A6B36
  class A,M pure
`,

  '13-card-lifecycle': `%% Financy — card lifecycle
%% Source of truth: docs/05-USER-FLOWS.md §G · FR-CRD-002
stateDiagram-v2
  [*] --> REQUESTED: user requests a card
  REQUESTED --> PENDING: approved, provider issuance queued
  REQUESTED --> REJECTED: approval declined
  PENDING --> ACTIVE: provider confirms issuance
  PENDING --> FAILED: provider error
  FAILED --> PENDING: retry
  ACTIVE --> LOCKED: locked by user, manager, finance, or policy
  LOCKED --> ACTIVE: unlock
  ACTIVE --> EXPIRED: past valid_until
  ACTIVE --> TERMINATED: terminate — irreversible, step-up required
  LOCKED --> TERMINATED
  EXPIRED --> [*]
  TERMINATED --> [*]
  REJECTED --> [*]

  note right of TERMINATED
    A terminated card can never
    be reactivated. History is
    retained in full.
  end note

  note right of ACTIVE
    The application stores only the
    provider reference and last four.
    Never a PAN, never a CVV.
    Limit changes append a
    spend_limits row rather than
    overwriting the current limit.
  end note
`,

  '14-transaction-lifecycle': `%% Financy — transaction lifecycle and its three independent status axes
%% Source of truth: docs/05-USER-FLOWS.md §H
stateDiagram-v2
  direction LR
  [*] --> PENDING: authorisation received or imported
  PENDING --> POSTED: settlement confirmed
  PENDING --> DECLINED: authorisation refused
  PENDING --> EXPIRED: authorisation never settled
  POSTED --> DISPUTED: dispute raised
  DISPUTED --> POSTED: dispute lost
  DISPUTED --> REVERSED: dispute won or chargeback
  POSTED --> REFUNDED: linked refund transaction
  POSTED --> [*]
  DECLINED --> [*]
  EXPIRED --> [*]
  REVERSED --> [*]
  REFUNDED --> [*]

  note right of POSTED
    Once POSTED, amount, currency,
    merchant, and occurred_at are
    IMMUTABLE — enforced by a
    database trigger, not only by
    application code.
    Corrections are adjustment rows.
    Category, review, and accounting
    fields remain mutable: they are
    ABOUT the transaction, not the
    money itself.
  end note

  note left of PENDING
    Duplicate prevention:
    UNIQUE (organization_id, provider,
    provider_transaction_id).
    A replayed webhook or re-uploaded
    CSV is a logged no-op.
  end note
`,

  '15-expense-lifecycle': `%% Financy — expense lifecycle
%% Source of truth: docs/05-USER-FLOWS.md §J · FR-EXP-002
stateDiagram-v2
  [*] --> DRAFT: create (receipt-first)
  DRAFT --> SUBMITTED: submit — policy evaluated
  DRAFT --> DELETED: discard
  SUBMITTED --> BLOCKED: policy blocks, e.g. receipt missing
  BLOCKED --> DRAFT: attach evidence and retry
  SUBMITTED --> PENDING_APPROVAL: chain resolved
  PENDING_APPROVAL --> APPROVED
  PENDING_APPROVAL --> REJECTED
  PENDING_APPROVAL --> CHANGES_REQUESTED
  CHANGES_REQUESTED --> DRAFT
  APPROVED --> REIMBURSEMENT_PENDING: out-of-pocket funding
  APPROVED --> CLOSED: card-funded, nothing owed
  REIMBURSEMENT_PENDING --> REIMBURSED: batch marked paid
  REIMBURSED --> CLOSED
  REJECTED --> [*]
  DELETED --> [*]
  CLOSED --> [*]

  note right of BLOCKED
    BLOCKED, not REJECTED —
    the policy refused, no human did.
    The user can fix it and resubmit.
  end note
`,

  '16-reimbursement-flow': `%% Financy — reimbursement batching and payment
%% Source of truth: docs/05-USER-FLOWS.md §K · FR-EXP-008..010
flowchart TD
  AP["Approved out-of-pocket expenses"] --> ELG{"Eligible?<br/>approved · not already in a batch ·<br/>receipt present where required"}
  ELG -- no --> HOLD["Held, with an explicit reason shown"]
  ELG -- yes --> GRP["Group by payee + entity + currency + period"]
  GRP --> TOT["Total computed SERVER-SIDE from the lines<br/>a client-supplied total is ignored"]
  TOT --> BATCH["INSERT reimbursement + reimbursement_lines"]
  BATCH --> DUP{"UNIQUE (expense_id) on reimbursement_lines"}
  DUP -- violated --> ERR["409 EXPENSE_ALREADY_REIMBURSED"]
  DUP -- ok --> APR["Finance approval — same approval engine"]
  APR -- reject --> BACK["Batch dissolved · expenses released"]
  APR -- approve --> PAY["Mark paid — payment reference REQUIRED"]
  PAY --> AUD["audit: reimbursement.paid"]
  AUD --> CLOSE["Linked expenses to CLOSED"]
  CLOSE --> NOTE["Notify the payee"]

  classDef guard fill:#EEF3FF,stroke:#2A4CD1
  classDef danger fill:#FDECEC,stroke:#A3161C
  class DUP,TOT guard
  class ERR danger
`,

  '17-budget-lifecycle': `%% Financy — budget movements and balance calculation
%% Source of truth: docs/05-USER-FLOWS.md §L · FR-BDG-003/004
flowchart TD
  subgraph Sources["What moves a budget"]
    C1["Approved spend request"] -->|COMMITMENT| L
    C2["Approved purchase order"] -->|COMMITMENT| L
    A1["Posted transaction"] -->|ACTUAL| L
    A2["Approved expense"] -->|ACTUAL| L
    A3["Approved bill"] -->|ACTUAL| L
    R1["Cancelled, expired, or reversed"] -->|RELEASE| L
  end

  L["budget_movements — APPEND ONLY<br/>amount always positive; direction carries the sign<br/>UNIQUE (line, source_type, source_id, movement_type)"]

  L --> TX["Write path, one transaction:<br/>1 SELECT budget_lines FOR UPDATE<br/>2 INSERT budget_movements<br/>3 UPDATE materialised balance<br/>4 INSERT audit_event"]
  TX --> CALC["allocated · committed · actual<br/>remaining = allocated - committed - actual"]

  CALC --> THR{"Utilisation threshold"}
  THR -->|">= 75%"| N1["budget.alert CAUTION"]
  THR -->|">= 90%"| N2["budget.alert WARNING"]
  THR -->|"> 100%"| N3["budget.alert OVERSPEND"]

  CALC --> POL["Budget state is an INPUT to the policy engine:<br/>budget.wouldExceed, budget.utilizationAfter"]
  POL --> BEH{"Configured overspend behaviour"}
  BEH -->|WARN| W["Allow and alert"]
  BEH -->|REQUIRE_APPROVAL| RA["Inject a finance approval step"]
  BEH -->|BLOCK| BL["Policy verdict BLOCK"]

  CALC --> CHK["Nightly integrity check:<br/>materialised balance MUST equal SUM(movements).<br/>Drift ALERTS — it is never silently repaired,<br/>because drift means something wrote outside<br/>the sanctioned path."]

  classDef crit fill:#FEF4E6,stroke:#8A5000
  class CHK,TX crit
`,

  '18-bill-lifecycle': `%% Financy — bill / accounts payable lifecycle
%% Source of truth: docs/05-USER-FLOWS.md §M
stateDiagram-v2
  [*] --> DRAFT: captured manually or ingested
  DRAFT --> PENDING_APPROVAL: submit — THE SAME policy and approval engine
  DRAFT --> VOID: void before approval
  PENDING_APPROVAL --> APPROVED
  PENDING_APPROVAL --> REJECTED
  PENDING_APPROVAL --> CHANGES_REQUESTED
  CHANGES_REQUESTED --> DRAFT
  APPROVED --> SCHEDULED: payment date set
  SCHEDULED --> PAID: payment executed and referenced
  APPROVED --> PAID: paid outside the system, recorded
  PAID --> RECONCILED: matched to a statement
  PAID --> PARTIALLY_CREDITED: credit note applied
  PARTIALLY_CREDITED --> RECONCILED
  REJECTED --> [*]
  VOID --> [*]
  RECONCILED --> [*]

  note right of PAID
    A paid bill's amounts are immutable.
    Corrections are credit notes —
    new, linked records.
  end note

  note left of PENDING_APPROVAL
    spendType = BILL is the only
    difference from a spend request.
    A second approval implementation
    would be a design failure.
  end note
`,

  '19-procurement-lifecycle': `%% Financy — procurement and three-way match
%% Source of truth: docs/05-USER-FLOWS.md §N
flowchart TD
  PR["Purchase request"] --> PA{"Approval — the same engine,<br/>spendType = PURCHASE_ORDER"}
  PA -- reject --> PX["Rejected"]
  PA -- approve --> PO["Purchase order issued"]
  PO --> COM["budget: COMMITMENT movement"]
  COM --> SENT["Sent to the vendor"]
  SENT --> REC["Goods or services received<br/>quantities recorded per PO line"]
  REC --> BILL["Vendor bill arrives"]
  BILL --> M3{"Three-way match<br/>PO line vs received qty vs bill line<br/>within configured tolerance?"}
  M3 -- matched --> APPR["Auto-approve within tolerance"]
  APPR --> PAY["Bill proceeds to payment"]
  M3 -- variance --> EXC["Exception queue — finance review"]
  EXC --> RES{"Resolution"}
  RES -->|"accept variance"| PAY
  RES -->|"amend PO"| PO
  RES -->|"dispute"| DISP["Vendor dispute"]
  PAY --> REL["budget: RELEASE the commitment,<br/>record the ACTUAL"]
  REL --> CLOSE["PO closed once fully received and billed"]

  classDef warn fill:#FEF4E6,stroke:#8A5000
  class EXC,M3 warn
`,

  '20-vendor-lifecycle': `%% Financy — vendor lifecycle
%% Source of truth: docs/05-USER-FLOWS.md §O
stateDiagram-v2
  [*] --> PENDING: created manually or auto-detected from a merchant
  PENDING --> ACTIVE: verified — details and tax id confirmed
  PENDING --> REJECTED: failed verification
  ACTIVE --> ON_HOLD: payment or compliance hold
  ON_HOLD --> ACTIVE: hold released
  ACTIVE --> INACTIVE: no activity, archived
  INACTIVE --> ACTIVE: reactivated
  ACTIVE --> MERGED: merged into a duplicate master
  REJECTED --> [*]
  MERGED --> [*]

  note right of MERGED
    Merging is non-destructive.
    The merged record is retained
    with merged_into_id, so historical
    bills and transactions never
    lose their reference.
  end note

  note left of PENDING
    Duplicate detection on create,
    by normalised name and tax id.
  end note
`,

  '21-accounting-export': `%% Financy — accounting export, and why re-running is safe
%% Source of truth: docs/05-USER-FLOWS.md §P
flowchart TD
  SEL["Select period · entity · record types"] --> ELG{"Eligible records:<br/>REVIEWED and CODED and not yet EXPORTED"}
  ELG -- none --> EMPTY["Nothing to export"]
  ELG -- some --> MAP["Apply mapping rules:<br/>GL account · cost centre · entity ·<br/>department · project · tax code"]
  MAP --> VAL{"Every line maps to a valid code?"}
  VAL -- no --> UNM["Unmapped queue — export BLOCKED until resolved.<br/>A silently-defaulted GL account produces a<br/>clean-looking export that is wrong."]
  VAL -- yes --> BAL{"Debits equal credits per journal?"}
  BAL -- no --> ERR["Export aborted — integrity error raised"]
  BAL -- yes --> GEN["queue: accounting.export"]
  GEN --> FILE["Generate the file in the adapter's layout<br/>UTF-8 BOM · RFC 4180 · formula-injection escaped"]
  FILE --> BATCH["INSERT export_batch:<br/>id · checksum · row count · record ids · actor"]
  BATCH --> MARK["Mark every record EXPORTED with the batch id"]
  MARK --> AUD["audit: accounting.exported"]
  AUD --> DL["Signed download link"]
  DL --> RE{"Re-run the same period?"}
  RE -- yes --> IDEM["Already-exported records are excluded<br/>by the eligibility filter — the re-run is<br/>idempotent by construction, not by a check."]

  classDef warn fill:#FEF4E6,stroke:#8A5000
  classDef ok fill:#E7F6EC,stroke:#0A6B36
  class UNM,ERR warn
  class IDEM ok
`,

  '22-notification-jobs': `%% Financy — queue and worker topology
%% Source of truth: docs/14-ASYNC-JOBS.md §5
graph TB
  subgraph Producers
    API["API instances<br/>enqueue AFTER commit"]
    CRON["Scheduler<br/>cron, UTC, distributed lock"]
    HOOK["Webhook endpoint<br/>202 immediately, process async"]
  end

  Q[("Redis — BullMQ<br/>(InlineQueueAdapter locally: no Redis on the dev host)")]

  API --> Q
  CRON --> Q
  HOOK --> Q

  Q --> W1["Worker: critical · concurrency 10<br/>notifications · approval reminders · escalations"]
  Q --> W2["Worker: default · concurrency 5<br/>receipt scan/OCR · transaction enrich · auto-match"]
  Q --> W3["Worker: heavy · concurrency 2<br/>exports · large reports · CSV imports"]
  Q --> W4["Worker: scheduled · concurrency 1<br/>maintenance · integrity checks · rollovers"]

  W1 --> DB[("PostgreSQL")]
  W2 --> DB
  W3 --> DB
  W4 --> DB
  W2 --> OBJ[("Object storage")]
  W3 --> OBJ

  W1 -.failure.-> DLQ[("Dead-letter queue")]
  W2 -.failure.-> DLQ
  W3 -.failure.-> DLQ
  W4 -.failure.-> DLQ
  DLQ --> AL["Alert — any arrival pages on-call"]

  W4 --> CHK["budget drift · orphaned records ·<br/>audit gaps · immutability violations"]
  CHK -.any finding.-> AL

  classDef crit fill:#FDECEC,stroke:#A3161C
  class DLQ,AL,CHK crit

  %% Separate queues so a 50,000-row export cannot delay an approval notification.
`,

  '23-tenant-security': `%% Financy — tenant isolation and the security model
%% Source of truth: docs/12-SECURITY-MODEL.md §5 · ADR-0010
graph TB
  REQ["Incoming request<br/>with a session cookie"]

  REQ --> L1["LAYER 1 — Request context<br/>organizationId comes ONLY from the session's membership.<br/>A client-supplied organizationId is ignored;<br/>if present and different, reject with 403 + security event."]
  L1 --> L2["LAYER 2 — Prisma client extension<br/>Injects organizationId into every query on a<br/>tenant-scoped model. Missing context THROWS<br/>TenantContextMissingError — fail closed, never fail open."]
  L2 --> L3["LAYER 3 — PostgreSQL row-level security (Phase 6)<br/>USING (organization_id = current_setting('app.current_organization_id')).<br/>The only layer that still holds if the application is wrong."]
  L3 --> L0["LAYER 0 — Schema<br/>Composite foreign keys carry organization_id on both sides,<br/>so a cross-tenant reference is PHYSICALLY IMPOSSIBLE<br/>regardless of application code."]
  L0 --> DATA[("Data — this tenant's rows only")]

  REQ --> AZ["Authorisation, in order:<br/>1 session valid?<br/>2 membership active in this org?<br/>3 permission held?<br/>4 row within scope?<br/>5 step-up satisfied?"]
  AZ --> DATA

  DATA --> RESP["Response"]

  X1["Cross-tenant resource requested"] --> R404["404 RESOURCE_NOT_FOUND<br/>— never 403, which would confirm it exists"]

  classDef layer fill:#EEF3FF,stroke:#2A4CD1
  classDef danger fill:#FDECEC,stroke:#A3161C
  class L0,L1,L2,L3 layer
  class X1,R404 danger

  %% Four layers because one is a single point of failure,
  %% and two that both live in the application share a failure mode.
`,

  '24-deployment': `%% Financy — deployment topology
%% Source of truth: docs/17-DEPLOYMENT.md §7 · docs/08-ARCHITECTURE.md §10
graph TB
  subgraph Edge
    CDN["CDN — static assets"]
    LB["Load balancer<br/>TLS 1.2+ termination · HSTS"]
  end

  subgraph App["Application tier — stateless, no sticky sessions"]
    W["Web instances xN<br/>Next.js standalone"]
    A["API instances xN<br/>node dist/main.js"]
    K["Worker instances xM<br/>node dist/worker.js<br/>SAME artefact, different entrypoint"]
  end

  subgraph Data["Data tier — private networking only"]
    PG[("PostgreSQL primary<br/>PITR · nightly full + WAL")]
    PGR[("Read replica — Phase 6<br/>reporting")]
    RD[("Redis — queue, rate limit")]
    S3[("Object storage — private,<br/>versioned, separate origin")]
  end

  subgraph Obs["Observability"]
    OT["OTel collector"]
    LOG["Log aggregation"]
    ERRT["Error tracking"]
  end

  CDN --> W
  LB --> W
  LB --> A
  W -->|"forwards the user session"| A
  A --> PG
  A --> RD
  A --> S3
  K --> PG
  K --> RD
  K --> S3
  A -.reports.-> PGR
  PG -.replicates.-> PGR
  A --> OT
  K --> OT
  A --> LOG
  K --> LOG
  A --> ERRT

  MIG["Migrations run as a SEPARATE deploy step,<br/>BEFORE the application rolls — never on process start.<br/>Expand/contract, so old code keeps working."]
  MIG --> PG

  classDef same fill:#EEF3FF,stroke:#2A4CD1
  classDef note fill:#FEF4E6,stroke:#8A5000
  class A,K same
  class MIG note
`,

  '25-vertical-slice': `%% Financy — the first vertical slice, end to end
%% Source of truth: docs/05-USER-FLOWS.md §0 · docs/01-PRODUCT-REQUIREMENTS.md §10.1
%% This is the flow that defines "the product works".
sequenceDiagram
  autonumber
  actor Daniel as Org Admin
  actor Aisha as Employee
  actor Marcus as Manager
  actor Priya as Finance
  participant API
  participant PE as Policy Engine
  participant DB as PostgreSQL
  participant Q as Queue
  participant AU as Audit

  rect rgb(238, 243, 255)
  Note over Daniel,AU: Phase 1 — identity, tenancy, audit
  Daniel->>API: POST /v1/auth/register
  API->>DB: org + user + membership(ORG_ADMIN) + entity — ATOMIC
  API->>AU: organization.created · membership.created
  Daniel->>API: POST /v1/memberships/invitations
  API->>Q: email.invitation
  API->>AU: invitation.created
  Aisha->>API: POST /v1/auth/invitations/accept
  API->>AU: invitation.accepted · membership.created
  end

  rect rgb(241, 237, 253)
  Note over Daniel,AU: Phase 2 — policy, approval, spend
  Daniel->>API: POST /v1/policies
  API->>AU: policy.created (version 1, immutable)
  Aisha->>API: POST /v1/spend-requests/evaluate (DRY RUN)
  API->>PE: evaluate(context)
  PE-->>API: ALLOWED_WITH_APPROVAL, chain [Manager, Finance]
  API-->>Aisha: preview — no rows written
  Aisha->>API: POST /v1/spend-requests (Idempotency-Key)
  API->>PE: evaluate — AUTHORITATIVE
  API->>DB: spend_request + approval_instance + steps + decision snapshot
  API->>AU: spend_request.submitted · policy.evaluated
  API->>Q: notification.approval_requested
  Marcus->>API: POST /v1/approvals/steps/{id}/approve
  API->>DB: FOR UPDATE · re-check · action · advance · COMMITMENT movement
  API->>AU: approval.approved · budget.committed
  Priya->>API: POST /v1/approvals/steps/{id}/approve
  API->>DB: instance APPROVED · request APPROVED
  API->>AU: spend_request.approved
  end

  rect rgb(231, 246, 236)
  Note over Priya,AU: Phase 3 — transaction, evidence, review
  Priya->>API: POST /v1/transactions/import (CSV)
  API->>DB: transaction — UNIQUE(provider, provider_transaction_id)
  API->>DB: match to the approved spend request
  API->>AU: transaction.imported · transaction.matched
  Aisha->>API: POST /v1/receipts/upload-intent then /complete
  API->>API: magic-byte validation — not the declared MIME
  API->>Q: receipt.scan then receipt.ocr
  API->>AU: receipt.uploaded · receipt.attached
  Priya->>API: POST /v1/transactions/{id}/review
  API->>DB: REVIEWED · release COMMITMENT · record ACTUAL
  API->>AU: transaction.categorized · transaction.reviewed · budget.actualized
  end

  rect rgb(254, 244, 230)
  Note over Priya,AU: Phase 4 — insight
  Priya->>API: GET /v1/dashboard/summary
  API->>DB: server-side aggregate
  Priya->>API: GET /v1/reports/spend-by-department
  API-->>Priya: figures — NOTHING computed in the browser
  Priya->>API: GET /v1/audit-events?resourceId=...
  API-->>Priya: the complete lifecycle, every actor, every timestamp
  end

  Note over Daniel,AU: End-state assertions the e2e test makes:<br/>1 request APPROVED and linked to its instance<br/>2 transaction linked, receipt ATTACHED<br/>3 budget shows actual, not committed; remaining correct<br/>4 report total includes this amount exactly once<br/>5 15+ audit events, every one with an actor, in order<br/>6 a second organisation gets 404 for every id in this flow
`,
};

let count = 0;
for (const [name, content] of Object.entries(diagrams)) {
  writeFileSync(join(OUT, `${name}.mmd`), content, 'utf8');
  count += 1;
}
console.log(`Wrote ${count} diagram sources to docs/diagrams/`);
