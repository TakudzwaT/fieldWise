# Research: Which farm should Felix go to next?

## Decision this informs
Should FieldWise keep ranking farms by a fixed category order (urgent > confirmed > call >
early signs > clear)? Or should it rank by **maize saved per minute of Felix's time**,
recalculated after every visit?

## Current system
- `maize_check.dart` gives each farm a weather score (0–21) and, after the USSD check-in, an
  outcome with a fixed number: urgent 100, confirmed 80, call 65, early signs 56, clear 10.
- `felix_app.dart` sorts on that number alone (`_ranked`). Distance, travel time, farm size,
  time left in the treatment window and neighbouring farms are all ignored. A confirmed farm
  45 minutes away beats an urgent-looking farm next door if its number is higher.
- Constraints: runs offline on a phone, has to be explainable to Felix in one line, and the
  only data is GPS points, the 7-day forecast and USSD answers. Felix travels by motorbike
  and has a fixed working day.

## How it's solved
### Studies
- **Orienteering problem (OP)**: pick *which* places to visit, and in what order, to collect
  the most value within a time budget. Unlike delivery routing, you don't have to visit
  every place. · Fits: exactly Felix's day (3,000 farms, time for about 8 visits). · Trades
  off: exact solvers need a server, but greedy "value ÷ travel time" heuristics run on a
  phone. [Gunawan, Lau & Vansteenwegen 2016 survey](https://ink.library.smu.edu.sg/sis_research/3271) ·
  [2025 survey](https://arxiv.org/html/2512.16865v1)
- **Risk-based plant-disease surveillance**: the highest-risk sites aren't always the best
  ones to inspect. When neighbouring sites share risk, spreading visits out finds outbreaks
  sooner, and the best plan depends on how reliable each check is. · Fits: a farmer's yes/no
  answer is an imperfect check; nearby farms share the same weather. · Trades off: the full
  model needs spread simulations we don't have. We keep only its two lessons, *add a value
  for nearby farms* and *count how reliable the answer is*. [Mastin et al. 2020, PLoS Biology](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7581011/)
- **Gittins / Whittle index (restless bandits)**: give each "project" (here, a farm) its own
  index, and each step act on the highest. This is close to optimal when farms change
  even while nobody visits them. · Fits: it backs up the idea of *one score per farm,
  recalculated*, rather than planning the whole day once. · Trades off: proving the index is
  right needs farm-to-farm transition data we don't have; Google also found these indices
  can fail in simple cases. Read from abstracts and a tutorial only, not the full papers.
  [Scully & Terenin tutorial](https://arxiv.org/pdf/2506.10872) ·
  [Glazebrook et al. 2006](https://eprints.lancs.ac.uk/id/eprint/2426/)
- **Timing of treatment for grey leaf spot**: spraying helps most from tasselling to early
  silking (VT–R1). Yield is lost once the leaf next to the cob is infected around tasselling,
  and when disease stays below about 4%, timing makes no difference. · Fits: this is the
  *cost of delay*. A farm whose spray window is closing loses value every day Felix doesn't
  come. · Trades off: these are US trials, so the windows need checking against Malawian
  hybrids. [K-State](https://eupdate.agronomy.ksu.edu/article/the-time-to-make-decisions-for-fungicide-management-of-gray-leaf-spot-is-rapidly-approaching-640-2) ·
  [Iowa State](https://crops.extension.iastate.edu/cropnews/2019/02/summary-foliar-fungicide-applications-corn-iowa-2018)

### Companies
- **Google Research + ARMMAN (India, maternal health)**: health workers' calls each week go
  to the beneficiaries with the top Whittle index. · Fits: a real field team that a score
  allocates its limited contacts. · Trades off: needs lots of history to learn from; we have
  none yet. [Decision-focused evaluation of the deployed system](https://arxiv.org/pdf/2301.07835)
- **Medic / Living Goods (Kenya, community health workers)**: their predictive pilot cut its
  risk factors down to **four**, chosen by *priority, data availability and potential for
  intervention*. Their simpler production mode just sorts households by days since the last
  visit, and in a Mali trial it gave **2.41 times higher odds** of the minimum visit
  coverage. · Fits: few, explainable factors, and "not seen recently" counts. · Trades off:
  a plain sort ignores distance. [Medic](https://medic.org/stories/deploying-a-predictive-algorithms-initiative-using-the-community-health-toolkit/) ·
  [Mali trial](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8609935/)
- **One Acre Fund (East Africa)**: a failed Uganda pilot found field officers spent much of
  their time *travelling between homes* instead of advising farmers. · Fits: proves travel
  cost has to be in the score. [OAF failures report](https://oneacrefund.org/sites/default/files/2023-09/Uganda_Pilot_Failures_One_Acre_Fund_Failures.pdf)
- **Weighted Shortest Job First (Reinertsen / SAFe)**: rank work by *cost of delay ÷ time
  taken*. · Fits: it's the simplest explainable version of the OP heuristic, and a busy
  person can do it in their head. [ProductPlan](https://www.productplan.com/glossary/weighted-shortest-job-first)

## Where they agree / diverge
All of them agree: **value ÷ cost, recalculated after every action**. The research adds
two things industry usually leaves out: uncertainty is worth reducing (an unanswered
high-risk farm is worth checking), and neighbouring farms share risk. Industry trades
precision for **few factors anyone can explain** (Medic's four). Felix has no history to
learn from yet, so FieldWise belongs on the industry side: a fixed formula that an
agronomist can tune, not a learned model.

## Recommendation (the seed)

**Next farm = the farm with the most maize saved per minute, recalculated after every
visit.** No number here is hand-picked. Each one is either **sourced** or **learned** from
check-in outcomes.

```
kg saved if Felix acts now  =  P(disease) × farm size × yield × loss share × still treatable?
minutes                     =  travel time from where Felix is now  +  time on the farm
next farm                   =  highest  kg saved ÷ minutes
```

| Input | Value | Source or method |
|---|---|---|
| Farm size | 0.7 ha (≈1.7 acres) until the farm's own size is recorded | [CCARDESA](https://ccardesa.org/malawi); 60% of farms are under 1 ha |
| Yield | 2,000 kg/ha → 1,400 kg per average farm | [CIMMYT SIMLESA](https://simlesa.cimmyt.org/?p=306) (range 1.5–2.6 t/ha) |
| Loss share | 13% conservative, 37% upper | [UKZN field trials](https://researchspace.ukzn.ac.za/handle/10413/11758) |
| P(disease) from weather | **Learned**: an ordinal logistic regression on the hours spent at 22–30 °C and ≥ 95% humidity, starting from the published Iowa State grey leaf spot model (66–73% of validation cases ranked correctly) | [Iowa State](https://dr.lib.iastate.edu/handle/20.500.12876/68099) · [APS 2002](https://www.apsnet.org/publications/plantdisease/2002/October/Pages/86_10_1127.aspx) · [APS 2005](https://www.apsnet.org/publications/plantdisease/2005/June/Pages/89_6_624.aspx) (abstracts only; read the full text for the coefficients before quoting them) |
| P(disease) after the USSD answer | **Learned**: each confirmed or ruled-out check-in is a labelled example, and the model is refitted to Kasungu as they accumulate. **No answer keeps the weather probability**, so a silent High-risk farm stays near the top. | Bayesian / logistic update from pilot data |
| Still treatable? | Full value until tasselling to early silking, then dropping | Spraying works best at the VT–R1 stages: [K-State](https://eupdate.agronomy.ksu.edu/article/the-time-to-make-decisions-for-fungicide-management-of-gray-leaf-spot-is-rapidly-approaching-640-2), [Iowa State](https://crops.extension.iastate.edu/cropnews/2019/02/summary-foliar-fungicide-applications-corn-iowa-2018). Needs a USSD question: "Has your maize tasselled?" |
| Travel time | From GPS points and Felix's own logged visit times | Learned from his visit log in the pilot. Until then, ask Felix for his average speed and visit length rather than guessing. |
| Neighbours | Only added once the pilot shows whether blight clusters within a radius | [Mastin et al. 2020](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7581011/): shared risk between nearby sites changes the best plan |
| Day budget | Choose greedily until the remaining hours, including the ride home, run out | The phone-friendly orienteering heuristic ([Gunawan et al. 2016](https://ink.library.smu.edu.sg/sis_research/3271)) |

**Worked value for an average farm:** 0.7 ha × 2,000 kg/ha × 13% ≈ **180 kg of maize ≈ $83**
(K790/kg, [ADMARC](https://mwnation.com/consumers-panic-as-maize-price-hits-k65-000-per-bag/)).
That's about 3 months of food for a family of five. 17–38 farms caught early pay a year of an
officer's salary ($1,360–3,100, [Paylab](https://www.paylab.com/mw/salaryinfo/agriculture-food-industry/livestock-specialist?lang=en)).

**What Felix sees, one line per farm:** *"Chimwemwe Farm · saves ~180 kg of maize · 12 min
away · spray window closes in 6 days."*

**The trade-off we accept:** on day 1 the model runs on published values and averages, not
Kasungu data, so it ranks farms about as well as the Iowa model does (66–73%), not
perfectly. In return every number can be defended in front of a jury, and the model gets
better with each confirmed check-in instead of staying a guess.

## Open questions
- Farm size (hectares) and crop growth stage aren't collected yet. Add a USSD question
  ("Has your maize tasselled? 1 yes 2 no") and a field for farm size.
- A trip can't be undone, so is a greedy pick per farm good enough, or does Felix need the
  whole day planned in one go? Test both against his real routes in the pilot.
- The engine still uses the hand-written rule (18–27 °C, 90% humidity, +1 per day). That's
  looser than the published thresholds (22–30 °C, ≥ 95%), so it flags more farms. Move it to
  the published model, test first.
- Mastin et al. argue for spreading visits out to *detect* disease, while the value formula
  favours clusters for *treatment*. Which matters more early in the season?
