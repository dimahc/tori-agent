/**
 * @file packages/core/src/policy/engine.ts
 * @description High-level PolicyEngine wrapper around the low-level DatalogEngine.
 * Part of the Ontological Upgrade (SC-03).
 *
 * Responsibilities:
 * - Convert ontological entities (Agent, Role, Artifact, ...) into Datalog facts (EDB).
 * - Ship a default set of authorization rules (IDB) for the tori-agent system.
 * - Expose a simple `evaluate(subject, action, object, context?)` access-control API.
 *
 * Design notes:
 * - `PolicyEngineImpl` keeps its own fact/rule arrays as the source of truth and
 *   rebuilds the underlying `DatalogEngine` on every `evaluate()` call. This is
 *   deliberate: the engine has no fact-removal API, and rebuilding guarantees that
 *   temporary context facts never leak into persistent state.
 * - Explicit denies win over any allow rule (deny-overrides combining algorithm):
 *   if `deny_access(subject, object)` is provable, evaluation returns `false`
 *   regardless of any applicable `can_*` rule.
 * - Negation in rule bodies uses the `NOT_` predicate prefix convention understood
 *   by {@link DatalogEngine} (stratified negation-as-failure).
 */

import { DatalogEngine } from "./datalog.js";
import type { Atom, Fact, PolicyEngine, Rule } from "../types/policy.js";
import type {
  Agent,
  Artifact,
  Capability,
  Knowledge,
  OntologicalEntity,
  Policy as PolicyEntity,
  Role,
  Skill,
  Stage,
  Task,
  Tool,
  Transition,
  Workflow,
} from "../types/ontology.js";

/** Predicate prefix the DatalogEngine treats as negation-as-failure in rule bodies. */
const NEGATION_PREFIX = "NOT_";

/** Role identifier that grants unrestricted access (admin override). */
const ADMIN_ROLE = "admin";

/** Predicate used for the global deny check, evaluated before any allow rule. */
const DENY_PREDICATE = "deny_access";

/**
 * Maps common action verbs to their authorization predicate. Any action not listed
 * here falls back to `can_<sanitized-action>`, so callers may introduce custom
 * predicates (e.g. action "deploy" -> `can_deploy`) simply by adding matching rules.
 */
const ACTION_ALIASES: Record<string, string> = {
  access: "can_access",
  read: "can_access",
  view: "can_access",
  open: "can_access",
  edit: "can_edit",
  write: "can_edit",
  modify: "can_edit",
  update: "can_edit",
  delete: "can_delete",
  remove: "can_delete",
  execute: "can_execute",
  run: "can_execute",
  invoke: "can_execute",
};

/**
 * In-memory PolicyEngine backed by the DatalogEngine.
 *
 * Implements the {@link PolicyEngine} contract and adds two management methods:
 * - {@link ingestOntology} — ETL from ontological entities to Datalog facts.
 * - {@link loadDefaultRules} — installs the default tori-agent authorization rules.
 */
export class PolicyEngineImpl implements PolicyEngine {
  private engine: DatalogEngine;
  private facts: Fact[] = [];
  private rules: Rule[] = [];
  private defaultRulesLoaded = false;

  constructor() {
    this.engine = new DatalogEngine(this.facts, this.rules);
  }

  /**
   * Evaluates whether `subject` may perform `action` on `object`.
   *
   * The action is mapped to a `can_*` predicate (see {@link ACTION_ALIASES}) and
   * queried as `can_*(subject, object)`. Before the allow check, the global deny
   * rule `deny_access(subject, object)` is evaluated and takes precedence.
   *
   * @param subject - Agent identifier (e.g. an ontological Agent `@id`).
   * @param action  - Action verb (e.g. "read", "edit", "execute", or a custom one).
   * @param object  - Target resource identifier (e.g. an Artifact `@id` or file path).
   * @param context - Optional ephemeral key/value data injected as temporary facts
   *                  for this evaluation only (see {@link buildContextFacts}).
   * @returns `true` if the access goal is provable and not explicitly denied.
   */
  public async evaluate(
    subject: string,
    action: string,
    object: string,
    context?: Record<string, any>,
  ): Promise<boolean> {
    const contextFacts = this.buildContextFacts(subject, object, context);

    // Rebuild the engine so temporary context facts are visible to this query
    // without ever entering the persistent fact base.
    this.engine = new DatalogEngine([...this.facts, ...contextFacts], this.rules);

    if (this.isProvable({ predicate: DENY_PREDICATE, terms: [subject, object] })) {
      return false;
    }

    const predicate = this.actionToPredicate(action);
    return this.isProvable({ predicate, terms: [subject, object] });
  }

  /**
   * Synchronous version of evaluate for cases where async is not needed.
   * Uses the current fact/rule base without rebuilding.
   */
  public evaluateSync(
    subject: string,
    action: string,
    object: string,
    context?: Record<string, unknown>
  ): boolean {
    const contextFacts = this.buildContextFacts(subject, object, context);
    const tempEngine = new DatalogEngine([...this.facts, ...contextFacts], this.rules);

    if (tempEngine.evaluate({ predicate: DENY_PREDICATE, terms: [subject, object] }).length > 0) {
      return false;
    }

    const predicate = this.actionToPredicate(action);
    return tempEngine.evaluate({ predicate, terms: [subject, object] }).length > 0;
  }

  /**
   * Adds a ground fact to the persistent fact base.
   * @throws If the fact has an empty predicate or a non-array `args`.
   */
  public addFact(fact: Fact): void {
    if (!fact || typeof fact.predicate !== "string" || fact.predicate.length === 0) {
      throw new Error("PolicyEngineImpl.addFact: fact.predicate must be a non-empty string");
    }
    if (!Array.isArray(fact.args) || !fact.args.every((a) => typeof a === "string")) {
      throw new Error("PolicyEngineImpl.addFact: fact.args must be an array of strings");
    }
    this.facts.push(fact);
  }

  /**
   * Adds an inference rule to the persistent rule base.
   * @throws If the rule lacks a head atom or a body array.
   */
  public addRule(rule: Rule): void {
    if (!rule || !rule.head || !Array.isArray(rule.body)) {
      throw new Error("PolicyEngineImpl.addRule: rule must have a head atom and a body array");
    }
    this.rules.push(rule);
  }

  /** Removes all facts and rules, including any previously loaded default rules. */
  public clear(): void {
    this.facts = [];
    this.rules = [];
    this.defaultRulesLoaded = false;
    this.engine = new DatalogEngine(this.facts, this.rules);
  }

  /**
   * Installs the default tori-agent authorization rules. Idempotent: calling it
   * more than once (without an intervening {@link clear}) is a no-op.
   *
   * Rule set:
   * - `can_access(A, R) :- has_role(A, Role), manages(Role, R)` — role-based access.
   * - `can_access(A, R) :- has_role(A, admin)` — admin override.
   * - `can_edit(A, F)  :- has_role(A, admin)` — admin edit override.
   * - `has_capability(A, C) :- has_role(A, Role), has_capability(Role, C)` —
   *   agents inherit the capabilities of their roles.
   * - `can_access(A, R) :- has_capability(A, C), requires_capability(R, C)`.
   * - `can_edit(A, F)  :- has_capability(A, C), requires_capability(F, C)`.
   * - `can_access(A, R) / can_edit(A, R) :- owned_by(R, A)` — ownership rights.
   * - `deny_access(A, R) :- is_restricted(R), NOT has_clearance(A, R)` —
   *   restricted resources are denied without explicit clearance.
   */
  public loadDefaultRules(): void {
    if (this.defaultRulesLoaded) return;

    const defaults: Rule[] = [
      {
        head: { predicate: "can_access", terms: ["?Agent", "?Resource"] },
        body: [
          { predicate: "has_role", terms: ["?Agent", "?Role"] },
          { predicate: "manages", terms: ["?Role", "?Resource"] },
        ],
      },
      {
        head: { predicate: "can_access", terms: ["?Agent", "?Resource"] },
        body: [{ predicate: "has_role", terms: ["?Agent", ADMIN_ROLE] }],
      },
      {
        head: { predicate: "can_edit", terms: ["?Agent", "?File"] },
        body: [{ predicate: "has_role", terms: ["?Agent", ADMIN_ROLE] }],
      },
      {
        head: { predicate: "has_capability", terms: ["?Agent", "?Capability"] },
        body: [
          { predicate: "has_role", terms: ["?Agent", "?Role"] },
          { predicate: "has_capability", terms: ["?Role", "?Capability"] },
        ],
      },
      {
        head: { predicate: "can_access", terms: ["?Agent", "?Resource"] },
        body: [
          { predicate: "has_capability", terms: ["?Agent", "?Capability"] },
          { predicate: "requires_capability", terms: ["?Resource", "?Capability"] },
        ],
      },
      {
        head: { predicate: "can_edit", terms: ["?Agent", "?File"] },
        body: [
          { predicate: "has_capability", terms: ["?Agent", "?Capability"] },
          { predicate: "requires_capability", terms: ["?File", "?Capability"] },
        ],
      },
      {
        head: { predicate: "can_access", terms: ["?Agent", "?Resource"] },
        body: [{ predicate: "owned_by", terms: ["?Resource", "?Agent"] }],
      },
      {
        head: { predicate: "can_edit", terms: ["?Agent", "?Resource"] },
        body: [{ predicate: "owned_by", terms: ["?Resource", "?Agent"] }],
      },
      {
        head: { predicate: DENY_PREDICATE, terms: ["?Agent", "?Resource"] },
        body: [
          { predicate: "is_restricted", terms: ["?Resource"] },
          { predicate: `${NEGATION_PREFIX}has_clearance`, terms: ["?Agent", "?Resource"] },
        ],
      },
    ];

    for (const rule of defaults) {
      this.addRule(rule);
    }
    this.defaultRulesLoaded = true;
  }

  /**
   * Converts an ontological entity into Datalog facts and adds them to the
   * fact base. Dispatches on the entity's `@type`; unknown types still
   * contribute the base `entity`/`has_type` facts and relational facts
   * (`governed_by`, `implements`, `part_of`, `requires`).
   *
   * Note: related entities (e.g. an Agent's Roles) are only referenced by id —
   * ingest them separately with their own `ingestOntology` call if their facts
   * are needed for reasoning.
   */
  public ingestOntology(entity: OntologicalEntity): void {
    if (!entity || typeof entity["@id"] !== "string" || entity["@id"].length === 0) {
      throw new Error("PolicyEngineImpl.ingestOntology: entity must have a non-empty '@id'");
    }
    const id = entity["@id"];
    const type = entity["@type"];

    this.addFact({ predicate: "entity", args: [id] });
    if (typeof type === "string" && type.length > 0) {
      this.addFact({ predicate: "has_type", args: [id, type] });
    }
    this.ingestRelations(entity);

    switch (type) {
      case "Agent":
        this.ingestAgent(entity as Agent);
        break;
      case "Role":
        this.ingestRole(entity as Role);
        break;
      case "Capability":
        this.ingestCapability(entity as Capability);
        break;
      case "Skill":
        this.ingestSkill(entity as Skill);
        break;
      case "Tool":
        this.ingestTool(entity as Tool);
        break;
      case "Task":
        this.ingestTask(entity as Task);
        break;
      case "Workflow":
        this.ingestWorkflow(entity as Workflow);
        break;
      case "Stage":
        this.ingestStage(entity as Stage);
        break;
      case "Transition":
        this.ingestTransition(entity as Transition);
        break;
      case "Artifact":
        this.ingestArtifact(entity as Artifact);
        break;
      case "Knowledge":
        this.ingestKnowledge(entity as Knowledge);
        break;
      case "Policy":
        this.ingestPolicy(entity as PolicyEntity);
        break;
      default:
        // Unknown @type: base and relational facts above are still emitted.
        break;
    }
  }

  /** Emits facts for the relational properties shared by all ontological entities. */
  private ingestRelations(entity: OntologicalEntity): void {
    const id = entity["@id"];
    if (entity.governedBy) {
      this.addFact({ predicate: "governed_by", args: [id, entity.governedBy] });
    }
    if (entity.implements) {
      this.addFact({ predicate: "implements", args: [id, entity.implements] });
    }
    if (entity.partOf) {
      this.addFact({ predicate: "part_of", args: [id, entity.partOf] });
    }
    for (const requirement of entity.requires ?? []) {
      this.addFact({ predicate: "requires", args: [id, requirement] });
    }
  }

  private ingestAgent(agent: Agent): void {
    const id = agent["@id"];
    this.addFact({ predicate: "agent", args: [id] });
    for (const role of agent.roles ?? []) {
      this.addFact({ predicate: "has_role", args: [id, role["@id"]] });
    }
    for (const capability of agent.capabilities ?? []) {
      this.addFact({ predicate: "has_capability", args: [id, capability["@id"]] });
    }
    for (const tool of agent.tools ?? []) {
      this.addFact({ predicate: "has_tool", args: [id, tool["@id"]] });
    }
  }

  private ingestRole(role: Role): void {
    const id = role["@id"];
    this.addFact({ predicate: "role", args: [id] });
    for (const permission of role.permissions ?? []) {
      this.addFact({ predicate: "has_permission", args: [id, permission] });
    }
    for (const capability of role.capabilities ?? []) {
      this.addFact({ predicate: "has_capability", args: [id, capability["@id"]] });
    }
  }

  private ingestCapability(capability: Capability): void {
    const id = capability["@id"];
    this.addFact({ predicate: "capability", args: [id] });
    if (typeof capability.scope === "string") {
      this.addFact({ predicate: "capability_scope", args: [id, capability.scope] });
    }
  }

  private ingestSkill(skill: Skill): void {
    const id = skill["@id"];
    this.addFact({ predicate: "skill", args: [id] });
    for (const capability of skill.required_capabilities ?? []) {
      this.addFact({ predicate: "requires_capability", args: [id, capability["@id"]] });
    }
  }

  private ingestTool(tool: Tool): void {
    const id = tool["@id"];
    this.addFact({ predicate: "tool", args: [id] });
    if (typeof tool.capability_id === "string" && tool.capability_id.length > 0) {
      this.addFact({ predicate: "provides_capability", args: [id, tool.capability_id] });
    }
  }

  private ingestTask(task: Task): void {
    const id = task["@id"];
    this.addFact({ predicate: "task", args: [id] });
    for (const assignee of task.assigned_to ?? []) {
      this.addFact({ predicate: "assigned_to", args: [id, assignee["@id"]] });
    }
    if (typeof task.status === "string") {
      this.addFact({ predicate: "task_status", args: [id, task.status] });
    }
  }

  private ingestWorkflow(workflow: Workflow): void {
    const id = workflow["@id"];
    this.addFact({ predicate: "workflow", args: [id] });
    for (const stage of workflow.stages ?? []) {
      this.addFact({ predicate: "has_stage", args: [id, stage["@id"]] });
    }
    for (const transition of workflow.transitions ?? []) {
      this.addFact({ predicate: "has_transition", args: [id, transition["@id"]] });
    }
  }

  private ingestStage(stage: Stage): void {
    const id = stage["@id"];
    this.addFact({ predicate: "stage", args: [id] });
    if (typeof stage.workflow_id === "string" && stage.workflow_id.length > 0) {
      this.addFact({ predicate: "stage_of", args: [id, stage.workflow_id] });
    }
  }

  private ingestTransition(transition: Transition): void {
    const id = transition["@id"];
    this.addFact({ predicate: "transition", args: [id] });
    this.addFact({ predicate: "transition_from", args: [id, transition.from_stage] });
    this.addFact({ predicate: "transition_to", args: [id, transition.to_stage] });
  }

  private ingestArtifact(artifact: Artifact): void {
    const id = artifact["@id"];
    this.addFact({ predicate: "artifact", args: [id] });
    if (typeof artifact.owner_id === "string" && artifact.owner_id.length > 0) {
      this.addFact({ predicate: "owned_by", args: [id, artifact.owner_id] });
    }
    this.ingestResourceFacts(artifact, artifact.metadata);
  }

  private ingestKnowledge(knowledge: Knowledge): void {
    const id = knowledge["@id"];
    this.addFact({ predicate: "knowledge", args: [id] });
    this.ingestResourceFacts(knowledge, undefined);
  }

  private ingestPolicy(policy: PolicyEntity): void {
    const id = policy["@id"];
    this.addFact({ predicate: "policy", args: [id] });
    for (const rule of policy.rules ?? []) {
      this.addFact({ predicate: "policy_rule", args: [id, rule] });
    }
    if (typeof policy.enforcement_level === "string") {
      this.addFact({ predicate: "enforcement_level", args: [id, policy.enforcement_level] });
    }
  }

  /**
   * Emits the facts common to resource-like entities (Artifact, Knowledge):
   * `resource(id)`, `is_restricted(id)` when flagged, and
   * `requires_capability(id, cap)` from the entity's `requires` list and metadata.
   */
  private ingestResourceFacts(entity: OntologicalEntity, metadata: unknown): void {
    const id = entity["@id"];
    this.addFact({ predicate: "resource", args: [id] });

    if (this.isRestricted(entity, metadata)) {
      this.addFact({ predicate: "is_restricted", args: [id] });
    }

    const required = new Set<string>(entity.requires ?? []);
    for (const entry of this.metadataEntries(metadata)) {
      for (const key of ["requires_capability", "requiresCapability"]) {
        const value = entry[key];
        if (typeof value === "string") {
          required.add(value);
        } else if (Array.isArray(value)) {
          for (const item of value) {
            if (typeof item === "string") required.add(item);
          }
        }
      }
    }
    for (const capabilityId of required) {
      this.addFact({ predicate: "requires_capability", args: [id, capabilityId] });
    }
  }

  /**
   * A resource is restricted when flagged via a top-level `restricted` /
   * `is_restricted` property or any metadata entry carrying the same flags.
   */
  private isRestricted(entity: OntologicalEntity, metadata: unknown): boolean {
    const loose = entity as unknown as Record<string, unknown>;
    if (loose["restricted"] === true || loose["is_restricted"] === true) {
      return true;
    }
    return this.metadataEntries(metadata).some(
      (entry) => entry["restricted"] === true || entry["is_restricted"] === true,
    );
  }

  /** Normalizes the various metadata shapes (array of records, single record, none). */
  private metadataEntries(metadata: unknown): Record<string, unknown>[] {
    if (Array.isArray(metadata)) {
      return metadata.filter(
        (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null,
      );
    }
    if (typeof metadata === "object" && metadata !== null) {
      return [metadata as Record<string, unknown>];
    }
    return [];
  }

  /**
   * Builds the temporary facts for a single {@link evaluate} call:
   * - `current_user(subject)`, `target_object(object)`, `target_file(object)` —
   *   always present when a context is provided, so rules can refer to the
   *   "who" and "what" of the current request.
   * - One unary fact per context entry: `{ key: value }` becomes
   *   `key("value")` for string/number/boolean values, and one fact per element
   *   for arrays of those primitives. Other shapes are ignored.
   * - `context.facts` may hold an array of fully-formed {@link Fact} objects,
   *   which are injected verbatim (the escape hatch for structured context).
   */
  private buildContextFacts(
    subject: string,
    object: string,
    context?: Record<string, any>,
  ): Fact[] {
    if (!context || typeof context !== "object") return [];

    const facts: Fact[] = [
      { predicate: "current_user", args: [subject] },
      { predicate: "target_object", args: [object] },
      { predicate: "target_file", args: [object] },
    ];

    for (const [key, value] of Object.entries(context)) {
      if (key === "facts") {
        if (Array.isArray(value)) {
          for (const candidate of value) {
            if (this.isFact(candidate)) facts.push(candidate);
          }
        }
        continue;
      }

      const predicate = this.sanitizePredicate(key);
      if (predicate.length === 0) continue;

      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        facts.push({ predicate, args: [String(value)] });
      } else if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
            facts.push({ predicate, args: [String(item)] });
          }
        }
      }
    }

    return facts;
  }

  /** Structural type guard for caller-supplied {@link Fact} objects in context. */
  private isFact(value: unknown): value is Fact {
    if (typeof value !== "object" || value === null) return false;
    const candidate = value as Fact;
    return (
      typeof candidate.predicate === "string" &&
      candidate.predicate.length > 0 &&
      Array.isArray(candidate.args) &&
      candidate.args.every((arg) => typeof arg === "string")
    );
  }

  /**
   * Maps an action verb to its authorization predicate, applying
   * {@link ACTION_ALIASES} and falling back to `can_<sanitized-action>`.
   */
  private actionToPredicate(action: string): string {
    const normalized = this.sanitizePredicate(action);
    return ACTION_ALIASES[normalized] ?? `can_${normalized}`;
  }

  /** Lowercases and converts any non-alphanumeric run into single underscores. */
  private sanitizePredicate(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  /** Returns `true` when the goal atom has at least one solution in the engine. */
  private isProvable(goal: Atom): boolean {
    return this.engine.evaluate(goal).length > 0;
  }
}
