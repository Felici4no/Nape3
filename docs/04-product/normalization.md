# Offer normalization

## Objective

Determine whether offers from different sources are comparable enough to appear in the same result set.

## Initial strategy

Use deterministic extraction whenever possible.

Examples:

- normalize units;
- parse "500 ml", "0.5 L", "500ml";
- standardize categories;
- separate toppings or modifiers;
- normalize currency values.

Use model-assisted extraction only when deterministic parsing is insufficient.

## Principle

An LLM may help extract structure, but it should not silently decide equivalence.

The system should preserve:

- original source title;
- extracted attributes;
- normalization method;
- confidence;
- reasons for match or rejection.

## Open research problem

Equivalence is category-specific. Matching logic for açaí may not generalize to pizza, meals, or branded products.
