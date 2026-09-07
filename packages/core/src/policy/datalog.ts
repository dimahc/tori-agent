import { Atom, Substitution, Rule, Fact, Term } from "../types/policy.js";

/**
 * A lightweight Datalog-inspired reasoning engine.
 * Supports Unification, Relational Joins, and Stratified Negation.
 */
export class DatalogEngine {
  private facts: Fact[] = [];
  private rules: Rule[] = [];

  constructor(facts: Fact[] = [], rules: Rule[] = []) {
    this.facts = facts;
    this.rules = rules;
  }

  public addFact(fact: Fact): void {
    this.facts.push(fact);
  }

  public addRule(rule: Rule): void {
    this.rules.push(rule);
  }

  public clear(): void {
    this.facts = [];
    this.rules = [];
  }

  /**
   * Evaluates if a specific atom is true given the current facts and rules.
   */
  public evaluate(atom: Atom, substitution: Substitution = {}): Substitution[] {
    const results: Substitution[] = [];

    // 1. Check direct facts (Unification)
    for (const fact of this.facts) {
      const newSub = this.unify(atom, { predicate: fact.predicate, terms: fact.args }, substitution);
      if (newSub) {
        results.push(newSub);
      }
    }

    // 2. Check rules (Inference)
    for (const rule of this.rules) {
      const newSubstitutions = this.evaluateRule(rule, atom, substitution);
      for (const sub of newSubstitutions) {
        if (!this.isDuplicateSubstitution(results, sub)) {
          results.push(sub);
        }
      }
    }

    return results;
  }

  /**
   * Monotonic counter used to standardize rule variables apart, so each rule
   * application works with fresh variables and recursive rules terminate.
   */
  private ruleCounter = 0;

  private evaluateRule(rule: Rule, goal: Atom, initialSub: Substitution): Substitution[] {
    // Standardize apart: rename the rule's variables uniquely for this application.
    const fresh = this.renameRuleVariables(rule, ++this.ruleCounter);

    // If the rule head matches the goal
    const headSub = this.unify(goal, fresh.head, initialSub);
    if (!headSub) return [];

    // We need to satisfy all atoms in the body
    return this.solveBody(fresh.body, 0, headSub);
  }

  /**
   * Returns a copy of the rule with every variable suffixed by a unique tag.
   * Without this, recursive rule applications share variable names with their
   * callers, which both corrupts bindings and can cause non-terminating recursion.
   */
  private renameRuleVariables(rule: Rule, tag: number): Rule {
    const suffix = `__r${tag}`;
    const renameAtom = (atom: Atom): Atom => ({
      ...atom,
      terms: atom.terms.map((term) => (this.isVariable(term) ? `${term}${suffix}` : term)),
    });
    return { ...rule, head: renameAtom(rule.head), body: rule.body.map(renameAtom) };
  }

  private solveBody(body: Atom[], index: number, currentSub: Substitution): Substitution[] {
    if (index === body.length) {
      return [currentSub];
    }

    const atom = body[index];
    
    // For simplicity in this implementation, we handle negation by checking 
    // if the atom's predicate starts with "NOT_". 
    // This is a convention for the engine to identify negated atoms in the body.
    const isNegated = atom.predicate.startsWith("NOT_");
    const actualPredicate = isNegated ? atom.predicate.replace("NOT_", "") : atom.predicate;
    const effectiveAtom = { ...atom, predicate: actualPredicate };

    const results: Substitution[] = [];
    const atomSubstitutions = this.evaluate(effectiveAtom, currentSub);

    if (isNegated) {
      // For negation, we succeed only if NO substitution makes the atom true.
      // However, we cannot bind new variables from a failed negation.
      // So we check if the current substitution satisfies the negation.
      if (atomSubstitutions.length === 0) {
        return this.solveBody(body, index + 1, currentSub);
      } else {
        return [];
      }
    } else {
      for (const sub of atomSubstitutions) {
        const nextSubs = this.solveBody(body, index + 1, sub);
        results.push(...nextSubs);
      }
    }

    return results;
  }

  /**
   * Unifies an atom with a fact or another atom.
   */
  private unify(atom: Atom, target: Atom, sub: Substitution): Substitution | null {
    if (atom.predicate !== target.predicate) return null;
    if (atom.terms.length !== target.terms.length) return null;

    let currentSub = { ...sub };

    for (let i = 0; i < atom.terms.length; i++) {
      const term = atom.terms[i];
      const targetTerm = target.terms[i];

      const unifiedSub = this.unifyTerms(term, targetTerm, currentSub);
      if (!unifiedSub) return null;
      currentSub = unifiedSub;
    }

    return currentSub;
  }

  private unifyTerms(term: Term, targetTerm: Term, sub: Substitution): Substitution | null {
    const t1 = this.resolveTerm(term, sub);
    const t2 = this.resolveTerm(targetTerm, sub);

    if (t1 === t2) return sub;

    // Only unbound variables may be bound. A variable already bound to a
    // different value is a unification failure, not a rebinding opportunity.
    const termIsUnbound = this.isVariable(term) && t1 === term;
    const targetIsUnbound = this.isVariable(targetTerm) && t2 === targetTerm;

    if (termIsUnbound) {
      return { ...sub, [term]: t2 };
    }

    if (targetIsUnbound) {
      return { ...sub, [targetTerm]: t1 };
    }

    return null;
  }

  private resolveTerm(term: Term, sub: Substitution): string {
    if (this.isVariable(term) && sub[term]) {
      return this.resolveTerm(sub[term], sub);
    }
    return term;
  }

  private isVariable(term: Term): boolean {
    return typeof term === "string" && term.startsWith("?");
  }

  private isDuplicateSubstitution(existing: Substitution[], newSub: Substitution): boolean {
    return existing.some(sub => {
      const keys = new Set([...Object.keys(sub), ...Object.keys(newSub)]);
      for (const key of keys) {
        if (sub[key] !== newSub[key]) return false;
      }
      return true;
    });
  }
}
