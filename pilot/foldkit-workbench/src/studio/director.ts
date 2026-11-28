/**
 * The synthetic director: a deterministic stand-in for a model turn.
 *
 * It receives only the bounded context packet and the conversation's current
 * representations, and it answers with Markdown plus an *untrusted* workspace
 * patch — the same shape a real model would return. The host validates that
 * patch with the catalogue schema before anything reaches the workspace.
 *
 * Object references in replies use `[[object-id]]` and render as chips that
 * select the object in the workspace.
 */

import type { Packet } from './context.js'
import type { Conversation, Scenario } from './model.js'
import { assumptionValues } from './model.js'
import { archMap, archOptions, archPlan, budgetPlan, researchEvidence, researchFindings } from './scenarios.js'
import { evaluate, type Representation } from './spec.js'
import { findObject } from './context.js'
import { onboardingSimulator } from './artifact.js'

export type Turn = {
  markdown: string
  /** Untrusted until decoded by the host. */
  patch: unknown
  scenario?: Scenario
  title?: string
}

const chf = (value: number) =>
  Number.isFinite(value) ? `${Math.round(value).toLocaleString('de-CH')} CHF` : '—'
const pct = (value: number) => (Number.isFinite(value) ? `${value.toFixed(1).replace('.', ',')} %` : '—')

export const starters: ReadonlyArray<{ scenario: Scenario; label: string; prompt: string }> = [
  { scenario: 'architecture', label: 'Architektur erkunden', prompt: 'Wie sollten wir die Synchronisation zwischen Chat und Arbeitsfläche architektonisch aufbauen?' },
  { scenario: 'budget', label: 'Budget planen', prompt: 'Wir haben 480 000 CHF für das Produktteam 2027. Wie sollten wir das Budget aufteilen?' },
  { scenario: 'research', label: 'Forschung verdichten', prompt: 'Fasse zusammen, was wir über Remote-Onboarding und die Produktivität neuer Mitarbeitender wissen.' },
]

const detect = (text: string): Scenario => {
  const t = text.toLowerCase()
  if (/budget|chf|kosten|aufteil|geld/.test(t)) return 'budget'
  if (/onboarding|studie|forschung|evidenz|wissen wir|befund/.test(t)) return 'research'
  if (/architektur|synchron|system|komponent|event|protokoll/.test(t)) return 'architecture'
  return 'open'
}

const values = (conversation: Conversation) => assumptionValues(conversation)

const budgetDerived = (conversation: Conversation) => {
  const pane = conversation.panes.find((p) => p.rep.id === 'budget.plan')
  const vals = values(conversation)
  const derived = pane?.rep.derived ?? budgetPlan().derived ?? {}
  const get = (id: string) => evaluate({ ref: id }, vals, derived)
  return { vals, get }
}

// ---------------------------------------------------------------- opening turns

const opening = (scenario: Scenario): Turn => {
  switch (scenario) {
    case 'architecture':
      return {
        scenario, title: 'Synchronisation Chat ↔ Arbeitsfläche',
        markdown: [
          'Der Kern ist eine Frage der **Autorität**: Wer darf den gemeinsamen Zustand verändern, und wie bleibt nachvollziehbar, was Mensch und Modell beigetragen haben?',
          '',
          'Ich sehe drei tragfähige Wege. Auf der Arbeitsfläche liegen jetzt eine [[arch.diagram]]-Landkarte und die Alternativen mit gewichteter Bewertung:',
          '',
          '1. [[opt.events]] — jede Interaktion wird ein typisiertes Ereignis; Ansichten und Modellkontext werden daraus abgeleitet.',
          '2. [[opt.shared]] — ein zusammenführbares Dokument, stark bei mehreren Personen.',
          '3. [[opt.direct]] — einfach, aber jeder Klick kostet einen Modellaufruf und überschreibt leicht menschliche Änderungen.',
          '',
          'Meine Empfehlung ist das Ereignisprotokoll. Wählen Sie zwei Alternativen aus und tippen Sie auf **Vergleichen**, oder markieren Sie eine Entscheidung und fragen Sie **Warum?**',
        ].join('\n'),
        patch: { upsert: [archMap, archOptions], focus: 'arch.options' },
      }
    case 'budget':
      return {
        scenario, title: 'Budget Produktteam 2027',
        markdown: [
          'Hier ist ein ausgewogener Startpunkt für **480 000 CHF**. Er setzt auf Entwicklung als grössten Posten und hält rund 15 % Reserve.',
          '',
          '| Posten | Betrag | Anteil |',
          '| --- | ---: | ---: |',
          '| Entwicklung | 210 000 CHF | 43,8 % |',
          '| Design | 80 000 CHF | 16,7 % |',
          '| Infrastruktur | 50 000 CHF | 10,4 % |',
          '| Nutzerforschung | 45 000 CHF | 9,4 % |',
          '| Weiterbildung | 25 000 CHF | 5,2 % |',
          '',
          'Die [[budget.inputs]] auf der Arbeitsfläche gehören Ihnen: Schieben Sie Beträge, und [[m.reserve]] sowie die Verteilung rechnen ohne Modellaufruf mit. Wenn Sie wissen wollen, was eine Änderung bedeutet, tippen Sie auf **Auswirkungen besprechen**.',
        ].join('\n'),
        patch: { upsert: [budgetPlan()], focus: 'budget.plan' },
      }
    case 'research':
      return {
        scenario, title: 'Remote-Onboarding',
        markdown: [
          'Kurzfassung der (synthetischen) Evidenz:',
          '',
          '- [[f.buddy]] ist der robusteste Befund — zwei unabhängige Quellen, darunter eine Längsschnittstudie.',
          '- [[f.async]] — Dokumentation hilft, aber erst nach den ersten zwei Wochen.',
          '- [[f.cohort]] stärkt Zugehörigkeit; ein Produktivitätseffekt ist nicht belegt.',
          '- [[f.tools]] beruht nur auf einem Erfahrungsbericht und ist entsprechend schwach.',
          '',
          'Die Arbeitsfläche trennt **Befunde** von der **Evidenz**. Tippen Sie auf eine Quelle, um ihre Relevanz zu prüfen, oder auf einen Befund und dann **Warum?**, um die Belegkette zu sehen.',
        ].join('\n'),
        patch: { upsert: [researchFindings, researchEvidence], focus: 'research.findings' },
      }
    case 'open':
      return {
        scenario,
        markdown: 'Im synthetischen Modus kenne ich drei Gesprächstypen: **Architektur**, **Budget** und **Forschung**. Wählen Sie einen Einstieg unten oder formulieren Sie Ihre Frage mit einem dieser Themen.',
        patch: null,
      }
  }
}

// ---------------------------------------------------------------- follow-ups

const weighted = (conversation: Conversation, optionId: string) => {
  const found = findObject(conversation, 'arch.matrix')
  const matrix = conversation.panes.flatMap((p) => collect(p.rep.root)).find((n) => n.type === 'matrix')
  if (!matrix || matrix.type !== 'matrix') return { score: 0, max: 0, found }
  let score = 0, max = 0
  for (const c of matrix.criteria) {
    score += (matrix.scores[optionId]?.[c.id] ?? 0) * c.weight
    max += 5 * c.weight
  }
  return { score, max, matrix }
}

const collect = (node: Representation['root']): Representation['root'][] =>
  node.type === 'section' || node.type === 'grid' ? [node, ...node.children.flatMap(collect)] : [node]

const compare = (conversation: Conversation, packet: Packet): Turn => {
  const ids = packet.selection.map((s) => s.id)
  if (conversation.scenario === 'architecture' && ids.every((id) => id.startsWith('opt.'))) {
    const rows = ids.map((id) => ({ id, ...weighted(conversation, id), label: packet.selection.find((s) => s.id === id)?.label ?? id }))
    const matrix = rows[0]?.matrix
    if (!matrix || matrix.type !== 'matrix') return { markdown: 'Die Bewertungsmatrix ist nicht mehr auf der Arbeitsfläche.', patch: null }
    const ranked = [...rows].sort((a, b) => b.score - a.score)
    const best = ranked[0]!, other = ranked[1]!
    const gaps = matrix.criteria
      .map((c) => ({ c, d: (matrix.scores[best.id]?.[c.id] ?? 0) - (matrix.scores[other.id]?.[c.id] ?? 0) }))
      .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
    const rep: Representation = {
      id: 'arch.compare',
      title: 'Gegenüberstellung',
      purpose: `${rows.map((r) => r.label).join(' · ')}`,
      root: {
        type: 'section',
        children: [
          {
            type: 'bars', id: 'compare.scores', title: 'Gewichtete Punkte', unit: 'Punkte',
            items: ranked.map((r, i) => ({ id: `score.${r.id}`, label: r.label, value: r.score, tone: i === 0 ? 'positive' as const : 'neutral' as const })),
          },
          {
            type: 'table', id: 'compare.table',
            columns: [{ key: 'criterion', label: 'Kriterium' }, ...ranked.map((r) => ({ key: r.id.replace('opt.', ''), label: r.label, align: 'end' as const })), { key: 'weight', label: 'Gewicht', align: 'end' as const }],
            rows: matrix.criteria.map((c) => ({
              id: `row.${c.id}`,
              cells: Object.fromEntries([['criterion', c.label], ...ranked.map((r) => [r.id.replace('opt.', ''), matrix.scores[r.id]?.[c.id] ?? 0]), ['weight', `×${c.weight}`]]),
            })),
          },
        ],
      },
    }
    return {
      markdown: [
        `**[[${best.id}]]** liegt mit ${best.score} von ${best.max} Punkten vor **[[${other.id}]]** (${other.score}).`,
        '',
        'Den grössten Unterschied machen:',
        ...gaps.slice(0, 3).map(({ c, d }) => `- **${c.label}** (Gewicht ${c.weight}): ${d > 0 ? '+' : ''}${d} für ${d >= 0 ? best.label : other.label}`),
        '',
        gaps[0] && gaps[0].d < 0 ? '' : `Wenn Mehrbenutzerfähigkeit später wichtiger wird, lohnt es sich, das Gewicht dieses Kriteriums zu erhöhen — die Gegenüberstellung liegt als eigenes Fenster neben den Alternativen.`,
      ].join('\n'),
      patch: { upsert: [rep], focus: 'arch.compare' },
    }
  }
  if (conversation.scenario === 'research') {
    const list = packet.selection.map((s) => `- [[${s.id}]]`).join('\n')
    return {
      markdown: `Die ausgewählten Elemente unterscheiden sich vor allem in der **Belegstärke**:\n\n${list}\n\n[[f.buddy]] stützt sich auf eine Längsschnitt- und eine randomisierte Studie, während [[f.cohort]] nur auf einer Querschnittsumfrage beruht. Für Entscheidungen würde ich nur den Buddy-Befund als belastbar behandeln.`,
      patch: null,
    }
  }
  return {
    markdown: `Ich vergleiche ${packet.selection.map((s) => `[[${s.id}]]`).join(', ')}. In diesem Szenario habe ich dafür keine strukturierte Bewertung; die Auswahl ist aber als Kontext angekommen.`,
    patch: null,
  }
}

const why = (conversation: Conversation, packet: Packet): Turn => {
  const target = packet.selection[0]
  if (!target) return { markdown: 'Wählen Sie zuerst ein Element auf der Arbeitsfläche aus.', patch: null }
  switch (target.id) {
    case 'dec.log':
    case 'opt.events': {
      const w = weighted(conversation, 'opt.events')
      return {
        markdown: [
          `[[${target.id}]] folgt aus zwei Anforderungen der Produktvision:`,
          '',
          '1. **Menschliche Änderungen dürfen nicht verloren gehen.** Ein angehängtes Ereignis überschreibt nichts; ein späterer Modellvorschlag kann geprüft und abgelehnt werden.',
          '2. **Das Gespräch muss wissen, worauf Sie zeigen.** Der Kontext für jeden Turn wird aus dem Protokoll abgeleitet — begrenzt, nachvollziehbar und ohne Zugriff auf fremde Projekte.',
          '',
          `In der Matrix erreicht die Option ${w.score} von ${w.max} gewichteten Punkten. Der Preis ist ein höherer Umsetzungsaufwand (3/5) gegenüber direkten Aufrufen.`,
        ].join('\n'),
        patch: null,
      }
    }
    case 'dec.select':
      return {
        markdown: '[[dec.select]] trennt **Aufmerksamkeit** von **Auftrag**. Eine Auswahl ist billig und häufig; würde jede einen Modellaufruf auslösen, wären Kosten und Latenz unvorhersehbar, und die Arbeitsfläche würde sich unter Ihren Händen verändern. Erst eine ausdrückliche Aktion wie *Warum?* oder *Vergleichen* erzeugt einen Turn.',
        patch: null,
      }
    default: {
      const found = findObject(conversation, target.id)
      const item = found?.item as { detail?: string; sources?: string[]; strength?: number } | undefined
      if (item?.sources) {
        return {
          markdown: [
            `**[[${target.id}]]** — Belegkette:`,
            '',
            ...item.sources.map((s) => `- [[${s}]]`),
            '',
            item.detail ?? '',
            '',
            `Belegstärke ${'●'.repeat(item.strength ?? 0)}${'○'.repeat(3 - (item.strength ?? 0))}. ${item.strength === 3 ? 'Zwei unabhängige Methoden kommen zum gleichen Ergebnis.' : item.strength === 1 ? 'Nur ein Einzelfall — als Hypothese behandeln.' : 'Eine Quelle mittlerer Güte — plausibel, aber nicht gesichert.'}`,
          ].join('\n'),
          patch: null,
        }
      }
      return { markdown: `Zu [[${target.id}]]: ${item?.detail ?? 'Dazu liegt auf der Arbeitsfläche keine Begründung vor.'}`, patch: null }
    }
  }
}

const investigate = (conversation: Conversation, packet: Packet): Turn => {
  const target = packet.selection[0]
  if (!target) return { markdown: 'Wählen Sie zuerst ein Element aus.', patch: null }
  const found = findObject(conversation, target.id)
  if (found?.node.type === 'diagram') {
    const edges = found.node.edges
    const label = (id: string) => `[[${id}]]`
    const inbound = edges.filter((e) => e.to === target.id).map((e) => label(e.from))
    const outbound = edges.filter((e) => e.from === target.id).map((e) => label(e.to))
    const detail = (found.item as { detail?: string }).detail
    return {
      markdown: [
        `**[[${target.id}]]** — ${detail ?? ''}`,
        '',
        inbound.length ? `Erhält Eingaben von ${inbound.join(', ')}.` : 'Hat keine eingehenden Abhängigkeiten.',
        outbound.length ? `Liefert an ${outbound.join(', ')}.` : 'Ist ein Endpunkt.',
        '',
        target.id === 'n.bridge' || target.id === 'n.artifact'
          ? 'Das ist eine **Vertrauensgrenze**: generiertes HTML läuft ohne Zugriff auf Speicher, Zugangsdaten oder Netzwerk, und nur erlaubte, schema-geprüfte Ereignisse passieren die Brücke.'
          : target.id === 'n.log'
            ? 'Fällt das Protokoll aus, kann der Zustand nicht mehr rekonstruiert werden — es ist der kritischste Baustein.'
            : 'Ein Ausfall hier betrifft nur die nachgelagerten Bausteine.',
      ].join('\n'),
      patch: null,
    }
  }
  if (found?.node.type === 'bars' && conversation.scenario === 'budget') {
    const { vals, get } = budgetDerived(conversation)
    const item = found.item as { assumption?: string; label?: string }
    const value = item.assumption ? (vals[item.assumption] ?? get(item.assumption)) : Number.NaN
    const share = value / get('allocated') * 100
    return {
      markdown: `**[[${target.id}]]** steht bei ${chf(value)} — ${pct(share)} des verplanten Budgets. ${share > 40 ? 'Das ist der dominierende Posten; Verschiebungen hier verändern die Reserve am stärksten.' : 'Ein kleinerer Posten; Kürzungen hier schaffen wenig Spielraum.'}`,
      patch: null,
    }
  }
  if (found?.node.type === 'bars' && conversation.scenario === 'research') {
    const v = (found.item as { value?: number }).value ?? 0
    return {
      markdown: `**[[${target.id}]]**: ${v} Wochen bis zur vollen Produktivität. ${v <= 9 ? 'Das stützt [[f.buddy]] — die Kombination mit Dokumentation ist am schnellsten.' : 'Deutlich langsamer als mit fester Ansprechperson ([[ttp.buddy]]).'}`,
      patch: null,
    }
  }
  if (found?.node.type === 'records' && found.node.variant === 'question') {
    return {
      markdown: `Zu [[${target.id}]] würde ich eine kleine interne Messung vorschlagen: die nächsten sechs Neueinstellungen mit Buddy, Zeit bis zum ersten eigenständig abgeschlossenen Ticket als Messgrösse. Das ist günstiger als eine weitere Literaturrecherche.`,
      patch: null,
    }
  }
  return { markdown: `[[${target.id}]] ist als Kontext angekommen. ${(found?.item as { detail?: string } | undefined)?.detail ?? ''}`, patch: null }
}

const inspectSource = (conversation: Conversation, packet: Packet): Turn => {
  const target = packet.selection[0]
  if (!target) return { markdown: 'Wählen Sie eine Quelle aus.', patch: null }
  const findings = researchFindings.root.type === 'section'
    ? researchFindings.root.children.flatMap((n) => n.type === 'records' ? n.items : []).filter((f) => f.sources?.includes(target.id))
    : []
  const src = conversation.panes
    .flatMap((p) => collect(p.rep.root))
    .flatMap((n) => (n.type === 'sources' ? n.items : []))
    .find((s) => s.id === target.id)
  return {
    markdown: [
      `**[[${target.id}]]** ist relevant für ${findings.length ? findings.map((f) => `[[${f.id}]]`).join(' und ') : 'keinen der aktuellen Befunde'}.`,
      '',
      src?.excerpt ? `> ${src.excerpt}` : '',
      '',
      target.id === 's.blog'
        ? 'Ein Einzelfall ohne Vergleichsgruppe — er illustriert ein Problem, belegt aber keine Grösse. Ich würde [[f.tools]] deshalb als Hypothese führen.'
        : target.id === 's.panel'
          ? 'Die Längsschnittstudie ist die stärkste Quelle im Set: grosse Stichprobe, 18 Monate Beobachtung.'
          : 'Mittlere Güte: brauchbar für die Richtung, nicht für genaue Effektgrössen.',
    ].join('\n'),
    patch: null,
  }
}

const budgetImplications = (conversation: Conversation, packet: Packet, question?: string): Turn => {
  const { vals, get } = budgetDerived(conversation)
  const reserve = get('reserve'), share = get('reserveShare'), allocated = get('allocated')
  const edits = packet.humanEdits
  const verdict = share < 0
    ? `Der Plan ist **überzeichnet** um ${chf(-reserve)}. Ohne Kürzung geht das nicht auf.`
    : share < 8
      ? `Die Reserve ist mit ${pct(share)} **knapp**. Eine ungeplante Stelle oder eine Lizenzerhöhung würde sie aufbrauchen.`
      : share > 20
        ? `Mit ${pct(share)} Reserve bleibt **viel ungenutzt**. Das ist vorsichtig, verschenkt aber Wirkung.`
        : `Die Reserve von ${pct(share)} liegt im gesunden Bereich.`
  const proposedVals = Object.fromEntries(Object.entries(vals).map(([id, v]) => [id, conversation.assumptions[id]?.proposed ?? v]))
  const proposedReserve = evaluate({ ref: 'reserve' }, proposedVals, budgetPlan().derived ?? {})
  const hires = question && /einstell|person|stelle|hire/i.test(question)
  const hireCost = 2 * 95_000
  const rep: Representation = {
    id: 'budget.compare',
    title: 'Szenarien',
    purpose: 'Vorschlag gegenüber Ihren Änderungen',
    root: {
      type: 'section',
      children: [
        {
          type: 'table', id: 'budget.diff',
          columns: [{ key: 'item', label: 'Posten' }, { key: 'proposed', label: 'Vorschlag', align: 'end' }, { key: 'current', label: 'Aktuell', align: 'end' }, { key: 'delta', label: 'Δ', align: 'end' }],
          rows: [
            ...['b.total', 'b.dev', 'b.design', 'b.research', 'b.infra', 'b.events'].map((id) => {
              const edit = conversation.assumptions[id]
              const proposed = edit?.proposed ?? vals[id] ?? 0
              const current = vals[id] ?? 0
              return {
                id: `diff.${id.slice(2)}`,
                cells: { item: packet.values ? labelFor(id) : id, proposed: chf(proposed), current: chf(current), delta: current === proposed ? '—' : `${current > proposed ? '+' : '−'}${chf(Math.abs(current - proposed))}` },
                ...(current !== proposed ? { tone: 'accent' as const } : {}),
              }
            }),
            { id: 'diff.reserve', cells: { item: 'Reserve', proposed: chf(proposedReserve), current: chf(reserve), delta: '' }, tone: share < 8 ? 'critical' as const : 'positive' as const },
          ],
        },
        ...(hires ? [{
          type: 'callout' as const, tone: (reserve - hireCost < 0 ? 'critical' : 'caution') as 'critical' | 'caution',
          title: 'Zwei zusätzliche Stellen',
          markdown: `Zwei Stellen à rund 95 000 CHF kosten ${chf(hireCost)}. Danach bliebe eine Reserve von **${chf(reserve - hireCost)}**.`,
        }] : []),
      ],
    },
  }
  const editLine = edits.length
    ? `Sie haben ${edits.map((e) => `[[${e.id}]] von ${chf(e.proposed)} auf **${chf(e.value)}**`).join(', ')} geändert.`
    : 'Sie haben noch keine Beträge verändert; ich beziehe mich auf den Vorschlag.'
  return {
    markdown: (hires
      ? [
          `**Zwei Einstellungen** kosten rund ${chf(hireCost)} pro Jahr.`,
          '',
          reserve - hireCost < 0
            ? `Mit Ihren aktuellen Werten passt das **nicht** — die Reserve liegt bei ${chf(reserve)}, es fehlen ${chf(hireCost - reserve)}.${edits.length ? ` Ich rechne mit Ihrer Änderung (${edits.map((e) => `[[${e.id}]] ${chf(e.value)}`).join(', ')}), nicht mit meinem Vorschlag.` : ''}`
            : `Das passt: die Reserve sänke von ${chf(reserve)} auf ${chf(reserve - hireCost)}.`,
          '',
          reserve - hireCost < 0 ? 'Am ehesten liesse sich das über [[b.design]] oder [[b.infra]] ausgleichen — oder über ein höheres [[b.total]].' : 'Eine Reserve unter 5 % würde ich trotzdem vermeiden.',
        ]
      : [
          editLine,
          '',
          verdict,
          `Verplant sind ${chf(allocated)}, also ${chf(allocated / 12)} pro Monat.`,
          '',
          'Die Gegenüberstellung auf der Arbeitsfläche zeigt Vorschlag und Ihre Werte nebeneinander. Ihre Änderungen bleiben erhalten, auch wenn ich die Darstellung neu aufbaue.',
        ]).join('\n'),
    patch: { upsert: [rep], focus: 'budget.compare' },
  }
}

const labelFor = (id: string) => ({ 'b.total': 'Gesamtbudget', 'b.dev': 'Entwicklung', 'b.design': 'Design', 'b.research': 'Nutzerforschung', 'b.infra': 'Infrastruktur', 'b.events': 'Weiterbildung' })[id] ?? id

const reassess = (conversation: Conversation, packet: Packet): Turn => {
  const board = conversation.panes.flatMap((p) => collect(p.rep.root)).find((n) => n.type === 'board')
  if (!board || board.type !== 'board') return { markdown: 'Es liegt kein Plan auf der Arbeitsfläche.', patch: null }
  const lane = (id: string) => conversation.cards[id] ?? board.cards.find((c) => c.id === id)?.lane ?? 'open'
  const done = board.cards.filter((c) => lane(c.id) === 'done')
  const doing = board.cards.filter((c) => lane(c.id) === 'doing')
  const moved = packet.movedCards
  const warnings: string[] = []
  if (lane('t.bridge') !== 'open' && lane('t.schema') !== 'done') warnings.push('Die [[t.bridge]] hängt vom Ereignisschema ab, das noch nicht fertig ist.')
  if (lane('t.replay') === 'done' && lane('t.log') !== 'done') warnings.push('[[t.replay]] ist erledigt, obwohl [[t.log]] noch offen ist — der Test prüft dann nichts Echtes.')
  if (doing.length > 2) warnings.push(`${doing.length} Aufgaben sind gleichzeitig in Arbeit; bei drei Personen erhöht das die Wechselkosten.`)
  const weeksLeft = Math.max(1, 8 - done.length * 1.5)
  const tlTone = (cardId: string) => lane(cardId) === 'done' ? 'positive' as const : lane(cardId) === 'doing' ? 'accent' as const : undefined
  const plan = archPlan.root.type === 'section' ? archPlan.root : null
  const timeline = plan?.children.find((n) => n.type === 'timeline')
  const updated: Representation | null = timeline && timeline.type === 'timeline' ? {
    ...archPlan,
    purpose: `Neu bewertet: ${done.length} von ${board.cards.length} erledigt`,
    root: {
      type: 'section',
      children: [
        board,
        {
          ...timeline,
          items: timeline.items.map((item) => {
            const tone = tlTone(item.id.replace('tl.', 't.'))
            return tone ? { ...item, tone } : item
          }),
        },
        ...(warnings.length ? [{ type: 'callout' as const, tone: 'caution' as const, title: 'Abhängigkeiten', markdown: warnings.join(' ').replace(/\[\[|\]\]/g, '') }] : []),
      ],
    },
  } : null
  return {
    markdown: [
      moved.length ? `Sie haben ${moved.map((m) => `[[${m.id}]] → **${laneLabel(m.lane)}**`).join(', ')} verschoben.` : 'Der Plan ist unverändert.',
      '',
      `Stand: ${done.length} erledigt, ${doing.length} in Arbeit. Bei gleichem Tempo bleiben etwa **${weeksLeft.toFixed(0)} Wochen**.`,
      ...(warnings.length ? ['', ...warnings.map((w) => `- ${w}`)] : ['', 'Keine Abhängigkeitskonflikte. Die Zeitleiste ist entsprechend eingefärbt.']),
    ].join('\n'),
    patch: updated ? { upsert: [updated], focus: 'arch.plan' } : null,
  }
}

const laneLabel = (id: string) => ({ open: 'Offen', doing: 'In Arbeit', done: 'Erledigt' })[id] ?? id

// ---------------------------------------------------------------- free text

const freeText = (conversation: Conversation, packet: Packet): Turn => {
  const text = packet.request.toLowerCase()
  if (conversation.scenario === 'architecture' && /plan|umsetz|schritte|roadmap/.test(text)) {
    return {
      markdown: 'Hier ist ein Umsetzungsplan in vier Strängen. Verschieben Sie Aufgaben zwischen den Spalten — **Plan neu bewerten** prüft danach Abhängigkeiten und Zeitbedarf.\n\nDie kritische Kette ist [[t.schema]] → [[t.log]] → [[t.replay]]. Die [[t.bridge]] kann parallel laufen, sobald das Schema steht.',
      patch: { upsert: [archPlan], focus: 'arch.plan' },
    }
  }
  if (conversation.scenario === 'budget') return budgetImplications(conversation, packet, packet.request)
  if (conversation.scenario === 'research' && /simul|interaktiv|rechner|artefakt|html/.test(text)) {
    return {
      markdown: 'Ich habe einen kleinen **Simulator** gebaut: Wählen Sie Buddy, Dokumentation und Teamgrösse, und übernehmen Sie ein Szenario. Er läuft als isoliertes HTML-Artefakt; nur das gewählte Szenario kommt als geprüftes Ereignis zurück ins Gespräch.\n\nDie Kurve folgt den Effektgrössen aus [[f.buddy]] und [[f.async]].',
      patch: { upsert: [onboardingSimulator], focus: 'research.simulator' },
    }
  }
  if (packet.selection.length) {
    return {
      markdown: `Ich beziehe mich auf ${packet.selection.map((s) => `[[${s.id}]]`).join(', ')}. ${conversation.scenario === 'architecture' ? 'Fragen Sie nach einem **Umsetzungsplan**, um daraus Aufgaben zu machen.' : ''}`,
      patch: null,
    }
  }
  if (conversation.scenario === 'architecture') {
    return { markdown: 'Ich kann aus der Empfehlung einen **Umsetzungsplan** machen, Alternativen **vergleichen** oder eine Komponente **untersuchen**.', patch: null }
  }
  if (conversation.scenario === 'research') {
    return { markdown: 'Ich kann einen **interaktiven Simulator** für die Einarbeitungszeit bauen, oder Sie wählen Befunde und Quellen aus, um sie zu prüfen.', patch: null }
  }
  return opening(detect(packet.request))
}

export const respond = (conversation: Conversation, packet: Packet): Turn => {
  if (conversation.messages.filter((m) => m.role === 'assistant').length === 0 || conversation.scenario === 'open') {
    const scenario = detect(packet.request)
    if (scenario !== 'open' || conversation.messages.length <= 1) return opening(scenario)
  }
  switch (packet.interaction?.type) {
    case 'compare': return compare(conversation, packet)
    case 'ask-why': return why(conversation, packet)
    case 'investigate': return investigate(conversation, packet)
    case 'inspect-source': return inspectSource(conversation, packet)
    case 'edit-assumption': return budgetImplications(conversation, packet)
    case 'move-card': return reassess(conversation, packet)
    case 'artifact-event': return artifactFollowUp(packet)
    default: return freeText(conversation, packet)
  }
}

const artifactFollowUp = (packet: Packet): Turn => {
  const p = packet.interaction?.payload ?? {}
  const weeks = Number(p['weeks'])
  const buddy = p['buddy'] === true || p['buddy'] === 'true'
  const docs = p['docs'] === true || p['docs'] === 'true'
  return {
    markdown: [
      `Im Simulator haben Sie das Szenario **${buddy ? 'mit' : 'ohne'} Buddy** und **${docs ? 'mit' : 'ohne'} Dokumentation** gewählt: etwa **${Number.isFinite(weeks) ? weeks : '?'} Wochen** bis zur vollen Produktivität.`,
      '',
      buddy
        ? 'Das deckt sich mit [[f.buddy]]. Für Ihr Team würde ich mit diesem Szenario planen und die offene Frage [[q.measure]] zuerst klären.'
        : 'Ohne feste Ansprechperson verlieren Sie laut [[f.buddy]] rund drei Wochen. Das ist der günstigste Hebel im Modell.',
    ].join('\n'),
    patch: null,
  }
}
