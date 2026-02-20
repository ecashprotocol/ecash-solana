const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { Connection, PublicKey } = require('@solana/web3.js');
const anchor = require('@coral-xyz/anchor');

// =============================================================================
// CONFIGURATION
// =============================================================================

const PORT = process.env.PORT || 3000;
const RPC_URL = 'https://mainnet.helius-rpc.com/?api-key=527a7436-f23b-422c-8278-66bae899064b';
const PROGRAM_ID = new PublicKey('w4eVWehdAiLdrxYduaF6UvSxCXTj2uAnstHJTgucwiY');
const MINT = new PublicKey('7ePGWB6HaHhwucuBXuu4mVVGYryvibtWxPVYCgvtjRC7');
const GLOBAL_STATE_PDA = new PublicKey('Bswa2hSMZKhN2MVMMFUSX9QqT7MPyUzfSnp2VyjmtUiS');
const VAULT = new PublicKey('9nhEukfrhisGX1wu7gRmPGucZ76H1UC5mMPh8xhBgM7y');
const TOTAL_PUZZLES = 6300;

// =============================================================================
// LOAD DATA FILES (defensive loading - don't crash if files missing)
// =============================================================================

let poemsRaw = [];
let blobsRaw = [];
let idl = {};

try {
  poemsRaw = require(path.join(__dirname, 'data', 'all-riddles-v3.json'));
  console.log(`Loaded ${poemsRaw.length} poems`);
} catch (e) {
  console.error('WARNING: all-riddles-v3.json not found, /puzzles will be empty');
}

try {
  blobsRaw = require(path.join(__dirname, 'data', 'encrypted-blobs.json'));
  console.log(`Loaded ${blobsRaw.length} blobs`);
} catch (e) {
  console.error('WARNING: encrypted-blobs.json not found');
}

try {
  idl = require(path.join(__dirname, 'data', 'ecash_program.json'));
  console.log('Loaded IDL');
} catch (e) {
  console.error('WARNING: ecash_program.json not found, /idl will be empty');
}

// Index poems and blobs by puzzleId
const poemsById = new Map();
poemsRaw.forEach(p => {
  poemsById.set(p.id, {
    puzzleId: p.id,
    title: p.title,
    poem: p.riddle,  // Map 'riddle' to 'poem' for API consistency
    category: p.category,
    difficulty: p.difficulty
  });
});

const blobsById = new Map();
blobsRaw.forEach(b => {
  blobsById.set(b.puzzleId, {
    puzzleId: b.puzzleId,
    blob: b.blob,
    nonce: b.nonce,
    tag: b.tag
  });
});

console.log(`Loaded ${poemsById.size} poems and ${blobsById.size} blobs`);

// =============================================================================
// SOLANA CONNECTION & ANCHOR
// =============================================================================

const connection = new Connection(RPC_URL, 'confirmed');
const coder = new anchor.BorshAccountsCoder(idl);

// Account discriminators for getProgramAccounts filters
const MINER_STATE_DISCRIMINATOR = Buffer.from([171, 93, 72, 78, 139, 153, 97, 8]);
const PUZZLE_SOLVED_DISCRIMINATOR = Buffer.from([18, 76, 55, 11, 132, 83, 154, 55]);
const JOB_DISCRIMINATOR = Buffer.from([75, 124, 80, 203, 161, 180, 202, 80]);
const AGENT_PROFILE_DISCRIMINATOR = Buffer.from([60, 227, 42, 24, 0, 87, 86, 205]);

// =============================================================================
// CACHING
// =============================================================================

const cache = {
  stats: { data: null, timestamp: 0, ttl: 30000 },
  solvedStatus: { data: new Map(), timestamp: 0, ttl: 60000 },
  leaderboard: { data: null, timestamp: 0, ttl: 60000 },
  activity: { data: null, timestamp: 0, ttl: 30000 },
  jobs: { data: null, timestamp: 0, ttl: 15000 },
  agents: { data: null, timestamp: 0, ttl: 60000 }
};

// SSE clients for real-time events
const sseClients = new Set();

function isCacheValid(cacheEntry) {
  return cacheEntry.data !== null && (Date.now() - cacheEntry.timestamp) < cacheEntry.ttl;
}

// =============================================================================
// PDA DERIVATION HELPERS
// =============================================================================

function getPuzzleSolvedPda(puzzleId) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(puzzleId));
  return PublicKey.findProgramAddressSync(
    [Buffer.from('puzzle_solved'), buf],
    PROGRAM_ID
  )[0];
}

function getMinerStatePda(authority) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('miner_state'), authority.toBuffer()],
    PROGRAM_ID
  )[0];
}

function getJobPda(jobId) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(jobId));
  return PublicKey.findProgramAddressSync(
    [Buffer.from('job'), buf],
    PROGRAM_ID
  )[0];
}

function getAgentProfilePda(owner) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('agent_profile'), owner.toBuffer()],
    PROGRAM_ID
  )[0];
}

// =============================================================================
// DATA FETCHING HELPERS
// =============================================================================

async function fetchGlobalState() {
  const accountInfo = await connection.getAccountInfo(GLOBAL_STATE_PDA);
  if (!accountInfo) throw new Error('GlobalState account not found');
  return coder.decode('GlobalState', accountInfo.data);
}

async function fetchVaultBalance() {
  const tokenAccountInfo = await connection.getTokenAccountBalance(VAULT);
  return tokenAccountInfo.value.uiAmount;
}

async function checkPuzzleSolved(puzzleId) {
  const pda = getPuzzleSolvedPda(puzzleId);
  const info = await connection.getAccountInfo(pda);
  if (!info) return { solved: false, solvedBy: null };

  const puzzleSolved = coder.decode('PuzzleSolved', info.data);
  return {
    solved: true,
    solvedBy: puzzleSolved.solver.toBase58()
  };
}

async function batchCheckSolved(puzzleIds) {
  // Use cache if valid
  if (isCacheValid(cache.solvedStatus)) {
    const result = new Map();
    for (const id of puzzleIds) {
      if (cache.solvedStatus.data.has(id)) {
        result.set(id, cache.solvedStatus.data.get(id));
      }
    }
    if (result.size === puzzleIds.length) return result;
  }

  // Fetch missing ones
  const pdas = puzzleIds.map(id => getPuzzleSolvedPda(id));
  const accounts = await connection.getMultipleAccountsInfo(pdas);

  const result = new Map();
  for (let i = 0; i < puzzleIds.length; i++) {
    const id = puzzleIds[i];
    const info = accounts[i];
    if (!info) {
      result.set(id, { solved: false, solvedBy: null });
    } else {
      const puzzleSolved = coder.decode('PuzzleSolved', info.data);
      result.set(id, {
        solved: true,
        solvedBy: puzzleSolved.solver.toBase58()
      });
    }
    cache.solvedStatus.data.set(id, result.get(id));
  }
  cache.solvedStatus.timestamp = Date.now();

  return result;
}

function getTier(solveCount) {
  if (solveCount >= 50) return 'Diamond';
  if (solveCount >= 25) return 'Gold';
  if (solveCount >= 10) return 'Silver';
  if (solveCount >= 1) return 'Bronze';
  return 'Unranked';
}

function getCurrentEra(totalSolved) {
  // Era 1: puzzles 0-3149 (reward: 4000 ECASH)
  // Era 2: puzzles 3150-6299 (reward: 2000 ECASH)
  return totalSolved < 3150 ? 1 : 2;
}

function getRewardPerPuzzle(era) {
  return era === 1 ? 4000 : 2000;
}

function getJobStatus(statusObj) {
  // Anchor returns status as { Open: {} }, { Accepted: {} }, etc. (PascalCase)
  if (statusObj.Open) return 'open';
  if (statusObj.Accepted) return 'accepted';
  if (statusObj.WorkSubmitted) return 'workSubmitted';
  if (statusObj.Completed) return 'completed';
  if (statusObj.Cancelled) return 'cancelled';
  if (statusObj.Disputed) return 'disputed';
  if (statusObj.Resolved) return 'resolved';
  return 'unknown';
}

// Helper to convert BN to number
function bnToNumber(bn) {
  if (bn && typeof bn.toNumber === 'function') {
    return bn.toNumber();
  }
  // Fallback for when it's already a number or string
  return Number(bn);
}

// Broadcast event to all SSE clients
function broadcastEvent(eventType, data) {
  const event = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(event);
  }
}

// =============================================================================
// EXPRESS APP SETUP
// =============================================================================

const app = express();

app.use(cors());
app.use(express.json());

// Rate limiting: 100 requests per minute per IP
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' }
});
app.use(limiter);

// =============================================================================
// ENDPOINTS
// =============================================================================

// GET /health
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    chain: 'solana',
    program: PROGRAM_ID.toBase58()
  });
});

// GET /stats
app.get('/stats', async (req, res) => {
  try {
    if (isCacheValid(cache.stats)) {
      return res.json(cache.stats.data);
    }

    const [globalState, vaultBalance] = await Promise.all([
      fetchGlobalState(),
      fetchVaultBalance()
    ]);

    const totalSolved = Number(globalState.total_solved);
    const currentBatch = Number(globalState.current_batch);
    const totalBurned = Number(globalState.total_burned);
    const currentEra = getCurrentEra(totalSolved);

    const stats = {
      totalSolved,
      totalPuzzles: TOTAL_PUZZLES,
      currentBatch,
      currentEra,
      rewardPerPuzzle: getRewardPerPuzzle(currentEra),
      miningReserve: vaultBalance,
      totalBurned,
      program: PROGRAM_ID.toBase58(),
      mint: MINT.toBase58(),
      chain: 'solana'
    };

    cache.stats.data = stats;
    cache.stats.timestamp = Date.now();

    res.json(stats);
  } catch (err) {
    console.error('Error fetching stats:', err.message);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// GET /puzzles
app.get('/puzzles', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;
    const unsolvedOnly = req.query.unsolved === 'true';

    // Get puzzle IDs in range - scan more when filtering unsolved
    const scanLimit = unsolvedOnly ? Math.min(offset + limit * 10, TOTAL_PUZZLES) : Math.min(offset + limit * 2, TOTAL_PUZZLES);
    const puzzleIds = [];
    for (let i = offset; i < scanLimit; i++) {
      puzzleIds.push(i);
    }

    // Batch check solved status
    const solvedMap = await batchCheckSolved(puzzleIds);

    // Build result
    const puzzles = [];
    for (const id of puzzleIds) {
      if (puzzles.length >= limit) break;

      const poem = poemsById.get(id);
      if (!poem) continue;

      const status = solvedMap.get(id) || { solved: false };

      if (unsolvedOnly && status.solved) continue;

      puzzles.push({
        puzzleId: poem.puzzleId,
        title: poem.title,
        poem: poem.poem,
        category: poem.category,
        difficulty: poem.difficulty,
        solved: status.solved
      });
    }

    res.json(puzzles);
  } catch (err) {
    console.error('Error fetching puzzles:', err.message);
    res.status(500).json({ error: 'Failed to fetch puzzles' });
  }
});

// GET /puzzles/:id
app.get('/puzzles/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);

    if (isNaN(id) || id < 0 || id >= TOTAL_PUZZLES) {
      return res.status(404).json({ error: 'Puzzle not found' });
    }

    const poem = poemsById.get(id);
    const blob = blobsById.get(id);

    if (!poem || !blob) {
      return res.status(404).json({ error: 'Puzzle not found' });
    }

    const status = await checkPuzzleSolved(id);

    res.json({
      puzzleId: poem.puzzleId,
      title: poem.title,
      poem: poem.poem,
      category: poem.category,
      difficulty: poem.difficulty,
      solved: status.solved,
      solvedBy: status.solvedBy,
      blob: blob.blob,
      nonce: blob.nonce,
      tag: blob.tag
    });
  } catch (err) {
    console.error('Error fetching puzzle:', err.message);
    res.status(500).json({ error: 'Failed to fetch puzzle' });
  }
});

// GET /puzzles/:id/blob
app.get('/puzzles/:id/blob', (req, res) => {
  const id = parseInt(req.params.id);

  if (isNaN(id) || id < 0 || id >= TOTAL_PUZZLES) {
    return res.status(404).json({ error: 'Puzzle not found' });
  }

  const blob = blobsById.get(id);

  if (!blob) {
    return res.status(404).json({ error: 'Blob not found' });
  }

  res.json({
    puzzleId: blob.puzzleId,
    blob: blob.blob,
    nonce: blob.nonce,
    tag: blob.tag
  });
});

// GET /leaderboard
app.get('/leaderboard', async (req, res) => {
  try {
    if (isCacheValid(cache.leaderboard)) {
      return res.json(cache.leaderboard.data);
    }

    // Fetch all MinerState accounts
    const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
      filters: [
        { memcmp: { offset: 0, bytes: anchor.utils.bytes.bs58.encode(MINER_STATE_DISCRIMINATOR) } }
      ]
    });

    const miners = accounts.map(({ pubkey, account }) => {
      try {
        const minerState = coder.decode('MinerState', account.data);
        const solveCount = Number(minerState.solve_count);
        return {
          address: minerState.owner.toBase58(),
          solveCount,
          tier: getTier(solveCount),
          gasBalance: Number(minerState.gas_balance)
        };
      } catch (e) {
        return null;
      }
    }).filter(m => m !== null);

    // Sort by solve count descending, take top 20
    miners.sort((a, b) => b.solveCount - a.solveCount);
    const leaderboard = miners.slice(0, 20);

    cache.leaderboard.data = leaderboard;
    cache.leaderboard.timestamp = Date.now();

    res.json(leaderboard);
  } catch (err) {
    console.error('Error fetching leaderboard:', err.message);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

// GET /activity
app.get('/activity', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);

    if (isCacheValid(cache.activity)) {
      return res.json(cache.activity.data.slice(0, limit));
    }

    // Fetch all PuzzleSolved accounts
    const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
      filters: [
        { memcmp: { offset: 0, bytes: anchor.utils.bytes.bs58.encode(PUZZLE_SOLVED_DISCRIMINATOR) } }
      ]
    });

    const activity = accounts.map(({ pubkey, account }) => {
      try {
        const puzzleSolved = coder.decode('PuzzleSolved', account.data);
        return {
          puzzleId: Number(puzzleSolved.puzzle_id),
          solver: puzzleSolved.solver.toBase58(),
          timestamp: Number(puzzleSolved.solved_at)
        };
      } catch (e) {
        return null;
      }
    }).filter(a => a !== null);

    // Sort by timestamp descending (newest first)
    activity.sort((a, b) => b.timestamp - a.timestamp);

    cache.activity.data = activity;
    cache.activity.timestamp = Date.now();

    res.json(activity.slice(0, limit));
  } catch (err) {
    console.error('Error fetching activity:', err.message);
    res.status(500).json({ error: 'Failed to fetch activity' });
  }
});

// GET /contract
app.get('/contract', (req, res) => {
  res.json({
    program: PROGRAM_ID.toBase58(),
    mint: MINT.toBase58(),
    globalState: GLOBAL_STATE_PDA.toBase58(),
    vault: VAULT.toBase58(),
    chain: 'solana',
    chainId: 'mainnet-beta',
    idl: idl
  });
});

// IDL endpoint for agents
app.get('/idl', (req, res) => {
  res.json(idl);
});

// =============================================================================
// MARKETPLACE ENDPOINTS
// =============================================================================

// GET /jobs - List all jobs
app.get('/jobs', async (req, res) => {
  try {
    const status = req.query.status; // Filter by status: open, accepted, etc.
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);

    if (isCacheValid(cache.jobs) && !status) {
      return res.json(cache.jobs.data.slice(0, limit));
    }

    // Fetch all Job accounts
    const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
      filters: [
        { memcmp: { offset: 0, bytes: anchor.utils.bytes.bs58.encode(JOB_DISCRIMINATOR) } }
      ]
    });

    const jobs = accounts.map(({ pubkey, account }) => {
      try {
        const job = coder.decode('Job', account.data);
        const jobStatus = getJobStatus(job.status);
        return {
          jobId: Number(job.job_id),
          pda: pubkey.toBase58(),
          hirer: job.hirer.toBase58(),
          worker: job.worker.toBase58() === '11111111111111111111111111111111' ? null : job.worker.toBase58(),
          amount: Number(job.amount) / 1e9,
          amountRaw: job.amount.toString(),
          status: jobStatus,
          description: job.description,
          deadline: Number(job.deadline),
          deadlineDate: new Date(Number(job.deadline) * 1000).toISOString(),
          createdAt: Number(job.created_at),
          resultHash: job.result_hash ? Buffer.from(job.result_hash).toString('hex') : null
        };
      } catch (e) {
        return null;
      }
    }).filter(j => j !== null);

    // Sort by jobId descending (newest first)
    jobs.sort((a, b) => b.jobId - a.jobId);

    // Cache unfiltered results
    cache.jobs.data = jobs;
    cache.jobs.timestamp = Date.now();

    // Filter by status if requested
    let result = jobs;
    if (status) {
      result = jobs.filter(j => j.status === status);
    }

    res.json(result.slice(0, limit));
  } catch (err) {
    console.error('Error fetching jobs:', err.message);
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

// GET /jobs/:id - Get single job
app.get('/jobs/:id', async (req, res) => {
  try {
    const jobId = parseInt(req.params.id);

    if (isNaN(jobId) || jobId < 0) {
      return res.status(400).json({ error: 'Invalid job ID' });
    }

    const jobPda = getJobPda(jobId);
    const accountInfo = await connection.getAccountInfo(jobPda);

    if (!accountInfo) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const job = coder.decode('Job', accountInfo.data);
    const jobStatus = getJobStatus(job.status);

    res.json({
      jobId: Number(job.job_id),
      pda: jobPda.toBase58(),
      hirer: job.hirer.toBase58(),
      worker: job.worker.toBase58() === '11111111111111111111111111111111' ? null : job.worker.toBase58(),
      amount: Number(job.amount) / 1e9,
      amountRaw: job.amount.toString(),
      status: jobStatus,
      description: job.description,
      deadline: Number(job.deadline),
      deadlineDate: new Date(Number(job.deadline) * 1000).toISOString(),
      createdAt: Number(job.created_at),
      resultHash: job.result_hash ? Buffer.from(job.result_hash).toString('hex') : null
    });
  } catch (err) {
    console.error('Error fetching job:', err.message);
    res.status(500).json({ error: 'Failed to fetch job' });
  }
});

// =============================================================================
// AGENT PROFILE ENDPOINTS
// =============================================================================

// GET /agents - List all agent profiles
app.get('/agents', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);

    if (isCacheValid(cache.agents)) {
      return res.json(cache.agents.data.slice(0, limit));
    }

    // Fetch all AgentProfile accounts
    const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
      filters: [
        { memcmp: { offset: 0, bytes: anchor.utils.bytes.bs58.encode(AGENT_PROFILE_DISCRIMINATOR) } }
      ]
    });

    const agents = accounts.map(({ pubkey, account }) => {
      try {
        const profile = coder.decode('AgentProfile', account.data);
        const solveCount = Number(profile.cached_solve_count);
        return {
          pda: pubkey.toBase58(),
          owner: profile.owner.toBase58(),
          name: profile.name,
          description: profile.description,
          solveCount: solveCount,
          tier: getTier(solveCount),
          jobsPosted: Number(profile.jobs_posted),
          jobsCompletedAsHirer: Number(profile.jobs_completed_as_hirer),
          jobsCompletedAsWorker: Number(profile.jobs_completed_as_worker),
          disputesAsParty: Number(profile.disputes_as_party),
          disputesWon: Number(profile.disputes_won),
          disputesLost: Number(profile.disputes_lost),
          registeredAt: Number(profile.registered_at),
          active: profile.active
        };
      } catch (e) {
        return null;
      }
    }).filter(a => a !== null);

    // Sort by jobs completed descending
    agents.sort((a, b) => (b.jobsCompletedAsWorker + b.jobsCompletedAsHirer) - (a.jobsCompletedAsWorker + a.jobsCompletedAsHirer));

    cache.agents.data = agents;
    cache.agents.timestamp = Date.now();

    res.json(agents.slice(0, limit));
  } catch (err) {
    console.error('Error fetching agents:', err.message);
    res.status(500).json({ error: 'Failed to fetch agents' });
  }
});

// GET /agents/:address - Get single agent profile
app.get('/agents/:address', async (req, res) => {
  try {
    let ownerPubkey;
    try {
      ownerPubkey = new PublicKey(req.params.address);
    } catch {
      return res.status(400).json({ error: 'Invalid address' });
    }

    const profilePda = getAgentProfilePda(ownerPubkey);
    const accountInfo = await connection.getAccountInfo(profilePda);

    if (!accountInfo) {
      return res.status(404).json({ error: 'Agent profile not found' });
    }

    const profile = coder.decode('AgentProfile', accountInfo.data);
    const solveCount = Number(profile.cached_solve_count);

    res.json({
      pda: profilePda.toBase58(),
      owner: profile.owner.toBase58(),
      name: profile.name,
      description: profile.description,
      solveCount: solveCount,
      tier: getTier(solveCount),
      jobsPosted: Number(profile.jobs_posted),
      jobsCompletedAsHirer: Number(profile.jobs_completed_as_hirer),
      jobsCompletedAsWorker: Number(profile.jobs_completed_as_worker),
      disputesAsParty: Number(profile.disputes_as_party),
      disputesWon: Number(profile.disputes_won),
      disputesLost: Number(profile.disputes_lost),
      registeredAt: Number(profile.registered_at),
      active: profile.active
    });
  } catch (err) {
    console.error('Error fetching agent:', err.message);
    res.status(500).json({ error: 'Failed to fetch agent' });
  }
});

// =============================================================================
// REAL-TIME EVENTS (Server-Sent Events)
// =============================================================================

// GET /events - SSE endpoint for real-time updates
app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Send initial connection message
  res.write(`event: connected\ndata: ${JSON.stringify({ message: 'Connected to Ecash event stream' })}\n\n`);

  // Add client to set
  sseClients.add(res);
  console.log(`SSE client connected. Total clients: ${sseClients.size}`);

  // Send heartbeat every 30 seconds
  const heartbeat = setInterval(() => {
    res.write(`event: heartbeat\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);
  }, 30000);

  // Remove client on disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
    console.log(`SSE client disconnected. Total clients: ${sseClients.size}`);
  });
});

// =============================================================================
// PROGRAM ACCOUNT CHANGE LISTENER (for broadcasting events)
// =============================================================================

// Start watching for job changes
let lastKnownJobCount = 0;
let lastKnownJobStates = new Map();

async function pollForChanges() {
  try {
    // Only poll if we have SSE clients
    if (sseClients.size === 0) return;

    const globalState = await fetchGlobalState();
    const currentJobCount = Number(globalState.next_job_id);

    // Check for new jobs
    if (currentJobCount > lastKnownJobCount) {
      for (let i = lastKnownJobCount; i < currentJobCount; i++) {
        const jobPda = getJobPda(i);
        const accountInfo = await connection.getAccountInfo(jobPda);
        if (accountInfo) {
          const job = coder.decode('Job', accountInfo.data);
          broadcastEvent('job_created', {
            jobId: i,
            hirer: job.hirer.toBase58(),
            amount: Number(job.amount) / 1e9,
            description: job.description,
            deadline: Number(job.deadline)
          });
        }
      }
      lastKnownJobCount = currentJobCount;
    }

    // Check for job status changes (sample recent jobs)
    const recentJobIds = [];
    for (let i = Math.max(0, currentJobCount - 20); i < currentJobCount; i++) {
      recentJobIds.push(i);
    }

    for (const jobId of recentJobIds) {
      const jobPda = getJobPda(jobId);
      const accountInfo = await connection.getAccountInfo(jobPda);
      if (accountInfo) {
        const job = coder.decode('Job', accountInfo.data);
        const currentStatus = getJobStatus(job.status);
        const previousStatus = lastKnownJobStates.get(jobId);

        if (previousStatus && previousStatus !== currentStatus) {
          broadcastEvent('job_updated', {
            jobId,
            previousStatus,
            newStatus: currentStatus,
            worker: job.worker.toBase58() === '11111111111111111111111111111111' ? null : job.worker.toBase58()
          });
        }
        lastKnownJobStates.set(jobId, currentStatus);
      }
    }
  } catch (err) {
    console.error('Poll error:', err.message);
  }
}

// Poll every 10 seconds
setInterval(pollForChanges, 10000);

// Initialize on startup
fetchGlobalState().then(gs => {
  lastKnownJobCount = Number(gs.next_job_id);
  console.log(`Initialized job watcher. Current job count: ${lastKnownJobCount}`);
}).catch(err => {
  console.error('Failed to initialize job watcher:', err.message);
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// =============================================================================
// START SERVER
// =============================================================================

app.listen(PORT, () => {
  console.log(`Ecash Solana API server running on port ${PORT}`);
  console.log(`Program: ${PROGRAM_ID.toBase58()}`);
  console.log(`Mint: ${MINT.toBase58()}`);
  console.log(`Total puzzles: ${TOTAL_PUZZLES}`);
});
