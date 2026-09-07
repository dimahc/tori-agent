export type Fact = {
  predicate: string;
  args: string[];
};

export type Variable = string;

export type Term = string | Variable;

export type Atom = {
  predicate: string;
  terms: Term[];
};

export type Rule = {
  head: Atom;
  body: Atom[];
  isNegated?: boolean; // For stratified negation support
};

export type Substitution = Record<Variable, string>;

export interface PolicyEngine {
  evaluate(
    subject: string,
    action: string,
    object: string,
    context?: Record<string, any>
  ): Promise<boolean>;
  
  addFact(fact: Fact): void;
  addRule(rule: Rule): void;
  clear(): void;
}
