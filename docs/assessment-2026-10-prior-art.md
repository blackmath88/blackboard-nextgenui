# Prior-art scan: Blackboard NextGenUI

Scope: web and literature research only. I did not read any code. Verification: every DOI below was checked against Crossref, so title, first author and year match the DOI. Every web URL marked "(200)" returned HTTP 200 on 2026-10-17. Anything I could not check is marked **[unverified]**. Summaries of papers I did not re-read in full this session come from abstracts and established secondary knowledge, and the text says when a claim is my own reading.

---

## 1. Blackboard architectures

**Sources**
- Erman, Hayes-Roth, Lesser, Reddy. "The Hearsay-II Speech-Understanding System: Integrating Knowledge to Resolve Uncertainty." *ACM Computing Surveys* 12(2), 1980. https://doi.org/10.1145/356810.356816. Independent knowledge sources (KSs) read and write hypotheses at several levels of abstraction (segment, syllable, word, phrase) on a shared, global "blackboard." A scheduler decides which KS to run next, using a focus-of-attention policy. The paper's central claim is *opportunistic* problem solving under uncertainty: work moves bottom-up and top-down from wherever confidence is highest, not in a fixed pipeline.
- Hayes-Roth, F. & Lesser, V. "Focus of Attention in the Hearsay-II Speech Understanding System." 1977 tech report. https://doi.org/10.21236/ada037770. Describes the scheduling and attention problem, which turned out to be the hard part.
- Hayes-Roth, B. "A blackboard architecture for control." *Artificial Intelligence* 26(3), 1985. https://doi.org/10.1016/0004-3702(85)90063-3. BB1 treats *control* as a problem in its own right, solved on a second "control blackboard" where control KSs post strategies, foci and policies. This makes the system's reasoning about what to do next explicit, and that is what makes it inspectable. Earlier psychological grounding: Hayes-Roth & Hayes-Roth, "A Cognitive Model of Planning," *Cognitive Science* 3(4), 1979, https://doi.org/10.1207/s15516709cog0304_1, on opportunistic planning.
- Nii, H. P. "The Blackboard Model of Problem Solving and the Evolution of Blackboard Architectures," *AI Magazine* 7(2), 1986, https://ojs.aaai.org/index.php/aimagazine/article/view/537 (200). Part Two: "Blackboard Application Systems, Blackboard Systems and a Knowledge Engineering Perspective," *AI Magazine* 7(3), 1986, https://ojs.aaai.org/index.php/aimagazine/article/view/550 (200). This is the canonical survey. It separates the abstract model (experts gathered round a blackboard) from concrete architectures, and application systems from skeletal frameworks (e.g., AGE, BB1, GBB).
- Recent LLM revivals: Han & Zhang, "Exploring Advanced LLM Multi-Agent Systems Based on Blackboard Architecture," arXiv:2507.01701 (2025), https://arxiv.org/abs/2507.01701 (200). Salemi et al., "LLM-Based Multi-Agent Blackboard System for Information Discovery in Data Science," arXiv:2510.01285 (2025), https://arxiv.org/abs/2510.01285 (200). Both use a shared board in place of a central orchestrator. The second argues explicitly against master/worker controllers that need precise knowledge of each sub-agent's capabilities.

**Failures and why**
- *Hearsay-II did not win its own benchmark.* In the 1971–76 DARPA Speech Understanding Research program, CMU's Harpy, a compiled finite-state network search, is generally credited as the system that met the program's targets. Hearsay-II was more general but slower and less accurate. See Klatt, "Review of the ARPA Speech Understanding Project," *JASA* 62(6), 1977, https://doi.org/10.1121/1.381666. Speech recognition then moved to statistical HMM methods, not blackboards. (The specific accuracy figures come from secondary memory and are **[unverified]** here.)
- *The difficulty sat in control and engineering.* Nii's surveys and BB1 both show that the scheduler and focus-of-attention policy carried most of the difficulty. Blackboard systems were hard to debug, hard to predict and costly at runtime. By the 1990s they survived mostly as niche frameworks. My reading is that the architecture was abandoned less because it was wrong than because more specialized, data-driven methods beat it on performance.

**Relevance to the project**
Using the blackboard as a *metaphor for how a model processes* is prior art. The 2025 arXiv papers already apply it to LLM agents. What is less common is putting the blackboard *on screen*, with the human as one of the knowledge sources and BB1-style control (the "frames" in this project) visible and user-applied. One caution: today's LLMs are not opportunistic multi-KS solvers internally. Calling the UI a "blackboard of the model's processing" risks a misleading mental model. "Blackboard of the conversation's work products" is more accurate.

---

## 2. Mixed-initiative interaction

**Sources**
- Horvitz, E. "Principles of mixed-initiative user interfaces." *CHI '99*. https://doi.org/10.1145/302979.303030. Lists 12 principles. Among them: add real value, consider uncertainty about user goals, weigh the costs and benefits of acting, time actions to attention, allow efficient invocation *and termination*, offer dialogue to resolve uncertainty, keep memory of recent interactions, and degrade service gracefully. Grounds them in **LookOut**, an Outlook add-on that inferred scheduling intent from email. LookOut acted only when expected utility exceeded thresholds, and otherwise asked or did nothing.
- Allen, J. F., Guinn, C. I., Horvitz, E. "Mixed-initiative interaction." *IEEE Intelligent Systems* 14(5), 1999. https://doi.org/10.1109/5254.796083. Frames initiative as something that shifts between human and system in a dialogue, and separates levels of initiative (task, dialogue, etc.).

**Failures and why**
Horvitz's principles grew directly out of the Lumière/Office Assistant experience (topic 4). The shipped product broke several of them, mainly timing to attention and cheap dismissal. The principles survived. Most commercial "proactive assistant" products that came after did not.

**Relevance**
Several project features restate Horvitz in new terms: "proposals not actions," asking before removing panes, and making initiative cheap to decline. The project's specific position, that the model may *propose* structure but only the user may *commit* it, sits at the most conservative end of Horvitz's decision-theoretic spectrum. Horvitz would argue for using confidence to decide *when* to propose. The project does not appear to do that, and that gap matters for consent fatigue (topic 5).

---

## 3. Direct manipulation vs. agents

**Sources**
- Shneiderman, B. "Direct Manipulation: A Step Beyond Programming Languages." *IEEE Computer* 16(8), 1983. https://doi.org/10.1109/MC.1983.1654471. Defines direct manipulation: continuous representation of the objects of interest, physical actions instead of complex syntax, and rapid, incremental, *reversible* operations whose effects are immediately visible.
- Shneiderman, B. & Maes, P. "Direct manipulation vs. interface agents." *Interactions* 4(6), 1997. https://doi.org/10.1145/267505.267514. Shneiderman argues for predictability, control and responsibility. Maes argues for delegation to agents in information overload. Both concede some ground: Maes says agents need visible models and user control, and Shneiderman accepts some automation.
- Beaudouin-Lafon, M. "Instrumental interaction." *CHI 2000*. https://doi.org/10.1145/332040.332473. Generalizes direct manipulation into "instruments" that mediate between user and domain objects, with degree of indirection, integration and compatibility as design dimensions.

**Failures and why**
Neither side "won." The agent vision of the 1990s (Maes' agents, Clippy, Microsoft Bob) failed commercially. The main reasons were opacity, mistimed interruptions and anthropomorphism. Pure direct manipulation hits limits with large or abstract object spaces. Instrumental interaction stayed mostly academic.

**Relevance**
The project's dashed, attributed proposals, which the user confirms, are a hybrid: the agent *creates* objects, and the user *manipulates* them directly. DirectGPT (Masson et al., topic 9) is the closest LLM-era statement of the Shneiderman position. The "answer-shaped vs workspace-shaped" distinction largely restates this debate with LLMs in place of agents. Present it as a reframing, not a new distinction.

---

## 4. Adaptive vs. adaptable interfaces, and their failures

**Sources**
- McGrenere, Baecker, Booth. "An evaluation of a multiple interface design solution for bloated software." *CHI 2002*. https://doi.org/10.1145/503376.503406. A field study of Word 2000. A user-controlled (adaptable) personal interface was preferred over, and used more than, Microsoft's adaptive personalized menus.
- Findlater, L. & McGrenere, J. "A comparison of static, adaptive, and adaptable menus." *CHI 2004*. https://doi.org/10.1145/985692.985704. Adaptable (user-controlled) menus were generally preferred, and adaptive menus were not faster than static ones. Results depended on the task and on the user's motivation to customize.
- Findlater, Moffatt, McGrenere, Dawson. "Ephemeral adaptation: the use of gradual onset to improve menu selection performance." *CHI 2009*. https://doi.org/10.1145/1518701.1518956. Keeps the layout fixed and adapts only *timing*: predicted items appear instantly and the rest fade in. This was faster than static menus at high prediction accuracy, and not significantly slower at low accuracy. Lesson: adapt salience, not location.
- Gajos, Czerwinski, Tan, Weld. "Exploring the design space for adaptive graphical user interfaces." *AVI 2006*. https://doi.org/10.1145/1133265.1133306.
- Gajos, Everitt, Tan, Czerwinski, Weld. "Predictability and accuracy in adaptive user interfaces." *CHI 2008*. https://doi.org/10.1145/1357054.1357252. Author PDF: https://kgajos.seas.harvard.edu/papers/kgajos-chi08-predictability.pdf. Both predictability and accuracy improved satisfaction. Contrary to the authors' expectation, *accuracy* had the stronger effect on performance and use.
- Jensen Harris (Microsoft Office UX lead), "Combating the Perception of Bloat (Why the UI, Part 3)," 2006. https://learn.microsoft.com/en-us/archive/blogs/jensenh/combating-the-perception-of-bloat-why-the-ui-part-3 (200; read in full). This is the primary practitioner post-mortem on Office 2000 Adaptive/Personalized Menus.
- Horvitz, Breese, Heckerman, Hovel, Rommelse. "The Lumière Project: Bayesian User Modeling for Inferring the Goals and Needs of Software Users." *UAI 1998*. https://arxiv.org/abs/1301.7385 (200). Bayesian models infer a user's needs from their actions and queries. The paper says the prototypes "served as the basis for components of the Office Assistant" in Office 97.
- Swartz, L. "Why People Hate the Paperclip: Labels, Appearance, Behavior, and Social Responses to User Interface Agents." Stanford undergraduate honors thesis, 2003. **[unverified: I could not locate a stable repository link; contents known via secondary summaries]**.
- Höök, K. "Steps to take before intelligent user interfaces become real." *Interacting with Computers* 12(4), 2000. https://doi.org/10.1016/S0953-5438(99)00006-5. Argues that intelligent interfaces fail on usability, not on AI. Lists preconditions: understand users' real needs, make the system's behaviour transparent and predictable, give users control, and evaluate in real use.

**Failures and why**
- *Office personalized menus* were introduced in Office 2000 and turned off by default by 2007. Harris gives three reasons. (1) No default "short" menu suited everyone, because people use a very wide range of features. (2) Two-pass scanning: when the full menu expanded, items were inserted in place, so the user's scan restarted. (3) "Auto-customization, unless it does a perfect job, is usually worse than no customization at all": users experienced "randomness and unpredictability; one time, a menu item would be in a certain place, and then two days later it wasn't there anymore." He reports that "most customers, especially those in corporate environments, turn both of these features off." **This bears directly on the project's "untouched panes fade to tabs after N turns."**
- *Clippy / Office Assistant.* Swartz (via secondary summaries) blames both concept and implementation. The assistant interrupted unprompted (the "It looks like you're writing a letter" feature), broke social etiquette, and left users feeling out of control. Anthropomorphism raised expectations it could not meet. It is often claimed that the shipped Assistant used far less of Lumière's event-stream inference and cost-of-interruption reasoning than the research prototype. Horvitz's own page says only that the prototypes formed "components" of the product, so treat that claim as **[unverified]**.
- *General pattern* (Höök; Gajos; Findlater): adaptation that moves things in space destroys learned locations. Adaptation users can neither predict nor veto feels random. Adaptable (user-controlled) designs win on preference but are under-used, because customizing takes effort.

**Relevance**
The project's consent-gated pane creation and "ask before removal" design is close to *adaptable* with *system-suggested adaptations*. Findlater & McGrenere and Bunt-style "mixed-initiative customization" studied exactly this (Bunt, Conati & McGrenere, IUI 2007 **[unverified DOI]**). "Fade to tabs after N turns" is spatial adaptation driven by a usage heuristic: the very pattern Harris describes as failing. It is mitigated because removal needs consent and the location is stable (the item stays as a tab). Findlater's ephemeral adaptation suggests adapting salience *in place* is safer than relocating.

---

## 5. Consent and notification fatigue

**Sources**
- Böhme, R. & Köpsell, S. "Trained to accept? A field experiment on consent dialogs." *CHI 2010*. https://doi.org/10.1145/1753326.1753689. In a field experiment with about 80,000 users, people accepted consent dialogs faster and more often when the dialog looked like an EULA. Habituation from ubiquitous click-through dialogs carries over to new ones.
- Akhawe, D. & Felt, A. P. "Alice in Warningland: A Large-Scale Field Study of Browser Security Warning Effectiveness." *USENIX Security 2013*. https://www.usenix.org/conference/usenixsecurity13/technical-sessions/presentation/akhawe (200). Using telemetry from millions of warning impressions, click-through rates differed widely by browser and warning design. The authors argue warnings *can* work and that design and frequency matter. This counters "users always ignore warnings."
- Anderson, Kirwan, Jenkins, Eargle, Howard, Vance. "How Polymorphic Warnings Reduce Habituation in the Brain: Insights from an fMRI Study." *CHI 2015*. https://doi.org/10.1145/2702123.2702322. fMRI shows visual-processing response drops sharply after repeated exposure to the same warning. Varying the warning's appearance (polymorphic warnings) slowed habituation. Follow-up: Vance et al., "Tuning Out Security Warnings," *MIS Quarterly* 42(2), 2018, https://aisel.aisnet.org/misq/vol42/iss2/3 **[unverified link; found via search]**. That study found habituation within a workweek and partial recovery between days.
- Bravo-Lillo et al. "Harder to Ignore? Revisiting Pop-Up Fatigue and Approaches to Prevent It." *SOUPS 2014*. https://www.usenix.org/conference/soups2014/proceedings/presentation/bravo-lillo (200).
- Cookie consent: Utz et al. "(Un)informed Consent: Studying GDPR Consent Notices in the Field." *CCS 2019*. https://doi.org/10.1145/3319535.3354212. Nouwens et al. "Dark Patterns after the GDPR." *CHI 2020*. https://doi.org/10.1145/3313831.3376321. Small changes in position and defaults strongly shift consent outcomes. Consent at scale becomes ritual, not deliberation.
- Raskin, J. *The Humane Interface.* Addison-Wesley, 2000 (ISBN 0-201-37937-6). Argues that confirmation dialogs get habituated ("you'll confirm automatically") and that universal undo should replace them. Cooper, A., Reimann, R., Cronin, D. *About Face* (3rd ed., 2007) makes the same point: confirmations are an "excise" users learn to dismiss.

**Failures and why**
Repeated, low-stakes, uniform dialogs train an automatic "accept." This is now neurologically documented (Anderson et al.). Consent built around frequency fails *because* it is frequent.

**Relevance (an important risk)**
The project depends on explicit consent at many points: confirming extracted objects, opening panes, removing panes, applying frames. Each consent is individually defensible. Together they recreate the conditions this literature associates with habituation. The likely failure is that users bulk-confirm proposals without reading them, so "confirmed" stops meaning "endorsed." Mitigations from the literature: batch consent, make it conditional on stakes, make it reversible instead of pre-approved (topic 6), and let low-stakes proposals sit unconfirmed without nagging. That last one is already close to the project's dashed-proposal design, which is a strength *if* proposals never block the user.

---

## 6. Undo and reversibility as an alternative to confirmation

**Sources**
- Abowd, G. D. & Dix, A. J. "Giving undo attention." *Interacting with Computers* 4(3), 1992. https://doi.org/10.1016/0953-5438(92)90021-7. A formal treatment of undo semantics: what an "undoable" state is, and how undo interacts with multiple views and the state the user perceives.
- Berlage, T. "A selective undo mechanism for graphical user interfaces based on command objects." *ACM TOCHI* 1(3), 1994. https://doi.org/10.1145/196699.196721. Undoing a single past command, not only the most recent, using command objects and dependency checks.
- Raskin 2000, as in topic 5.

**Failures and why**
Selective undo has been studied for decades but rarely shipped beyond niche tools. Dependency handling (undoing A when B depends on A) is hard, and users find non-linear history confusing. Linear undo plus version history became the de facto standard.

**Relevance**
The project's provenance record ("/why" with file:line) is the substrate selective undo needs. Making extraction *auto-applied but undoable and attributable* is a credible alternative to "confirm each proposal." I found no evidence the project evaluated that trade-off. It is the main design alternative a critical review should raise.

---

## 7. Malleable software, end-user programming and workspaces

**Sources**
- Engelbart, D. "Augmenting Human Intellect: A Conceptual Framework." SRI Summary Report AFOSR-3223, 1962. https://dougengelbart.org/content/view/138 (200).
- Kay, A. & Goldberg, A. "Personal Dynamic Media." *IEEE Computer* 10(3), 1977. https://doi.org/10.1109/C-M.1977.217672.
- diSessa, A. & Abelson, H. "Boxer: a reconstructible computational medium." *CACM* 29(9), 1986. https://doi.org/10.1145/6592.6595. Boxes are both the visible structure and the program ("naive realism").
- Marshall, C. & Shipman, F. "VIKI: spatial hypertext supporting emergent structure." *ECHT '94*. https://doi.org/10.1145/192757.192759. "Spatial hypertext." *CACM* 38(8), 1995. https://doi.org/10.1145/208344.208350. Spatial layout as implicit structure. VIKI's *spatial parser* inferred lists and stacks from layout and *suggested* structure without forcing it.
- Shipman, F. & Marshall, C. "Formality Considered Harmful: Experiences, Emerging Themes, and Directions on the Use of Formal Representations in Interactive Systems." *CSCW Journal* 8, 1999. https://doi.org/10.1023/A:1008716330212. **The most important single citation for this project.** Asking users to formalize (type, link, categorize) too early fails: people resist premature commitment, tacit knowledge resists formalization, and situations change. The authors propose *incremental formalization*, with the system suggesting structure and the user accepting it.
- Klokmose et al. "Webstrates: Shareable Dynamic Media." *UIST 2015*. https://doi.org/10.1145/2807442.2807446.
- Beaudouin-Lafon 2000, as in topic 3.
- Kleppmann, Wiggins, van Hardenberg, McGranaghan. "Local-first software: you own your data, in spite of the cloud." *Onward! 2019*. https://doi.org/10.1145/3359591.3359737; essay at https://www.inkandswitch.com/local-first/ (200).
- Litt, Schoening, Shen, Sonnentag. *Potluck: Dynamic documents as personal software.* Ink & Switch, 2022. https://www.inkandswitch.com/potluck/ (200). Gradual enrichment: plain text, then searches that pull out structured data, then computations. Structure is *extracted* from free text, which closely parallels the project's extractor.
- Litt, Horowitz, van Hardenberg, Matthews. *Malleable Software: Restoring User Agency in a World of Locked-Down Apps.* Ink & Switch, June 2025. https://www.inkandswitch.com/essay/malleable-software/ (200). Argues the "application" model blocks user agency, and that AI code generation alone will not fix it. Successful malleable systems pair a media editor with optional programmability (spreadsheets, HyperCard, Notion).
- HyperCard (Apple, 1987): no single canonical paper; it is discussed in the Malleable Software essay.

**Failures and why**
- Engelbart's NLS was powerful but had a steep learning curve (chord keyset, command language). Its ideas spread piecemeal; the system itself did not. Boxer and Smalltalk-as-personal-medium stayed in education and research. HyperCard was discontinued after Apple stopped investing in it. The recurring explanations are business-model fit and the step from user to programmer, not that the idea failed.
- Formal structure in hypertext and knowledge tools (gIBIS, typed links, semantic wikis) repeatedly failed through premature formalization (Shipman & Marshall).

**Relevance**
The "growing workbench" with model-extracted proposals is incremental formalization (Shipman & Marshall 1999) with an LLM as the spatial parser. Potluck is a close modern relative. This is the project's strongest prior-art lineage, and it should be cited explicitly. The new element is that an LLM makes the formalizer far more capable, which makes the over-formalization risk *worse*: the model can propose more structure than the user wants.

---

## 8. Notebooks, outliners and documents as primary objects

**Sources**
- Rule, A., Tabard, A., Hollan, J. "Exploration and Explanation in Computational Notebooks." *CHI 2018*. https://doi.org/10.1145/3173574.3173606. Analyzed about 1M GitHub notebooks plus interviews. Notebooks are used for messy exploration, and few become explanatory artifacts: exploration and explanation pull against each other.
- Pimentel, Murta, Braganholo, Freire. "A Large-Scale Study About Quality and Reproducibility of Jupyter Notebooks." *MSR 2019*. https://doi.org/10.1109/MSR.2019.00077. Most notebooks do not re-run to the same results. Out-of-order execution and hidden state are major causes.
- Head, Hohman, Barik, Drucker, DeLine. "Managing Messes in Computational Notebooks." *CHI 2019*. https://doi.org/10.1145/3290605.3300500. Uses program slicing to collect the cells that produced a result. This is provenance used for cleanup.
- Chattopadhyay et al. "What's Wrong with Computational Notebooks?" *CHI 2020*. https://doi.org/10.1145/3313831.3376729.
- Observable (reactive notebooks): product, no canonical paper.

**Failures and why**
The linear-cell notebook keeps a chronological log alongside an editable document, and hidden state breaks the link between them. The *transcript* and the *work product* drift apart. This is exactly the problem the project names in chat transcripts.

**Relevance**
This literature supports the project's premise that a scrolling transcript is a poor home for work products. It also warns that a workbench beside a transcript recreates the notebook's dual-state problem: the workbench can disagree with what the conversation now says. Provenance linking each element to transcript lines, as in Head et al.'s slicing, is the right response.

---

## 9. Generative and LLM-native UI, and critiques of chat

**Academic**
- Amershi et al. "Guidelines for Human-AI Interaction." *CHI 2019*. https://doi.org/10.1145/3290605.3300233. Eighteen guidelines, e.g., "make clear why the system did what it did," "support efficient dismissal," "support efficient correction," "remember recent interactions," "convey the consequences of user actions." Many project features map onto G11 (why), G8/G9 (dismiss/correct) and G17 (global controls).
- Jiang et al. "Graphologue." *UIST 2023*. https://doi.org/10.1145/3586183.3606737. Turns LLM text answers into interactive node-link diagrams.
- Suh et al. "Sensecape." *UIST 2023*. https://doi.org/10.1145/3586183.3606756. A multilevel canvas for nonlinear LLM exploration and sensemaking, with a canvas view and a hierarchy view.
- Suh et al. "Luminate." *CHI 2024*. https://doi.org/10.1145/3613904.3642400. The LLM generates *dimensions* of a design space, which users explore and filter.
- Masson, Malacria, Casiez, Vogel. "DirectGPT." *CHI 2024*. https://doi.org/10.1145/3613904.3642462. Direct-manipulation selection of objects as prompt context, plus reusable toolbar commands. Faster than ChatGPT with fewer and shorter prompts.
- Vaithilingam, Glassman, Inala, Wang. "DynaVis: Dynamically Synthesized UI Widgets for Visualization Editing." *CHI 2024* (Best Paper per MSR). https://doi.org/10.1145/3613904.3642639. Natural language edits produce *persistent* synthesized widgets for further adjustment.
- Cheng et al. (Apple). "BISCUIT: Scaffolding LLM-Generated Code with Ephemeral UIs in Computational Notebooks." *VL/HCC 2024*. https://arxiv.org/abs/2404.07387 (200). Ephemeral generated UIs between prompt and code. (First author "Cheng" is from memory **[unverified]**.)
- Lin & Martelaro. "Jigsaw: Supporting Designers to Prototype Multimodal Applications by Chaining AI Foundation Models." *CHI 2024*. https://doi.org/10.1145/3613904.3641920.
- Min, Chen, Cao, Xia. "Malleable Overview-Detail Interfaces." *CHI 2025*. https://doi.org/10.1145/3706598.3714164. (UC San Diego, not Microsoft as the brief guessed.) Fluid attributes: show, hide, or AI-generate fields in overview/detail views.
- Leviathan, Matias et al. (Google). "Generative UI: LLMs are Effective UI Generators." arXiv:2604.09577, submitted 24 Feb 2026, https://arxiv.org/abs/2604.09577 (200). Blog (Nov 2025): https://research.google/blog/generative-ui-a-rich-custom-visual-interactive-user-experience-for-any-prompt/ (200). Generated HTML/CSS/JS UIs were strongly preferred over markdown answers, ignoring latency. They were comparable to expert-made pages in about half of cases. Releases the PAGEN dataset.

**Industry**
- Vercel AI SDK, Generative UI (tool calls render React components). https://ai-sdk.dev/docs/ai-sdk-ui/generative-user-interfaces (200).
- Anthropic Artifacts (introduced with Claude 3.5 Sonnet, June 2024). https://www.anthropic.com/news/claude-3-5-sonnet (200). Projects: https://www.anthropic.com/news/projects (200).
- OpenAI Canvas (Oct 2024). https://openai.com/index/introducing-canvas/ (returned 403 to my fetcher; **[unverified]**).

**Critiques of chat**
- Wattenberger, A. "Why chatbots are not the future." 2023. https://wattenberger.com/thoughts/boo-chatbots (200). Chat gives no affordances ("good tools make it clear how they should be used") and gives the user too little control.
- Appleton, M. "Language Model Sketchbook, or Why I Hate Chatbots." https://maggieappleton.com/lm-sketchbook (200).
- Lee, L. "Imagining better interfaces to language models." https://thesephist.com/posts/latent/ (200). "Synthesizer for thought." https://thesephist.com/posts/synth/ (200).

**Failures and why**
This field is too young for documented abandonment, so I will not claim one. Recurring problems reported within these papers: latency (Google's result explicitly ignores generation time); non-determinism of generated layouts, which brings back the Gajos/Harris unpredictability problem; and evaluations that are mostly short lab studies (n = 10–24) on novel tasks. The 2010s chatbot boom and bust is often cited as a cautionary precedent, but that is commentary, not research.

**Relevance**
"Interfaces that morph," generated panes, and structured objects beside chat are all heavily occupied territory: Sensecape, Graphologue, DynaVis, Artifacts and Canvas. The project's distinguishing stance is *conservative* generative UI. The model may generate only from a closed vocabulary (frames, a fixed set of pane types), and every structural change needs consent. That deliberately rejects the open-ended Google/Vercel direction in favour of predictability, and it is a defensible, citable position given topic 4.

---

## 10. Provenance and "why" explanations

**Sources**
- Ko, A. J. & Myers, B. A. "Designing the Whyline: a debugging interface for asking questions about program behavior." *CHI 2004*. https://doi.org/10.1145/985692.985712. (First author is Ko, not Myers.) "Why did / why didn't" questions answered from recorded execution traces. Debugging time dropped substantially in the study.
- Myers, Weitzman, Ko, Chau. "Answering Why and Why Not Questions in User Interfaces" (Crystal). *CHI 2006*. https://doi.org/10.1145/1124772.1124832. Users point at any UI object and ask why it looks or behaves that way. Answers come from a recorded command history. **The closest prior art to "/why".**
- Lim, B. Y., Dey, A. K., Avrahami, D. "Why and why not explanations improve the intelligibility of context-aware intelligent systems." *CHI 2009*. https://doi.org/10.1145/1518701.1519023.
- Bansal et al. "Does the Whole Exceed its Parts? The Effect of AI Explanations on Complementary Team Performance." *CHI 2021*. https://doi.org/10.1145/3411764.3445717. Explanations raised acceptance of AI recommendations *whether or not they were correct*, so they did not improve human-AI team performance over confidence scores alone.
- Buçinca, Malaya, Gajos. "To Trust or to Think: Cognitive Forcing Functions Can Reduce Overreliance on AI." *CSCW 2021*. https://doi.org/10.1145/3449287.
- Ragan, Endert, Sanyal, Chen. "Characterizing Provenance in Visualization and Data Analysis." *IEEE TVCG* 22(1), 2016. https://doi.org/10.1109/TVCG.2015.2467551. A taxonomy of provenance types (data, visualization, interaction, insight, rationale) and purposes (recall, replication, action recovery, collaboration, presentation, meta-analysis).
- Turpin, Michael, Perez, Bowman. "Language Models Don't Always Say What They Think: Unfaithful Explanations in Chain-of-Thought Prompting." arXiv:2305.04388 (NeurIPS 2023). https://arxiv.org/abs/2305.04388 (200).

**Failures and why**
Explanation interfaces often raise *trust* without raising *appropriate reliance* (Bansal; Buçinca). LLM self-explanations can be unfaithful (Turpin). The Whyline worked partly because answers came from *recorded traces*, not generated rationales.

**Relevance**
"/why from recorded provenance (file:line)" is Crystal/Whyline applied to LLM-extracted UI. Its strongest claim to rigour is that it answers from a log, not by asking the model to justify itself, which sidesteps Turpin's unfaithfulness problem. Two limits apply. (1) Provenance shows *where* an element came from, not whether the extraction was *correct*. Bansal's over-reliance finding suggests file:line citations may increase unwarranted confidence. (2) If the extractor's reasoning is not logged, "/why" explains lineage, not judgment. In Ragan's terms, it covers interaction and data provenance but not rationale provenance.

---

## 11. Information foraging, interruption, resumption and task-centric workspaces

**Sources**
- Pirolli, P. & Card, S. "Information foraging." *Psychological Review* 106(4), 1999. https://doi.org/10.1037/0033-295X.106.4.643.
- Altmann, E. M. & Trafton, J. G. "Memory for goals: an activation-based model." *Cognitive Science* 26(1), 2002. https://doi.org/10.1207/s15516709cog2601_2. Suspended goals decay. Resumption depends on cues available in the environment, which is the basis for "resumption lag" research.
- Iqbal, S. T. & Horvitz, E. "Disruption and recovery of computing tasks." *CHI 2007*. https://doi.org/10.1145/1240624.1240730. A field study: after alerts, users often took many minutes to return to suspended tasks. Visible cues to suspended work helped.
- Henderson, D. A. & Card, S. "Rooms: the use of multiple virtual workspaces to reduce space contention in a window-based graphical user interface." *ACM TOG* 5(3), 1986. https://doi.org/10.1145/24054.24056.
- Bardram, J. "Activity-based computing: support for mobility and collaboration in ubiquitous computing." *Personal and Ubiquitous Computing* 9, 2005. https://doi.org/10.1007/s00779-004-0335-2. "Activity-based computing for medical work in hospitals." *ACM TOCHI* 16(2), 2009. https://doi.org/10.1145/1534903.1534907.
- Dragunov et al. "TaskTracer: a desktop environment to support multi-tasking knowledge workers." *IUI 2005*. https://doi.org/10.1145/1040830.1040855.

**Failures and why** (synthesis; I found no single authoritative post-mortem)
Virtual desktops (Rooms) survived as a feature. Activity-based desktops (Bardram's ABC, TaskTracer, KDE Activities) mostly did not take hold. Explanations offered across this literature: (a) the user must declare and maintain activities, a formalization tax (Shipman & Marshall again); (b) real work does not fall into clean activities, because documents belong to several; (c) the OS/application split meant activity managers could not see inside applications; (d) automatic activity inference was too inaccurate to trust (as with TaskTracer's learning). Treat this as a reasoned synthesis, not consensus.

**Relevance**
A workbench that keeps decisions, tasks and sources visible across turns is a resumption cue in Altmann & Trafton's sense. That is a strong rationale, and it is under-claimed in the project summary. Automatic extraction removes the declaration tax that sank activity-based computing. Requiring confirmation for every extraction partly brings that tax back.

---

## 12. Evaluation methodology

**Sources**
- Greenberg, S. & Buxton, B. "Usability evaluation considered harmful (some of the time)." *CHI 2008*. https://doi.org/10.1145/1357054.1357074. Early usability tests can kill novel ideas or confirm the obvious. The method should fit the question, and culture and adoption need their own methods.
- Olsen, D. R. "Evaluating user interface systems research." *UIST 2007*. https://doi.org/10.1145/1294211.1294256. Judge systems by situations, tasks and users (STU). Criteria include importance, problems not previously solvable, generality, reduced solution viscosity, empowering new design participants, and power in combination. He also warns about the "usability trap."
- Hart, S. G. & Staveland, L. E. "Development of NASA-TLX (Task Load Index)." In *Human Mental Workload*, Advances in Psychology 52, 1988. https://doi.org/10.1016/S0166-4115(08)62386-9.

**Relevance**
This kind of system is best evaluated with Olsen-style claims (what does it make possible?) plus field or diary deployment over days. Habituation (topic 5) and adaptation unpredictability (topic 4) only appear over repeated use, so a one-session lab study cannot test the project's riskiest assumption. NASA-TLX can measure whether consent prompts add workload. Its known limits are self-report, weighting procedures that are often skipped, and weak sensitivity to small differences, so it should not be the only measure.

---

## What appears genuinely novel vs. established

Each project feature is set against the closest prior art. "Novel" means *I did not find* a direct precedent, not that none exists.

| Project feature | Status | Closest prior art | Candid note |
|---|---|---|---|
| Blackboard as metaphor for model processing | **Established** | Hearsay-II, BB1, Nii; LLM blackboard MAS 2025 | Metaphor risk: one LLM is not a multi-KS opportunistic solver. Framing the board as *work products* is more honest. |
| UI that morphs | **Established** | Adaptive UIs (Gajos), generative UI (Google, Vercel, Artifacts, Canvas), Sensecape | The documented failure mode is unpredictability (Harris; Gajos). |
| Answer-shaped vs. workspace-shaped; who holds authority | **Reframing** of Shneiderman–Maes and Horvitz | Shneiderman & Maes 1997; Horvitz 1999; Wattenberger 2023 | A useful vocabulary, not a new distinction. |
| Model-extracted work objects as dashed, attributed proposals, confirmed by consent | **Mostly established** | Incremental formalization and VIKI's spatial parser (Shipman & Marshall); Potluck; track-changes "suggesting" modes | Applying it to *LLM-extracted* decisions, tasks and sources from a dialogue is a reasonable new instance. The consent-per-object requirement is the weakest part (topics 5–6). |
| Panes appear only with consent | **Established** (adaptable / mixed-initiative customization) | Findlater & McGrenere 2004; McGrenere et al. 2002 | Literature supports user control. Watch for prompt fatigue. |
| Untouched panes fade to tabs after N turns; removal only after asking | **Partly novel combination; mechanism has a known failure history** | Office personalized menus (abandoned); ephemeral adaptation (Findlater 2009) | Demotion keyed to turn count repeats the Office 2000 pattern. Asking before removal reduces the risk. Evidence favours changing salience in place over relocating. |
| "/why" explains every element from recorded provenance with file:line | **Established concept, plausibly novel application** | Crystal (Myers 2006), Whyline (Ko & Myers 2004), Ragan 2016 | Grounding in logs, not LLM self-report, is the right call (Turpin 2023). It may still increase over-reliance (Bansal 2021). It explains lineage, not correctness. |
| Role-specific model routing (chat / extractor / framer; local / cloud) | **Established engineering** | FrugalGPT (arXiv:2305.05176); RouteLLM (arXiv:2406.18665) | Not an HCI contribution. *Showing* which role and model produced each element (attribution) is the more interesting UI angle. |
| Model proposes "frames" (focus/order/group) from a closed vocabulary; user applies or resets | **Plausibly novel in combination** | BB1 control blackboard (explicit control strategies); DynaVis and BISCUIT (constrained generated controls); Luminate (generated dimensions); adaptable UI | I found no direct precedent for a closed, model-proposed, user-applied *view-transform vocabulary* over an LLM workspace. A closed vocabulary is the right answer to generative-UI unpredictability. This is the most defensible novelty claim. |
| "Enter diffusion": offer "send?" after a pause | **Established problem, unusual application** | Spoken-dialogue end-of-turn detection (Skantze 2021, https://doi.org/10.1016/j.csl.2020.101178); Horvitz's timing-to-attention | Proactive prompts after a pause are exactly what made Clippy unpopular. A small, ignorable, never-modal affordance would avoid that, but it is high-risk and should be evaluated over repeated use. |

**Overall assessment.** Almost every component has substantial prior art. The project's credible contribution is an *integration*: incremental formalization, Crystal-style recorded provenance, and closed-vocabulary model initiative, applied to LLM conversation. This is a design stance (conservative, consent-first, provenance-backed generative UI), not new mechanisms.

The literature points to two serious risks:
1. **Consent fatigue.** The design multiplies confirmation points, which topics 5 and 6 predict will degrade into reflexive acceptance.
2. **Usage-based demotion.** Fading panes after N turns resembles the abandoned Office adaptive menus.

The strongest under-used justifications are interruption and resumption (Altmann & Trafton; Iqbal & Horvitz) and Shipman & Marshall's "Formality Considered Harmful," which the project should engage with directly because it both supports and challenges the extraction-and-confirmation design.

**Unverified items (summary):** Swartz 2003 thesis link; Bunt et al. IUI 2007 DOI; Vance et al. MISQ 2018 link; BISCUIT first author; OpenAI Canvas page (403); Harpy vs. Hearsay-II accuracy figures; the claim that the shipped Office Assistant used less Lumière inference than the prototype; the reasons given for the failure of activity-based desktops (synthesis, not sourced consensus).
