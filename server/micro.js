// Minimal zero-dependency Express-like router (the sandbox has no npm;
// locally you can keep this or swap back to Express, the route files are identical).
export function Router() {
  const routes = [];
  const register = (method) => (path, ...handlers) => routes.push({ method, path, handlers });
  const match = (routePath, url) => {
    const rp = routePath.split("/").filter(Boolean);
    const up = url.split("/").filter(Boolean);
    if (rp.length !== up.length) return null;
    const params = {};
    for (let i = 0; i < rp.length; i++) {
      if (rp[i].startsWith(":")) params[rp[i].slice(1)] = up[i];
      else if (rp[i] !== up[i]) return null;
    }
    return params;
  };
  return {
    get: register("GET"),
    post: register("POST"),
    routes,
    handle: async (req, res) => {
      for (const route of routes) {
        if (route.method !== req.method) continue;
        const params = match(route.path, req.path);
        if (!params) continue;
        req.params = params;
        let i = 0;
        const next = () => {
          const h = route.handlers[i++];
          if (h) return h(req, res, next);
        };
        await next();
        return true;
      }
      return false;
    },
  };
}
