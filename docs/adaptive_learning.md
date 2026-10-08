# ArthSathi — Adaptive Recommendation Engine

## Overview

ArthSathi's recommendation engine starts with hand-crafted weights and improves
automatically over time through a lightweight gradient-update mechanism trained
on real user engagement.

---

## Scoring Formula

Each eligible scheme or insurance policy receives a composite score:

```
score = w₁ × goalRelevance
      + w₂ × urgencyMatch
      + w₃ × benefitSignificance
      + w₄ × eligibilityComfort
      + w₅ × accessibility
```

### Default Weights

| Component             | Default Weight | Description |
|-----------------------|----------------|-------------|
| `goalRelevance`       | 0.30           | Keyword overlap between user's stated goal and scheme tags |
| `urgencyMatch`        | 0.20           | How well benefit amount covers goal, scaled by urgency level |
| `benefitSignificance` | 0.25           | Benefit ÷ annual income (logarithmic scale) |
| `eligibilityComfort`  | 0.15           | How far user is from eligibility boundaries |
| `accessibility`       | 0.10           | Barrier score (collateral, Jan Dhan, land requirements) |

---

## Component Definitions

### 1. Goal Relevance Score `[0, 1]`

```python
goal_words = tokenise(user.financial_goal)
scheme_tokens = scheme.tags + [scheme.category]
overlap_ratio = len(matches) / len(goal_words)
category_boost = 0.2 if direct_category_keyword_hit else 0
score = min(1.0, overlap_ratio + category_boost)
```

### 2. Urgency Match Score `[0, 1]`

```python
urgency_factor  = user.urgency_level / 5           # 0.2 – 1.0
coverage_factor = min(1.0, benefit / goal_amount)  # 0.0 – 1.0
access_factor   = 1.0 if free else 0.7

score = urgency_factor × 0.5 + coverage_factor × 0.3 + access_factor × 0.2
```

### 3. Benefit Significance Score `[0, 1]`

| Benefit / Annual Income | Score |
|-------------------------|-------|
| ≥ 100%                  | 1.00  |
| ≥ 50%                   | 0.85  |
| ≥ 20%                   | 0.70  |
| ≥ 10%                   | 0.60  |
| ≥ 5%                    | 0.50  |
| < 5%                    | 0.30  |

### 4. Eligibility Comfort Score `[0, 1]`

Measures how comfortably the user sits within the eligibility window.

```python
age_range    = max_age - min_age
min_distance = min(user.age - min_age, max_age - user.age)
age_score    = max(0.1, min(1.0, min_distance / (age_range / 2)))

income_score = max(0.1, 1.0 - (user.income / max_income) × 0.8)

score = age_score × 0.5 + income_score × 0.5
```

### 5. Accessibility Score `[0, 1]`

```
base = 0.80
− 0.10 if requires_land
− 0.05 if requires_bank_account
+ 0.10 if requires_jan_dhan     (designed for rural poor)
+ 0.15 if tag: collateral_free
+ 0.10 if tag: direct_benefit
+ 0.05 if tag: free
```

---

## Adaptive Weight Learning

### Mechanism

Once per day (scheduled via cron), `ml-model/engine.py --recalibrate` runs:

1. **Data collection**: Fetch all `interaction_events` from the last 30 days
   where `event_type IN ('apply', 'clicked', 'dismiss')`.

2. **Feature reconstruction**: For each (user, scheme) pair, retrieve the
   `profile_snapshot` stored at match time and recompute all 5 score components.

3. **Labels**:
   ```
   apply    → +1.0
   clicked  → +0.8
   dismiss  → −0.5
   view     →  0.0  (ignored, no learning signal)
   ```

4. **Gradient update** (simplified policy gradient):
   ```
   ∂w_i = label × (component_i − mean(component_i))
   w_i_new = w_i + lr × mean(∂w_i across all events)
   ```
   Where `lr = 0.05` (learning rate).

5. **Clipping**: Each weight is floored at 0.05 so no component disappears.

6. **Normalisation**: Σ weights = 1.0 after update.

7. **Persistence**: Written to `ml-model/weights.json`, which the Node backend
   watches and reloads every 10 minutes.

### Intuition

If users consistently click on high-benefit-significance schemes, the gradient
for `benefitSignificance` will be positive, pushing its weight higher.
If goal relevance rarely correlates with engagement, its gradient stays near 0.

This is mathematically equivalent to training a linear classifier with engagement
as the binary label — a lightweight, explainable approach suited to the expected
dataset size at launch (hundreds to low thousands of interactions).

### Mathematical Derivation

For a linear scoring model `ŷ = Σᵢ wᵢ fᵢ` where `fᵢ` are the component scores:

The binary cross-entropy loss w.r.t. weight `wᵢ` is:
```
∂L/∂wᵢ = Σₙ (yₙ − σ(ŷₙ)) × fᵢₙ
```

For the simplified update we use `(yₙ − 0.5) ≈ label` (since the expected 
score without learning is ~0.5) and subtract the mean to reduce variance:
```
∂L/∂wᵢ ≈ mean_n [ labelₙ × (fᵢₙ − mean(fᵢ)) ]
```

This is the correlation between engagement labels and centred component scores —
a zero-framework, zero-dependency approach deployable on any Python 3.8+ environment.

---

## Monitoring

Weights are logged to stdout after every recalibration run and are readable via:

```bash
cat ml-model/weights.json
```

Interaction counts that fed the last recalibration are logged to the server console.

---

## Extending the Engine

To add a new scoring component:
1. Add it to `DEFAULT_WEIGHTS` in both `engine.py` and `recommendationService.js`
2. Implement the component function in both files
3. Add it to `score_components()` in `engine.py` and `scoringWeights` in `recommendationService.js`
4. The adaptive learning loop will pick it up automatically on next recalibration
