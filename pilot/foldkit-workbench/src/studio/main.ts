/**
 * Studio start-up. Stored state enters only through the persisted schema; a
 * foreign or broken document is ignored and the studio starts fresh.
 */
import { Runtime } from 'foldkit'
import { Model } from './model.js'
import { StudioStorageKey } from './model.js'
import { makeStudioUpdate, restoreStudio } from './update.js'
import { studioSubscriptions } from './subscriptions.js'
import { studioView } from './view.js'

const read = (): string | null => {
  try {
    return globalThis.localStorage?.getItem(StudioStorageKey) ?? null
  } catch {
    return null
  }
}

const now = () => new Date().toISOString()
const { model, restored, ignored } = restoreStudio(read(), now())
const restoreNote = restored
  ? 'Wieder geöffnet: Gespräche, Darstellungen, Auswahl und Ihre Änderungen wurden aus dem lokalen Speicher wiederhergestellt.'
  : ignored ? 'Ein gespeicherter Stand war ungültig und wurde ignoriert.' : undefined

Runtime.run(Runtime.makeApplication({
  Model,
  init: () => ({ model }),
  update: makeStudioUpdate({ now }),
  view: (current, h) => studioView(current, h, { restoreNote }),
  subscriptions: studioSubscriptions,
  container: document.getElementById('app'),
}))
