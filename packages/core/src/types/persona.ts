export interface PersonaDefinition {
  id: string;
  description: string;
  expertise_tags: string[];
  parent_id?: string;
  weight: number;
  instructions?: string;
  permissions?: Record<string, unknown>;
}

export interface PersonaHierarchy {
  [id: string]: PersonaDefinition;
}

export interface PersonaMatch {
  persona_id: string;
  confidence: number;
  matched_tags: string[];
  inherited_tags: string[];
}
