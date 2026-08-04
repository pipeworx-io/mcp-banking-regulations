# mcp-banking-regulations

Banking Regulations MCP — US banking & consumer-finance rules (12 CFR).

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `banking_regulation` | Get the full text of one banking regulation — a US Federal Reserve, OCC, FDIC, CFPB or NCUA rule codified in 12 CFR — by its citation or Regulation letter. Returns the exact regulatory wording currently in force. Answers "what does Regulation E require", "what is the Federal Reserve regulation for X", "read 12 CFR 1026.19", "the CFPB rule on X", "the OCC / FDIC regulation for X", "bank capital requirement". Forgiving input: "1026.19", "12 CFR 1026.19", "§ 217.10", "1026.19(e)" (paragraph stripped to the section), "part 1026". Fed "Regulation letters" resolve automatically: "Regulation Z" (truth in lending) -> part 1026, "Reg B" (ECOA) -> 1002, "Reg C" (HMDA) -> 1003, "Reg D" -> 204, "Reg E" (EFTA) -> 1005, "Reg O" (insider lending) -> 215, "Reg W" (affiliate transactions) -> 223, "Reg X" (RESPA) -> 1024, "Reg Y" (bank holding companies) -> 225, "Reg CC" (funds availability) -> 229, "Reg DD" (truth in savings) -> 1030, "Reg Q" / capital -> 217, plus "Volcker rule" -> 248, "CRA" -> 228, "liquidity coverage ratio" -> 249. Covers bank compliance across all of Title 12: consumer financial protection, mortgage disclosure and servicing, deposits and payments, capital and liquidity, holding-company supervision, safety and soundness. Pass a whole part or Regulation letter to get that part's section list. Example: banking_regulation({ citation: "1026.19" }) -> certain mortgage and variable-rate transactions; banking_regulation({ citation: "Regulation Z" }) -> the truth-in-lending part's section list. Keyless. |
| `banking_regulations_search` | Keyword search across the US banking regulations — Federal Reserve, OCC, FDIC, CFPB and NCUA rules in 12 CFR. Answers "what banking regulations cover X", "the Federal Reserve regulation about X", "find the CFPB rule for X", "which consumer financial protection rule applies to X", "the bank compliance requirement for X". Great for topics: truth in lending disclosure, mortgage origination and servicing, closing disclosures and TRID, ability to repay and qualified mortgages, electronic fund transfers and error resolution, overdraft and remittances, fair lending and adverse action notices, HMDA reporting, funds availability and check holds, deposit insurance, risk-based capital and leverage ratios, liquidity coverage, transactions with affiliates, insider lending limits, bank holding company activities, stress testing, community reinvestment. Returns matching banking rules with citation (12 CFR), heading, excerpt, and source URL. Example: banking_regulations_search({ query: "truth in lending disclosure" }); banking_regulations_search({ query: "ability to repay qualified mortgage", limit: 15 }). Keyless. |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "banking-regulations": {
      "url": "https://gateway.pipeworx.io/banking-regulations/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Banking Regulations data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
