# React + Vite

## Environment variables

Put these in `.env.local` for local dev, and in the Vercel project settings for
production (Vite only exposes variables prefixed with `VITE_`):

```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
VITE_GOOGLE_MAPS_KEY=<same Google Maps key the rider/customer app uses>
```

`VITE_GOOGLE_MAPS_KEY` is the dashboard's copy of the rider app's
`NEXT_PUBLIC_GOOGLE_MAPS_KEY` — same key, same Google Cloud project, so live
tracking costs stay on one bill. The key's **HTTP referrer restrictions must
include this dashboard's domain** (and `localhost` for dev) or Google will
refuse to serve the map. Required APIs: *Maps JavaScript API*.

Without the key the dashboard still works — the map buttons fall back to the
plain "open in Google Maps" links they used before.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
