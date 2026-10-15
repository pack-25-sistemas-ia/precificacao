---
name: margin-markup-engine
description: Use ao mexer no solver, na avaliação direta, no preço de equilíbrio, no preço para a margem-alvo, em markup ou desconto.
---

# Motor de margem e markup

- **Avaliação direta** (`evaluate`) é a verdade: dado um preço, calcula taxas por linha, contribuição, margem, markup e gerencial. O **solver** só procura o preço e **sempre confere** pela avaliação direta.
- Caso simples: `R = (C×q + Σb) ÷ (1 − m − Σa)`; denominador ≤ 0 → **inviável** (nunca devolver preço). Tetos/pisos: enumera regimes (até 8 taxas limitadas) e mantém só soluções verificadas; senão «não resolvível».
- Arredondamentos: `nearest`, `up`, `down`, `charm_90`, `charm_99`; `up` e terminações **sobem até atingir a meta** (a taxa arredondada pode deixar 1 centavo faltando). `meetsTarget`/`shortfallPp` dizem a verdade.
- Desconto: taxas recalculadas sobre o preço **final**; desconto máximo = preço mínimo da margem mínima (`up`).
- Fixtures F1–F10 em docs/PRICING_ENGINE.md. Mudou algo: `pnpm test` + `pnpm test:db` + `pnpm test:mutation --only motor`.
