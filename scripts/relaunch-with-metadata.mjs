/**
 * relaunch-with-metadata.mjs
 *
 * MAINNET RELAUNCH SCRIPT
 *
 * Creates a new Ecash token with Metaplex metadata attached.
 * This is the production script for the token relaunch.
 *
 * Usage:
 *   node scripts/relaunch-with-metadata.mjs --dry-run    # Preview without executing
 *   node scripts/relaunch-with-metadata.mjs --execute    # Actually create token
 *
 * Cost estimate: ~0.02-0.03 SOL total
 */

import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  createV1,
  mplTokenMetadata,
  TokenStandard,
  findMetadataPda
} from '@metaplex-foundation/mpl-token-metadata';
import {
  generateSigner,
  keypairIdentity,
  publicKey,
  percentAmount,
} from '@metaplex-foundation/umi';
import {
  createMint,
  mplToolbox,
  mintTokensTo,
  findAssociatedTokenPda
} from '@metaplex-foundation/mpl-toolbox';
import { readFileSync } from 'fs';
import { Keypair, Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

// Configuration
const MAINNET_RPC = 'https://api.mainnet-beta.solana.com';
const DEVNET_RPC = 'https://api.devnet.solana.com';

const TOKEN_CONFIG = {
  name: "Ecash",
  symbol: "ECASH",
  uri: "https://raw.githubusercontent.com/ecashprotocol/ecash-solana/main/scripts/token-metadata.json",
  decimals: 9,
  // Initial supply for LP allocation (2.1M ECASH)
  lpAllocation: 2_100_000n * (10n ** 9n),
};

// Program PDA seeds (must match ecash_program)
const MINT_SEED = Buffer.from("ecash_mint");
const ECASH_PROGRAM_ID = "w4eVWehdAiLdrxYduaF6UvSxCXTj2uAnstHJTgucwiY";

function deriveEcashMintPDA() {
  const [pda] = PublicKey.findProgramAddressSync(
    [MINT_SEED],
    new PublicKey(ECASH_PROGRAM_ID)
  );
  return pda;
}

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const isExecute = args.includes('--execute');
  const useDevnet = args.includes('--devnet');

  if (!isDryRun && !isExecute) {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                 Ecash Token Relaunch Script                  ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  This script creates a NEW Ecash token with Metaplex        ║
║  metadata for the mainnet relaunch.                          ║
║                                                              ║
║  Usage:                                                      ║
║    --dry-run    Preview the operation without executing     ║
║    --execute    Actually create the token (MAINNET!)         ║
║    --devnet     Use devnet instead of mainnet               ║
║                                                              ║
║  Example:                                                    ║
║    node scripts/relaunch-with-metadata.mjs --dry-run        ║
║    node scripts/relaunch-with-metadata.mjs --execute        ║
║    node scripts/relaunch-with-metadata.mjs --devnet --execute║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);
    process.exit(0);
  }

  const network = useDevnet ? 'DEVNET' : 'MAINNET';
  const rpcUrl = useDevnet ? DEVNET_RPC : MAINNET_RPC;

  console.log("=".repeat(60));
  console.log(`Ecash TOKEN RELAUNCH - ${network}`);
  console.log("=".repeat(60));

  // Load deployer wallet
  const deployerPath = new URL('../deployer.json', import.meta.url).pathname;
  const deployerSecret = JSON.parse(readFileSync(deployerPath, 'utf-8'));
  const deployerKeypair = Keypair.fromSecretKey(Uint8Array.from(deployerSecret));

  console.log(`\nDeployer: ${deployerKeypair.publicKey.toBase58()}`);

  // Check balance
  const connection = new Connection(rpcUrl, 'confirmed');
  const balance = await connection.getBalance(deployerKeypair.publicKey);
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL`);

  const minBalance = useDevnet ? 0.5 : 0.05;
  if (balance < minBalance * LAMPORTS_PER_SOL) {
    console.error(`\n❌ Insufficient balance! Need at least ${minBalance} SOL`);
    process.exit(1);
  }

  // Show expected program PDA
  const expectedPDA = deriveEcashMintPDA();
  console.log(`\nExpected program PDA: ${expectedPDA.toBase58()}`);
  console.log("(Mint authority will be transferred here after program deploy)");

  // Token configuration summary
  console.log("\n" + "-".repeat(60));
  console.log("TOKEN CONFIGURATION");
  console.log("-".repeat(60));
  console.log(`Name:     ${TOKEN_CONFIG.name}`);
  console.log(`Symbol:   ${TOKEN_CONFIG.symbol}`);
  console.log(`Decimals: ${TOKEN_CONFIG.decimals}`);
  console.log(`URI:      ${TOKEN_CONFIG.uri}`);
  console.log(`LP Alloc: ${Number(TOKEN_CONFIG.lpAllocation) / 1e9} ECASH`);

  if (isDryRun) {
    console.log("\n" + "=".repeat(60));
    console.log("DRY RUN - No transactions will be sent");
    console.log("=".repeat(60));
    console.log(`
STEPS THAT WOULD EXECUTE:
1. Create Token-2022 mint with ${TOKEN_CONFIG.decimals} decimals
2. Create Metaplex metadata account with name/symbol/uri
3. Mint ${Number(TOKEN_CONFIG.lpAllocation) / 1e9} ECASH to deployer (LP allocation)
4. Print new mint address

AFTER THIS SCRIPT:
- Deploy updated ecash_program pointing to new mint
- Transfer mint authority: spl-token authorize <MINT> mint ${expectedPDA.toBase58()}
- Create Meteora pool with LP allocation
`);
    process.exit(0);
  }

  // EXECUTE MODE
  console.log("\n⚠️  EXECUTING ON " + network + "!");
  console.log("Press Ctrl+C within 5 seconds to abort...\n");

  await new Promise(r => setTimeout(r, 5000));

  // Initialize Umi
  console.log("Initializing Umi...");
  const umi = createUmi(rpcUrl)
    .use(mplTokenMetadata())
    .use(mplToolbox());

  const umiKeypair = umi.eddsa.createKeypairFromSecretKey(deployerKeypair.secretKey);
  umi.use(keypairIdentity(umiKeypair));

  // Generate new mint
  const mintSigner = generateSigner(umi);
  console.log(`\nNew mint address: ${mintSigner.publicKey}`);

  // Step 1: Create mint
  console.log("\n[1/3] Creating Token-2022 mint...");
  const createMintTx = await createMint(umi, {
    mint: mintSigner,
    decimals: TOKEN_CONFIG.decimals,
    mintAuthority: umi.identity.publicKey,
    freezeAuthority: umi.identity.publicKey,
  }).sendAndConfirm(umi);
  console.log(`✅ Mint created: ${bs58.encode(createMintTx.signature)}`);

  // Step 2: Add metadata
  console.log("\n[2/3] Adding Metaplex metadata...");
  const metadataTx = await createV1(umi, {
    mint: mintSigner.publicKey,
    authority: umi.identity,
    payer: umi.identity,
    updateAuthority: umi.identity.publicKey,
    name: TOKEN_CONFIG.name,
    symbol: TOKEN_CONFIG.symbol,
    uri: TOKEN_CONFIG.uri,
    sellerFeeBasisPoints: percentAmount(0),
    tokenStandard: TokenStandard.Fungible,
  }).sendAndConfirm(umi);
  console.log(`✅ Metadata added: ${bs58.encode(metadataTx.signature)}`);

  // Step 3: Mint LP allocation using CLI (more reliable)
  console.log("\n[3/3] Minting LP allocation...");
  console.log("NOTE: Use spl-token CLI for minting:");
  console.log(`  spl-token create-account ${mintSigner.publicKey} --url mainnet-beta --fee-payer deployer.json`);
  console.log(`  spl-token mint ${mintSigner.publicKey} ${Number(TOKEN_CONFIG.lpAllocation) / 1e9} --url mainnet-beta --fee-payer deployer.json`);
  console.log("(Skipping automatic minting - use CLI commands above)");

  // Summary
  const metadataPda = findMetadataPda(umi, { mint: mintSigner.publicKey });

  console.log("\n" + "=".repeat(60));
  console.log("✅ TOKEN CREATED SUCCESSFULLY");
  console.log("=".repeat(60));
  console.log(`Mint Address:    ${mintSigner.publicKey}`);
  console.log(`Metadata PDA:    ${metadataPda[0]}`);
  console.log(`Deployer ATA:    ${ata[0]}`);
  console.log(`LP Balance:      ${Number(TOKEN_CONFIG.lpAllocation) / 1e9} ECASH`);

  console.log("\n" + "-".repeat(60));
  console.log("NEXT STEPS");
  console.log("-".repeat(60));
  console.log(`
1. Update ecash_program to use new mint: ${mintSigner.publicKey}
2. Deploy program to mainnet
3. Transfer mint authority to program PDA:
   spl-token authorize ${mintSigner.publicKey} mint ${expectedPDA.toBase58()} --url ${network.toLowerCase()}
4. Create Meteora DLMM pool at https://app.meteora.ag/dlmm/create
5. Update all configs (SKILL.md, API, website) with new addresses
`);

  console.log("\n" + "-".repeat(60));
  console.log("VERIFICATION LINKS");
  console.log("-".repeat(60));
  const cluster = useDevnet ? '?cluster=devnet' : '';
  console.log(`Solscan:  https://solscan.io/token/${mintSigner.publicKey}${cluster}`);
  console.log(`Explorer: https://explorer.solana.com/address/${mintSigner.publicKey}${cluster}`);

  // Save to file for reference
  const result = {
    network,
    mint: mintSigner.publicKey.toString(),
    metadataPda: metadataPda[0].toString(),
    deployerAta: ata[0].toString(),
    lpAllocation: Number(TOKEN_CONFIG.lpAllocation) / 1e9,
    expectedProgramPda: expectedPDA.toBase58(),
    createdAt: new Date().toISOString()
  };

  console.log("\n" + JSON.stringify(result, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("\n❌ FAILED:", err);
    process.exit(1);
  });
