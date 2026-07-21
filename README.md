# API Platform

**Define your company's API stack as an APIs.json.** — [platform.apicommons.org](https://platform.apicommons.org)

Every organization runs on a stack of APIs — some you publish, most you consume. API Platform is a browser-first workbench for drawing that stack and turning it into a single machine-readable definition. Browse every provider indexed on [APIs.io](https://apis.io/), drag the ones you use onto the board, sort them into groupings that match how your enterprise is organized, and then — per provider — check off the exact **operations** and **properties** your teams actually use. Export it all as one [APIs.json](https://apisjson.org) document (YAML, `type: platform`).

Hand that file to an AI and it has complete, honest context for the entire API surface your organization depends on.

## How it works

- **Browse the whole network.** The provider palette searches all 8,900+ providers on the [APIs.io API](https://apis.io/developer/) as you type. Quick-filter chips map the common areas of enterprise operations — Payments, Communications, Identity, CRM, Data & Analytics, AI/ML, DevOps, HR, Finance, and more — to curated searches so you can find your providers fast.
- **Draw your stack.** Drag providers onto the board. Start with the **General** group, add your own groupings (by team, domain, or capability), and drag provider chips between them. Everything is drag-and-drop.
- **Pick what you actually use.** Click any provider to open its detail drawer. Every API the provider publishes is listed; expand one to see **all operations across all paths** (loaded live from the provider's OpenAPI in the [API Evangelist](https://github.com/api-evangelist) GitHub repos) and check the ones you use — individually or all at once.
- **Carry the supporting properties.** A second column lists the provider's **properties** — documentation, plans, SDKs, GraphQL, Arazzo, webhooks, and more — collected from its APIs. Check the ones an agent needs to actually work with the operations you selected.
- **One merged OpenAPI per provider.** On download, the operations you checked across a provider's many specs are assembled into a **single OpenAPI** and embedded in that provider's `properties` in the APIs.json, alongside the properties you selected.
- **Round-trips losslessly.** The download embeds your full board — groups, providers, selected operations, and properties — as an `x-api-platform` extension. Upload the `apis.yml` any time to rebuild the UI and keep editing.

Everything runs in your browser. The only network calls are read-only requests to the public APIs.io API and the API Evangelist OpenAPI repositories. Nothing leaves the page.

## The output

A `type: platform` APIs.json (YAML). Each provider becomes an `apis[]` entry with an `x-group`, a merged `OpenAPI` property containing just your selected operations, and the supporting properties you chose. The full editor state lives under `x-api-platform` for round-tripping.

```yaml
name: My Company Platform
type: platform
specificationVersion: "0.21"
apis:
  - name: Twilio
    slug: twilio
    x-group: Communications
    x-operation-count: 4
    properties:
      - type: OpenAPI
        data: { openapi: 3.1.0, ... }   # merged from your selected operations
      - type: Documentation
        url: https://www.twilio.com/docs/...
x-api-platform:
  groups: [...]
  members: [...]     # slugs, selected ops, selected props — rebuilds the UI
```

## Develop

```bash
npm install
npm run dev     # local dev server
npm run build   # production build to dist/
```

Deployed to GitHub Pages by `.github/workflows/deploy.yml` on push to `main`.

Part of the [API Commons](https://apicommons.org) tool suite. Pairs with [Toolsmith](https://toolsmith.apicommons.org) (forge the agent layer for one API) and the [API Validator](https://validator.apicommons.org).

## License

Apache-2.0
