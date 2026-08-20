/** Resolve in-box profile plugins from the runtime embedded in Electron's ASAR archive. */

import { registerHooks, type ResolveHookSync } from 'node:module'
import { pathToFileURL } from 'node:url'

const anchor = process.env.DSH_DESKTOP_RUNTIME_ANCHOR
if (anchor === undefined) throw new Error('DSH_DESKTOP_RUNTIME_ANCHOR is required')
const runtimeParentURL = pathToFileURL(anchor).href

const resolve: ResolveHookSync = (specifier, context, nextResolve) => {
  try {
    return nextResolve(specifier, context)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ERR_MODULE_NOT_FOUND'
      || specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) throw error
    return nextResolve(specifier, { ...context, parentURL: runtimeParentURL })
  }
}

registerHooks({ resolve })
