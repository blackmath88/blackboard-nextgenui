/**
 * Start-up: read the stored fixture state, build the Model, wire the update and
 * view into the Foldkit runtime.
 *
 * Two rules hold here. State only enters the Model through the stored schema, so
 * a broken or foreign document is ignored rather than trusted. And a runtime
 * route can only be a loopback URL supplied by the developer at boot — this
 * prototype reads no credential and sends none.
 */

import { Option } from 'effect'
import { Runtime } from 'foldkit'

import { fixtureProject } from './project/fixture.js'
import { initialModel, Model, type Model as WorkbenchModel } from './workbench/model.js'
import { StorageKey, encodePersisted, modelOf, restoreFrom } from './workbench/persistence.js'
import { makeUpdate } from './workbench/update.js'
import { view } from './workbench/view.js'

/** A developer-supplied loopback route, or nothing. */
const runtimeRoute = (): string | undefined => {
  return import.meta.env.DEV && new URLSearchParams(location.search).get('unibas') === '1'
    ? '/api/unibas'
    : undefined
}

const readStored = (): Option.Option<string> => {
  const storage = globalThis.localStorage
  if (storage === undefined) return Option.none()
  return Option.fromNullishOr(storage.getItem(StorageKey))
}

const boot = (): void => {
  const route = runtimeRoute()
  const restore = restoreFrom(readStored())
  const { _tag: outcome } = restore

  const restored: WorkbenchModel =
    restore._tag === 'Restored'
      ? modelOf(restore.state, { runtimeRouteConfigured: route !== undefined })
      : initialModel(fixtureProject())
  const model: WorkbenchModel = {
    ...restored,
    runtimeRouteConfigured: route !== undefined,
    providerMode: route === undefined ? 'fixture' : 'runtime',
  }

  const restoreNote =
    outcome === 'Restored'
      ? 'Reopened from the local fixture save. The saved arrangement was resolved against the records as they stand now.'
      : outcome === 'Ignored'
        ? 'A stored document was found but ignored, so this session started from the fixture.'
        : undefined

  if (outcome === 'Ignored' && restore._tag === 'Ignored') {
    console.warn('[workbench]', restore.reason)
  }

  const app = Runtime.makeApplication({
    Model,
    init: () => ({ model }),
    update: makeUpdate({
      encode: encodePersisted,
      freshProject: fixtureProject,
      runtimeRoute: route,
      now: () => new Date().toISOString(),
    }),
    view: (current, h) => view(current, h, { restoreNote }),
    container: document.getElementById('app'),
  })

  Runtime.run(app)
}

await boot()
