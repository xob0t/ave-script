/**
 * Blacklist operations - add/remove users and offers
 */

import { addUser, removeUser, addOffer, removeOffer } from './db';
import {
  addToBlacklistUsers,
  removeFromBlacklistUsers,
  addToBlacklistOffers,
  removeFromBlacklistOffers
} from './state';

const LOG_PREFIX = '[ave]';

export async function addUserToBlacklist(userId: string): Promise<void> {
  addToBlacklistUsers(userId);
  await addUser(userId);
  console.log(`${LOG_PREFIX} seller ${userId} added to blacklist`);
}

export async function removeUserFromBlacklist(userId: string): Promise<void> {
  removeFromBlacklistUsers(userId);
  await removeUser(userId);
  console.log(`${LOG_PREFIX} seller ${userId} removed from blacklist`);
}

export async function addOfferToBlacklist(offerId: string): Promise<void> {
  addToBlacklistOffers(offerId);
  await addOffer(offerId);
  console.log(`${LOG_PREFIX} offer ${offerId} added to blacklist`);
}

export async function removeOfferFromBlacklist(offerId: string): Promise<void> {
  removeFromBlacklistOffers(offerId);
  await removeOffer(offerId);
  console.log(`${LOG_PREFIX} offer ${offerId} removed from blacklist`);
}
