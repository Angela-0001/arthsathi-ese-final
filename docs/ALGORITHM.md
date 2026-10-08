# ArthSathi — Recommendation Algorithm

## Overview

The engine runs in 4 stages: hard eligibility filter → weighted scoring → MMR re-ranking → adaptive learning.

---

## Stage 1 — Three-Valued Eligibility Filter

Each criterion evaluates to **PASS**, **FAIL**, or **UNKNOWN** (user hasn't answered that field yet).

- Any **FAIL** → scheme excluded (never shown)
- All **PASS** → status = `eligible`
- No FAIL but some **UNKNOWN** → status = `likely` (shown with a penalty and a "answer X more questions to confirm" prompt)

Criteria checked: age range, income ceiling, state, gender, caste, occupation, ration card type, residence, bank account, Aadhaar, BPL, disability, widow, student, farmer.

---

## Stage 2 — 8-Feature Weighted Score

```
score(u,s) = Σ w_k(u) · f_k(u,s)  −  unknown_penalty
```

| Feature | Default Weight | Description |
|---------|---------------|-------------|
| f1 goalRelevance | 0.25 | Keyword overlap between user goal and scheme tags/category |
| f2 financialBenefit | 0.20 | `min(1, benefit/goal_amount)` blended with `log(1+benefit/income)` |
| f3 urgencyMatch | 0.15 | Scheme delivery speed vs user urgency; deadline proximity boost |
| f4 eligibilityMargin | 0.12 | Distance from eligibility boundaries; `likely` penalty |
| f5 easeOfAccess | 0.08 | Fewer docs, user already has required documents |
| f6 coveragePriority | 0.08 | Insurance/health boost for vulnerable uninsured households |
| f7 categoryAffinity | 0.07 | Per-user learned preference for this scheme category |
| f8 recencyDeadline | 0.05 | Newly scraped or closing-soon schemes get a boost |

**unknown_penalty** = `unknown_criteria_count × 0.04`

---

## Stage 3 — MMR Diversity Re-Ranking

Prevents 10 near-identical schemes dominating results.

```
next = argmax[ λ·score(s) − (1−λ)·max_sim(s, already_selected) ]
λ = 0.8,  similarity = 0.6·(same_category) + 0.4·(tag_overlap)
```

One slot (ε=10%) is reserved for **exploration** — a novel-category scheme the user hasn't seen, so the system can discover new preferences.

**Maximum results returned: 10 schemes, 5 insurance.**

---

## Stage 4 — Adaptive Weight Learning

After each user interaction (click, apply, dismiss):

```python
Δ_k = f_k(chosen) − mean_k(all_shown)   # deviation of chosen from mean
w_k ← w_k · exp(η · reward · Δ_k)       # multiplicative weights update
η_t  = 0.10 / (1 + t/50)                # decaying learning rate
w    = clip(w, 0.01, 0.60)
w    = normalise(w)                       # Σ w = 1
w    = (1−0.05)·w + 0.05·w_global        # regularise toward global prior
```

**Reward values:**
- apply: +1.0 | save: +0.6 | click: +0.3 | long-dwell: +0.15
- dismiss: −0.5 | impression-ignored: −0.05

**Worked example:**

User always clicks cash-benefit schemes. After 10 interactions:
- `f2_financialBenefit` weight rises from 0.20 → ~0.28
- `f1_goalRelevance` may drop slightly if goal text didn't match well
- Cash-category schemes move up in next session's ranking

Stored in `user_weight_profiles` table with version history.

---

## Explainability

`explain(user, scheme)` produces: *"Recommended because: matches your farming goal; provides ₹6,000/year benefit; specifically for SC category."*

Built from the top-3 highest-scoring features + passing eligibility criteria.

---

## Global Retraining (Nightly)

Logistic regression on aggregated interaction logs (features → click/apply label). New global weights replace old only if NDCG@10 improves on held-out slice.

```python
python recommendation_engine.py --retrain --scope global
```
