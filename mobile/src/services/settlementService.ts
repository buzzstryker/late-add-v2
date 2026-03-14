/**
 * Settlement Service — framework-agnostic settlement/payout calculations.
 *
 * Calculates who owes whom based on round results.
 * Provides transaction minimization to reduce the number of Venmo payments.
 * Includes Venmo deep-link URL construction.
 */
import { LeagueScore } from '../models/League';
import { getRoundNetAmounts } from './leagueService';

export interface SettlementEntry {
  fromPlayerId: string;
  toPlayerId: string;
  amount: number; // always positive
  description: string;
}

export interface RoundSettlement {
  roundId: string;
  groupId: string;
  roundDate: string;
  entries: SettlementEntry[];
  playerNetAmounts: Map<string, number>;
  totalPool: number;
}

export interface VenmoUrls {
  deepLink: string;
  webFallback: string;
}

// ── Round Settlement ──

/**
 * Calculate settlement entries for a single round.
 *
 * For scoresOverride=true rounds, the scores ARE net $ amounts (used directly).
 * For scoresOverride=false rounds, the scores are game points —
 * round-robin is applied by getRoundNetAmounts(), then optionally multiplied
 * by stakePerPoint to convert points to dollars.
 */
export function calculateRoundSettlement(
  scores: LeagueScore[],
  scoresOverride: boolean,
  roundId: string,
  groupId: string,
  roundDate: string,
  stakePerPoint?: number,
): RoundSettlement {
  // 1. Get per-player net amounts
  const netAmounts = getRoundNetAmounts(scores, scoresOverride);

  // 2. For non-override rounds with stakePerPoint, multiply nets by stake
  let balances: Map<string, number>;
  if (!scoresOverride && stakePerPoint && stakePerPoint > 0) {
    balances = new Map();
    for (const [pid, net] of netAmounts) {
      balances.set(pid, Math.round(net * stakePerPoint * 100) / 100);
    }
  } else {
    balances = netAmounts;
  }

  // 3. Build settlement entries
  const entries = buildSettlementEntries(balances);

  // 4. Set round-specific descriptions
  for (const entry of entries) {
    entry.description = `Round settlement — ${roundDate}`;
  }

  const totalPool = entries.reduce((sum, e) => sum + e.amount, 0);

  return {
    roundId,
    groupId,
    roundDate,
    entries,
    playerNetAmounts: balances,
    totalPool: Math.round(totalPool * 100) / 100,
  };
}

// ── Generic Settlement Helpers ──

/**
 * Build settlement entries from a balance map (player -> net amount).
 * Positive balance = owed money, negative = owes money.
 * Uses a greedy pairing to minimize number of transactions.
 */
export function buildSettlementEntries(
  balances: Map<string, number>,
): SettlementEntry[] {
  // Separate into creditors (owed money) and debtors (owe money)
  const creditors: { playerId: string; amount: number }[] = [];
  const debtors: { playerId: string; amount: number }[] = [];

  for (const [playerId, balance] of balances) {
    if (balance > 0.005) {
      creditors.push({ playerId, amount: balance });
    } else if (balance < -0.005) {
      debtors.push({ playerId, amount: -balance }); // store as positive
    }
  }

  // Sort descending by amount
  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);

  const entries: SettlementEntry[] = [];
  let ci = 0;
  let di = 0;

  while (ci < creditors.length && di < debtors.length) {
    const creditor = creditors[ci];
    const debtor = debtors[di];

    const amount = Math.min(creditor.amount, debtor.amount);
    const rounded = Math.round(amount * 100) / 100;

    if (rounded > 0) {
      entries.push({
        fromPlayerId: debtor.playerId,
        toPlayerId: creditor.playerId,
        amount: rounded,
        description: '',
      });
    }

    creditor.amount -= amount;
    debtor.amount -= amount;

    if (creditor.amount < 0.005) ci++;
    if (debtor.amount < 0.005) di++;
  }

  return entries;
}

/**
 * Minimize the number of transactions needed to settle all debts.
 * Takes existing entries and recomputes using net balances.
 */
export function minimizeTransactions(entries: SettlementEntry[]): SettlementEntry[] {
  // Compute net balance for each player from the entries
  const balances = new Map<string, number>();

  for (const entry of entries) {
    const fromBalance = balances.get(entry.fromPlayerId) ?? 0;
    balances.set(entry.fromPlayerId, fromBalance - entry.amount);

    const toBalance = balances.get(entry.toPlayerId) ?? 0;
    balances.set(entry.toPlayerId, toBalance + entry.amount);
  }

  return buildSettlementEntries(balances);
}

// ── Venmo URL Builders ──

/**
 * Build Venmo pay URL (deep link + web fallback).
 * Used when the payer wants to send money to the recipient.
 */
export function buildVenmoPayUrl(
  recipientHandle: string,
  amount: number,
  note: string,
): VenmoUrls {
  const amountStr = amount.toFixed(2);
  const encodedNote = encodeURIComponent(note);
  return {
    deepLink: `venmo://paycharge?txn=pay&recipients=${recipientHandle}&amount=${amountStr}&note=${encodedNote}`,
    webFallback: `https://venmo.com/${recipientHandle}?txn=pay&amount=${amountStr}&note=${encodedNote}`,
  };
}

/**
 * Build Venmo request URL (deep link + web fallback).
 * Used when the recipient wants to request money from the payer.
 */
export function buildVenmoRequestUrl(
  fromHandle: string,
  amount: number,
  note: string,
): VenmoUrls {
  const amountStr = amount.toFixed(2);
  const encodedNote = encodeURIComponent(note);
  return {
    deepLink: `venmo://paycharge?txn=charge&recipients=${fromHandle}&amount=${amountStr}&note=${encodedNote}`,
    webFallback: `https://venmo.com/${fromHandle}?txn=charge&amount=${amountStr}&note=${encodedNote}`,
  };
}
