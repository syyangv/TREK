# trek-plugin-sdk

The SDK for building [TREK](https://github.com/mauriceboe/TREK) plugins.

## Scaffold a plugin

```bash
npx create-trek-plugin my-plugin --type integration|page|widget
cd my-plugin
# build server/index.js, fill in the README
npx trek-plugin validate .
```

## Write a plugin

```js
const { definePlugin } = require('trek-plugin-sdk')

module.exports = definePlugin({
  async onLoad(ctx) {
    await ctx.db.migrate('001', 'CREATE TABLE cache (k TEXT PRIMARY KEY, v TEXT)')
  },
  routes: [
    { method: 'GET', path: '/status', auth: true, async handler(req, ctx) {
      return { status: 200, headers: { 'content-type': 'application/json' }, body: '{"ok":true}' }
    }},
  ],
})
```

Your plugin runs in an **isolated child process**. `ctx` is the only way to reach
TREK, and it grants exactly the permissions your `trek-plugin.json` declares — an
ungranted call throws `PERMISSION_DENIED`.

## Test without a running TREK

```js
import { createMockHost } from 'trek-plugin-sdk/testing'

const { ctx, broadcasts } = createMockHost({
  grants: ['db:read:trips', 'ws:broadcast:trip'],
  trips: { 1: { members: [42], data: { id: 1, name: 'Japan' } } },
})
// the mock enforces the SAME permission model, so you can prove your plugin
// degrades gracefully when a permission is missing.
```

## Exports

- `definePlugin(def)` + all the plugin types (`PluginContext`, `PluginRoute`, `PluginJob`, `PhotoProvider`, `CalendarSource`).
- `PLUGIN_API_VERSION` — embed as `apiVersion` in your manifest.
- `validateManifest(json)` — the same checks the registry CI runs.
- `createMockHost(opts)` (from `trek-plugin-sdk/testing`).

## CLIs

- `create-trek-plugin <name> --type …` — scaffold.
- `trek-plugin validate [dir]` — validate the manifest + README locally (predicts the registry CI result).

MIT.
