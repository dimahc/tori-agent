---
title: "Spec : Review Report Contract"
status: superseded
created: 2026-07-29
superseded: 2026-07-29
---

> **OBSOLETE** — This spec describes the report contract for the old review cluster (review-manager, requirements-reviewer, code-reviewer, security-reviewer, architecture-reviewer). These agents no longer exist as separate entities in the new 3-agent architecture (Tori, Specialist, Scribe). The review orchestration model has been replaced by Tori's delegation workflow.

# Spec : Review Report Contract

**Statut :** draft
**Mis à jour :** 2026-07-29

## Résumé

Contrat structurel unique pour les rapports produits par le cluster review (`review-manager`, `requirements-reviewer`, `code-reviewer`, `security-reviewer`, `architecture-reviewer`). Définit comment garder ces rapports plats à travers les rounds multiples au lieu de les laisser grossir linéairement — sans jamais compresser lexicalement le contenu dont l'arbitrage dépend.

---

## Non-but explicite

**Ce n'est PAS de la compression lexicale / style caveman.** Aucune règle ci-dessous ne raccourcit le vocabulaire, ne coupe la grammaire, ni ne résume les champs dont la logique d'arbitrage dépend. Ces champs restent intégraux, phrases complètes :

| Champ | Agent | Pourquoi il reste intact |
|---|---|---|
| `Attack vector:` | `security-reviewer` | Le review-manager arbitre la sévérité sur la base du vecteur d'exploitation décrit — une version tronquée fausse l'arbitrage |
| Ligne du tableau *Requirements Coverage* | `requirements-reviewer` | Preuve d'évidence (`file:line` + statut) — l'arbitrage "requirements failures block" en dépend directement |

Ce contrat est **structurel** : il change la forme du rapport (ce qui est répété, ce qui est omis, ce qui est référencé par ID), jamais le contenu des champs qui portent la décision.

---

## Règle 1 — Cap / strip des sections narratives

Les sections narratives libres (`Positive Notes`, texte d'accompagnement hors template) doivent rester courtes par construction — pas de paragraphe multi-phrases quand une ligne suffit. Elles ne sont jamais le support d'une décision d'arbitrage ; les allonger n'ajoute aucune valeur au round suivant.

## Règle 2 — "No issues" collapse à une ligne

Quand un reviewer n'a aucun finding, la section `### Positive Notes` (ou équivalent) devient une seule ligne d'acknowledgment — jamais un paragraphe libre. Exemple :

```
### Positive Notes
No issues found. Implementation is sound.
```

Exception déjà existante et à conserver telle quelle : la Auth/Token/Crypto Acknowledgment Rule de `security-reviewer` produit déjà un one-liner explicite ("Reviewed auth/token handling — no issues detected.") — ce contrat généralise ce pattern aux trois reviewers, il ne le remplace pas.

## Règle 3 — Schéma d'ID d'issue par round

Chaque issue reportée dans un round de review reçoit un ID séquentiel `#N`, assigné par `review-manager` au moment de la synthèse (pas par les reviewers individuels — ils n'ont pas de vue sur les rounds précédents). L'ID est stable pour la durée de vie de la review multi-round.

Au round suivant, si une issue précédemment reportée est résolue, elle est référencée par son ID — jamais re-décrite :

```
### Issues

Issue #2 — fixed (previously: missing null check on `parseInput`)
```

Une issue non résolue au round N+1 est re-évaluée normalement (elle peut changer de sévérité, de description) mais garde son ID `#N` d'origine pour la traçabilité.

---

## Portée d'application

| Agent | S'applique |
|---|---|
| `review-manager` | Assigne les ID `#N`, applique la règle de référencement cross-round dans `### Issues` |
| `requirements-reviewer` | Règle 1 et 2 sur `### Positive Notes` |
| `code-reviewer` | Règle 1 et 2 sur `### Positive Notes` |
| `security-reviewer` | Règle 1 et 2 sur `### Positive Notes` (déjà partiellement couvert par l'Acknowledgment Rule) |
| `architecture-reviewer` | Règle 1 et 2 sur `### Positive Notes` |

Les prompts des 5 agents ne dupliquent pas ce texte — ils pointent vers ce fichier et n'inlinent que la ou les règles actionnables nécessaires à leur comportement au runtime.

---

## Liens

- [Spec : Cluster review](./review-cluster.md)
- [Spec : Mechanical checks — review-manager](./review-manager-mechanical-checks.md)
- [Index docs](../index.md)
