# Before going public

Just See is set up for **personal use** right now. These choices keep the free
Vercel plan safe for one person; change them before other people use the app.

| # | What | Now (personal) | Change to (public) | Where |
| --- | --- | --- | --- | --- |
| 1 | **Early delete of clips** | Source clips are deleted from online storage as soon as the render page has copied them to the device. If the render then fails, the clips must be added again (the project is still on that device and opens in the editor). | Keep clips until the MP4 is saved (or longer). Set env `JUST_SEE_EAGER_DELETE=0` on the `just-see-api` project. | `apps/api/src/app.ts` → `eagerDelete()` |
| 2 | **Delete after render** | Clips are deleted once the MP4 is saved (`render_video` keeps them only with `keep_media: true`). Projects can't be reopened after that. | Decide per plan: keep clips for N days so people can re-edit. | `apps/api/src/app.ts` → `deleteJobMedia` |
| 3 | **Storage size** | Free Vercel Blob, 1 GB total; one ~900 MB clip at a time; downloads refused above ~950 MB. | Paid storage (Vercel Pro or another store), per-user quotas. | `apps/api/src/store.ts` → `STORAGE_LIMIT`, `apps/api/src/mcp.ts` → `MAX_BYTES` |
| 4 | **Clip expiry** | Unrendered clips: 2 days. Everything else: 30 days. | Per plan. | `apps/api/src/store.ts` → `MEDIA_KEEP_MS`, `KEEP_MS` |
| 5 | **Connector key** | One secret key in the URL, shared by the owner only. | Real accounts (OAuth sign-in) and one key per user. | `apps/api/src/app.ts` (`MCP_KEY`) |
| 6 | **Rendering** | Done in the user's own browser (free). | Optional render server for slow phones. | `apps/web/src/app/render` |
| 7 | **Vercel plan** | Hobby (free, non-commercial use only). | Vercel Pro is required for commercial use. | Vercel dashboard |
| 8 | **Google Drive** | Share links ("Anyone with the link"); the user's own Drive files are never deleted. | Google sign-in (Drive API) if needed; needs a Google Cloud project and review. | `apps/api/src/mcp.ts` → `directDownloadUrl` |
| 9 | **Cloud usage meter** | Every finished video's reply (and `get_usage`) shows the owner's cloud use: downloaded, stored, sent to browser, server time, and this month's total against the free plan. Our own count, close to Vercel's but not exact. Claude's own credits can't be seen by a connector. | The owner said this will change later. For the public: per-user usage and limits (or credits/billing), hide owner-wide totals from users, and read exact numbers from Vercel's usage API. | `apps/api/src/usage.ts` (`FREE_PLAN`, `usageReport`) |
