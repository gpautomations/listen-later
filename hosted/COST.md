# Monthly cost on Workers and R2

Prices below are Cloudflare's published Standard rates as of November 2026.

Sources:

- Workers: https://developers.cloudflare.com/workers/platform/pricing/
- R2: https://developers.cloudflare.com/r2/pricing/

Workers Paid is **$5 per account per month**. It includes 10 million requests and 30 million CPU-milliseconds. Extra requests are $0.30 per million. Extra CPU time is $0.02 per million CPU-milliseconds. Duration and egress are not billed. The Free plan allows 100,000 requests per day but only **10 ms of CPU per request**, which is not enough to accept a multi-megabyte upload. This service needs the paid plan.

R2 Standard:

- Storage: $0.015 per GB-month. First 10 GB-month free.
- Class A (writes, including PutObject): $4.50 per million. First 1 million free.
- Class B (reads, including GetObject and HeadObject): $0.36 per million. First 10 million free.
- Egress to the internet: free.
- DeleteObject: free.
- Cloudflare rounds R2 usage up to the next billing unit. 1.1 GB-month is billed as 2 GB-month.

No KV, D1, or Durable Objects are used. Those would add another meter.

## What one active user does in a month

These are planning assumptions, not a measurement of real traffic.

- Saves 4 new episodes.
- Keeps a library of 10 episodes (the 4 new ones plus 6 older ones).
- Listens 10 times.
- Each episode is 15 minutes of speech.
- Audio is Opus at 24 kbps: `15 * 60 * 24000 / 8 = 2,700,000` bytes, about 2.7 MB. With the manifest, call it 3 MB stored per episode.
- A listen is 1 page view plus 6 audio range requests. Mobile Safari uses range requests to start and to seek. Each ranged response does one HeadObject and one GetObject. A page view does one GetObject for the manifest.

| Action | Count | Worker requests | Class A | Class B |
|---|---:|---:|---:|---:|
| Upload one episode (audio, manifest, account read, account write) | 4 | 4 | 12 | 4 |
| Listen (1 manifest + 6 ranges, each range is head + get) | 10 | 70 | 0 | 130 |
| Open the list in options | 2 | 2 | 0 | 2 |
| **Per user** |  | **76** | **12** | **136** |

Stored library: `10 * 3 MB = 30 MB` per user.

## 100 active users

| Meter | Use | Bill |
|---|---|---|
| Workers subscription | required | $5.00 |
| Worker requests | 7,600 | $0 (inside 10 million) |
| CPU | well under 30 million ms (uploads are the heavy calls; even 100 ms each is 40,000 ms) | $0 |
| R2 storage | 3.0 GB | $0 (inside 10 GB) |
| Class A | 1,200 | $0 (inside 1 million) |
| Class B | 13,600 | $0 (inside 10 million) |
| Egress | free | $0 |
| **Total** |  | **$5.00** |

## 1,000 active users

| Meter | Use | Bill |
|---|---|---|
| Workers subscription | required | $5.00 |
| Worker requests | 76,000 | $0 |
| CPU | about 0.4 million ms if uploads average 100 ms | $0 |
| R2 storage | 30 GB, minus 10 GB free = 20 GB, times $0.015 | $0.30 |
| Class A | 12,000 | $0 |
| Class B | 136,000 | $0 |
| Egress | free | $0 |
| **Total** |  | **about $5.30** |

If the account already pays for Workers for other scripts, the extra cost of this worker is about $0.30 at 1,000 users, until the account passes the included request or CPU allowance. The $5 minimum is per account, not per worker.

## If audio stays WAV

16-bit mono at 24 kHz is about 2.88 MB per minute, so a 15 minute episode is about 43 MB. Ten episodes are about 430 MB per user.

- 100 users: about 43 GB. Billable storage is about 33 GB after the free 10 GB, times $0.015, about $0.50. Total about **$5.50**.
- 1,000 users: about 430 GB. Billable storage is about 420 GB, times $0.015, about $6.30. Total about **$11.30**.

Opus is the cheap path. The extension uses it when WebCodecs is available.

## What would make this more expensive

- Many more range requests per listen. 30 ranges instead of 6 is still inside the free Class B allowance at 1,000 users (`1,000 * 10 * 30 * 2 = 600,000` Class B reads).
- A public catalog or hotlinking. The pages send `noindex` and `Cross-Origin-Resource-Policy: same-origin` so another site cannot embed the audio. A leaked link can still be opened directly.
- Adding email, KV, or a database. Not in this version.

Prices change. Recheck the two Cloudflare pages before setting a user price.
