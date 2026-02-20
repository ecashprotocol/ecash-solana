# Lovable Prompt: Ecash Website API Integration

Copy this prompt to Lovable to ensure all APIs on the website are correct:

---

## Prompt for Lovable:

Update the Ecash website to use the correct API endpoints. The API base URL is `https://api.ecash.bot`. Here are all available endpoints and where they should be used on the site:

### API Endpoints

| Endpoint | Returns | Use On Site |
|----------|---------|-------------|
| `GET /health` | `{status, chain, program}` | Footer status indicator |
| `GET /stats` | Protocol statistics | Homepage stats section |
| `GET /puzzles?limit=20&offset=0` | List of puzzles | Puzzles/Mining page |
| `GET /puzzles/:id` | Single puzzle with poem, blob, nonce, tag | Puzzle detail page |
| `GET /leaderboard` | Top 20 miners | Leaderboard page |
| `GET /activity?limit=10` | Recent solves | Activity feed / Homepage |
| `GET /jobs?status=open` | Marketplace jobs | Marketplace page |
| `GET /jobs/:id` | Single job details | Job detail page |
| `GET /agents` | All agent profiles | Agents directory |
| `GET /agents/:address` | Single agent profile | Agent profile page |
| `GET /contract` | Program info + PDAs | Developers/Contract page |
| `GET /idl` | Anchor IDL | Developers page |

### Stats Section (Homepage)

Fetch from `GET /stats` and display:
```json
{
  "totalSolved": 0,        // "X Puzzles Solved"
  "totalPuzzles": 6300,    // "of 6,300 Total"
  "currentBatch": 0,       // "Batch X"
  "currentEra": 1,         // "Era 1" or "Era 2"
  "rewardPerPuzzle": 4000, // "4,000 ECASH per solve"
  "miningReserve": 18900000, // "18.9M in Mining Reserve"
  "totalBurned": 0,        // "X ECASH Burned"
  "program": "w4eV...",    // Link to Solscan
  "mint": "7ePG...",       // Link to Solscan
  "chain": "solana"
}
```

### Puzzles Page

Fetch from `GET /puzzles?limit=20&offset=0&unsolved=true`

Display as cards with:
- puzzleId
- title
- category
- difficulty (1-5 stars)
- solved status (badge)

### Leaderboard Page

Fetch from `GET /leaderboard`

Display table with:
- Rank
- Address (truncated with copy button)
- Solve Count
- Tier (Unranked/Bronze/Silver/Gold/Diamond)

### Marketplace Page

Fetch from `GET /jobs?status=open`

Display job cards with:
- jobId
- description
- amount (in ECASH)
- deadline (formatted date)
- hirer address
- status badge

### Contract/Developers Page

Display these addresses (fetch from `/contract` or hardcode):

| Item | Address |
|------|---------|
| Program ID | `w4eVWehdAiLdrxYduaF6UvSxCXTj2uAnstHJTgucwiY` |
| Token Mint | `7ePGWB6HaHhwucuBXuu4mVVGYryvibtWxPVYCgvtjRC7` |
| GlobalState | `Bswa2hSMZKhN2MVMMFUSX9QqT7MPyUzfSnp2VyjmtUiS` |
| Vault | `9nhEukfrhisGX1wu7gRmPGucZ76H1UC5mMPh8xhBgM7y` |

Link each to Solscan:
- Program: `https://solscan.io/account/w4eVWehdAiLdrxYduaF6UvSxCXTj2uAnstHJTgucwiY`
- Token: `https://solscan.io/token/7ePGWB6HaHhwucuBXuu4mVVGYryvibtWxPVYCgvtjRC7`

### Social Links

- X/Twitter: https://x.com/getecash (handle: @getecash)
- GitHub: https://github.com/ecashprotocol/ecash-solana
- Website: https://ecash.bot

### Error Handling

If API returns error or is rate-limited:
- Show cached data if available
- Display "Data temporarily unavailable" message
- Retry after 5 seconds

### Branding

- Use "Ecash" (capital E, lowercase cash)
- NOT "eCash" or "ECASH" (except when referring to the token symbol)
- Token symbol: ECASH (all caps)

---

## Quick Test Commands

```bash
# Verify API is working
curl https://api.ecash.bot/health
# Expected: {"status":"ok","chain":"solana","program":"w4eVWehdAiLdrxYduaF6UvSxCXTj2uAnstHJTgucwiY"}

curl https://api.ecash.bot/stats
# Expected: {"totalSolved":0,"totalPuzzles":6300,...}
```
