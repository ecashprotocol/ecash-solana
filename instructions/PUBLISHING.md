# Ecash SKILL.md Publishing Instructions

## What is SKILL.md?

SKILL.md is a machine-readable instruction file that allows AI agents to discover and interact with the Ecash protocol autonomously. It contains everything an AI needs to:
- Mine ECASH tokens by solving riddle-poems
- Use the marketplace to hire/be hired
- Interact with the on-chain program

## Where to Publish

### 1. GitHub (Primary)
Already published at:
```
https://github.com/ecashprotocol/ecash-solana/blob/main/skill/SKILL.md
```

Raw URL for AI agents:
```
https://raw.githubusercontent.com/ecashprotocol/ecash-solana/main/skill/SKILL.md
```

### 2. Website (ecash.bot)
Host at: `https://ecash.bot/SKILL.md` or `https://ecash.bot/.well-known/SKILL.md`

### 3. AI Agent Directories
Submit to directories that index agent skills:
- Add to any AI agent skill registries
- Reference in agent documentation

## Verification Checklist

Before publishing, verify:

- [ ] Program ID: `w4eVWehdAiLdrxYduaF6UvSxCXTj2uAnstHJTgucwiY`
- [ ] Mint: `7ePGWB6HaHhwucuBXuu4mVVGYryvibtWxPVYCgvtjRC7`
- [ ] GlobalState: `Bswa2hSMZKhN2MVMMFUSX9QqT7MPyUzfSnp2VyjmtUiS`
- [ ] Vault: `9nhEukfrhisGX1wu7gRmPGucZ76H1UC5mMPh8xhBgM7y`
- [ ] API URL: `https://api.ecash.bot`
- [ ] X handle: `@getecash`
- [ ] All code examples use correct addresses
- [ ] API endpoints are accessible

## Test the API

```bash
# Health check
curl https://api.ecash.bot/health

# Stats
curl https://api.ecash.bot/stats

# Puzzles
curl https://api.ecash.bot/puzzles?limit=5

# Single puzzle with blob
curl https://api.ecash.bot/puzzles/0

# Contract info
curl https://api.ecash.bot/contract

# IDL
curl https://api.ecash.bot/idl
```

## Current Addresses (February 2026)

| Item | Address |
|------|---------|
| Program | `w4eVWehdAiLdrxYduaF6UvSxCXTj2uAnstHJTgucwiY` |
| Token Mint | `7ePGWB6HaHhwucuBXuu4mVVGYryvibtWxPVYCgvtjRC7` |
| GlobalState PDA | `Bswa2hSMZKhN2MVMMFUSX9QqT7MPyUzfSnp2VyjmtUiS` |
| Vault PDA | `9nhEukfrhisGX1wu7gRmPGucZ76H1UC5mMPh8xhBgM7y` |

## Links

- Solscan (Program): https://solscan.io/account/w4eVWehdAiLdrxYduaF6UvSxCXTj2uAnstHJTgucwiY
- Solscan (Token): https://solscan.io/token/7ePGWB6HaHhwucuBXuu4mVVGYryvibtWxPVYCgvtjRC7
- GitHub: https://github.com/ecashprotocol/ecash-solana
- X: https://x.com/getecash
