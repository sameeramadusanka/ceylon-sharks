// /build-info.json: the commit this copy of the site was built from. The
// admin panel's "site photos are live" email (backend notifySitePhotos)
// polls it to know when a change has been deployed. GITHUB_SHA is set by
// GitHub Actions; local builds report null.
export function GET() {
  return new Response(JSON.stringify({ commit: process.env.GITHUB_SHA ?? null }), { headers: { 'content-type': 'application/json' } });
}
